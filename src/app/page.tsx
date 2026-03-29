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
  tickColumn?: string | null;
  error?: string | null;
  /** 寫入 ZIP 的檔名；處理失敗時可能為空 */
  outputFileName?: string;
};

const DATE_REGEX = /\b\d{4}-\d{2}-\d{2}\b/;
const FILE_NO_REGEX = /\bACQ\d+-\d+\b/;
const ID_REGEX = /\b\d{6}\b/;
const DATE_DD_MM_YYYY_REGEX = /\b\d{2}-\d{2}-\d{4}\b/;

function isQuotaExceeded(err: unknown): boolean {
  const e = err as any;
  const msg = String(e?.message ?? e?.cause?.message ?? "").toLowerCase();
  const nested = String(e?.error?.message ?? e?.response?.data?.error?.message ?? "").toLowerCase();
  const combined = `${msg} ${nested}`;

  const http =
    typeof e?.status === "number"
      ? e.status
      : typeof e?.code === "number" && e.code >= 400 && e.code < 600
        ? e.code
        : typeof e?.response?.status === "number"
          ? e.response.status
          : undefined;

  // 429：多數 API 表示請求過於頻繁／額度相關（含 SDK 把狀態寫在字串內的情況）
  if (http === 429) return true;
  if (/\[429\]|status\s*[:=]\s*429|:\s*429\s/mi.test(combined)) return true;

  // 503 常見於維護／逾時，勿單獨當成「額度用完」
  if (http === 503) {
    return (
      /quota|rate limit|resource exhausted|resource_exhausted|too many requests/i.test(
        combined
      )
    );
  }

  // 僅在訊息明確與額度／頻率限制相關時才判定（避免其他 API 的無關錯誤被誤判）
  const quotaHints =
    /quota exceeded|exceeded your quota|rate limit exceeded|rate-limit|too many requests|resource exhausted|resource_exhausted|billing|payment required/i;
  return quotaHints.test(combined);
}

const QUOTA_MESSAGE =
  "可能已達 API 使用上限或頻率限制。請稍後再試，或到服務商後台查看用量與方案。";

