import { NextResponse } from 'next/server'
import { isGuestAssistantRateLimited } from '@/lib/guest-assistant-rate-limit'
import { adminConfigured, createAdminClient } from '@/lib/supabase/admin'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_BODY_BYTES = 1_000

export async function POST(request: Request) {
  if (isGuestAssistantRateLimited(request, 'booking-email-check', 10)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 413 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || !('email' in body) || typeof body.email !== 'string') {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 })
  }
  const email = body.email.trim().toLowerCase()
  if (email.length > 254 || !emailPattern.test(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 })
  }
  if (!adminConfigured()) {
    console.error('Guest booking email checks require SUPABASE_SERVICE_ROLE_KEY.')
    return NextResponse.json({ error: 'lookup_unavailable' }, { status: 503 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('guest_has_prior_booking', { p_email: email })
  if (error) {
    console.error('Could not check for a previous guest booking:', error)
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
  }
  if (typeof data !== 'boolean') {
    console.error('Guest booking email check returned an unexpected result.')
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
  }

  return NextResponse.json({ hasPreviousBooking: data })
}
