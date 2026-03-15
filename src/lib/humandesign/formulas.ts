/**
 * Excel LOOKUP(1,0/(range=value),return_range) 邏輯
 * 從 searchCol 找到最後一個等於 findVal 的列，回傳對應 returnCol 的值
 */
export function lookupLastMatch<T>(
  findVal: T,
  searchCol: T[],
  returnCol: unknown[]
): unknown {
  for (let i = searchCol.length - 1; i >= 0; i--) {
    if (String(searchCol[i]).trim() === String(findVal).trim()) {
      return returnCol[i];
    }
  }
  return "";
}

/**
 * 從二維表格取得某列某欄的值 (1-based)
 */
export function getCell<T>(sheet: T[][], row: number, col: number): T | undefined {
  const r = row - 1;
  const c = col - 1;
  if (r < 0 || c < 0) return undefined;
  return sheet[r]?.[c];
}

/**
 * 取得一欄的資料 (1-based row)
 */
export function getColumn(sheet: unknown[][], col: number): unknown[] {
  return sheet.map((row) => row[(col - 1)] ?? "");
}
