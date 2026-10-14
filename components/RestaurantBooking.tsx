'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { friendlyError, money, addDays, todayISO } from '@/lib/format'
import { GuestCounters } from '@/components/Stepper'
import DiningRoomDecor from '@/components/DiningRoomDecor'
import { DetailsFields, detailsValid, type Details } from '@/components/Checkout'
import RestaurantMenu, { type ProductVM as RestaurantMenuProductVM } from '@/components/RestaurantMenu'

export type { ProductVM } from '@/components/RestaurantMenu'

export interface AreaVM { id: string; name: string; width: number; height: number }
export interface TableVM { id: string; area_id: string; label: string; shape: string; x: number; y: number; w: number; h: number; capacity: number; min_party: number; seat_selectable: boolean }
export interface SeatVM { id: string; table_id: string; label: string; x: number; y: number }
export interface ConfigVM { open_time: string; close_time: string; slot_minutes: number; dwell_minutes: number; closed_weekdays: number[]; deposit_per_guest: number }
export interface ExistingDiningBooking { date: string; time: string; tableId: string; seats: string[] }

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const displayTime = (t: string) => {
  const hours = Number(t.slice(0, 2))
  return `${hours % 12 || 12}:${t.slice(3, 5)} ${hours < 12 ? 'AM' : 'PM'}`
}
const dateIsClosed = (date: string, closedWeekdays: number[]) =>
  closedWeekdays.includes(new Date(`${date}T12:00:00Z`).getUTCDay())
