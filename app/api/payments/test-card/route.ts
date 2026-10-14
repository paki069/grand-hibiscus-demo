import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { friendlyError } from '@/lib/format'
import { isGuestAssistantRateLimited } from '@/lib/guest-assistant-rate-limit'
import { approveTestCard, testCardGatewayAvailable, type TestCardDetails } from '@/lib/test-card-gateway'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: Request) {
  if (isGuestAssistantRateLimited(request, 'test-card-payment', 10)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }
  if (Number(request.headers.get('content-length') ?? 0) > 4_000) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 413 })
  }

  const supabase = await createClient()
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError || !auth.user) {
    if (authError) console.error('Could not authenticate test-card checkout:', authError)
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })
  }
  if (!testCardGatewayAvailable()) {
    return NextResponse.json({ error: 'test_card_gateway_unavailable' }, { status: 503 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const data = body as Record<string, unknown>
  const card = data.card as Record<string, unknown> | undefined
  if (
    typeof data.firstName !== 'string' || data.firstName.trim().length < 1 || data.firstName.length > 100
    || typeof data.lastName !== 'string' || data.lastName.trim().length < 1 || data.lastName.length > 100
    || typeof data.email !== 'string' || !emailPattern.test(data.email.trim()) || data.email.length > 254
    || typeof data.phone !== 'string' || data.phone.trim().length < 5 || data.phone.length > 40
    || typeof data.notes !== 'string' || data.notes.length > 1_000
    || !card
    || typeof card.number !== 'string' || card.number.length > 32
    || typeof card.expiry !== 'string' || card.expiry.length > 12
    || typeof card.cvc !== 'string' || card.cvc.length > 8
  ) {
    return NextResponse.json({ error: 'invalid_payment_details' }, { status: 400 })
  }

  const cardDetails: TestCardDetails = {
    number: card.number,
    expiry: card.expiry,
    cvc: card.cvc,
  }
  if (!approveTestCard(cardDetails)) {
    return NextResponse.json({ error: 'card_declined' }, { status: 402 })
  }

  const admin = createAdminClient()
  const { data: checkout, error } = await admin.rpc('checkout_cart_test_card', {
    p_customer_id: auth.user.id,
    p_first: data.firstName,
    p_last: data.lastName,
    p_email: data.email,
    p_phone: data.phone,
    p_notes: data.notes,
  })
  if (error) {
    console.error('Test-card checkout could not complete:', error)
    return NextResponse.json({ error: 'checkout_failed', message: friendlyError(error) }, { status: 409 })
  }
  if (!checkout || typeof checkout !== 'object' || typeof checkout.reservation_id !== 'string') {
    console.error('Test-card checkout returned an incomplete reservation result.')
    return NextResponse.json({ error: 'checkout_failed' }, { status: 500 })
  }

  return NextResponse.json({ checkout })
}
