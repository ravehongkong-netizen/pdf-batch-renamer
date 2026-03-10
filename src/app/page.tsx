"use client"

import JSZip from "jszip"
import { useCallback, useMemo, useState } from "react"
import { useDropzone } from "react-dropzone"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { buildSuggestedName, extractFields, type ExtractedFields } from "@/lib/extract-fields"
import { createOcrWorker, recognizeCanvas } from "@/lib/ocr"
import { pdfToCanvases } from "@/lib/pdf-to-canvases"

type JobStatus = "pending" | "rendering" | "ocr" | "done" | "needs_review" | "error"

type FileJob = {
  id: string
  file: File
  status: JobStatus
  progress: number // 0..100
  extracted: ExtractedFields
  finalName: string
  error?: string
}

function uid() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function sanitizeFilename(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim()
}

function ensurePdfExt(name: string) {
  return name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`
}

export default function Home() {
  const [jobs, setJobs] = useState<FileJob[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [globalError, setGlobalError] = useState<string | null>(null)

  const onDrop = useCallback((accepted: File[]) => {
    setGlobalError(null)
    const next = accepted
      .filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"))
      .map<FileJob>((file) => ({
        id: uid(),
        file,
        status: "pending",
        progress: 0,
        extracted: {},
        finalName: ensurePdfExt(sanitizeFilename(file.name.replace(/\.pdf$/i, ""))),
      }))
    setJobs((prev) => [...next, ...prev])
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    disabled: isRunning,
    multiple: true,
    accept: { "application/pdf": [".pdf"] },
  })

  const runnable = useMemo(() => jobs.some((j) => j.status === "pending" || j.status === "error"), [jobs])
  const downloadable = useMemo(
    () => jobs.some((j) => j.status === "done" || j.status === "needs_review"),
    [jobs]
  )

  async function runOcr() {
    setGlobalError(null)
    setIsRunning(true)
    try {
      for (const job of jobs) {
        if (job.status !== "pending" && job.status !== "error") continue
        try {
          setJobs((prev) =>
            prev.map((j) => (j.id === job.id ? { ...j, status: "rendering", progress: 1, error: undefined } : j))
          )

          const pdfData = await job.file.arrayBuffer()
          const canvases = await pdfToCanvases(pdfData, {
            scale: 2,
            onPageRendered: ({ pageIndex, pageCount }) => {
              const p = Math.min(20, Math.round(((pageIndex + 1) / Math.max(1, pageCount)) * 20))
              setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, progress: p } : j)))
            },
          })

          setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: "ocr", progress: 20 } : j)))

          const pageCount = Math.max(1, canvases.length)
          let currentPage = 0

          const worker = await createOcrWorker({
            langs: ["chi_tra", "chi_sim", "eng"],
            onProgress: (m) => {
              if (m?.status !== "recognizing text" || typeof m.progress !== "number") return
              const base = 20 + (currentPage / pageCount) * 80
              const within = (m.progress ?? 0) * (80 / pageCount)
              const p = Math.max(20, Math.min(99, Math.round(base + within)))
              setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, progress: p } : j)))
            },
          })

          try {
            let combinedText = ""
            for (let i = 0; i < canvases.length; i++) {
              currentPage = i
              const { text } = await recognizeCanvas(worker, canvases[i])
              combinedText += `\n${text}\n`
              const p = Math.round(20 + ((i + 1) / pageCount) * 80)
              setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, progress: p } : j)))
            }

            const extracted = extractFields(combinedText)
            const suggested = buildSuggestedName(extracted)

            setJobs((prev) =>
              prev.map((j) => {
                if (j.id !== job.id) return j
                const finalName = suggested ?? j.finalName
                const status: JobStatus = suggested ? "done" : "needs_review"
                const error = suggested
                  ? undefined
                  : "未在 OCR 文字中同時找到：日期(YYYY-MM-DD)、檔案號碼(ACQ\\d+-\\d+)、ID(6位數)。可手動修改下方欄位後再下載 ZIP。"
                return { ...j, extracted, finalName, status, progress: 100, error }
              })
            )
          } finally {
            await worker.terminate()
          }
        } catch (e) {
          updateJob(job.id, {
            status: "error",
            progress: 0,
            error: e instanceof Error ? e.message : String(e),
          })
        }
      }
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsRunning(false)
    }
  }

  function updateJob(id: string, patch: Partial<FileJob>) {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)))
  }

  function updateExtracted(id: string, patch: Partial<ExtractedFields>) {
    setJobs((prev) =>
      prev.map((j) => {
        if (j.id !== id) return j
        const extracted = { ...j.extracted, ...patch }
        const suggested = buildSuggestedName(extracted)
        const finalName = suggested ?? j.finalName
        const status: JobStatus = suggested ? "done" : j.status === "done" ? "needs_review" : j.status
        return { ...j, extracted, finalName, status }
      })
    )
  }

  async function downloadZip() {
    setGlobalError(null)
    try {
      const zip = new JSZip()
      const selected = jobs.filter((j) => j.status === "done" || j.status === "needs_review")
      for (const j of selected) {
        const name = ensurePdfExt(sanitizeFilename(j.finalName))
        zip.file(name, await j.file.arrayBuffer())
      }

      const blob = await zip.generateAsync({ type: "blob" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `renamed_pdfs_${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : String(e))
    }
  }

  function clearAll() {
    if (isRunning) return
    setGlobalError(null)
    setJobs([])
  }

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6 md:p-10">
        <div className="flex flex-col gap-2">
          <h1 className="text-balance text-2xl font-semibold tracking-tight md:text-3xl">PDF Batch Renamer (OCR)</h1>
          <p className="text-sm text-muted-foreground">
            拖放多個 PDF → 前端 OCR（含中文）→ 正則抽取日期/檔案號碼/ID → 下載 ZIP。
          </p>
        </div>

        {globalError ? (
          <Alert variant="destructive">
            <AlertTitle>發生錯誤</AlertTitle>
            <AlertDescription className="break-words">{globalError}</AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>上傳</CardTitle>
            <CardDescription>支援拖放/批量上傳 PDF。OCR 會在瀏覽器端執行，PDF 不會上傳到伺服器。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              {...getRootProps()}
              className={[
                "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center transition-colors",
                isRunning ? "opacity-60 cursor-not-allowed" : "hover:bg-muted/50",
                isDragActive ? "bg-muted" : "bg-card",
              ].join(" ")}
            >
              <input {...getInputProps()} />
              <div className="text-sm font-medium">拖放 PDF 到這裡，或點擊選擇檔案</div>
              <div className="text-xs text-muted-foreground">建議 1–10 份 PDF 先試跑；OCR 速度與頁數/解析度有關。</div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={runOcr} disabled={!runnable || isRunning}>
                {isRunning ? "處理中…" : "開始 OCR & 解析"}
              </Button>
              <Button variant="secondary" onClick={downloadZip} disabled={!downloadable || isRunning}>
                下載 ZIP
              </Button>
              <Button variant="outline" onClick={clearAll} disabled={jobs.length === 0 || isRunning}>
                清空
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>結果</CardTitle>
            <CardDescription>
              正則：日期 <Badge variant="secondary">YYYY-MM-DD</Badge>，檔案號碼{" "}
              <Badge variant="secondary">ACQ\d+-\d+</Badge>，ID <Badge variant="secondary">\d{"{6}"}</Badge>。
              目標檔名：<Badge variant="secondary">{"{date}_{filename}_{ID}.pdf"}</Badge>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {jobs.length === 0 ? (
              <div className="text-sm text-muted-foreground">尚未加入 PDF。</div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[320px]">原檔名</TableHead>
                      <TableHead className="w-[140px]">狀態</TableHead>
                      <TableHead className="w-[220px]">進度</TableHead>
                      <TableHead>新檔名</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map((j) => (
                      <TableRow key={j.id} className="align-top">
                        <TableCell className="font-medium break-all">{j.file.name}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <StatusBadge status={j.status} />
                          </div>
                          {j.error ? <div className="mt-2 text-xs text-destructive">{j.error}</div> : null}
                        </TableCell>
                        <TableCell>
                          <Progress value={j.progress} />
                          <div className="mt-1 text-xs text-muted-foreground">{j.progress}%</div>
                        </TableCell>
                        <TableCell className="space-y-2">
                          <Input
                            value={j.finalName}
                            onChange={(e) => updateJob(j.id, { finalName: e.target.value })}
                            disabled={isRunning}
                          />
                          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                            <FieldInput
                              label="date"
                              placeholder="2026-01-06"
                              value={j.extracted.date ?? ""}
                              onChange={(v) => updateExtracted(j.id, { date: v || undefined })}
                              disabled={isRunning}
                            />
                            <FieldInput
                              label="filename"
                              placeholder="ACQ68-42200"
                              value={j.extracted.fileNo ?? ""}
                              onChange={(v) => updateExtracted(j.id, { fileNo: v || undefined })}
                              disabled={isRunning}
                            />
                            <FieldInput
                              label="ID"
                              placeholder="151653"
                              value={j.extracted.id ?? ""}
                              onChange={(v) => updateExtracted(j.id, { id: v || undefined })}
                              disabled={isRunning}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <Separator />

                <div className="text-xs text-muted-foreground">
                  提示：如果 PDF 是模糊手寫/低對比，請先把 PDF 轉成較高解析度或提高掃描品質，OCR 命中率會差很多。
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: JobStatus }) {
  switch (status) {
    case "pending":
      return <Badge variant="secondary">待處理</Badge>
    case "rendering":
      return <Badge>轉圖片中</Badge>
    case "ocr":
      return <Badge>OCR 中</Badge>
    case "done":
      return <Badge variant="outline">完成</Badge>
    case "needs_review":
      return <Badge variant="destructive">需校對</Badge>
    case "error":
      return <Badge variant="destructive">失敗</Badge>
  }
}

function FieldInput(props: {
  label: string
  placeholder: string
  value: string
  disabled?: boolean
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{props.label}</div>
      <Input
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
        disabled={props.disabled}
      />
    </div>
  )
}
