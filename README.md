## PDF Batch Renamer (OCR)

Next.js 14 + TypeScript + shadcn/ui 的瀏覽器端工具：

- 拖放/批量上傳多個 PDF
- 前端使用 Tesseract.js OCR（支援中文 `chi_tra` / `chi_sim`）
- 每份 PDF 自動抽取：
  - 日期：`YYYY-MM-DD`
  - 檔案號碼：`ACQ\d+-\d+`
  - ID：`\d{6}`
- 改名為：`{date}_{filename}_{ID}.pdf`
- 批量下載 ZIP

## Getting Started

Install dependencies and run the dev server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Notes

- OCR 與 PDF 轉圖都在瀏覽器端執行（不會上傳 PDF 到伺服器）。
- `pdfjs-dist` 的 worker 目前使用 CDN 載入（避免 Next 14 production build 去打包/壓縮 worker）。

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