const dateLabel = (date: string, weekday = false) =>
  new Intl.DateTimeFormat('en-US', {
    ...(weekday ? { weekday: 'short' as const } : {}),
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`))
const EMPTY_GUEST_DETAILS: Details = { first_name: '', last_name: '', email: '', phone: '', notes: '' }
function datesInStay(checkin: string, checkout: string) {
  const dates: string[] = []
  const end = new Date(`${checkout}T00:00:00Z`).getTime()
  for (let day = new Date(`${checkin}T00:00:00Z`); day.getTime() < end; day.setUTCDate(day.getUTCDate() + 1)) {
    dates.push(day.toISOString().slice(0, 10))
  }
  return dates
}

export default function RestaurantBooking({ areas, tables, seats, products, config, currency, holdMinutes, hotelEntitlementId, roomCheckinDate, roomCheckoutDate, roomAdults, roomChildren, hotelCheckinTime, existingBookings = [], embedded = false, initialGuestDetails = EMPTY_GUEST_DETAILS, isLoggedIn = false, onAdded }: {
  areas: AreaVM[]; tables: TableVM[]; seats: SeatVM[]; products: RestaurantMenuProductVM[]; config: ConfigVM; currency: string; holdMinutes: number
  hotelEntitlementId?: string; roomCheckinDate?: string; roomCheckoutDate?: string; roomAdults?: number; roomChildren?: number
  hotelCheckinTime?: string; existingBookings?: ExistingDiningBooking[]; embedded?: boolean; initialGuestDetails?: Details; isLoggedIn?: boolean; onAdded?: () => void
}) {
  const router = useRouter()
  const standaloneBooking = !embedded && !hotelEntitlementId
  const roomContext = Boolean(hotelEntitlementId && roomCheckinDate && roomCheckoutDate)
  const editingRoomDining = roomContext && existingBookings.length > 0
  const stayDates = useMemo(
    () => roomContext ? datesInStay(roomCheckinDate!, roomCheckoutDate!) : [],
    [roomContext, roomCheckinDate, roomCheckoutDate],
  )
  const initialDateTimes = existingBookings.reduce<Record<string, string>>((times, booking) => {
    if (!times[booking.date]) times[booking.date] = booking.time
    return times
  }, {})
  const initialDiningDates = [...new Set(existingBookings.map((booking) => booking.date))].sort()
  const initialTable = existingBookings.find((booking) => booking.tableId)
  const [date, setDate] = useState(roomCheckinDate || addDays(todayISO(), 1))
  const [time, setTime] = useState('')
  const [selectedDates, setSelectedDates] = useState<string[]>(() =>
    editingRoomDining
      ? initialDiningDates
      : roomContext && !dateIsClosed(roomCheckinDate!, config.closed_weekdays) ? [roomCheckinDate!] : [],
  )
  const [dateTimes, setDateTimes] = useState<Record<string, string>>(initialDateTimes)
  const [g, setG] = useState({ a: roomAdults ?? 2, c: roomChildren ?? 0 })
  const [areaId, setAreaId] = useState(tables.find((table) => table.id === initialTable?.tableId)?.area_id ?? areas[0]?.id ?? '')
  const [activeView, setActiveView] = useState<'area' | 'menu'>('area')
  const [availabilityByDate, setAvailabilityByDate] = useState<Record<string, Record<string, { taken: boolean; seats: string[] }>>>({})
  const [loading, setLoading] = useState(false)
  const [selTable, setSelTable] = useState<string | null>(initialTable?.tableId ?? null)
  const [selSeats, setSelSeats] = useState<string[]>(() => {
    const selectedLabels = new Set(initialTable?.seats ?? [])
    return seats.filter((seat) => seat.table_id === initialTable?.tableId && selectedLabels.has(seat.label)).map((seat) => seat.id)
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [showGuestDetails, setShowGuestDetails] = useState(false)
  const [guestDetails, setGuestDetails] = useState<Details>(initialGuestDetails)
  const [showDetailsErrors, setShowDetailsErrors] = useState(false)

  const adults = roomContext ? roomAdults ?? 0 : g.a
  const children = roomContext ? roomChildren ?? 0 : g.c
  const party = adults + children
  const closed = !roomContext && dateIsClosed(date, config.closed_weekdays)
  const earlyReadyTime = useMemo(() => {
    const arrivalTime = roomContext
      ? selectedDates.includes(roomCheckinDate!) ? dateTimes[roomCheckinDate!] : ''
      : date === roomCheckinDate ? time : ''
    if (!roomCheckinDate || !arrivalTime) return null
    const mealEnd = toMin(arrivalTime) + config.dwell_minutes
    if (mealEnd >= toMin(hotelCheckinTime ?? '15:00')) return null
    return hhmm(mealEnd)
  }, [roomContext, roomCheckinDate, selectedDates, dateTimes, date, time, config.dwell_minutes, hotelCheckinTime])
  const slots = useMemo(() => {
    const out: string[] = []
    const end = toMin(config.close_time) - config.dwell_minutes
    for (let m = toMin(config.open_time); m <= end; m += 60) out.push(hhmm(m))
    return out
  }, [config.open_time, config.close_time, config.dwell_minutes])
  const availabilitySchedule = useMemo(() => {
    if (roomContext) return selectedDates.flatMap((day) => dateTimes[day] ? [{ date: day, time: dateTimes[day] }] : [])
    return time && !closed ? [{ date, time }] : []
  }, [roomContext, selectedDates, dateTimes, date, time, closed])
  const allTimesSelected = roomContext
    ? selectedDates.length > 0 && selectedDates.every((day) => !!dateTimes[day])
    : !!time && !closed
  const firstMissingDate = roomContext ? selectedDates.find((day) => !dateTimes[day]) : null
  const timeGridLayout = selectedDates.length === 1 ? 'single'
    : selectedDates.length === 2 ? 'double'
      : selectedDates.length % 3 === 1 ? 'last-full'
        : selectedDates.length % 3 === 2 ? 'last-half' : ''

  const refresh = useCallback(async () => {
    if (availabilitySchedule.length === 0) {
      setAvailabilityByDate({})
      setLoading(false)
      return
    }
    const client = createClient()
    const results = await Promise.all(availabilitySchedule.map(async (slot) => ({
      date: slot.date,
      ...await client.rpc('restaurant_availability', { p_date: slot.date, p_time: slot.time }),
    })))
    const next: Record<string, Record<string, { taken: boolean; seats: string[] }>> = {}
    let firstError: unknown = null
    for (const result of results) {
      if (result.error) {
        firstError ??= result.error
        continue
      }
      const day: Record<string, { taken: boolean; seats: string[] }> = {}
      for (const row of result.data ?? []) day[row.table_id] = { taken: row.taken, seats: row.taken_seat_ids ?? [] }
      next[result.date] = day
    }
    setAvailabilityByDate(next)
    setLoading(false)
    setMsg(firstError ? { tone: 'bad', text: friendlyError(firstError) } : null)
  }, [availabilitySchedule, editingRoomDining, hotelEntitlementId])

  useEffect(() => {
    if (availabilitySchedule.length === 0) {
      setAvailabilityByDate({})
      setLoading(false)
      return
    }
    setLoading(true)
    void refresh()
    const id = setInterval(refresh, 10000)
    return () => clearInterval(id)
  }, [refresh, availabilitySchedule.length])

  const area = areas.find((a) => a.id === areaId)
  const areaTables = tables.filter((t) => t.area_id === areaId)
  const takenSeatIds = (tableId: string) => availabilitySchedule.flatMap((slot) =>
    availabilityByDate[slot.date]?.[tableId]?.seats ?? [],
  )
  const tableState = (t: TableVM) => {
    if (loading || !allTimesSelected || availabilitySchedule.length === 0) return 'idle'
    const requiredCapacity = party <= 2 ? 2 : party <= 4 ? 4 : party <= 8 ? 8 : null
    if (requiredCapacity === null || t.capacity !== requiredCapacity || party < t.min_party) return 'small-party'
    for (const slot of availabilitySchedule) {
      const state = availabilityByDate[slot.date]?.[t.id]
      if (!state) return 'idle'
      if (state.taken) return 'taken'
    }
    return 'free'
  }
  const sel = tables.find((t) => t.id === selTable)
  const ready = !!sel && tableState(sel) === 'free'
    && (!sel.seat_selectable || (selSeats.length === party && selSeats.every((id) => !takenSeatIds(sel.id).includes(id))))

  function pickTable(t: TableVM) {
    const st = tableState(t)
    if (st === 'taken' || st === 'small-party' || st === 'idle') return
    setSelTable(t.id); setSelSeats([]); setMsg(null)
  }
  function toggleSeat(id: string) {
    if (takenSeatIds(selTable ?? '').includes(id)) return
    setSelSeats((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < party ? [...cur, id] : cur))
  }
  function toggleDate(day: string) {
    if (dateIsClosed(day, config.closed_weekdays)) return
    setSelectedDates((current) => current.includes(day)
      ? current.filter((selected) => selected !== day)
      : [...current, day].sort())
    if (!editingRoomDining) {
      setSelTable(null)
      setSelSeats([])
    }
    setMsg(null)
  }
  function setDateTime(day: string, value: string) {
    setDateTimes((current) => ({ ...current, [day]: value }))
    if (!editingRoomDining) {
      setSelTable(null)
      setSelSeats([])
    }
    setMsg(null)
  }

  async function add() {
    const removingDining = editingRoomDining && selectedDates.length === 0
    if (!removingDining && (!sel || !ready)) return
    if (standaloneBooking && !showGuestDetails) {
      setShowGuestDetails(true)
      setMsg(null)
      return
    }
    if (standaloneBooking && !detailsValid(guestDetails)) {
      setShowDetailsErrors(true)
      return
    }
    setBusy(true); setMsg(null)
    const client = createClient()
    const booking = editingRoomDining
      ? await client.rpc('update_restaurant_dates_for_room_cart', {
        p_hotel_entitlement: hotelEntitlementId,
        p_table: removingDining ? null : sel?.id ?? null,
        p_seats: !removingDining && sel?.seat_selectable ? selSeats : null,
        p_dates: selectedDates,
        p_times: selectedDates.map((day) => dateTimes[day]),
        p_adults: adults,
        p_children: children,
      })
      : roomContext
      ? await client.rpc('add_restaurant_dates_to_room_cart', {
        p_hotel_entitlement: hotelEntitlementId, p_table: sel!.id, p_seats: sel!.seat_selectable ? selSeats : null,
        p_dates: selectedDates, p_times: selectedDates.map((day) => dateTimes[day]), p_adults: adults, p_children: children,
      })
      : hotelEntitlementId
        ? await client.rpc('add_restaurant_to_room_cart', {
          p_hotel_entitlement: hotelEntitlementId, p_table: sel!.id, p_seats: sel!.seat_selectable ? selSeats : null,
          p_date: date, p_time: time, p_adults: adults, p_children: children,
        })
        : standaloneBooking
          ? await client.rpc('confirm_standalone_restaurant_booking', {
            p_table: sel!.id, p_seats: sel!.seat_selectable ? selSeats : null,
            p_date: date, p_time: time, p_adults: adults, p_children: children,
            p_first: guestDetails.first_name, p_last: guestDetails.last_name, p_email: guestDetails.email,
            p_phone: guestDetails.phone, p_notes: guestDetails.notes,
          })
          : await client.rpc('add_restaurant_to_cart', {
            p_table: sel!.id, p_seats: sel!.seat_selectable ? selSeats : null,
            p_date: date, p_time: time, p_adults: adults, p_children: children,
          })
    const { data, error } = booking
    setBusy(false)
    if (error) {
      if (error.message === 'not_authenticated') {
        const next = hotelEntitlementId ? `/book/restaurant?room=${encodeURIComponent(hotelEntitlementId)}` : '/book/restaurant'
        window.location.href = `/login?next=${encodeURIComponent(next)}`
        return
      }
      const message = friendlyError(error)
      await refresh()
      setMsg({ tone: 'bad', text: message })
      return
    }
    if (standaloneBooking) {
      const reservationId = data && typeof data === 'object' && 'reservation_id' in data
        ? data.reservation_id
        : null
      if (typeof reservationId !== 'string') {
        setMsg({ tone: 'bad', text: 'The reservation was confirmed, but its confirmation details could not be loaded. Please check your reservations before trying again.' })
        return
      }
      void fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reservationId, kind: 'confirmation' }),
      }).then((response) => {
        if (!response.ok) console.error(`Restaurant confirmation notification request failed with status ${response.status}`)
      }).catch((error: unknown) => {
        console.error('Restaurant reservation was confirmed, but its notification request failed.', error)
      })
      router.push(`/reservations/${encodeURIComponent(reservationId)}?new=1`)
      return
    }
    setSelTable(null); setSelSeats([])
    router.refresh()
    if (onAdded) return onAdded()
    setMsg({ tone: 'ok', text: roomContext
      ? `Table ${sel!.label} reserved for ${selectedDates.length} date${selectedDates.length === 1 ? '' : 's'} and held for ${holdMinutes} minutes.`
      : `Table ${sel!.label} added to your cart and held for ${holdMinutes} minutes.` })
  }

  return (
    <div className="stack">
      {!embedded && <ol className="steps">
        {standaloneBooking ? (
          <>
            <li className={showGuestDetails ? 'done' : 'on'}>Choose table</li>
            <li className={showGuestDetails ? 'on' : ''}>Guest details</li>
            <li>Confirmation</li>
          </>
        ) : (
          <>
            {hotelEntitlementId && <li className="done">Room</li>}
            <li className="on">Restaurant</li>
            <li>Cart & pay</li>
          </>
        )}
      </ol>}
      {!(standaloneBooking && showGuestDetails) && <>
      {roomContext ? (
        <div className="stack restaurant-room-form">
          {editingRoomDining && <div className="notice warn small">
            Your current table hold is released while you edit. Update dining to hold your new selection; closing now means you will need to set up dining again.
          </div>}
          {earlyReadyTime && <div className="restaurant-guarantee" role="status">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            <span>{editingRoomDining ? 'If you update dining for' : 'Dine on'} {dateLabel(roomCheckinDate!, true)}{editingRoomDining ? ', your room will be guaranteed by ' : ' and your room is guaranteed by '}<strong>{displayTime(earlyReadyTime)}</strong>, right after your meal. Reception can hold your luggage until then.</span>
          </div>}
          <div className="restaurant-step-heading">
            <strong>1 · Choose your dining days</strong>
            <span>Any days during your stay</span>
          </div>
          <div className="restaurant-date-bubbles" role="group" aria-label="Choose dining dates during your stay">
            {stayDates.map((day) => {
              const isClosed = dateIsClosed(day, config.closed_weekdays)
              const selected = selectedDates.includes(day)
              return <button key={day} type="button" disabled={isClosed} aria-pressed={selected}
                className={`restaurant-date-bubble${selected ? ' selected' : ''}`}
                onClick={() => toggleDate(day)}>
                <strong>{dateLabel(day)}</strong>
                {selected && <span className="restaurant-date-check" aria-hidden="true">✓</span>}
                {isClosed && <small>Closed</small>}
              </button>
            })}
          </div>
          <div className="restaurant-step-heading">
            <strong>2 · Pick a time for each day</strong>
            <span>Same table and seats each day · held about {config.dwell_minutes} min</span>
          </div>
          {selectedDates.length > 0 ? <div className={`restaurant-date-times ${timeGridLayout}`}>
            {selectedDates.map((day) => (
              <section key={day} className="restaurant-day-card" aria-label={`Dining time on ${dateLabel(day, true)}`}>
                <header className="restaurant-day-card-header">
                  <strong>{dateLabel(day, true)}</strong>
                  {day === roomCheckinDate && <span className="restaurant-arrival-badge">Arrival day</span>}
                  <span className={`restaurant-day-choice${dateTimes[day] ? ' chosen' : ''}`}>
                    {dateTimes[day] ? `Chosen: ${displayTime(dateTimes[day])}` : 'Needs a time'}
                  </span>
                </header>
                <div className="field">
                  <select aria-label={`Time for ${dateLabel(day, true)}`} value={dateTimes[day] ?? ''} onChange={(event) => setDateTime(day, event.target.value)}>
                    <option value="">Select a time</option>
                    {slots.map((slot) => <option key={slot} value={slot}>{displayTime(slot)}</option>)}
                  </select>
                </div>
              </section>
            ))}
          </div> : <div className="restaurant-date-empty">Select one or more days during your stay to choose dining times.</div>}
        </div>
      ) : (
        <div className="card stack">
          <div className="form-grid restaurant-booking-fields" style={{ alignItems: 'end' }}>
            <label className="field">Date<input type="date" min={todayISO()} value={date} onChange={(e) => { setDate(e.target.value); setTime(''); setSelTable(null); setSelSeats([]) }} /></label>
            <label className="field">Time
              <select value={time} onChange={(e) => { setTime(e.target.value); setSelTable(null); setSelSeats([]) }} disabled={closed}>
                <option value="">Select a time</option>
                {slots.map((s) => <option key={s} value={s}>{displayTime(s)}</option>)}
              </select>
            </label>
            <GuestCounters adults={g.a} children={g.c} onChange={(a, c) => { setG({ a, c }); setSelTable(null); setSelSeats([]) }} maxTotal={8} />
          </div>
          {closed && <div className="notice warn">The restaurant is closed on that day.</div>}
          <div className="small muted">Reservations hold the table for about {config.dwell_minutes} minutes. Browse the menu without placing a pre-order.</div>
        </div>
      )}

      <div className={`stack restaurant-availability-panel${roomContext ? ' room-linked' : ' card'}`}>
        <div className="tabs restaurant-view-tabs" role="tablist" aria-label="Dining areas and menu">
          {areas.map((a) => (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={activeView === 'area' && a.id === areaId}
              className={activeView === 'area' && a.id === areaId ? 'active' : ''}
              onClick={() => { setAreaId(a.id); setActiveView('area'); setSelTable(null); setSelSeats([]) }}
            >{a.name}</button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={activeView === 'menu'}
            className={activeView === 'menu' ? 'active' : ''}
            onClick={() => setActiveView('menu')}
          >Menu</button>
        </div>
        {activeView === 'menu' ? <RestaurantMenu products={products} currency={currency} /> : (
          closed
            ? <div className="notice warn">The restaurant is closed on that day.</div>
            : !allTimesSelected
              ? <div className="notice info">{roomContext
                ? selectedDates.length === 0
                  ? 'Select at least one dining date during your stay.'
                  : `Choose a time for ${dateLabel(firstMissingDate!, true)} to see tables open on all selected days.`
                : 'Choose a time to see which tables are free.'}</div>
              : <>
          {loading && <div className="small muted"><span className="spinner" /> Loading availability…</div>}
          <div className="map-scroll" style={{ maxHeight: '60vh' }}>
            <div className="map" style={{ width: area?.width ?? 800, height: area?.height ?? 500 }}>
              {area?.name === 'Main Dining' && <DiningRoomDecor />}
              {areaTables.map((t) => {
                const st = tableState(t)
                const isSel = selTable === t.id
                return (
                  <div key={t.id}>
                    <button type="button" disabled={st !== 'free'}
                      aria-label={`Table ${t.label}, seats ${t.capacity}, ${st === 'free' ? 'available' : st === 'taken' ? 'taken' : 'not suitable for your party size'}`}
                      className={`tbl seating-${t.capacity === 8 ? 'vip' : t.capacity === 2 ? 'two' : 'four'} ${t.shape === 'round' ? 'round' : ''} ${st} ${isSel ? 'selected' : ''}`}
                      style={{ left: t.x, top: t.y, width: t.w, height: t.h }} onClick={() => pickTable(t)}>
                      <span>{t.label}<small>{t.capacity} seats</small></span>
                    </button>
                    {t.seat_selectable && seats.filter((s) => s.table_id === t.id).map((s) => {
                      const seatTaken = takenSeatIds(t.id).includes(s.id)
                      return (
                        <button key={s.id} type="button" aria-label={`Seat ${s.label}`} disabled={!isSel || seatTaken}
                          className={`seat ${seatTaken ? 'taken' : ''} ${selSeats.includes(s.id) ? 'selected' : ''}`}
                          style={{ left: t.x + s.x, top: t.y + s.y, opacity: isSel || seatTaken ? 1 : 0.5 }} onClick={() => toggleSeat(s.id)}>{s.label}</button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
          <div className="legend">
            <span><i className="map-key seating-two" />Duo · 1–2</span><span><i className="map-key seating-four" />Quartet · 3–4</span><span><i className="map-key seating-vip" />VIP · 5–8</span>
            <span>Available</span><span style={{ color: 'var(--accent)' }}>Selected</span><span className="muted">Taken / wrong size</span>
          </div>
          {sel?.seat_selectable && <div className="notice info small">Table {sel.label}: pick exactly {party} seat{party > 1 ? 's' : ''} ({selSeats.length} chosen).</div>}
          {areaTables.length === 0 && <div className="empty">No tables in this area yet.</div>}
              </>
        )}
      </div>
      </>}

      {standaloneBooking && showGuestDetails && (
        <section className="card stack" aria-labelledby="restaurant-guest-details-title">
          <div>
            <h2 id="restaurant-guest-details-title" style={{ margin: 0 }}>Confirm your table</h2>
            <p className="small muted" style={{ margin: '.35rem 0 0' }}>This table reservation is free. No cart or payment is needed.</p>
          </div>
          <div className="card flat stack">
            <div className="row between"><strong>{dateLabel(date, true)} · {displayTime(time)}</strong><strong>{money(0, currency)}</strong></div>
            <div>{area?.name} · Table {sel?.label}</div>
            <div className="small muted">Party of {party}: {adults} adult{adults === 1 ? '' : 's'}{children > 0 ? `, ${children} child${children === 1 ? '' : 'ren'}` : ''}</div>
          </div>
          <DetailsFields value={guestDetails} onChange={setGuestDetails} showErrors={showDetailsErrors} notesLabel="Notes for the restaurant (optional)" isLoggedIn={isLoggedIn} />
          <div className="row between">
            <button type="button" className="btn secondary" disabled={busy} onClick={() => { setShowGuestDetails(false); setShowDetailsErrors(false) }}>Back to table</button>
            <button type="button" className="btn accent" disabled={busy} onClick={add}>
              {busy ? <span className="spinner" /> : 'Confirm free reservation'}
            </button>
          </div>
        </section>
      )}

      {msg && <div className={`notice ${msg.tone}`} role={msg.tone === 'bad' ? 'alert' : 'status'}>{msg.text}</div>}
      {!showGuestDetails && <div className="row between restaurant-booking-actions">
        {!embedded && <Link className="btn secondary" href={hotelEntitlementId ? '/book/cart' : '/dining'} prefetch={hotelEntitlementId ? false : undefined}>← Back</Link>}
        <div className="row">
          <button className="btn accent" disabled={busy || (editingRoomDining
            ? selectedDates.length > 0 && !ready
            : !ready)} onClick={add}>
            {busy ? <span className="spinner" /> : editingRoomDining
              ? selectedDates.length > 0 ? `Update dining${selectedDates.length > 1 ? ` · ${selectedDates.length} dates` : ''}` : 'Remove dining'
              : roomContext ? `Reserve table${selectedDates.length > 1 ? ` · ${selectedDates.length} dates` : ''}` : standaloneBooking ? 'Continue to details' : 'Add to cart'}
          </button>
          {!embedded && !standaloneBooking && <Link className="btn" href="/book/cart" prefetch={false}>Go to cart</Link>}
        </div>
      </div>}
    </div>
  )
}
