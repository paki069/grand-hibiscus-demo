import { NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient, adminConfigured } from '@/lib/supabase/admin'
import { getSettings } from '@/lib/data'
import { fmtDateTime, money } from '@/lib/format'
import { renderConfirmationEmail } from '@/lib/confirmation-email'
import { renderCancellationEmail } from '@/lib/cancellation-email'
import { sendEmail, emailConfigured } from '@/lib/email'
import { getRoomBookingOptions } from '@/lib/room-booking-options'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: user } = await supabase.auth.getUser()
  if (!user.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const resendNotificationId = typeof body.resendNotificationId === 'string' ? body.resendNotificationId : null
  let notificationKind: 'confirmation' | 'cancellation' = body.kind === 'cancellation' ? 'cancellation' : 'confirmation'
  let reservationId = String(body.reservationId)
  let resendRecipient: string | null = null
  let adminClient: ReturnType<typeof createAdminClient> | null = null

  if (resendNotificationId) {
    const { data: profile, error: profileError } = await supabase.from('profiles')
      .select('role, active')
      .eq('id', user.user.id)
      .maybeSingle()
    if (profileError) {
      console.error('Could not verify admin access for a notification resend:', profileError)
      return NextResponse.json({ error: 'admin_lookup_failed' }, { status: 500 })
    }
    if (profile?.role !== 'admin' || !profile.active) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    if (!adminConfigured()) return NextResponse.json({ status: 'not_configured', emailConfigured: emailConfigured() })
    adminClient = createAdminClient()
    const { data: original, error: originalError } = await adminClient.from('notifications')
      .select('reservation_id, kind, to_email')
      .eq('id', resendNotificationId)
      .maybeSingle()
    if (originalError) {
      console.error('Could not load notification for resend:', originalError)
      return NextResponse.json({ error: 'notification_lookup_failed' }, { status: 500 })
    }
    if (!original || !original.reservation_id || ![
      'confirmation',
      'confirmation_resend',
      'cancellation',
      'cancellation_resend',
    ].includes(original.kind)) {
      return NextResponse.json({ error: 'notification_not_resendable' }, { status: 404 })
    }
    reservationId = original.reservation_id
    resendRecipient = original.to_email
    notificationKind = original.kind.startsWith('cancellation') ? 'cancellation' : 'confirmation'
  }

  const { data: reservation, error: reservationError } = await supabase.from('reservations')
    .select('id, reference, email, first_name, status, subtotal, tax, fees, total, currency, cancellation_fee, cancel_reason, cancelled_at')
    .eq('id', reservationId)
    .maybeSingle()
  if (reservationError) {
    console.error('Could not load reservation for its confirmation email:', reservationError)
    return NextResponse.json({ error: 'reservation_lookup_failed' }, { status: 500 })
  }
  if (!reservation || !reservation.email || reservation.status === 'cart') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (notificationKind === 'cancellation' && reservation.status !== 'cancelled') {
    return NextResponse.json({ error: 'reservation_not_cancelled' }, { status: 409 })
  }
  if (notificationKind === 'confirmation' && reservation.status === 'cancelled') {
    return NextResponse.json({ error: 'reservation_cancelled' }, { status: 409 })
  }

  if (!adminConfigured()) return NextResponse.json({ status: 'not_configured', emailConfigured: emailConfigured() })
  const admin = adminClient ?? createAdminClient()
  if (!resendNotificationId) {
    const loggedKind = notificationKind
    const { count, error: notificationError } = await admin.from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('reservation_id', reservation.id)
      .eq('kind', loggedKind)
    if (notificationError) {
      console.error('Could not check whether the confirmation email was already sent:', notificationError)
      return NextResponse.json({ error: 'notification_lookup_failed' }, { status: 500 })
    }
    if ((count ?? 0) > 0) return NextResponse.json({ status: 'already_logged' })
  }

  if (notificationKind === 'cancellation') {
    const [entitlementsResult, paymentsResult, settings] = await Promise.all([
      admin.from('entitlements')
        .select('service_type, title, starts_at')
        .eq('reservation_id', reservation.id)
        .order('starts_at'),
      admin.from('payments')
        .select('method, status, amount, currency, paid_at')
        .eq('reservation_id', reservation.id)
        .order('created_at'),
      getSettings(),
    ])
    const detailError = entitlementsResult.error || paymentsResult.error
    if (detailError) {
      console.error('Could not load booking details for its cancellation email:', detailError)
      return NextResponse.json({ error: 'booking_details_unavailable' }, { status: 500 })
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '') || new URL(req.url).origin
    const emailContent = renderCancellationEmail({
      hotelName: settings.hotel_name,
      firstName: reservation.first_name,
      reference: reservation.reference,
      cancelledAt: reservation.cancelled_at
        ? fmtDateTime(reservation.cancelled_at, settings.timezone)
        : 'Recently',
      reason: reservation.cancel_reason || 'Cancelled by the hotel',
      cancellationFee: money(reservation.cancellation_fee, reservation.currency),
      total: money(reservation.total, reservation.currency),
      services: (entitlementsResult.data ?? []).map((entitlement) => ({
        category: entitlement.service_type === 'event' ? 'Tours' : `${entitlement.service_type[0].toUpperCase()}${entitlement.service_type.slice(1)}`,
        title: entitlement.title,
        when: entitlement.starts_at ? fmtDateTime(entitlement.starts_at, settings.timezone) : '',
      })),
      payments: (paymentsResult.data ?? []).map((payment) => {
        const method = payment.method.replaceAll('_', ' ')
        const status = payment.status.replaceAll('_', ' ')
        const paidAt = payment.paid_at ? ` · paid ${fmtDateTime(payment.paid_at, settings.timezone)}` : ''
        return `${method} · ${status} · ${money(payment.amount, payment.currency)}${paidAt}`
      }),
      accountUrl: `${siteUrl}/reservations/${encodeURIComponent(reservation.id)}`,
    })
    const subject = `Booking cancelled · ${reservation.reference}`
    const recipient = resendRecipient ?? reservation.email
    const result = await sendEmail(recipient, subject, emailContent.text, { html: emailContent.html })
    const { error: insertError } = await admin.from('notifications').insert({
      kind: resendNotificationId ? 'cancellation_resend' : 'cancellation',
      to_email: recipient,
      subject,
      body: emailContent.text,
      status: result.status,
      error: result.error ?? null,
      reservation_id: reservation.id,
      sent_at: result.status === 'sent' ? new Date().toISOString() : null,
    })
    if (insertError) {
      console.error('Could not record cancellation email result:', insertError)
      return NextResponse.json({ error: 'notification_log_failed', status: result.status }, { status: 500 })
    }
    return NextResponse.json({ status: result.status, emailConfigured: emailConfigured(), error: result.error ?? null })
  }

  const [entitlementsResult, paymentsResult, passResult, menuOrdersResult, settings] = await Promise.all([
    admin.from('entitlements')
      .select('id, parent_entitlement_id, service_type, title, detail, starts_at, ends_at, adults, children, total, meta')
      .eq('reservation_id', reservation.id)
      .order('starts_at'),
    admin.from('payments')
      .select('method, status, amount, currency, paid_at')
      .eq('reservation_id', reservation.id)
      .order('created_at'),
    admin.from('qr_passes')
      .select('token')
      .eq('reservation_id', reservation.id)
      .eq('status', 'active')
      .maybeSingle(),
    admin.from('menu_orders')
      .select('total, entitlement_id, menu_order_items(name, qty)')
      .eq('reservation_id', reservation.id)
      .neq('status', 'cancelled'),
    getSettings(),
  ])
  const detailError = entitlementsResult.error || paymentsResult.error || passResult.error || menuOrdersResult.error
  if (detailError) {
    console.error('Could not load booking details for its confirmation email:', detailError)
    return NextResponse.json({ error: 'booking_details_unavailable' }, { status: 500 })
  }

  const entitlements = entitlementsResult.data ?? []
  const hotelRooms = new Map(entitlements
    .filter((entitlement) => entitlement.service_type === 'hotel')
    .map((entitlement) => [entitlement.id, entitlement]))
  const menuItems = (menuOrdersResult.data ?? []).map((order) => ({
    category: 'Restaurant',
    title: 'Menu pre-order',
    detail: [
      (order.menu_order_items ?? []).map((item) => `${item.qty}× ${item.name}`).join(', '),
      (() => {
        const service = order.entitlement_id ? entitlements.find((item) => item.id === order.entitlement_id) : null
        const room = service?.parent_entitlement_id ? hotelRooms.get(service.parent_entitlement_id) : null
        return room ? `Extra for ${room.title}${room.meta?.room_number ? ` · Room ${room.meta.room_number}` : ''}` : ''
      })(),
    ].filter(Boolean).join(' · '),
    when: '',
    party: '',
    total: money(order.total, reservation.currency),
  }))
  const items = [
    ...entitlements.map((entitlement) => {
      const service = entitlement.service_type
      const meta = entitlement.meta ?? {}
      const roomOptions = service === 'hotel' ? getRoomBookingOptions(meta) : { addons: [], upgrades: [] }
      const parentRoom = entitlement.parent_entitlement_id ? hotelRooms.get(entitlement.parent_entitlement_id) : null
      const extraDetails = [
        meta.room_number ? `Room ${meta.room_number}` : '',
        meta.table_label ? `Table ${meta.table_label}` : '',
        meta.area ? String(meta.area) : '',
        parentRoom ? `Extra for ${parentRoom.title}${parentRoom.meta?.room_number ? ` · Room ${parentRoom.meta.room_number}` : ''}` : '',
      ].filter(Boolean)
      const party = [
        entitlement.adults > 0 ? `${entitlement.adults} adult${entitlement.adults === 1 ? '' : 's'}` : '',
        entitlement.children > 0 ? `${entitlement.children} child${entitlement.children === 1 ? '' : 'ren'}` : '',
      ].filter(Boolean).join(', ')
      return {
        category: service === 'event' ? 'Tours' : `${service[0].toUpperCase()}${service.slice(1)}`,
        title: entitlement.title,
        detail: [entitlement.detail, ...extraDetails].filter(Boolean).join(' · '),
        when: entitlement.starts_at
          ? `${fmtDateTime(entitlement.starts_at, settings.timezone)}${entitlement.ends_at ? ` – ${fmtDateTime(entitlement.ends_at, settings.timezone)}` : ''}`
          : '',
        party,
        total: money(entitlement.total, reservation.currency),
        options: [
          ...roomOptions.addons.map((option) => ({
            category: 'Room add-on',
            name: option.name,
            total: option.total !== undefined ? money(option.total, reservation.currency) : '',
          })),
          ...roomOptions.upgrades.map((option) => ({
            category: 'Room upgrade',
            name: option.name,
            total: option.total !== undefined ? money(option.total, reservation.currency) : '',
            ...(option.details ? { details: option.details } : {}),
          })),
        ],
      }
    }),
    ...menuItems,
  ]
  const payments = (paymentsResult.data ?? []).map((payment) => {
    const method = payment.method.replaceAll('_', ' ')
    const status = payment.status.replaceAll('_', ' ')
    const paidAt = payment.paid_at ? ` · paid ${fmtDateTime(payment.paid_at, settings.timezone)}` : ''
    return `${method} · ${status} · ${money(payment.amount, payment.currency)}${paidAt}`
  })
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '') || new URL(req.url).origin
  const accountUrl = `${siteUrl}/reservations/${encodeURIComponent(reservation.id)}`
  const hasQrPass = !!passResult.data?.token
  const emailContent = renderConfirmationEmail({
    hotelName: settings.hotel_name,
    firstName: reservation.first_name,
    reference: reservation.reference,
    status: reservation.status,
    items,
    payments,
    subtotal: money(reservation.subtotal, reservation.currency),
    taxes: money(reservation.tax, reservation.currency),
    fees: money(reservation.fees, reservation.currency),
    total: money(reservation.total, reservation.currency),
    accountUrl,
    hasQrPass,
  })
  const subject = reservation.status === 'confirmed'
    ? `Booking confirmed · ${reservation.reference}`
    : `Booking details · ${reservation.reference}`
  const recipient = resendRecipient ?? reservation.email

  let qrImage: Buffer | null = null
  if (hasQrPass && passResult.data) {
    try {
      qrImage = await QRCode.toBuffer(passResult.data.token, {
        width: 420,
        margin: 2,
        errorCorrectionLevel: 'M',
      })
    } catch (error) {
      console.error('Could not generate the reservation QR pass for email:', error)
      return NextResponse.json({ error: 'qr_generation_failed' }, { status: 500 })
    }
  }

  const result = await sendEmail(recipient, subject, emailContent.text, {
    html: emailContent.html,
    attachments: qrImage ? [{
      filename: `${reservation.reference}-qr-pass.png`,
      content: qrImage,
      contentType: 'image/png',
      contentDisposition: 'inline',
      cid: 'reservation-pass',
    }] : [],
  })
  const { error: insertError } = await admin.from('notifications').insert({
    kind: resendNotificationId ? 'confirmation_resend' : 'confirmation',
    to_email: recipient,
    subject,
    body: emailContent.text,
    status: result.status,
    error: result.error ?? null,
    reservation_id: reservation.id,
    sent_at: result.status === 'sent' ? new Date().toISOString() : null,
  })
  if (insertError) {
    console.error('Could not record confirmation email result:', insertError)
    return NextResponse.json({ error: 'notification_log_failed', status: result.status }, { status: 500 })
  }
  return NextResponse.json({ status: result.status, emailConfigured: emailConfigured(), error: result.error ?? null })
}
