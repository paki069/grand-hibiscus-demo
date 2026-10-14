import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getSettings } from '@/lib/data'
import { money, fmtDateTime, friendlyError } from '@/lib/format'
import { Pill, Empty } from '@/components/ui'

const SERVICE_TABS = [
  { key: 'all', label: 'All' },
  { key: 'hotel', label: 'Hotel' },
  { key: 'restaurant', label: 'Restaurant' },
  { key: 'spa', label: 'Spa' },
  { key: 'gym', label: 'Gym' },
  { key: 'event', label: 'Tours' },
] as const

const RESERVATION_STATUSES = ['pending', 'confirmed', 'cancelled', 'completed'] as const

interface RestaurantReservation {
  reservation_id: string
  reference: string
  guest_name: string
  reservation_status: string
  entitlement_id: string
  title: string
  starts_at: string
  service_status: string
  checked_in_at: string | null
  area_name: string
  table_label: string
  party_size: number
  seat_labels: string[]
}

interface ReservationRow {
  id: string
  reference: string
  first_name: string
  last_name: string
  email: string
  status: string
  total: number | string | null
  currency: string
  created_at: string
  entitlements: { id: string; service_type: string; title: string; detail: string }[]
  payments: { status: string }[]
}

function validDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null
}

function validTime(value?: string) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null
  const [hours, minutes] = value.split(':').map(Number)
  return hours <= 23 && minutes <= 59 ? value : null
}

