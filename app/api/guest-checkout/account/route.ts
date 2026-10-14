import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminConfigured, createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  let body: { reservationId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const reservationId = typeof body.reservationId === 'string' ? body.reservationId : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reservationId)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError || !auth.user) {
    if (authError) console.error('Could not authenticate guest account setup:', authError)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!auth.user.is_anonymous) {
    return NextResponse.json({ error: 'guest_session_required' }, { status: 403 })
  }

  const { data: reservation, error: reservationError } = await supabase.from('reservations')
    .select('id, customer_id, status, email, first_name, last_name, phone')
    .eq('id', reservationId)
    .eq('customer_id', auth.user.id)
    .maybeSingle()
  if (reservationError) {
    console.error('Could not load guest reservation for account setup:', reservationError)
    return NextResponse.json({ error: 'reservation_lookup_failed' }, { status: 500 })
  }
  if (!reservation || reservation.status === 'cart' || !reservation.email) {
    return NextResponse.json({ error: 'reservation_not_found' }, { status: 404 })
  }

  const email = reservation.email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'invalid_guest_email' }, { status: 422 })
  }

  const { data: guestProfile, error: profileUpdateError } = await supabase.from('profiles')
    .update({
      email,
      first_name: reservation.first_name,
      last_name: reservation.last_name,
      phone: reservation.phone,
    })
    .eq('id', auth.user.id)
    .select('id')
    .maybeSingle()
  if (profileUpdateError || !guestProfile) {
    console.error('Could not update the anonymous guest profile after checkout:', profileUpdateError?.message ?? 'profile row not found')
    return NextResponse.json({ error: 'guest_profile_update_failed' }, { status: 500 })
  }

  if (!adminConfigured()) {
    console.error('Guest account setup requires SUPABASE_SERVICE_ROLE_KEY.')
    return NextResponse.json({ error: 'account_setup_unavailable' }, { status: 503 })
  }

  const admin = createAdminClient()
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: false,
    user_metadata: {
      first_name: reservation.first_name,
      last_name: reservation.last_name,
      phone: reservation.phone,
    },
  })
  if (createError && createError.code !== 'email_exists' && createError.code !== 'user_already_exists') {
    console.error('Could not create guest account after checkout:', createError)
    return NextResponse.json({ error: 'account_setup_failed' }, { status: 500 })
  }

  return NextResponse.json({ status: 'ready' })
}
