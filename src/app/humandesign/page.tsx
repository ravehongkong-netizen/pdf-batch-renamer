"use client";

import Link from "next/link";

export default function HumanDesignExcelPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-2xl space-y-6 text-center">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">
            人類圖 Polly 2025 網頁版
          </h1>
          <p className="text-sm text-muted-foreground">
            輸入對象名稱，依公式自動顯示各項分析結果
          </p>
        </header>

        <section className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
          <p className="text-sm text-muted-foreground">
            請選擇要使用的版本：
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/humandesign-app"
              className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-base font-medium text-primary-foreground shadow hover:bg-primary/90"
            >
              人類圖網頁版（推薦）
            </Link>
            <Link
              href="/humandesign-excel/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-md border bg-background px-6 py-3 text-base font-medium hover:bg-muted"
            >
              試算表檢視
            </Link>
          </div>
          <ul className="text-sm text-left list-disc list-inside space-y-1 text-muted-foreground">
            <li><strong>人類圖網頁版</strong>：輸入 D1 對象後，依公式自動顯示類型、輪回交叉、爻辭等</li>
            <li><strong>試算表檢視</strong>：以 Excel 風格開啟並編輯檔案</li>
          </ul>

          <p className="text-xs text-muted-foreground">
            請將「人類圖Polly 2025.xlsx」放在 public/humandesign-excel/ 資料夾。
          </p>
        </section>

        <Link
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground underline"
        >
          ← 返回首頁
        </Link>
      </div>
    </main>
  );
}
