import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isGuestAssistantRateLimited } from '@/lib/guest-assistant-rate-limit'

export const runtime = 'nodejs'

const MAX_BODY_BYTES = 8_192

async function readLimitedBody(request: Request) {
  const reader = request.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let byteLength = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    byteLength += value.byteLength
    if (byteLength > MAX_BODY_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, maxLength)
}

export async function POST(request: Request) {
  if (isGuestAssistantRateLimited(request, 'contact-form', 5)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'invalid_submission' }, { status: 413 })
  }

  let body: unknown
  try {
    const raw = await readLimitedBody(request)
    if (raw === null) return NextResponse.json({ error: 'invalid_submission' }, { status: 413 })
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'invalid_submission' }, { status: 400 })
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid_submission' }, { status: 400 })
  }

  const fields = body as Record<string, unknown>
  if (cleanText(fields.website, 200)) {
    return NextResponse.json({ error: 'invalid_submission' }, { status: 400 })
  }
  const name = cleanText(fields.name, 100)
  const email = cleanText(fields.email, 254).toLowerCase()
  const subject = cleanText(fields.subject, 140)
  const message = cleanText(fields.message, 5_000)
  if (name.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
    || subject.length < 3 || message.length < 10) {
    return NextResponse.json({ error: 'invalid_submission' }, { status: 400 })
  }

  const supabase = await createClient()
  const { error: saveError } = await supabase.from('contact_inquiries').insert({
    name,
    email,
    subject,
    message,
  })
  if (saveError) {
    console.error('Could not save a contact inquiry:', saveError)
    return NextResponse.json({ error: 'contact_unavailable' }, { status: 503 })
  }

  return NextResponse.json({ status: 'sent' })
}
