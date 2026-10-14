'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmtDate, friendlyError, money } from '@/lib/format'
import { GuestCounters } from '@/components/Stepper'
import type { TourVM } from '@/components/ToursShowcase'
import { tourDatesForStay } from '@/lib/tour-dates'

type DateWindow = { first: string; last: string }
type Party = { adults: number; children: number }

function bookingWindow(tour: TourVM, checkin: string, checkout: string, timezone: string): DateWindow | null {
  const dates = tourDatesForStay(tour, checkin, checkout, timezone)
  return dates.length > 0 ? { first: dates[0], last: dates[dates.length - 1] } : null
}

function displayTime(value: string) {
  const date = new Date(`2000-01-01T${value.slice(0, 5)}:00Z`)
  return new Intl.DateTimeFormat('en', { timeStyle: 'short', timeZone: 'UTC' }).format(date)
}

export default function TourBooking({
  events, hotelEntitlementId, roomCheckinDate, roomCheckoutDate, roomAdults, roomChildren,
  currency, tz, onAdded,
}: {
  events: TourVM[]
  hotelEntitlementId: string
  roomCheckinDate: string
  roomCheckoutDate: string
  roomAdults: number
  roomChildren: number
  currency: string
  tz: string
  onAdded: () => void
}) {
  const [openTour, setOpenTour] = useState<string | null>(null)
  const [dates, setDates] = useState<Record<string, string>>({})
  const [parties, setParties] = useState<Record<string, Party>>({})
  const [busyTour, setBusyTour] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const maxGuests = Math.min(20, roomAdults + roomChildren)
  const availableTours = events
    .map((tour) => ({ tour, window: bookingWindow(tour, roomCheckinDate, roomCheckoutDate, tz) }))
    .filter((item): item is { tour: TourVM; window: DateWindow } => item.window !== null)

  async function addTour(tour: TourVM, dateWindow: DateWindow) {
    const date = dates[tour.id] ?? dateWindow.first
    const party = parties[tour.id] ?? { adults: roomAdults, children: roomChildren }
    setBusyTour(tour.id)
    setErrors((current) => ({ ...current, [tour.id]: '' }))
    const { error } = await createClient().rpc('add_event_to_room_cart', {
      p_hotel_entitlement: hotelEntitlementId,
      p_event: tour.id,
      p_tour_date: date,
      p_adults: party.adults,
      p_children: party.children,
    })
    setBusyTour(null)
    if (error) {
      setErrors((current) => ({ ...current, [tour.id]: friendlyError(error) }))
      return
    }
    onAdded()
  }

  if (availableTours.length === 0) {
    return <div className="empty">No tours are available for booking during this stay yet. Choose another extra or ask the hotel about tour options.</div>
  }

  return (
    <div className="tour-booking-list">
      {availableTours.map(({ tour, window }) => {
        const selectedDate = dates[tour.id] ?? window.first
        const party = parties[tour.id] ?? { adults: roomAdults, children: roomChildren }
        const total = tour.price * party.adults + (tour.child_price ?? tour.price) * party.children
        const isOpen = openTour === tour.id
        return (
          <article className="tour-booking-card" key={tour.id}>
            {tour.photo_url
              ? <img src={tour.photo_url} alt="" className="tour-booking-image" />
              : <div className="tour-booking-image tour-booking-placeholder">Discover Trinidad</div>}
            <div className="tour-booking-copy">
              <p className="home-eyebrow home-eyebrow-dark">{tour.provider_name ?? 'The Grand Hibiscus'}</p>
              <h3>{tour.title}</h3>
              <p>{tour.description}</p>
              <div className="tour-booking-meta">
                {tour.location && <span>{tour.location}</span>}
                <span>{displayTime(tour.departure_start!)}–{displayTime(tour.departure_end!)}</span>
              </div>
              <div className="tour-booking-prices">
                <span>{money(tour.price, currency)} / adult</span>
                <span>{money(tour.child_price ?? tour.price, currency)} / child</span>
              </div>
              <button type="button" className="btn secondary" onClick={() => {
                setOpenTour(isOpen ? null : tour.id)
                setErrors((current) => ({ ...current, [tour.id]: '' }))
              }}>
                {isOpen ? 'Close' : 'Choose a date'}
              </button>
            </div>
            {isOpen && (
              <div className="tour-booking-panel">
                <p className="small muted">Choose a departure between {fmtDate(`${window.first}T12:00:00Z`, tz)} and {fmtDate(`${window.last}T12:00:00Z`, tz)}. Only dates in your stay are available.</p>
                <label className="field">Tour date
                  <input type="date" min={window.first} max={window.last} value={selectedDate}
                    onChange={(event) => setDates((current) => ({ ...current, [tour.id]: event.target.value }))} />
                </label>
                <GuestCounters
                  adults={party.adults}
                  children={party.children}
                  maxAdults={Math.max(1, roomAdults)}
                  maxChildren={roomChildren}
                  maxTotal={maxGuests}
                  onChange={(adults, children) => setParties((current) => ({ ...current, [tour.id]: { adults, children } }))}
                />
                {errors[tour.id] && <div className="notice bad" role="alert">{errors[tour.id]}</div>}
                <div className="row between tour-booking-actions">
                  <strong>Total {money(total, currency)}</strong>
                  <button type="button" className="btn" disabled={busyTour === tour.id || !selectedDate}
                    onClick={() => addTour(tour, window)}>
                    {busyTour === tour.id ? <span className="spinner" /> : 'Add to this stay'}
                  </button>
                </div>
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}