export default function Home() {
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [resolvedModel, setResolvedModel] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<FileResult[]>([]);
  const [status, setStatus] = useState<string>("READY");
  const [progress, setProgress] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detectRedBoxTick, setDetectRedBoxTick] = useState(true);

  useEffect(() => {
    const savedTick = window.localStorage.getItem(
      "pdf_batch_renamer_detect_red_box_tick"
    );
    if (savedTick === "0" || savedTick === "false") setDetectRedBoxTick(false);
    if (savedTick === "1" || savedTick === "true") setDetectRedBoxTick(true);

    const savedKey = window.localStorage.getItem("pdf_batch_renamer_api_key");
    if (savedKey) {
      setApiKeyInput(savedKey);
      setApiKeySaved(true);
    }
    const savedModel = window.localStorage.getItem("pdf_batch_renamer_model");
    if (savedModel) setResolvedModel(savedModel);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      "pdf_batch_renamer_detect_red_box_tick",
      detectRedBoxTick ? "1" : "0"
    );
  }, [detectRedBoxTick]);

  const listModels = async (apiKey: string) => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(
        apiKey
      )}`
    );
    const json = await res.json();
    if (!res.ok) {
      const msg =
        json?.error?.message ??
        "無法列出模型清單。請確認這是 Google AI Studio 的 Gemini API Key。";
      throw new Error(msg);
    }
    return (json?.models ?? []) as Array<{
      name?: string;
      supportedGenerationMethods?: string[];
    }>;
  };

  const pickModelFromList = (models: Array<{ name?: string; supportedGenerationMethods?: string[] }>) => {
    const candidates = models
      .filter((m) => m?.name && (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m) => m.name as string);

    // Prefer vision-capable Gemini models when available.
    const preferredOrder = [
      "models/gemini-1.5-flash",
      "models/gemini-1.5-flash-latest",
      "models/gemini-1.5-pro",
      "models/gemini-1.5-pro-latest",
      "models/gemini-1.0-pro-vision-latest",
      "models/gemini-pro-vision",
    ];

    for (const p of preferredOrder) {
      if (candidates.includes(p)) return p;
    }
    return candidates[0] ?? null;
  };

  const handleSaveApiKey = useCallback(() => {
    (async () => {
      const k = apiKeyInput.trim();
      if (!k) {
        setApiKeySaved(false);
        setResolvedModel(null);
        window.localStorage.removeItem("pdf_batch_renamer_model");
        setError("請先輸入 API Key。");
        return;
      }

      setStatus("🔎 正在驗證 API Key 與可用模型...");
      const models = await listModels(k);
      const picked = pickModelFromList(models);
      if (!picked) {
        throw new Error(
          "此 API Key 沒有任何可用的 generateContent 模型。請改用 Google AI Studio 的 Gemini API Key。"
        );
      }

      window.localStorage.setItem("pdf_batch_renamer_api_key", k);
      window.localStorage.setItem("pdf_batch_renamer_model", picked);
      setResolvedModel(picked);
      setApiKeySaved(true);
      setError(null);
      setStatus(`✅ API Key 已儲存（模型：${picked.replace(/^models\//, "")}）。`);
    })().catch((e: any) => {
      console.error(e);
      setApiKeySaved(false);
      setResolvedModel(null);
      window.localStorage.removeItem("pdf_batch_renamer_model");
      setError(e?.message ?? "API Key 驗證失敗。");
      setStatus("❌ API Key 驗證失敗。");
    });
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
    const date =
      text.match(DATE_REGEX)?.[0] ??
      (() => {
        const m = text.match(DATE_DD_MM_YYYY_REGEX)?.[0];
        if (!m) return null;
        const [dd, mm, yyyy] = m.split("-");
        return `${yyyy}-${mm}-${dd}`;
      })() ??
      null;
    const fileNo = text.match(FILE_NO_REGEX)?.[0] ?? null;
    const id = text.match(ID_REGEX)?.[0] ?? null;
    return { date, fileNo, id };
  };

  const extractJsonObject = (raw: string) => {
    const text = raw.replace(/```json|```/g, "").trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("AI 回覆未包含 JSON 物件。");
    }
    return JSON.parse(text.slice(start, end + 1));
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

  const ocrWithGemini = async (
    image: Blob,
    options: { detectRedBoxTick: boolean }
  ): Promise<string> => {
    const key = apiKeyInput.trim();
    if (!key) throw new Error("請先在上方輸入並儲存 Gemini API Key。");

    const genAI = new GoogleGenerativeAI(key);
    const modelId =
      resolvedModel ??
      window.localStorage.getItem("pdf_batch_renamer_model") ??
      "models/gemini-1.5-flash";

    const imagePart = await blobToGenerativePart(image, "image/png");

    const tickBlock = options.detectRedBoxTick
      ? `
4) 紅框勾選（tick）：表單上若有一排畫在紅色邊框內的勾選格／剔選格，由左至右依序為 A、B、C、D、E（共五格）。請仔細看哪一格內有手寫或列印的打勾記號（✓、✔、剔、V、圈選等）。只回傳被勾選的那一格對應的字母。若完全看不出有勾選、或此區塊不存在，tickColumn 請填 null。

請嚴格只回傳 JSON（不要任何額外文字/Markdown）：
{"date":"2025-12-22","fileNo":"ACQ68-42171","id":"151564","tickColumn":"A"}
其中 tickColumn 只能是 "A"、"B"、"C"、"D"、"E" 之一，或 null。`
      : "";

    const prompt = `你是一個專門讀取「維修報告單右上角欄位」的 OCR + 資料抽取助手。

請只關注右上角的這三個欄位，並依序抽取：
1) 服務日期：通常是 DD-MM-YYYY（例如 22-12-2025）。請轉成 YYYY-MM-DD（例如 2025-12-22）。
2) 檔案號碼 File No.：格式為 ACQ\\d+-\\d+（例如 ACQ68-42171）。
3) ID：六位數字 \\d{6}（例如 151564）。${tickBlock}

${
  options.detectRedBoxTick
    ? ""
    : `請嚴格只回傳 JSON（不要任何額外文字/Markdown）：
{"date":"2025-12-22","fileNo":"ACQ68-42171","id":"151564"}`
}`;

    try {
      const model = genAI.getGenerativeModel({ model: modelId });
      const result = await model.generateContent([prompt, imagePart]);
      return result.response.text();
    } catch (e: any) {
      // Quota/rate limit: do not retry, rethrow so caller can stop and prompt.
      if (isQuotaExceeded(e)) throw e;
      // If model fails (e.g. 404), try to refresh model list once.
      const models = await listModels(key);
      const picked = pickModelFromList(models);
      if (!picked) throw new Error(e?.message ?? "Gemini OCR failed.");

      window.localStorage.setItem("pdf_batch_renamer_model", picked);
      setResolvedModel(picked);

      const model = genAI.getGenerativeModel({ model: picked });
      const result = await model.generateContent([prompt, imagePart]);
      return result.response.text();
    }
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
          setStatus(`🤖 Gemini 辨識右上角欄位中：${file.name}`);
          const raw = await ocrWithGemini(imageBlob, { detectRedBoxTick });
          const data = extractJsonObject(raw);

          const parsedText = String(raw ?? "").replace(/```/g, "").trim();
          const date =
            typeof data?.date === "string" && data.date
              ? extractFields(String(data.date)).date
              : extractFields(parsedText).date;

          const fileNo =
            typeof data?.fileNo === "string" && FILE_NO_REGEX.test(data.fileNo)
              ? (data.fileNo.match(FILE_NO_REGEX)?.[0] ?? null)
              : extractFields(parsedText).fileNo;

          const id =
            typeof data?.id === "string" && ID_REGEX.test(data.id)
              ? (data.id.match(ID_REGEX)?.[0] ?? null)
              : extractFields(parsedText).id;

          let tickColumn: string | null = null;
          if (detectRedBoxTick) {
            const rawTick = data?.tickColumn;
            if (rawTick != null && rawTick !== "") {
              const t = String(rawTick).toUpperCase().trim();
              if (["A", "B", "C", "D", "E"].includes(t)) tickColumn = t;
            }
          }

          const datePart = date ?? "NA";
          const fileNoPart = fileNo ?? "NA";
          const idPart = id ?? "NA";
          const tickSuffix = detectRedBoxTick
            ? `_${tickColumn ?? "NA"}`
            : "";

          const newName = `${datePart}_${fileNoPart}_${idPart}${tickSuffix}.pdf`;

          zip.file(newName, file);

          const hasAnyNA =
            datePart === "NA" ||
            fileNoPart === "NA" ||
            idPart === "NA" ||
            (detectRedBoxTick && tickColumn == null);

          nextResults.push({
            file,
            text: parsedText,
            date,
            fileNo,
            id,
            tickColumn: detectRedBoxTick ? tickColumn : undefined,
            error: hasAnyNA
              ? "部分欄位無法辨識，檔名已以 NA 代替。"
              : null,
            outputFileName: newName,
          });

          setResults([...nextResults]);
        } catch (err: any) {
          console.error(err);
          const errMsg = err?.message ?? "未知錯誤";
          nextResults.push({ file, error: errMsg, outputFileName: undefined });
          setResults([...nextResults]);

          if (isQuotaExceeded(err)) {
            setError(`${QUOTA_MESSAGE}\n（${errMsg}）`);
            setStatus("⚠️ API 用量或頻率限制，已停止處理。");
            break;
          }
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
  }, [files, totalSteps, detectRedBoxTick]);

  const handleClear = useCallback(() => {
    setFiles([]);
    setResults([]);
    setDownloadUrl(null);
    setProgress(0);
    setStatus("READY");
    setError(null);
  }, []);

  const downloadExcel = useCallback(() => {
    if (!results.length) return;
    void import("xlsx").then((XLSX) => {
      const rows = results.map((r, idx) => ({
        序號: idx + 1,
        原始檔名: r.file.name,
        新檔名: r.outputFileName ?? "",
        服務日期: r.date ?? "NA",
        檔案號碼: r.fileNo ?? "NA",
        ID: r.id ?? "NA",
        紅框勾選:
          r.tickColumn !== undefined ? (r.tickColumn ?? "NA") : "（未啟用）",
        備註: r.error ?? "",
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "辨識結果");
      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `pdf_batch_renamer_${stamp}.xlsx`);
    });
  }, [results]);

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
              href="https://aistudio.google.com/api-keys"
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
            {apiKeySaved && resolvedModel ? (
              <>
                {" "}
                · 模型：{resolvedModel.replace(/^models\//, "")}
              </>
            ) : null}
          </div>
          <p className="text-[11px] text-amber-600/90 border border-amber-200/60 rounded px-2 py-1.5 bg-amber-50/50">
            ⚠️ 免費額度用盡時會自動停止處理並提示，可前往 Google AI Studio 查看使用量。
          </p>
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

          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border"
              checked={detectRedBoxTick}
              onChange={(e) => setDetectRedBoxTick(e.target.checked)}
              disabled={loading}
            />
            <span>
              識別紅框內勾選欄位（由左至右 A–E），並加在檔名最後（例如{" "}
              <span className="font-mono text-xs">…_151653_B.pdf</span>）
            </span>
          </label>

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
            {!!results.length && (
              <button
                type="button"
                onClick={downloadExcel}
                className="inline-flex items-center justify-center rounded-md border border-blue-600 bg-background px-4 py-2 text-sm font-medium text-blue-700 shadow-sm hover:bg-blue-50"
              >
                📊 下載 Excel
              </button>
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
            可點「下載 Excel」匯出每份 PDF 的欄位摘要。
          </p>
          <p className="text-xs text-muted-foreground">
            目標檔名：{"{date}_{fileNo}_{id}.pdf"}；任一項辨識不到則以{" "}
            <span className="font-mono">NA</span> 代替。若勾選紅框識別，檔名末尾為{" "}
            <span className="font-mono">_A</span>～<span className="font-mono">_E</span>{" "}
            或 <span className="font-mono">_NA</span>（例如：
            2026-01-06_ACQ68-42200_151653_B.pdf 或 2026-01-06_NA_151653_NA.pdf）
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
                  <div className="mt-1 grid grid-cols-1 gap-1 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
                    <span>日期：{r.date ?? "NA"}</span>
                    <span>檔案號碼：{r.fileNo ?? "NA"}</span>
                    <span>ID：{r.id ?? "NA"}</span>
                    <span>
                      紅框勾選：{" "}
                      {r.tickColumn !== undefined
                        ? r.tickColumn ?? "NA"
                        : "（未啟用）"}
                    </span>
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
