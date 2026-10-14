import { NextResponse } from 'next/server'
import { GuestAssistantContextError, loadGuestAssistantSpeechSettings } from '@/lib/guest-assistant'
import { isGuestAssistantRateLimited } from '@/lib/guest-assistant-rate-limit'

export const runtime = 'nodejs'

const MAX_BODY_BYTES = 2_000
const MAX_TEXT_LENGTH = 200

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export async function POST(request: Request) {
  if (isGuestAssistantRateLimited(request, 'speech', 30)) {
    return NextResponse.json({ error: 'Spoken replies are temporarily rate-limited. Please wait a minute and try again.' }, { status: 429 })
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'That reply is too long to read aloud at once.' }, { status: 413 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Please choose a reply to hear.' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || !('text' in body) || typeof body.text !== 'string') {
    return NextResponse.json({ error: 'Please choose a reply to hear.' }, { status: 400 })
  }
  const text = body.text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text || text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json({ error: 'Spoken replies must be between 1 and 200 characters.' }, { status: 400 })
  }

  let settings
  try {
    settings = await loadGuestAssistantSpeechSettings()
  } catch (error) {
    console.error('[guest-assistant] Could not load spoken reply settings:', error instanceof GuestAssistantContextError ? error.source : 'unknown source')
    return NextResponse.json({ error: 'Spoken replies are unavailable right now.' }, { status: 503 })
  }
  if (!settings.voiceOutputEnabled) {
    return NextResponse.json({ error: 'Spoken replies are currently turned off.' }, { status: 403 })
  }

  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    console.error('[guest-assistant] GROQ_API_KEY is not configured for speech output.')
    return NextResponse.json({ error: 'Spoken replies are not configured right now.' }, { status: 503 })
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/audio/speech', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'canopylabs/orpheus-v1-english',
        voice: settings.speechVoice,
        input: text,
        response_format: 'wav',
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) {
      const responseBody: unknown = await response.json().catch(() => null)
      const providerError = isRecord(responseBody) ? responseBody.error : null
      const providerDetails = isRecord(providerError) ? providerError : null
      const providerMessage = typeof providerDetails?.message === 'string'
        ? providerDetails.message.replace(/gsk_[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 240)
        : undefined
      console.error('[guest-assistant] Groq speech generation failed:', {
        status: response.status,
        code: providerDetails?.code,
        type: providerDetails?.type,
        message: providerMessage,
      })
      const status = response.status === 429 ? 429 : 502
      return NextResponse.json(
        { error: status === 429 ? 'Spoken replies are busy right now. Please try again shortly.' : 'I could not prepare that spoken reply.' },
        { status },
      )
    }
    return new Response(await response.arrayBuffer(), {
      headers: {
        'content-type': 'audio/wav',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch (error) {
    console.error('[guest-assistant] Groq speech request failed:', error instanceof Error ? error.name : 'unknown error')
    return NextResponse.json({ error: 'Spoken replies are temporarily unavailable.' }, { status: 502 })
  }
}
