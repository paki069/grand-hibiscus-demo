import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSettings } from '@/lib/data'
import { money, fmtDateTime } from '@/lib/format'
import { Pill } from '@/components/ui'
import AdminReservationActions from '@/components/AdminReservationActions'
import RoomBookingOptions from '@/components/RoomBookingOptions'

export default async function AdminReservation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const s = await getSettings()
  const { data: r } = await supabase.from('reservations').select('*').eq('id', id).maybeSingle()
  if (!r) notFound()
  const [{ data: ents }, { data: pays }, { data: passes }, { data: refunds }, { data: orders }] = await Promise.all([
    supabase.from('entitlements').select('*').eq('reservation_id', id).order('starts_at'),
    supabase.from('payments').select('*').eq('reservation_id', id).order('created_at', { ascending: false }),
    supabase.from('qr_passes').select('id, status, issued_at, revoked_at, revoked_reason').eq('reservation_id', id).order('issued_at', { ascending: false }),
    supabase.from('refunds').select('amount, reason, created_at, payment_id'),
    supabase.from('menu_orders').select('total, entitlement_id, menu_order_items(name, qty)')
      .eq('reservation_id', id).neq('status', 'cancelled'),
  ])
  const entitlementsById = new Map((ents ?? []).map((entitlement) => [entitlement.id, entitlement]))
  const hotelRooms = new Map((ents ?? [])
    .filter((entitlement) => entitlement.service_type === 'hotel')
    .map((entitlement) => [entitlement.id, entitlement]))
  const receiptEntries = await Promise.all((pays ?? []).filter((payment) => payment.receipt_path).map(async (payment) => {
    const { data } = await supabase.storage.from('receipts').createSignedUrl(payment.receipt_path, 300)
    return [payment.id, data?.signedUrl ?? null] as const
  }))
  const receiptUrls = new Map(receiptEntries)
  const myRefunds = (refunds ?? []).filter((x) => (pays ?? []).some((p) => p.id === x.payment_id))
  const paymentActions = (pays ?? []).map((payment) => ({
    id: payment.id,
    status: payment.status,
    amount: Number(payment.amount),
    entitlementId: payment.entitlement_id ?? null,
    label: payment.entitlement_id
      ? `Tour · ${entitlementsById.get(payment.entitlement_id)?.title ?? 'booking'}`
      : 'Room and original booking charges',
  }))

  return (
    <div className="stack reservation-page">
      <Link className="small" href="/admin/reservations">← All reservations</Link>
      <header className="reservation-header">
        <div>
          <div className="small muted">Reservation</div>
          <h1>{r.reference}</h1>
          <div className="small muted">Placed {fmtDateTime(r.placed_at, s.timezone)}</div>
        </div>
        <div className="row reservation-statuses">
          <Pill value={r.status} />
          {(pays ?? []).slice(0, 3).map((payment) => <Pill key={payment.id} value={payment.status} />)}
          {(pays ?? []).length > 3 && <span className="pill">{(pays ?? []).length} payments</span>}
        </div>
      </header>

      <div className="reservation-layout">
        <main className="card stack reservation-services">
          <div className="row between">
            <div>
              <h2 style={{ margin: 0 }}>Services</h2>
              <div className="small muted">Each service is checked in independently.</div>
            </div>
            <span className="pill">{(ents ?? []).length} item{(ents ?? []).length === 1 ? '' : 's'}</span>
          </div>
          <div className="reservation-service-list">
            {(ents ?? []).map((e) => (
              <article className="reservation-service" key={e.id}>
                <div className="row between">
                  <div className="row">
                    <Pill value={e.service_type} />
                    <strong>{e.title}</strong>
                  </div>
                  <Pill value={e.status} />
                </div>
                <div className="small muted">{e.detail}</div>
                <div className="reservation-service-facts">
                  <div><span>When</span><strong>{fmtDateTime(e.starts_at, s.timezone)}</strong></div>
                  <div><span>Party</span><strong>{e.adults} adults{e.children > 0 ? `, ${e.children} children` : ''}</strong></div>
                  <div><span>Total</span><strong>{money(e.total, r.currency)}</strong></div>
                  <div><span>Check-in</span><strong>{e.checked_in_at ? fmtDateTime(e.checked_in_at, s.timezone) : 'Not checked in'}</strong></div>
                </div>
                {e.meta?.room_number && <div className="small"><strong>Room {e.meta.room_number}</strong></div>}
                {e.meta?.table_label && <div className="small"><strong>Table {e.meta.table_label}</strong>{e.meta.area && ` · ${e.meta.area}`}</div>}
                {e.meta?.early_checkin_guaranteed === true && <div className="notice warn small">
                  Guaranteed early check-in — prepare room {e.meta.room_number} by {fmtDateTime(String(e.meta.early_checkin_at), s.timezone)} after dining.
                </div>}
                {e.service_type === 'hotel' && <RoomBookingOptions meta={e.meta} currency={r.currency} admin />}
                {e.parent_entitlement_id && hotelRooms.get(e.parent_entitlement_id) && <div className="small muted">
                  Extra for {hotelRooms.get(e.parent_entitlement_id)!.title}
                  {hotelRooms.get(e.parent_entitlement_id)!.meta?.room_number && ` · Room ${hotelRooms.get(e.parent_entitlement_id)!.meta.room_number}`}
                </div>}
              </article>
            ))}
            {(orders ?? []).filter((order) => (order.menu_order_items as { name: string; qty: number }[]).length > 0).map((order, index) => {
              const service = order.entitlement_id ? entitlementsById.get(order.entitlement_id) : null
              const parentRoom = service?.parent_entitlement_id ? hotelRooms.get(service.parent_entitlement_id) : null
              return (
                <article className="reservation-service" key={`menu-order-${index}`}>
                  <div className="row between"><div className="row"><Pill value="restaurant" /><strong>Menu pre-order</strong></div></div>
                  <div className="small muted">{(order.menu_order_items as { name: string; qty: number }[]).map((item) => `${item.qty}× ${item.name}`).join(', ')}</div>
                  {parentRoom && <div className="small muted">Extra for {parentRoom.title}{parentRoom.meta?.room_number && ` · Room ${parentRoom.meta.room_number}`}</div>}
                  <div className="reservation-payment-amount">{money(order.total, r.currency)}</div>
                </article>
              )
            })}
          </div>
          <div className="reservation-totals">
            <div><span>Subtotal</span><span>{money(r.subtotal, r.currency)}</span></div>
            <div><span>Tax</span><span>{money(r.tax, r.currency)}</span></div>
            <div><span>Fees</span><span>{money(r.fees, r.currency)}</span></div>
            <div className="grand-total"><strong>Total</strong><strong>{money(r.total, r.currency)}</strong></div>
          </div>
        </main>

        <aside className="reservation-sidebar">
          <section className="card stack">
            <h2 style={{ margin: 0 }}>Guest</h2>
            <strong>{r.first_name} {r.last_name}</strong>
            <a className="small" href={`mailto:${r.email}`}>{r.email}</a>
            <a className="small" href={`tel:${r.phone}`}>{r.phone}</a>
            {r.notes && <div className="notice info small">Guest note: {r.notes}</div>}
          </section>

          <section className="card stack">
            <h2 style={{ margin: 0 }}>Payments</h2>
            {(pays ?? []).length > 0 ? (pays ?? []).map((payment) => (
              <div key={payment.id} className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: '.7rem' }}>
                <strong>{payment.entitlement_id
                  ? `Tour · ${entitlementsById.get(payment.entitlement_id)?.title ?? 'booking'}`
                  : 'Room and original booking charges'}</strong>
                <div className="reservation-payment-amount">{money(payment.amount, payment.currency)}</div>
                <div className="row"><span className="small">{payment.method.replaceAll('_', ' ')}</span><Pill value={payment.status} /></div>
                {payment.method === 'dev_test' && <span className="pill warn">DEV ONLY</span>}
                {receiptUrls.get(payment.id)
                  ? <a className="btn sm secondary" href={receiptUrls.get(payment.id)!} target="_blank" rel="noreferrer">View uploaded receipt</a>
                  : payment.method === 'bank_transfer' && <div className="small muted">No receipt uploaded yet.</div>}
                {myRefunds.filter((refund) => refund.payment_id === payment.id).map((refund, index) => (
                  <div key={index} className="small">Refund {money(refund.amount, r.currency)} · {fmtDateTime(refund.created_at, s.timezone)} {refund.reason && `· ${refund.reason}`}</div>
                ))}
              </div>
            )) : <div className="muted small">{Number(r.total) === 0 ? 'No payment required; this reservation has a zero balance.' : 'No payment record.'}</div>}
          </section>

          <AdminReservationActions reservationId={r.id} status={r.status} payments={paymentActions} />

          <section className="card stack">
            <h2 style={{ margin: 0 }}>QR passes</h2>
            {(passes ?? []).map((p) => <div key={p.id} className="small"><Pill value={p.status} /> issued {fmtDateTime(p.issued_at, s.timezone)}{p.revoked_at && ` · revoked ${fmtDateTime(p.revoked_at, s.timezone)}`}</div>)}
            {(passes ?? []).length === 0 && <div className="small muted">No pass issued yet.</div>}
          </section>
        </aside>
      </div>
    </div>
  )
}
