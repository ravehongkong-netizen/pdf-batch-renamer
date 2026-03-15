"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type SheetData = Record<string, (string | number)[][]>;

const SHEET_TABS = [
  "Index ",
  "Index Gate",
  "統計表",
  "個案爻辭總表",
  "爻辭",
  "閘門",
  "通道",
  "輪回交叉",
  "角色閘門",
  "9 Center ",
] as const;

export default function HumanDesignAppPage() {
  const [data, setData] = useState<SheetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("Index ");
  const [d1, setD1] = useState("");
  const [editCells, setEditCells] = useState<Record<string, Record<string, string>>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/humandesign-data");
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err?.error || "載入失敗");
      }
      const json = await res.json();
      setData(json.sheets);
      if (json.sheets?.["Index "]?.[0]?.[3]) {
        setD1(String(json.sheets["Index "][0][3] ?? ""));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const getCell = useCallback(
    (sheetName: string, row: number, col: number): string | number => {
      const key = `${sheetName}:${row}:${col}`;
      if (editCells[sheetName]?.[key] !== undefined) {
        return editCells[sheetName][key];
      }
      const sheet = data?.[sheetName];
      if (!sheet || !sheet[row]) return "";
      const val = sheet[row][col];
      return val ?? "";
    },
    [data, editCells]
  );

  const setCell = useCallback(
    (sheetName: string, row: number, col: number, value: string) => {
      setEditCells((prev) => {
        const next = { ...prev };
        if (!next[sheetName]) next[sheetName] = {};
        if (value === "") {
          delete next[sheetName][`${sheetName}:${row}:${col}`];
        } else {
          next[sheetName][`${sheetName}:${row}:${col}`] = value;
        }
        return next;
      });
    },
    []
  );

  const computedIndex = React.useMemo(() => {
    if (!data) return null;
    const tongJi = data["統計表"];
    const lunHui = data["輪回交叉"];
    const name = d1.trim();
    if (!name || !tongJi) return null;

    const col = (s: string) => {
      const map: Record<string, number> = {
        B: 1, C: 2, D: 3, F: 5, N: 13, O: 14,
        AQ: 42, AR: 43, AS: 44, AT: 45, AU: 46, AV: 47,
        AX: 49, AY: 50, AZ: 51, BA: 52, BB: 53, BC: 54,
      };
      let c = 0;
      for (const k of Object.keys(map)) if (s.includes(k)) return map[k];
      if (s.match(/^[A-Z]+$/)) {
        let n = 0;
        for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
        return n - 1;
      }
      return 0;
    };

    let type = "";
    let profile = "";
    let fenJi = "";
    let cross = "";
    let authority = "";
    const profileNums: number[] = [];

    for (let i = (tongJi?.length ?? 0) - 1; i >= 2; i--) {
      const bVal = String(tongJi[i]?.[1] ?? "").trim();
      if (bVal === name) {
        type = String(tongJi[i]?.[2] ?? "");
        profile = String(tongJi[i]?.[3] ?? "");
        fenJi = String(tongJi[i]?.[5] ?? "");
        authority = String(tongJi[i]?.[13] ?? "");
        cross = String(tongJi[i]?.[14] ?? "");
        for (const k of [42, 43, 44, 45, 46, 47]) {
          const v = tongJi[i]?.[k];
          profileNums.push(typeof v === "number" ? v : parseInt(String(v ?? "0"), 10) || 0);
        }
        break;
      }
    }

    let crossDesc = "";
    if (cross && lunHui) {
      for (let i = (lunHui?.length ?? 0) - 1; i >= 1; i--) {
        if (String(lunHui[i]?.[3] ?? "").trim() === cross) {
          crossDesc = String(lunHui[i]?.[4] ?? "");
          break;
        }
      }
    }

    return {
      type,
      profile,
      fenJi,
      cross,
      crossDesc,
      authority,
      profileNums,
    };
  }, [data, d1]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground">載入中…</div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-background px-4 py-8 gap-4">
        <div className="text-destructive">{error}</div>
        <p className="text-sm text-muted-foreground text-center max-w-md">
          請將「人類圖Polly 2025.xlsx」放到 public/humandesign-excel/ 資料夾後重新整理。
        </p>
        <button
          type="button"
          onClick={loadData}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
        >
          重新載入
        </button>
        <Link href="/" className="text-sm underline">
          ← 返回首頁
        </Link>
      </main>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <main className="min-h-screen flex flex-col bg-background">
      <header className="border-b px-4 py-2 flex items-center justify-between">
        <h1 className="font-semibold">人類圖 Polly 2025</h1>
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          返回首頁
        </Link>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <nav className="w-44 border-r overflow-y-auto py-2">
          {SHEET_TABS.filter((t) => data[t]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={cn(
                "w-full text-left px-3 py-1.5 text-sm",
                activeTab === tab ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"
              )}
            >
              {tab.trim()}
            </button>
          ))}
        </nav>

        <section className="flex-1 overflow-auto p-4">
          {activeTab === "Index " && (
            <div className="max-w-2xl space-y-6">
              <div>
                <label className="text-sm font-medium block mb-1">對象（D1）</label>
                <input
                  type="text"
                  value={d1}
                  onChange={(e) => setD1(e.target.value)}
                  placeholder="輸入姓名，例如 Polly、Celian"
                  className="w-full rounded-md border px-3 py-2"
                  list="names-list"
                />
                <datalist id="names-list">
                  {data["統計表"]?.slice(2, 552).map((row, i) => (
                    <option key={i} value={String(row[1] ?? "").trim()} />
                  ))}
                </datalist>
              </div>

              {computedIndex && d1.trim() && (
                <div className="space-y-4 rounded-lg border p-4">
                  <h2 className="font-semibold">依公式顯示結果</h2>
                  <div className="grid gap-3 text-sm">
                    <div>
                      <span className="text-muted-foreground">類型：</span>
                      <span>{computedIndex.type || "—"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Profile：</span>
                      <span>{computedIndex.profile || "—"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">幾分人：</span>
                      <span>{computedIndex.fenJi || "—"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">輪回交叉：</span>
                      <span>{computedIndex.cross || "—"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">輪回交叉描述：</span>
                      <p className="mt-1 text-muted-foreground whitespace-pre-wrap">
                        {computedIndex.crossDesc || "—"}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">內在權威：</span>
                      <span>{computedIndex.authority || "—"}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab !== "Index " && data[activeTab] && (
            <div className="overflow-x-auto">
              <table className="border-collapse text-sm">
                <tbody>
                  {data[activeTab].slice(0, 50).map((row, ri) => (
                    <tr key={ri}>
                      {row.slice(0, 20).map((cell, ci) => (
                        <td key={ci} className="border px-2 py-1 min-w-[80px]">
                          <input
                            type="text"
                            value={String(getCell(activeTab, ri, ci) ?? "")}
                            onChange={(e) => setCell(activeTab, ri, ci, e.target.value)}
                            className="w-full bg-transparent border-0 p-0 min-w-0 focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {data[activeTab].length > 50 && (
                <p className="text-xs text-muted-foreground mt-2">
                  僅顯示前 50 列，共 {data[activeTab].length} 列
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