export default async function Reservations({ searchParams }: {
  searchParams: Promise<{
    status?: string
    service?: string
    q?: string
    date?: string
    from?: string
    to?: string
    code?: string
    serviceFrom?: string
    serviceTo?: string
  }>
}) {
  const sp = await searchParams
  const supabase = await createClient()
  const settings = await getSettings()
  const activeTab = SERVICE_TABS.find((tab) => tab.key === (sp.service ?? 'all')) ?? SERVICE_TABS[0]
  const activeService = activeTab.key === 'all' ? null : activeTab.key
  const status = RESERVATION_STATUSES.find((value) => value === sp.status) ?? null
  const search = sp.q?.trim().replace(/[%,()]/g, '') ?? ''
  const serviceFrom = validDate(sp.serviceFrom)
  const serviceTo = validDate(sp.serviceTo)
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: settings.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  function tabHref(key: string) {
    const params = new URLSearchParams()
    if (key !== 'all') params.set('service', key)
    if (sp.status) params.set('status', sp.status)
    if (sp.q && key !== 'restaurant') params.set('q', sp.q)
    if (key === 'restaurant') {
      if (sp.date) params.set('date', sp.date)
      if (sp.from) params.set('from', sp.from)
      if (sp.to) params.set('to', sp.to)
      if (sp.code) params.set('code', sp.code)
    } else if (key !== 'all') {
      if (sp.serviceFrom) params.set('serviceFrom', sp.serviceFrom)
      if (sp.serviceTo) params.set('serviceTo', sp.serviceTo)
    }
    const query = params.toString()
    return `/admin/reservations${query ? `?${query}` : ''}`
  }

  let loadError: string | null = null
  let reservations: ReservationRow[] = []
  let restaurantBookings: RestaurantReservation[] = []

  if (activeService === 'restaurant') {
    const today = localDate.format(new Date())
    const date = validDate(sp.date) ?? today
    const from = validTime(sp.from)
    const to = validTime(sp.to)
    const code = sp.code?.trim() || null
    const { data, error } = await supabase.rpc('restaurant_reservations', {
      p_date: date,
      p_from_time: from,
      p_to_time: to,
      p_code: code,
    })
    loadError = error?.message ?? null
    restaurantBookings = (data ?? []) as RestaurantReservation[]
  } else {
    let ids: string[] | null = null
    if (activeService) {
      const { data, error } = await supabase.from('entitlements')
        .select('reservation_id, starts_at')
        .eq('service_type', activeService)
        .limit(1000)
      loadError = error?.message ?? null
      ids = [...new Set((data ?? [])
        .filter((entitlement) => {
          if (!serviceFrom && !serviceTo) return true
          const date = localDate.format(new Date(entitlement.starts_at))
          return (!serviceFrom || date >= serviceFrom) && (!serviceTo || date <= serviceTo)
        })
        .map((entitlement) => entitlement.reservation_id))]
    }

    let query = supabase.from('reservations')
      .select('id, reference, first_name, last_name, email, status, total, currency, created_at, entitlements(id,service_type,title,detail), payments(status)')
      .neq('status', 'cart')
      .order('created_at', { ascending: false })
      .limit(200)
    if (status) query = query.eq('status', status)
    if (ids) query = query.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
    if (search) query = query.or(`reference.ilike.%${search}%,last_name.ilike.%${search}%,first_name.ilike.%${search}%,email.ilike.%${search}%`)
    const { data, error } = await query
    loadError = loadError || error?.message || null
    reservations = data ?? []
  }

  const clearParams = new URLSearchParams()
  if (activeService) clearParams.set('service', activeService)
  const clearQuery = clearParams.toString()
  const clearHref = `/admin/reservations${clearQuery ? `?${clearQuery}` : ''}`
  const restaurantDate = validDate(sp.date) ?? localDate.format(new Date())
  const restaurantStatusOptions = RESERVATION_STATUSES.filter((value) => value !== 'cancelled')
  const visibleRestaurantBookings = restaurantBookings.filter((booking) => !status || booking.reservation_status === status)

  return (
    <div className="stack">
      <h1>Reservations</h1>
      <nav className="tabs" role="tablist" aria-label="Reservation service">
        {SERVICE_TABS.map((tab) => (
          <Link
            key={tab.key}
            href={tabHref(tab.key)}
            role="tab"
            aria-selected={tab.key === activeTab.key}
            className={tab.key === activeTab.key ? 'active' : ''}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <form className="row" style={{ alignItems: 'end' }}>
        {activeService !== 'restaurant' && (
          <label className="field">Search<input name="q" defaultValue={sp.q} placeholder="Ref, name, email" /></label>
        )}
        <label className="field">Status
          <select name="status" defaultValue={status ?? ''}>
            <option value="">All</option>
            {(activeService === 'restaurant' ? restaurantStatusOptions : RESERVATION_STATUSES).map((value) => (
              <option key={value} value={value}>{value[0].toUpperCase()}{value.slice(1)}</option>
            ))}
          </select>
        </label>
        {activeService === 'restaurant' ? (
          <>
            <label className="field">Date<input type="date" name="date" defaultValue={restaurantDate} required /></label>
            <label className="field">From<input type="time" name="from" defaultValue={validTime(sp.from) ?? ''} /></label>
            <label className="field">To<input type="time" name="to" defaultValue={validTime(sp.to) ?? ''} /></label>
            <label className="field">Reservation code<input type="search" name="code" placeholder="e.g. HX-4EC3BDDD" defaultValue={sp.code} autoComplete="off" /></label>
          </>
        ) : activeService ? (
          <>
            <label className="field">{activeService === 'hotel' ? 'Check-in from' : 'Service date from'}
              <input type="date" name="serviceFrom" defaultValue={serviceFrom ?? ''} />
            </label>
            <label className="field">{activeService === 'hotel' ? 'Check-in to' : 'Service date to'}
              <input type="date" name="serviceTo" defaultValue={serviceTo ?? ''} />
            </label>
            <input type="hidden" name="service" value={activeService} />
          </>
        ) : null}
        {activeService === 'restaurant' && <input type="hidden" name="service" value="restaurant" />}
        <button className="btn secondary">Filter</button>
        <Link className="btn" href={clearHref}>Clear</Link>
      </form>
      {loadError && <div className="notice bad" role="alert">{friendlyError(loadError)}</div>}
      {!loadError && activeService === 'restaurant' && visibleRestaurantBookings.length === 0 && (
        <Empty>No restaurant reservations match.</Empty>
      )}
      {!loadError && activeService === 'restaurant' && visibleRestaurantBookings.length > 0 && (
        <div className="table-wrap"><table className="data">
          <thead><tr><th>Time</th><th>Guest</th><th>Party</th><th>Seating</th><th>Booking</th><th>Check-in</th></tr></thead>
          <tbody>{visibleRestaurantBookings.map((booking) => (
              <tr key={booking.entitlement_id}>
                <td className="nowrap">{fmtDateTime(booking.starts_at, settings.timezone)}</td>
                <td>{booking.guest_name}<div className="small"><Link href={`/admin/reservations/${booking.reservation_id}`}>{booking.reference}</Link></div></td>
                <td>{booking.party_size}</td>
                <td><strong>{booking.table_label}</strong><div className="small muted">{booking.area_name}{booking.seat_labels.length > 0 && ` · seats ${booking.seat_labels.join(', ')}`}</div></td>
                <td><Pill value={booking.reservation_status} /><div className="small muted">{booking.title}</div></td>
                <td>{booking.checked_in_at ? <Pill value="checked_in" label="checked in" /> : <Pill value={booking.service_status} />}</td>
              </tr>
            ))}</tbody>
        </table></div>
      )}
      {!loadError && activeService !== 'restaurant' && reservations.length === 0 && <Empty>No reservations match.</Empty>}
      {!loadError && activeService !== 'restaurant' && reservations.length > 0 && (
        <div className="table-wrap"><table className="data">
          <thead><tr><th>Ref</th><th>Guest</th><th>Services</th><th>Placed</th><th>Total</th><th>Booking</th><th>Payment</th></tr></thead>
          <tbody>{reservations.map((reservation) => (
            <tr key={reservation.id}>
              <td><Link href={`/admin/reservations/${reservation.id}`}>{reservation.reference}</Link></td>
              <td>{reservation.first_name} {reservation.last_name}<div className="small muted">{reservation.email}</div></td>
              <td>{activeService
                ? (reservation.entitlements ?? [])
                  .filter((entitlement) => entitlement.service_type === activeService)
                  .map((entitlement) => (
                    <div key={entitlement.id}>
                      <strong>{entitlement.title}</strong>
                      {entitlement.detail && <div className="small muted">{entitlement.detail}</div>}
                    </div>
                  ))
                : [...new Set((reservation.entitlements ?? []).map((entitlement) => entitlement.service_type))]
                  .map((service) => service === 'event' ? 'Tours' : `${service[0].toUpperCase()}${service.slice(1)}`)
                  .join(', ')}</td>
              <td className="nowrap">{fmtDateTime(reservation.created_at, settings.timezone)}</td>
              <td>{money(reservation.total, reservation.currency)}</td>
              <td><Pill value={reservation.status} /></td>
              <td>{reservation.payments?.[0] ? <Pill value={reservation.payments[0].status} /> : '—'}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  )
}
