import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { friendlyError } from '@/lib/format'
import { isGuestAssistantRateLimited } from '@/lib/guest-assistant-rate-limit'
import { approveTestCard, testCardGatewayAvailable, type TestCardDetails } from '@/lib/test-card-gateway'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
  if (isGuestAssistantRateLimited(request, 'test-card-payment', 10)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }
  if (Number(request.headers.get('content-length') ?? 0) > 4_000) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 413 })
  }

  const supabase = await createClient()
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError || !auth.user || auth.user.is_anonymous) {
    if (authError) console.error('Could not authenticate test-card tour checkout:', authError)
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
  const validDate = typeof data.tourDate === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(data.tourDate)
    && !Number.isNaN(Date.parse(`${data.tourDate}T00:00:00.000Z`))
    && new Date(`${data.tourDate}T00:00:00.000Z`).toISOString().slice(0, 10) === data.tourDate
  if (
    typeof data.hotelEntitlementId !== 'string' || !uuidPattern.test(data.hotelEntitlementId)
    || typeof data.eventId !== 'string' || !uuidPattern.test(data.eventId)
    || !validDate
    || !Number.isInteger(data.adults) || Number(data.adults) < 1 || Number(data.adults) > 20
    || !Number.isInteger(data.children) || Number(data.children) < 0 || Number(data.children) > 20
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
  const { data: booking, error } = await admin.rpc('book_tour_for_room_stay_test_card', {
    p_customer_id: auth.user.id,
    p_hotel_entitlement: data.hotelEntitlementId,
    p_event: data.eventId,
    p_tour_date: data.tourDate,
    p_adults: data.adults,
    p_children: data.children,
  })
  if (error) {
    console.error('Test-card tour booking could not complete:', error)
    return NextResponse.json({ error: 'booking_failed', message: friendlyError(error) }, { status: 409 })
  }
  if (!booking || typeof booking !== 'object' || typeof booking.reservation_id !== 'string') {
    console.error('Test-card tour booking returned an incomplete result.')
    return NextResponse.json({ error: 'booking_failed' }, { status: 500 })
  }

  return NextResponse.json({ booking })
}
