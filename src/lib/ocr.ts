import { createWorker } from "tesseract.js"

export type OcrProgress = {
  status?: string
  progress?: number // 0..1
}

export type OcrResult = {
  text: string
}

export type OcrWorker = Awaited<ReturnType<typeof createWorker>>

export async function createOcrWorker(args?: {
  langs?: string[] | string
  onProgress?: (m: OcrProgress) => void
}): Promise<OcrWorker> {
  const langs = args?.langs ?? ["chi_tra", "chi_sim", "eng"]
  const worker = await createWorker(langs, undefined, {
    logger: (m) => args?.onProgress?.(m),
  })
  return worker
}

export async function recognizeCanvas(
  worker: OcrWorker,
  canvas: HTMLCanvasElement
): Promise<OcrResult> {
  const res = await worker.recognize(canvas)
  return { text: res.data.text ?? "" }
}

