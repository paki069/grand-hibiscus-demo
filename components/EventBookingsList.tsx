import Link from 'next/link'
import { Empty, Pill } from '@/components/ui'
import { fmtDateTime, money } from '@/lib/format'

export interface EventBookingRow {
  id: string
  eventTitle: string
  providerName: string
  providerEmail: string
  startsAt: string | null
  location: string
  adults: number
  children: number
  qty: number
  reservationId: string
  reference: string
  guest: string
  email: string
  phone: string
  reservationStatus: string
  currency: string
  total: number
  payment: { status: string; method: string } | null
  createdAt: string
}

export default function EventBookingsList({ rows, events, providers, filters, timezone }: {
  rows: EventBookingRow[]
  events: { id: string; title: string }[]
  providers: { id: string; name: string }[]
  filters: { event: string; provider: string; date: string; status: string; q: string }
  timezone: string
}) {
  return (
    <div className="stack">
      <form action="/admin/events" method="get" className="row" style={{ alignItems: 'end' }}>
        <input type="hidden" name="tab" value="bookings" />
        <label className="field">Search guest or reference<input name="q" defaultValue={filters.q} placeholder="Name, email, phone, ref" /></label>
        <label className="field">Tour<select name="event" defaultValue={filters.event}><option value="">All tours</option>{events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}</select></label>
        <label className="field">Provider<select name="provider" defaultValue={filters.provider}><option value="">All providers</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
        <label className="field">Tour date<input type="date" name="date" defaultValue={filters.date} /></label>
        <label className="field">Booking status<select name="status" defaultValue={filters.status}>
          <option value="">All statuses</option>
          {['pending', 'confirmed', 'cancelled', 'completed'].map((status) => <option key={status} value={status}>{status}</option>)}
        </select></label>
        <button className="btn secondary">Filter bookings</button>
        <Link className="btn secondary" href="/admin/events?tab=bookings">Clear</Link>
      </form>
      <p className="small muted" style={{ margin: 0 }}>{rows.length} tour {rows.length === 1 ? 'booking' : 'bookings'}. Guest names and contact details belong to the reservation holder; party size includes accompanying adults and children.</p>
      {rows.length === 0 ? <Empty>No tour bookings match these filters.</Empty> : (
        <div className="table-wrap"><table className="data">
          <thead><tr><th>Tour & provider</th><th>Date & time</th><th>Booking guest</th><th>Attending</th><th>Reservation</th><th>Payment</th></tr></thead>
          <tbody>{rows.map((row) => (
            <tr key={row.id}>
              <td>
                <strong>{row.eventTitle}</strong>
                <div className="small muted">{row.providerName}{row.providerEmail && ` · ${row.providerEmail}`}</div>
                {row.location && <div className="small muted">{row.location}</div>}
              </td>
              <td className="nowrap">{fmtDateTime(row.startsAt, timezone)}</td>
              <td>{row.guest}<div className="small muted">{row.email}</div><div className="small muted">{row.phone}</div></td>
              <td>{row.qty} guest{row.qty === 1 ? '' : 's'}<div className="small muted">{row.adults} adult{row.adults === 1 ? '' : 's'}{row.children > 0 ? ` · ${row.children} child${row.children === 1 ? '' : 'ren'}` : ''}</div></td>
              <td>
                <Link href={`/admin/reservations/${row.reservationId}`}>{row.reference}</Link>
                <div className="small"><Pill value={row.reservationStatus} /></div>
                <div className="small muted">{money(row.total, row.currency)}</div>
              </td>
              <td>{row.payment ? <><Pill value={row.payment.status} /><div className="small muted">{row.payment.method.replaceAll('_', ' ')}</div></> : '—'}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  )
}
