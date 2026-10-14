import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSettings } from '@/lib/data'
import { requireRole } from '@/lib/auth'
import { emailConfigured } from '@/lib/email'
import { fmtDateTime, money } from '@/lib/format'
import { Pill } from '@/components/ui'
import { GuestActions, QrPass, ReceiptUpload } from '@/components/ReservationClient'
import RoomBookingOptions from '@/components/RoomBookingOptions'

export default async function ReservationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string }> }) {
  const { id } = await params
  const { new: isNew } = await searchParams
  const me = await requireRole(['customer', 'staff', 'admin'], `/reservations/${id}`)
  const supabase = await createClient()
  const settings = await getSettings()
  const { data: r } = await supabase.from('reservations').select('*').eq('id', id).maybeSingle()
  if (!r || (r.customer_id !== me.id && me.role !== 'admin')) notFound()
  const [{ data: ents }, { data: pays }, { data: pass }, { data: orders }] = await Promise.all([
    supabase.from('entitlements').select('*').eq('reservation_id', id).order('starts_at'),
    supabase.from('payments').select('id, entitlement_id, method, status, amount, currency, receipt_path').eq('reservation_id', id).order('created_at', { ascending: false }),
    supabase.from('qr_passes').select('token').eq('reservation_id', id).eq('status', 'active').maybeSingle(),
    supabase.from('menu_orders').select('total, menu_order_items(name, qty)')
      .eq('reservation_id', id).neq('status', 'cancelled'),
  ])
  const tz = settings.timezone
  const cancellable = ['pending', 'confirmed'].includes(r.status) && !(ents ?? []).some((e) => e.checked_in_at)
  const hotelRooms = new Map((ents ?? [])
    .filter((entitlement) => entitlement.service_type === 'hotel')
    .map((entitlement) => [entitlement.id, entitlement]))

  return (
    <div className="stack">
      {isNew && (
        <div className="notice ok" role="status">
          <strong>{r.status === 'confirmed' ? 'Your booking is confirmed.' : 'Your booking has been received.'}</strong>{' '}
          {emailConfigured() ? 'A confirmation email is being sent.' : 'No confirmation email was sent because email is not configured on this site – please keep this page or screenshot your QR pass.'}
        </div>
      )}
      <div className="row between">
        <h1 style={{ margin: 0 }}>Reservation {r.reference}</h1>
        <div className="row"><span className="small muted">Booking</span><Pill value={r.status} />{(pays ?? []).length > 0 && <><span className="small muted">Payments</span><span className="pill">{(pays ?? []).length}</span></>}</div>
      </div>
      <div className="grid cols-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <div className="stack">
          <div className="card stack">
            <h3 style={{ margin: 0 }}>Services</h3>
            {(ents ?? []).map((e) => (
              <div key={e.id} className="row between" style={{ borderTop: '1px solid var(--line)', paddingTop: '.5rem' }}>
                <div>
                  <span className="pill">{e.service_type}</span> <strong>{e.title}</strong>
                  <div className="small muted">{e.detail}</div>
                  <div className="small">{fmtDateTime(e.starts_at, tz)} · {e.adults} adult{e.adults !== 1 ? 's' : ''}{e.children > 0 && `, ${e.children} child${e.children > 1 ? 'ren' : ''}`}</div>
                  {e.service_type === 'restaurant' && e.meta?.table_label && <div className="small">Table {e.meta.table_label} · {e.meta.area}</div>}
                  {e.service_type === 'hotel' && <RoomBookingOptions meta={e.meta} currency={r.currency} />}
                  {e.parent_entitlement_id && hotelRooms.get(e.parent_entitlement_id) && <div className="small muted">
                    Extra for {hotelRooms.get(e.parent_entitlement_id)!.title}
                    {hotelRooms.get(e.parent_entitlement_id)!.meta?.room_number && ` · Room ${hotelRooms.get(e.parent_entitlement_id)!.meta.room_number}`}
                  </div>}
                </div>
                <div className="right">
                  <div>{money(e.total, r.currency)}</div>
                  <Pill value={e.checked_in_at ? 'checked_in' : e.status} label={e.checked_in_at ? 'used' : e.status} />
                </div>
              </div>
            ))}
            {(orders ?? []).filter((o) => (o.menu_order_items as any[]).length > 0).map((o, i) => (
              <div key={i} className="small muted">Menu pre-order: {(o.menu_order_items as any[]).map((x) => `${x.qty}× ${x.name}`).join(', ')} ({money(o.total, r.currency)})</div>
            ))}
            <table className="totals small"><tbody>
              <tr><td>Subtotal</td><td className="right">{money(r.subtotal, r.currency)}</td></tr>
              {Number(r.tax) > 0 && <tr><td>Taxes</td><td className="right">{money(r.tax, r.currency)}</td></tr>}
              {Number(r.fees) > 0 && <tr><td>Fees</td><td className="right">{money(r.fees, r.currency)}</td></tr>}
              <tr><td>Total</td><td className="right">{money(r.total, r.currency)}</td></tr>
            </tbody></table>
          </div>
          <div className="card stack">
            <h3 style={{ margin: 0 }}>Guest</h3>
            <div className="small">{r.first_name} {r.last_name} · {r.email} · {r.phone}</div>
          </div>
          <details className="card small"><summary><strong>Cancellation policy</strong></summary><p>{settings.cancellation_policy}</p></details>
        </div>
        <div className="stack">
          <div className="card stack">
            <h3 style={{ margin: 0 }}>Payments</h3>
            <p className="small muted" style={{ margin: 0 }}>Each charge is listed separately. A tour charge does not change a payment already made for your room.</p>
            {(pays ?? []).length > 0 ? (pays ?? []).map((payment) => {
              const linkedService = payment.entitlement_id
                ? (ents ?? []).find((entitlement) => entitlement.id === payment.entitlement_id)
                : null
              return (
                <div key={payment.id} className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: '.75rem' }}>
                  <div className="row between">
                    <div>
                      <strong>{linkedService ? `Tour · ${linkedService.title}` : 'Room and original booking charges'}</strong>
                      <div className="small">Method: {payment.method.replaceAll('_', ' ')} · Amount {money(payment.amount, payment.currency)}</div>
                    </div>
                    <Pill value={payment.status} />
                  </div>
                  {payment.method === 'dev_test' && <div className="notice warn small">DEVELOPMENT ONLY test payment – no real money moved.</div>}
                  {payment.method === 'cash_on_arrival' && payment.status !== 'paid' && <div className="notice info small">Please pay this amount at the hotel.</div>}
                  {payment.method === 'bank_transfer' && ['awaiting_receipt', 'pending_verification', 'failed'].includes(payment.status) && r.status !== 'cancelled' && (
                    <>
                      {settings.payment_methods.bank_transfer?.instructions && <div className="notice info small" style={{ whiteSpace: 'pre-wrap' }}>{settings.payment_methods.bank_transfer.instructions}<br />Use reference <strong>{r.reference}</strong>.</div>}
                      {payment.status === 'pending_verification' && <div className="notice ok small">Receipt received – this payment is awaiting verification.</div>}
                      <ReceiptUpload reservationId={r.id} paymentId={payment.id} userId={me.id} hasReceipt={!!payment.receipt_path} />
                    </>
                  )}
                </div>
              )
            }) : <div className="small muted">{Number(r.total) === 0 ? 'No payment required for this reservation.' : 'No payment recorded.'}</div>}
          </div>
          <div className="card stack">
            <h3 style={{ margin: 0 }}>QR pass</h3>
            {pass ? <QrPass token={pass.token} reference={r.reference} /> : (
              <div className="notice info small">{r.status === 'confirmed' ? 'Your pass is not available.' : r.status === 'cancelled' ? 'This reservation was cancelled; the pass is revoked.' : 'Your QR pass is issued once the booking is confirmed (after payment is verified for bank transfers).'}</div>
            )}
          </div>
          <GuestActions reservationId={r.id} canCancel={cancellable} canReissue={r.status === 'confirmed' && !!pass} />
        </div>
      </div>
      <Link className="small" href="/account">← My reservations</Link>
    </div>
  )
}
