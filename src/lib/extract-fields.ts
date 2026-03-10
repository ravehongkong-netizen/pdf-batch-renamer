export type ExtractedFields = {
  date?: string
  fileNo?: string
  id?: string
}

const DATE_RE = /\b(20\d{2}-\d{2}-\d{2})\b/g
const FILENO_RE = /\b(ACQ\d+-\d+)\b/gi
const ID_RE = /\b(\d{6})\b/g

export function extractFields(text: string): ExtractedFields {
  const date = firstMatch(text, DATE_RE)
  const fileNoRaw = firstMatch(text, FILENO_RE)
  const id = firstMatch(text, ID_RE)

  return {
    date,
    fileNo: fileNoRaw ? fileNoRaw.toUpperCase() : undefined,
    id,
  }
}

function firstMatch(text: string, re: RegExp): string | undefined {
  re.lastIndex = 0
  const m = re.exec(text)
  return m?.[1]
}

export function buildSuggestedName(fields: ExtractedFields): string | undefined {
  if (!fields.date || !fields.fileNo || !fields.id) return undefined
  return `${fields.date}_${fields.fileNo}_${fields.id}.pdf`
}

