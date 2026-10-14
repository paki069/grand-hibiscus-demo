import { NextResponse } from 'next/server'
import { createAdminClient, adminConfigured } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email'
import { fmtDateTime, money } from '@/lib/format'
import { renderCancellationEmail } from '@/lib/cancellation-email'

// Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!adminConfigured()) return NextResponse.json({ error: 'service role not configured' }, { status: 503 })
  const admin = createAdminClient()

  const expirationWindowStart = new Date(Date.now() - 5 * 60_000).toISOString()
  const holds = await admin.rpc('release_expired_holds')
  const unpaid = await admin.rpc('expire_unpaid_reservations')

  const cancellationEmails = { sent: 0, not_configured: 0, failed: 0 }
  const { data: settings, error: settingsError } = await admin.from('settings')
    .select('hotel_name, timezone')
    .eq('id', 1)
    .single()
  if (settingsError) console.error('Could not load hotel settings for cancellation emails:', settingsError)
  if (!unpaid.error && Number(unpaid.data ?? 0) > 0 && !settingsError) {
    const { data: expiredReservations, error: expiredReservationsError } = await admin.from('reservations')
      .select('id, reference, email, first_name, status, subtotal, tax, fees, total, currency, cancellation_fee, cancel_reason, cancelled_at')
      .eq('status', 'cancelled')
      .eq('cancel_reason', 'Payment not received in time')
      .gte('cancelled_at', expirationWindowStart)
    if (expiredReservationsError) {
      console.error('Could not load expired reservations for cancellation emails:', expiredReservationsError)
      cancellationEmails.failed++
    }
    for (const reservation of expiredReservations ?? []) {
      if (!reservation.email) continue
      const { count, error: existingNotificationError } = await admin.from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('reservation_id', reservation.id)
        .eq('kind', 'cancellation')
      if (existingNotificationError) {
        console.error('Could not check the cancellation email log:', existingNotificationError)
        cancellationEmails.failed++
        continue
      }
      if ((count ?? 0) > 0) continue

      const [entitlementsResult, paymentsResult] = await Promise.all([
        admin.from('entitlements')
          .select('service_type, title, starts_at')
          .eq('reservation_id', reservation.id)
          .order('starts_at'),
        admin.from('payments')
          .select('method, status, amount, currency, paid_at')
          .eq('reservation_id', reservation.id)
          .order('created_at'),
      ])
      if (entitlementsResult.error || paymentsResult.error) {
        console.error('Could not load booking details for its cancellation email:', entitlementsResult.error ?? paymentsResult.error)
        cancellationEmails.failed++
        continue
      }

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '') || new URL(req.url).origin
      const emailContent = renderCancellationEmail({
        hotelName: settings.hotel_name,
        firstName: reservation.first_name,
        reference: reservation.reference,
        cancelledAt: reservation.cancelled_at ? fmtDateTime(reservation.cancelled_at, settings.timezone) : 'Recently',
        reason: reservation.cancel_reason || 'Payment not received in time',
        cancellationFee: money(reservation.cancellation_fee, reservation.currency),
        total: money(reservation.total, reservation.currency),
        services: (entitlementsResult.data ?? []).map((entitlement) => ({
          category: entitlement.service_type === 'event' ? 'Tours' : `${entitlement.service_type[0].toUpperCase()}${entitlement.service_type.slice(1)}`,
          title: entitlement.title,
          when: fmtDateTime(entitlement.starts_at, settings.timezone),
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
      const result = await sendEmail(reservation.email, subject, emailContent.text, { html: emailContent.html })
      const { error: logError } = await admin.from('notifications').insert({
        kind: 'cancellation',
        to_email: reservation.email,
        subject,
        body: emailContent.text,
        status: result.status,
        error: result.error ?? null,
        reservation_id: reservation.id,
        sent_at: result.status === 'sent' ? new Date().toISOString() : null,
      })
      if (logError) {
        console.error('Could not record cancellation email result:', logError)
        cancellationEmails.failed++
        continue
      }
      cancellationEmails[result.status]++
    }
  }

  let reminders = { queued: 0, sent: 0, not_configured: 0, failed: 0 }
  const { data: s } = await admin.from('settings').select('notification_settings').eq('id', 1).single()
  const ns = s?.notification_settings
  if (ns?.reminder_email) {
    const hours = Number(ns.reminder_hours_before) || 24
    const now = new Date()
    const until = new Date(now.getTime() + hours * 3600_000).toISOString()
    const { data: ents } = await admin.from('entitlements').select('reservation_id, starts_at, reservations!inner(id, reference, email, first_name, status)')
      .gte('starts_at', now.toISOString()).lte('starts_at', until).eq('status', 'active')
    const seen = new Set<string>()
    for (const e of (ents ?? []) as any[]) {
      const r = e.reservations
      if (!r?.email || r.status !== 'confirmed' || seen.has(r.id)) continue
      seen.add(r.id)
      const { count } = await admin.from('notifications').select('id', { count: 'exact', head: true }).eq('reservation_id', r.id).eq('kind', 'reminder')
      if ((count ?? 0) > 0) continue
      const subject = `Reminder: reservation ${r.reference}`
      const text = `Hello ${r.first_name}, this is a reminder of your upcoming reservation ${r.reference}. Your QR pass is in your account.`
      const result = await sendEmail(r.email, subject, text)
      reminders[result.status]++
      await admin.from('notifications').insert({ kind: 'reminder', reservation_id: r.id, to_email: r.email, subject, body: text, status: result.status, error: result.error ?? null, sent_at: result.status === 'sent' ? new Date().toISOString() : null })
    }
  }
  return NextResponse.json({ releasedHolds: holds.data, expiredUnpaid: unpaid.data, cancellationEmails, reminders, error: holds.error?.message ?? unpaid.error?.message ?? null })
}
