"use client";
import React, { useState } from 'react';
import { GoogleGenerativeAI } from "@google/generative-ai";
import JSZip from 'jszip';

const DATE_YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;
const DATE_DD_MM_YYYY = /^\d{2}-\d{2}-\d{4}$/;
const FILE_NO_RE = /\bACQ\d+-\d+\b/;
const ID_RE = /\b\d{6}\b/;

export default function Home() {
  const [status, setStatus] = useState('');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 初始化 API
  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  const genAI = new GoogleGenerativeAI(apiKey || "");

  const extractJsonObject = (raw: string) => {
    const text = raw.replace(/```json|```/g, "").trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("AI 回覆未包含 JSON 物件。");
    }
    return JSON.parse(text.slice(start, end + 1));
  };

  const normalizeDate = (dateLike: unknown): string | null => {
    if (typeof dateLike !== "string") return null;
    const s = dateLike.trim();
    if (DATE_YYYY_MM_DD.test(s)) return s;
    if (DATE_DD_MM_YYYY.test(s)) {
      const [dd, mm, yyyy] = s.split("-");
      return `${yyyy}-${mm}-${dd}`;
    }
    return null;
  };

  const fileToGenerativePart = async (file: File) => {
    const base64 = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      reader.readAsDataURL(file);
    });
    return { inlineData: { data: base64, mimeType: file.type } };
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0 || !apiKey) {
      if (!apiKey) setStatus("❌ 找不到 API Key，請檢查 .env.local 並重啟 npm run dev");
      return;
    }

    setLoading(true);
    setStatus('🚀 AI 正在識別維修單資料...');
    setDownloadUrl(null);
    const zip = new JSZip();

    try {
      // Some API keys may not support certain model IDs; try a small fallback list.
      const candidateModels = ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-1.0-pro-vision-latest"];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const imagePart = await fileToGenerativePart(file);
        
        const prompt = `你是一個專門讀取「維修報告單右上角欄位」的 OCR + 資料抽取助手。

請只關注右上角的這三個欄位，並依序抽取：

1) 服務日期：通常是 DD-MM-YYYY（例如 22-12-2025）。請轉成 YYYY-MM-DD（例如 2025-12-22）。
2) 檔案號碼 File No.：格式為 ACQ\\d+-\\d+（例如 ACQ68-42171）。
3) ID：六位數字 \\d{6}（例如 151564）。

請嚴格只回傳 JSON（不要任何額外文字/Markdown）：
{"date":"2025-12-22","fileNo":"ACQ68-42171","id":"151564"}`;

        let responseText = "";
        let lastErr: any = null;
        for (const modelId of candidateModels) {
          try {
            const model = genAI.getGenerativeModel({ model: modelId });
            const result = await model.generateContent([prompt, imagePart]);
            responseText = result.response.text();
            break;
          } catch (e: any) {
            lastErr = e;
          }
        }
        if (!responseText) throw lastErr ?? new Error("Gemini 無法回應。");

        const data = extractJsonObject(responseText);
        const date = normalizeDate(data?.date);
        const fileNo =
          typeof data?.fileNo === "string" && FILE_NO_RE.test(data.fileNo)
            ? data.fileNo.match(FILE_NO_RE)?.[0] ?? null
            : (responseText.match(FILE_NO_RE)?.[0] ?? null);
        const id =
          typeof data?.id === "string" && ID_RE.test(data.id)
            ? data.id.match(ID_RE)?.[0] ?? null
            : (responseText.match(ID_RE)?.[0] ?? null);

        if (!date || !fileNo || !id) {
          throw new Error(
            `未能完整抽取欄位（date/fileNo/id）。目前解析到：date=${date ?? "null"}, fileNo=${fileNo ?? "null"}, id=${id ?? "null"}`
          );
        }

        const newName = `${date}_${fileNo}_${id}.pdf`;
        zip.file(newName, file);
        setStatus(`✅ 已辨識: ${newName}`);
      }

      const content = await zip.generateAsync({ type: "blob" });
      setDownloadUrl(URL.createObjectURL(content));
      setStatus('🎊 處理成功！請點擊按鈕下載。');
    } catch (error: any) {
      console.error(error);
      setStatus(`❌ 錯誤: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
      <div className="bg-white p-10 rounded-3xl shadow-xl w-full max-w-md text-center border border-gray-100">
        <h1 className="text-2xl font-black text-gray-800 mb-6">AI PDF 批量改名</h1>
        
        <label className={`block w-full py-12 border-4 border-dashed rounded-2xl cursor-pointer transition ${loading ? 'bg-gray-50 border-gray-300' : 'bg-indigo-50 border-indigo-200 hover:bg-indigo-100'}`}>
          <span className="text-indigo-600 font-bold">{loading ? 'AI 正在分析...' : '點擊上傳維修單'}</span>
          <input type="file" multiple accept="application/pdf,image/*" onChange={handleFileUpload} disabled={loading} className="hidden" />
        </label>

        <div className="mt-6 p-4 bg-gray-900 rounded-xl min-h-[60px] flex items-center justify-center">
          <p className="text-xs text-green-400 font-mono break-all">{status || "READY"}</p>
        </div>

        {downloadUrl && (
          <a href={downloadUrl} download="Renamed_Files.zip" className="mt-6 block w-full bg-green-600 text-white py-4 rounded-xl font-bold shadow-lg hover:bg-green-700 transition">
            📥 下載已改名壓縮檔 (.zip)
          </a>
        )}
      </div>
    </main>
  );
}
