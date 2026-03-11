"use client";
import React, { useState } from 'react';
import { GoogleGenerativeAI } from "@google/generative-ai";
import JSZip from 'jszip';
import { pdfToCanvases } from "@/lib/pdf-to-canvases";

export default function Home() {
  const [status, setStatus] = useState('');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 初始化 API
  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  const genAI = new GoogleGenerativeAI(apiKey || "");

  const fileToGenerativePart = async (file: Blob, mimeType: string) => {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = () => reject(new Error("Failed to read file."));
      reader.readAsDataURL(file);
    });
    return { inlineData: { data: base64, mimeType } };
  };

  const extractJsonObject = (raw: string) => {
    const text = raw.replace(/```json|```/g, "").trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("AI response did not contain a JSON object.");
    }
    return JSON.parse(text.slice(start, end + 1));
  };

  const pdfToPngBlob = async (file: File) => {
    const pdfData = await file.arrayBuffer();
    const canvases = await pdfToCanvases(pdfData, {
      scale: 2,
      onPageRendered: ({ pageIndex, pageCount }) => {
        setStatus(`🖼️ 轉換 PDF 頁面中... (${pageIndex + 1}/${pageCount})`);
      },
    });
    if (canvases.length === 0) throw new Error("PDF has no pages.");

    // Default: use first page to keep it fast (can be extended to multi-page).
    const first = canvases[0];
    const blob = await new Promise<Blob>((resolve, reject) => {
      first.toBlob((b) => (b ? resolve(b) : reject(new Error("Failed to export canvas."))), "image/png");
    });
    return blob;
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
      // 重點：模型名稱改為完整路徑 "models/gemini-1.5-flash"
      const model = genAI.getGenerativeModel({ model: "models/gemini-1.5-flash" });

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        let imageBlob: Blob;
        let imageMime = "image/png";

        if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
          setStatus(`📄 讀取 PDF：${file.name}`);
          imageBlob = await pdfToPngBlob(file);
        } else if (file.type.startsWith("image/")) {
          imageBlob = file;
          imageMime = file.type;
        } else {
          throw new Error(`Unsupported file type: ${file.type || file.name}`);
        }

        const imagePart = await fileToGenerativePart(imageBlob, imageMime);
        
        const prompt = `你是一個專業的資料提取員。請從這張維修報告中提取以下資訊：
        1. 服務日期 (請將 DD-MM-YYYY 格式轉換為 YYYY-MM-DD)
        2. 檔案號碼 (File No.)
        3. ID
        
        請嚴格只回傳 JSON，例如：{"date": "2025-10-30", "fileNo": "ACQ68-42121", "id": "51085"}`;

        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        const data = extractJsonObject(response.text());

        // 命名格式：2025-10-30_ACQ68-42121_51085.pdf
        const newName = `${data.date}_${data.fileNo}_${data.id}.pdf`;
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
