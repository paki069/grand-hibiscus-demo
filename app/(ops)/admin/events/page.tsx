import AdminSection, { type Tab } from '@/components/AdminSection'
import EventBookingsList, { type EventBookingRow } from '@/components/EventBookingsList'
import { createClient } from '@/lib/supabase/server'
import { getSettings } from '@/lib/data'

const tabs: Tab[] = [
  { key: 'events', label: 'Tours', selects: { provider_id: { table: 'event_providers', label: 'name' } }, config: { table: 'events', title: 'Tours', orderBy: 'sort_order', fields: [
    { key: 'title', label: 'Tour name', required: true }, { key: 'provider_id', label: 'Provider', type: 'select', required: true },
    { key: 'sort_order', label: 'Display order', type: 'number', required: true, defaultValue: 0 },
    { key: 'available_from', label: 'Available from', type: 'date', help: 'First date guests can book this tour.' },
    { key: 'available_until', label: 'Available through', type: 'date', help: 'Last date guests can book this tour, inclusive.' },
    { key: 'departure_start', label: 'Departure starts', type: 'time' },
    { key: 'departure_end', label: 'Departure ends', type: 'time' },
    { key: 'location', label: 'Meeting location' },
    { key: 'capacity', label: 'Seats per departure', type: 'number', nullable: true, help: 'Applies separately to each date. Empty = unlimited.' },
    { key: 'price', label: 'Adult price', type: 'number', step: '0.01', required: true, defaultValue: 0 }, { key: 'child_price', label: 'Child price', type: 'number', step: '0.01', nullable: true },
    { key: 'booking_enabled', label: 'Allow online booking', type: 'checkbox', help: 'Guests can book this tour only within the configured date range and a room stay.' },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'photo_url', label: 'Photo', type: 'image' }, { key: 'active', label: 'Published', type: 'checkbox' },
  ] } },
  { key: 'providers', label: 'Providers', config: { table: 'event_providers', title: 'Tour providers (private contact details)', orderBy: 'name', fields: [
    { key: 'name', label: 'Name', required: true }, { key: 'email', label: 'Email', type: 'email' },
  ] } },
  { key: 'bookings', label: 'Tour bookings', config: { table: 'event_bookings', title: 'Tour bookings', fields: [] } },
]

