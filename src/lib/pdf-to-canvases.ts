import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api"

let pdfjsReady: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | null =
  null

async function getPdfjs() {
  if (!pdfjsReady) {
    // Use the browser-friendly legacy build of pdf.js to avoid
    // Node-specific shims causing runtime errors in the browser.
    pdfjsReady = import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
      // pdf.js v5 removed `disableWorker`; configure the worker explicitly.
      // Using a CDN keeps the bundle small and avoids Next.js worker bundling edge cases.
      if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc =
          "https://unpkg.com/pdfjs-dist@5.5.207/legacy/build/pdf.worker.min.mjs"
      }
      return pdfjs
    })
  }
  return pdfjsReady
}

export type RenderProgress = {
  pageIndex: number
  pageCount: number
}

export async function pdfToCanvases(
  pdfData: ArrayBuffer,
  opts: { scale?: number; onPageRendered?: (p: RenderProgress) => void } = {}
): Promise<HTMLCanvasElement[]> {
  const scale = opts.scale ?? 2
  const pdfjs = await getPdfjs()
  const loadingTask = pdfjs.getDocument({ data: pdfData })
  const pdf: PDFDocumentProxy = await loadingTask.promise

  const canvases: HTMLCanvasElement[] = []
  for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex++) {
    const pageNumber = pageIndex + 1
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale })

    const canvas = document.createElement("canvas")
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas 2D context unavailable.")

    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)

    const renderContext = {
      canvasContext: ctx,
      viewport,
    } as unknown as Parameters<typeof page.render>[0]

    await page.render(renderContext).promise
    canvases.push(canvas)
    opts.onPageRendered?.({ pageIndex, pageCount: pdf.numPages })
  }

  return canvases
}

