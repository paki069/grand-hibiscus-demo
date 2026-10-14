import { NextResponse } from 'next/server'
import { GuestAssistantContextError, loadGuestAssistantSpeechSettings } from '@/lib/guest-assistant'
import { isGuestAssistantRateLimited } from '@/lib/guest-assistant-rate-limit'

export const runtime = 'nodejs'

const MAX_AUDIO_BYTES = 20 * 1024 * 1024
const ALLOWED_AUDIO_TYPES = new Map([
  ['audio/flac', 'flac'],
  ['audio/m4a', 'm4a'],
  ['audio/mp4', 'mp4'],
  ['audio/mpeg', 'mp3'],
  ['audio/mpga', 'mpga'],
  ['audio/ogg', 'ogg'],
  ['audio/wav', 'wav'],
  ['audio/webm', 'webm'],
  ['audio/x-flac', 'flac'],
  ['audio/x-m4a', 'm4a'],
  ['audio/x-wav', 'wav'],
])

export async function POST(request: Request) {
  if (isGuestAssistantRateLimited(request, 'transcription', 6)) {
    return NextResponse.json({ error: 'Voice transcription is temporarily rate-limited. Please wait a minute and try again.' }, { status: 429 })
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_AUDIO_BYTES + 64_000) {
    return NextResponse.json({ error: 'That recording is too large. Please record a shorter question.' }, { status: 413 })
  }

  let settings
  try {
    settings = await loadGuestAssistantSpeechSettings()
  } catch (error) {
    console.error('[guest-assistant] Could not load speech input settings:', error instanceof GuestAssistantContextError ? error.source : 'unknown source')
    return NextResponse.json({ error: 'Voice questions are unavailable right now. Please try typing your question.' }, { status: 503 })
  }
  if (!settings.voiceInputEnabled) {
    return NextResponse.json({ error: 'Voice questions are currently turned off.' }, { status: 403 })
  }

  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    console.error('[guest-assistant] GROQ_API_KEY is not configured for voice transcription.')
    return NextResponse.json({ error: 'Voice transcription is not configured. Please type your question instead.' }, { status: 503 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Please record your question again.' }, { status: 400 })
  }
  const audio = form.get('file')
  if (!(audio instanceof File)) {
    return NextResponse.json({ error: 'Please include an audio recording.' }, { status: 400 })
  }
  if (!audio.size || audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'That recording is empty or too large. Please record a shorter question.' }, { status: 413 })
  }
  const mimeType = audio.type.toLowerCase().split(';')[0]
  const extension = ALLOWED_AUDIO_TYPES.get(mimeType)
  if (!extension) {
    return NextResponse.json({ error: 'This browser audio format is not supported. Try another browser or type your question.' }, { status: 415 })
  }

  const groqForm = new FormData()
  groqForm.append('model', 'whisper-large-v3-turbo')
  groqForm.append('language', 'en')
  groqForm.append('prompt', 'Transcribe the guest’s spoken English accurately. This is a hotel concierge conversation about The Grand Hibiscus in Trinidad and Tobago; terms may include rooms, dining, spa, gym, tours, bookings, and loyalty points.')
  groqForm.append('file', new File([await audio.arrayBuffer()], `petal-question.${extension}`, { type: mimeType }))

  try {
    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: groqForm,
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) {
      console.error('[guest-assistant] Groq transcription failed with status:', response.status)
      const status = response.status === 429 ? 429 : 502
      return NextResponse.json(
        { error: status === 429 ? 'Voice transcription is busy right now. Please try again shortly.' : 'I could not understand that recording. Please try again or type your question.' },
        { status },
      )
    }
    const result: unknown = await response.json()
    if (!result || typeof result !== 'object' || !('text' in result) || typeof result.text !== 'string') {
      console.error('[guest-assistant] Groq transcription returned an invalid response.')
      return NextResponse.json({ error: 'I could not understand that recording. Please try again or type your question.' }, { status: 502 })
    }
    const text = result.text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1_000)
    if (!text) {
      return NextResponse.json({ error: 'I did not hear a question. Please try again or type your question.' }, { status: 422 })
    }
    return NextResponse.json({ text })
  } catch (error) {
    console.error('[guest-assistant] Groq transcription request failed:', error instanceof Error ? error.name : 'unknown error')
    return NextResponse.json({ error: 'Voice transcription is temporarily unavailable. Please type your question instead.' }, { status: 502 })
  }
}
