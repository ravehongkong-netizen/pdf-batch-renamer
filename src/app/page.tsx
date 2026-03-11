"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { GoogleGenerativeAI } from "@google/generative-ai";
import JSZip from "jszip";
import { useDropzone } from "react-dropzone";
import { pdfToCanvases } from "@/lib/pdf-to-canvases";

type FileResult = {
  file: File;
  text?: string;
  date?: string | null;
  fileNo?: string | null;
  id?: string | null;
  error?: string | null;
};

const DATE_REGEX = /\b\d{4}-\d{2}-\d{2}\b/;
const FILE_NO_REGEX = /\bACQ\d+-\d+\b/;
const ID_REGEX = /\b\d{6}\b/;

export default function Home() {
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<FileResult[]>([]);
  const [status, setStatus] = useState<string>("READY");
  const [progress, setProgress] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const savedKey = window.localStorage.getItem("pdf_batch_renamer_api_key");
    if (savedKey) {
      setApiKeyInput(savedKey);
      setApiKeySaved(true);
    }
  }, []);

  const handleSaveApiKey = useCallback(() => {
    const k = apiKeyInput.trim();
    if (!k) {
      setApiKeySaved(false);
      setError("請先輸入 API Key。");
      return;
    }
    window.localStorage.setItem("pdf_batch_renamer_api_key", k);
    setApiKeySaved(true);
    setError(null);
    setStatus("✅ API Key 已儲存。");
  }, [apiKeyInput]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const pdfFiles = acceptedFiles.filter((f) =>
      f.name.toLowerCase().endsWith(".pdf")
    );
    setFiles(pdfFiles);
    setResults([]);
    setDownloadUrl(null);
    setStatus(
      pdfFiles.length
        ? `已選擇 ${pdfFiles.length} 份 PDF，請點「開始 OCR & 解析」`
        : "尚未加入 PDF。"
    );
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    multiple: true,
    disabled: loading,
  });

  const totalSteps = useMemo(
    () => (files.length > 0 ? files.length : 1),
    [files.length]
  );

  const extractFields = (text: string) => {
    const date = text.match(DATE_REGEX)?.[0] ?? null;
    const fileNo = text.match(FILE_NO_REGEX)?.[0] ?? null;
    const id = text.match(ID_REGEX)?.[0] ?? null;
    return { date, fileNo, id };
  };

  const blobToGenerativePart = async (blob: Blob, mimeType: string) => {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = () => reject(new Error("Failed to read image."));
      reader.readAsDataURL(blob);
    });
    return { inlineData: { data: base64, mimeType } };
  };

  const ocrWithGemini = async (image: Blob) => {
    const key = apiKeyInput.trim();
    if (!key) throw new Error("請先在上方輸入並儲存 Gemini API Key。");

    const genAI = new GoogleGenerativeAI(key);
    // Different API keys / regions may expose different model IDs.
    // Use a safe fallback list and avoid the "models/" prefix for v1beta.
    const candidateModels = [
      "gemini-1.5-flash",
      "gemini-1.5-flash-latest",
      "gemini-1.5-pro",
      "gemini-1.5-pro-latest",
    ];

    const imagePart = await blobToGenerativePart(image, "image/png");
    const prompt =
      "你是一個OCR。請把圖片中的所有文字完整轉成純文字輸出，保留原本換行。不要解釋、不要加Markdown、不要加JSON，只輸出文字內容。";

    let lastErr: unknown = null;
    for (const modelId of candidateModels) {
      try {
        const model = genAI.getGenerativeModel({ model: modelId });
        const result = await model.generateContent([prompt, imagePart]);
        const text = result.response.text();
        return text.replace(/```/g, "").trim();
      } catch (e) {
        lastErr = e;
      }
    }
    const msg =
      (lastErr as any)?.message ??
      "Gemini OCR failed (no supported model for this API key).";
    throw new Error(msg);
  };

  const handleProcess = useCallback(async () => {
    if (!files.length) {
      setStatus("請先拖放或選擇至少一份 PDF。");
      return;
    }

    setLoading(true);
    setError(null);
    setStatus("🚀 開始 OCR 與正則解析...");
    setProgress(0);
    setResults([]);
    setDownloadUrl(null);

    const zip = new JSZip();

    try {
      const nextResults: FileResult[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setStatus(`📄 讀取第 ${i + 1}/${files.length} 份：${file.name}`);

        try {
          const pdfData = await file.arrayBuffer();
          const canvases = await pdfToCanvases(pdfData, {
            scale: 2,
            onPageRendered: ({ pageIndex, pageCount }) => {
              setStatus(
                `🖼️ PDF 轉圖片中：${file.name} (${pageIndex + 1}/${pageCount})`
              );
            },
          });

          if (!canvases.length) {
            throw new Error("PDF 沒有任何頁面。");
          }

          const firstPage = canvases[0];
          const imageBlob = await new Promise<Blob>((resolve, reject) => {
            firstPage.toBlob(
              (b) => (b ? resolve(b) : reject(new Error("Failed to export image."))),
              "image/png"
            );
          });
          setStatus(`🤖 Gemini OCR 辨識中：${file.name}`);
          const text = await ocrWithGemini(imageBlob);
          const { date, fileNo, id } = extractFields(text);

          let newName: string;
          if (date && fileNo && id) {
            newName = `${date}_${fileNo}_${id}.pdf`;
          } else {
            const base = file.name.replace(/\.pdf$/i, "");
            newName = `${base}_UNPARSED.pdf`;
          }

          zip.file(newName, file);

          nextResults.push({
            file,
            text,
            date,
            fileNo,
            id,
            error:
              date && fileNo && id
                ? null
                : "未能完整匹配到三個欄位（日期/檔案號碼/ID）。",
          });

          setResults([...nextResults]);
        } catch (err: any) {
          console.error(err);
          nextResults.push({
            file,
            error: err?.message ?? "未知錯誤",
          });
          setResults([...nextResults]);
        }

        setProgress(((i + 1) / totalSteps) * 100);
      }

      const content = await zip.generateAsync({ type: "blob" });
      setDownloadUrl(URL.createObjectURL(content));
      setStatus("🎊 完成！請下載已改名 ZIP 檔。");
    } catch (err: any) {
      console.error(err);
      setError(err?.message ?? "處理過程中發生錯誤。");
      setStatus("❌ 發生錯誤，請稍後再試。");
    } finally {
      setLoading(false);
    }
  }, [files, totalSteps]);

  const handleClear = useCallback(() => {
    setFiles([]);
    setResults([]);
    setDownloadUrl(null);
    setProgress(0);
    setStatus("READY");
    setError(null);
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-3xl space-y-6">
        <header className="space-y-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight">
            PDF Batch Renamer (OCR)
          </h1>
          <p className="text-sm text-muted-foreground">
            拖放多個 PDF → 轉圖片 → 用家自填 Gemini API Key 進行 OCR → 正則抽取日期 / 檔案號碼 / ID → ZIP 批量改名下載。
          </p>
        </header>

        <section className="rounded-xl border bg-card p-5 shadow-sm space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span>🔑</span>
            <span>Gemini API 設定</span>
          </div>
          <p className="text-xs text-muted-foreground">
            請輸入你的 Gemini API Key。你可以到{" "}
            <a
              className="underline underline-offset-2 hover:text-foreground"
              href="https://aistudio.google.com/"
              target="_blank"
              rel="noreferrer"
            >
              Google AI Studio
            </a>{" "}
            免費獲取。
          </p>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex-1">
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => {
                  setApiKeyInput(e.target.value);
                  setApiKeySaved(false);
                }}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="輸入 Gemini API Key（只會儲存在你的瀏覽器）"
                autoComplete="off"
              />
            </div>
            <button
              type="button"
              onClick={handleSaveApiKey}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
            >
              儲存
            </button>
          </div>
          <div className="text-[11px] text-muted-foreground">
            狀態：{apiKeySaved ? "✅ 已儲存" : "未儲存"}
          </div>
        </section>

        <section className="rounded-xl border bg-card p-4 shadow-sm space-y-4">
          <div
            {...getRootProps()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition ${
              loading
                ? "border-muted bg-muted/40 text-muted-foreground"
                : isDragActive
                ? "border-primary bg-primary/5 text-primary"
                : "border-muted-foreground/30 hover:border-primary/60 hover:bg-muted/40"
            }`}
          >
            <input {...getInputProps()} />
            <p className="text-sm font-medium">
              {isDragActive
                ? "放開滑鼠以上傳 PDF"
                : "拖放 PDF 到此處，或點擊選擇檔案"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              建議一次 1–10 份 PDF 測試；速度與頁數與解析度有關。
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleProcess}
              disabled={loading || !files.length}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "處理中..." : "開始 OCR & 解析"}
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={loading && !files.length}
              className="inline-flex items-center justify-center rounded-md border bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              清空
            </button>
            {downloadUrl && (
              <a
                href={downloadUrl}
                download="Renamed_Files.zip"
                className="inline-flex items-center justify-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-emerald-700"
              >
                📥 下載已改名 ZIP
              </a>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>進度</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="rounded-md bg-black px-3 py-2 text-xs font-mono text-emerald-400">
            {status}
          </div>
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </section>

        <section className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
          <h2 className="text-sm font-semibold">結果</h2>
          <p className="text-xs text-muted-foreground">
            正則：日期 YYYY-MM-DD，檔案號碼 ACQ\d+-\d+，ID \d{6}。
            目標檔名：{"{date}_{filename}_{ID}.pdf"}（例如：
            2026-01-06_ACQ68-42200_151653.pdf）
          </p>

          {!results.length && (
            <p className="text-xs text-muted-foreground">尚未加入 PDF。</p>
          )}

          {!!results.length && (
            <div className="space-y-2 max-h-64 overflow-y-auto text-xs">
              {results.map((r) => (
                <div
                  key={r.file.name + r.error}
                  className="rounded-md border bg-background px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{r.file.name}</span>
                    {r.error ? (
                      <span className="text-[11px] text-destructive">
                        {r.error}
                      </span>
                    ) : (
                      <span className="text-[11px] text-emerald-600">
                        ✅ 已匹配
                      </span>
                    )}
                  </div>
                  <div className="mt-1 grid grid-cols-1 gap-1 text-[11px] sm:grid-cols-3">
                    <span>日期：{r.date ?? "—"}</span>
                    <span>檔案號碼：{r.fileNo ?? "—"}</span>
                    <span>ID：{r.id ?? "—"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