const localDate = (iso: string | null, timezone: string) => {
  if (!iso) return ''
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso))
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export default async function Events({ searchParams }: { searchParams: Promise<{ tab?: string; event?: string; provider?: string; date?: string; status?: string; q?: string }> }) {
  const sp = await searchParams
  let customContent
  if (sp.tab === 'bookings') {
    const supabase = await createClient()
    const settings = await getSettings()
    const [{ data: events, error: eventsError }, { data: providers, error: providersError }] = await Promise.all([
      supabase.from('events').select('id, title, provider_id, starts_at, location, available_from, available_until').order('sort_order').order('title'),
      supabase.from('event_providers').select('id, name, email').order('name'),
    ])
    if (eventsError) throw new Error(`Could not load tour events: ${eventsError.message}`)
    if (providersError) throw new Error(`Could not load tour providers: ${providersError.message}`)

    const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') ? sp.date! : ''
    const selectedStatus = ['pending', 'confirmed', 'cancelled', 'completed'].includes(sp.status ?? '') ? sp.status! : ''
    const query = (sp.q ?? '').trim().slice(0, 100).toLowerCase()
    const filteredEvents = (events ?? []).filter((event) =>
      (!sp.event || event.id === sp.event)
      && (!sp.provider || event.provider_id === sp.provider)
      && (!selectedDate || (event.available_from && event.available_until
        ? selectedDate >= event.available_from && selectedDate <= event.available_until
        : localDate(event.starts_at, settings.timezone) === selectedDate)),
    )
    const providerById = new Map((providers ?? []).map((provider) => [provider.id, provider]))
    const rows: EventBookingRow[] = []

    if (filteredEvents.length > 0) {
      const bookings = []
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase
          .from('event_bookings')
          .select('id, event_id, entitlement_id, qty')
          .in('event_id', filteredEvents.map((event) => event.id))
          .order('id')
          .range(offset, offset + 499)
        if (error) throw new Error(`Could not load tour bookings: ${error.message}`)
        const batch = data ?? []
        bookings.push(...batch)
        if (batch.length < 500) break
      }

      const entitlementIds = [...new Set(bookings.map((booking) => booking.entitlement_id))]
      if (entitlementIds.length > 0) {
        const { data: entitlements, error: entitlementsError } = await supabase
          .from('entitlements')
          .select('id, reservation_id, adults, children, total, starts_at')
          .in('id', entitlementIds)
        if (entitlementsError) throw new Error(`Could not load tour booking details: ${entitlementsError.message}`)

        const reservationIds = [...new Set((entitlements ?? []).map((entitlement) => entitlement.reservation_id))]
        const { data: reservations, error: reservationsError } = reservationIds.length > 0
          ? await supabase
            .from('reservations')
            .select('id, reference, first_name, last_name, email, phone, status, created_at, currency')
            .in('id', reservationIds)
          : { data: [], error: null }
        if (reservationsError) throw new Error(`Could not load tour guest details: ${reservationsError.message}`)

        const { data: payments, error: paymentsError } = reservationIds.length > 0
          ? await supabase
            .from('payments')
            .select('reservation_id, entitlement_id, status, method, created_at')
            .in('reservation_id', reservationIds)
            .order('created_at', { ascending: false })
          : { data: [], error: null }
        if (paymentsError) throw new Error(`Could not load tour payment details: ${paymentsError.message}`)

        const eventById = new Map((events ?? []).map((event) => [event.id, event]))
        const entitlementById = new Map((entitlements ?? []).map((entitlement) => [entitlement.id, entitlement]))
        const reservationById = new Map((reservations ?? []).map((reservation) => [reservation.id, reservation]))
        const paymentByEntitlementId = new Map<string, { status: string; method: string }>()
        const paymentByReservationId = new Map<string, { status: string; method: string }>()
        for (const payment of payments ?? []) {
          if (payment.entitlement_id) {
            if (!paymentByEntitlementId.has(payment.entitlement_id)) paymentByEntitlementId.set(payment.entitlement_id, payment)
          } else if (!paymentByReservationId.has(payment.reservation_id)) {
            paymentByReservationId.set(payment.reservation_id, payment)
          }
        }

        for (const booking of bookings) {
          const event = eventById.get(booking.event_id)
          const entitlement = entitlementById.get(booking.entitlement_id)
          const reservation = entitlement ? reservationById.get(entitlement.reservation_id) : undefined
          if (!event || !entitlement || !reservation) {
            throw new Error('A tour booking is missing its event, reservation, or guest details.')
          }
          if (reservation.status === 'cart' || (selectedStatus && reservation.status !== selectedStatus)) continue
          if (selectedDate && localDate(entitlement.starts_at, settings.timezone) !== selectedDate) continue
          const guest = `${reservation.first_name} ${reservation.last_name}`
          if (query && ![guest, reservation.email, reservation.phone, reservation.reference].some((value) => value.toLowerCase().includes(query))) continue
          const provider = event.provider_id ? providerById.get(event.provider_id) : undefined
          rows.push({
            id: booking.id,
            eventTitle: event.title,
            providerName: provider?.name ?? '—',
            providerEmail: provider?.email ?? '',
            startsAt: entitlement.starts_at,
            location: event.location,
            adults: entitlement.adults,
            children: entitlement.children,
            qty: booking.qty,
            reservationId: reservation.id,
            reference: reservation.reference,
            guest,
            email: reservation.email,
            phone: reservation.phone,
            reservationStatus: reservation.status,
            currency: reservation.currency,
            total: Number(entitlement.total),
            payment: paymentByEntitlementId.get(entitlement.id) ?? paymentByReservationId.get(reservation.id) ?? null,
            createdAt: reservation.created_at,
          })
        }
        rows.sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? '') || b.createdAt.localeCompare(a.createdAt))
      }
    }

    customContent = <EventBookingsList
      rows={rows}
      events={(events ?? []).map(({ id, title }) => ({ id, title }))}
      providers={(providers ?? []).map(({ id, name }) => ({ id, name }))}
      filters={{ event: sp.event ?? '', provider: sp.provider ?? '', date: selectedDate, status: selectedStatus, q: sp.q ?? '' }}
      timezone={settings.timezone}
    />
  }

  return (
    <AdminSection
      title="Tours"
      base="/admin/events"
      tabs={tabs}
      tab={sp.tab}
      intro="Manage the guest-facing Tours catalog and providers here. Hosted-event inquiries are separate under Events."
      customContent={customContent}
    />
  )
}
