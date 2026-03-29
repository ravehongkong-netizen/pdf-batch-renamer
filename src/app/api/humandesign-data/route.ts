import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";

export async function GET() {
  try {
    const basePath = process.cwd();
    const possiblePaths = [
      path.join(basePath, "public", "humandesign-excel", "人類圖Polly 2025.xlsx"),
      path.join(basePath, "humandesign-excel", "人類圖Polly 2025.xlsx"),
      path.join(process.env.HOME || "", "Downloads", "Ravehongkong data", "public", "humandesign-excel", "人類圖Polly 2025.xlsx"),
    ];

    let filePath = "";
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        filePath = p;
        break;
      }
    }

    if (!filePath) {
      return NextResponse.json(
        { error: "找不到 Excel 檔案，請將「人類圖Polly 2025.xlsx」放到 public/humandesign-excel/" },
        { status: 404 }
      );
    }

    const buf = fs.readFileSync(filePath);
    const mod = await import("xlsx");
    type XlsxNs = typeof import("xlsx");
    const XLSX: XlsxNs =
      (mod as unknown as { default?: XlsxNs }).default ??
      (mod as unknown as XlsxNs);
    const workbook = XLSX.read(buf, { type: "buffer", cellFormula: true });

    const result: Record<string, unknown[][]> = {};
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: "",
        raw: false,
      });
      result[name] = data as unknown[][];
    }

    return NextResponse.json({ sheets: result });
  } catch (err) {
    console.error("humandesign-data error:", err);
    return NextResponse.json(
      { error: String(err instanceof Error ? err.message : err) },
      { status: 500 }
    );
  }
}
