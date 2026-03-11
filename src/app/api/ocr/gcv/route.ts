import { NextResponse } from "next/server"

export const runtime = "nodejs"

function getEnv(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env: ${name}`)
  return v
}

async function blobToBuffer(blob: Blob) {
  const ab = await blob.arrayBuffer()
  return Buffer.from(ab)
}

export async function POST(req: Request) {
  try {
    // Store the service account JSON in an env var to work on Vercel.
    // In Vercel, paste the *full JSON* into this env var.
    const serviceAccountJson = getEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON")
    const credentials = JSON.parse(serviceAccountJson)

    const form = await req.formData()
    const file = form.get("file")
    if (!(file instanceof Blob)) {
      return NextResponse.json(
        { error: "Missing form field: file" },
        { status: 400 }
      )
    }

    const buf = await blobToBuffer(file)

    const { ImageAnnotatorClient } = await import("@google-cloud/vision")
    const client = new ImageAnnotatorClient({ credentials })

    // For forms/bills, documentTextDetection is usually better than textDetection.
    const [result] = await client.documentTextDetection({
      image: { content: buf },
      imageContext: { languageHints: ["zh-TW"] },
    })

    const text =
      result.fullTextAnnotation?.text ??
      result.textAnnotations?.[0]?.description ??
      ""

    return NextResponse.json({ text })
  } catch (err: any) {
    console.error(err)
    return NextResponse.json(
      { error: err?.message ?? "Google Vision OCR failed" },
      { status: 500 }
    )
  }
}

