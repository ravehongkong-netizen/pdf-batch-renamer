import type { PDFDocumentProxy } from "pdfjs-dist"

let pdfjsReady: Promise<typeof import("pdfjs-dist")> | null = null

async function getPdfjs() {
  if (!pdfjsReady) {
    pdfjsReady = import("pdfjs-dist").then((pdfjs) => {
      // Avoid bundling/minifying the worker in Next.js 14 builds.
      // Load the worker from a CDN at runtime instead.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(pdfjs as any).GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${(pdfjs as any).version}/pdf.worker.min.js`
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

