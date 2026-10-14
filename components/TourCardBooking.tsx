'use client'

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { fmtDate, friendlyError, money } from '@/lib/format'
import { GuestCounters } from '@/components/Stepper'
import { CardDetailsFields, cardDetailsValid, type CardDetails } from '@/components/Checkout'
import type { TourVM } from '@/components/ToursShowcase'
import type { Settings } from '@/lib/format'
import type { TourDateChoice } from '@/lib/tour-dates'

type PaymentMethod = 'bank_transfer' | 'cash_on_arrival' | 'card'
type BookingResult = { reservation_id: string; reference: string; payment_status: string }
type Party = { adults: number; children: number }

function choiceKey(choice: TourDateChoice) {
  return `${choice.hotelEntitlementId}:${choice.date}`
}

function displayTime(value: string | null) {
  if (!value) return ''
  const date = new Date(`2000-01-01T${value.slice(0, 5)}:00Z`)
  return new Intl.DateTimeFormat('en', { timeStyle: 'short', timeZone: 'UTC' }).format(date)
}

export default function TourCardBooking({
  tour, choices, paymentMethods, cardGatewayAvailable, taxRate, feeRate,
}: {
  tour: TourVM
  choices: TourDateChoice[]
  paymentMethods: Settings['payment_methods']
  cardGatewayAvailable: boolean
  taxRate: number
  feeRate: number
}) {
  const [open, setOpen] = useState(false)
  const [selectedKey, setSelectedKey] = useState('')
  const [party, setParty] = useState<Party>({ adults: 1, children: 0 })
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash_on_arrival')
  const [card, setCard] = useState<CardDetails>({ number: '', expiry: '', cvc: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [booked, setBooked] = useState<BookingResult | null>(null)
  const titleId = `tour-booking-title-${tour.id}`
  const availableMethods: PaymentMethod[] = (['cash_on_arrival', 'bank_transfer'] as const)
    .filter((method) => paymentMethods[method]?.enabled)
  if (paymentMethods.card?.enabled && cardGatewayAvailable) availableMethods.push('card')
  const selectedChoice = choices.find((choice) => choiceKey(choice) === selectedKey) ?? choices[0] ?? null
  const subtotal = selectedChoice
    ? Math.round((tour.price * party.adults + (tour.child_price ?? tour.price) * party.children) * 100) / 100
    : 0
  const tax = Math.round(subtotal * taxRate) / 100
  const fee = Math.round(subtotal * feeRate) / 100
  const total = subtotal + tax + fee

  useEffect(() => {
    if (!open) return
    const bodyOverflow = document.body.style.overflow
    const rootOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = bodyOverflow
      document.documentElement.style.overflow = rootOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  function showBooking() {
    const firstChoice = choices[0]
    setSelectedKey(firstChoice ? choiceKey(firstChoice) : '')
    setParty(firstChoice ? { adults: firstChoice.adults, children: firstChoice.children } : { adults: 1, children: 0 })
    setPaymentMethod(availableMethods.includes('cash_on_arrival') ? 'cash_on_arrival' : availableMethods[0] ?? 'cash_on_arrival')
    setCard({ number: '', expiry: '', cvc: '' })
    setBooked(null)
    setError(null)
    setOpen(true)
  }

  function selectChoice(key: string) {
    const choice = choices.find((candidate) => choiceKey(candidate) === key)
    setSelectedKey(key)
    if (choice) setParty({ adults: choice.adults, children: choice.children })
  }

  async function bookTour(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedChoice) return
    setBusy(true)
    setError(null)
    let data: BookingResult | null = null
    if (paymentMethod === 'card') {
      if (!cardDetailsValid(card)) {
        setBusy(false)
        return setError('Enter a valid card number, expiry date, and CVC.')
      }
      try {
        const response = await fetch('/api/payments/test-card/tour', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hotelEntitlementId: selectedChoice.hotelEntitlementId,
            eventId: tour.id,
            tourDate: selectedChoice.date,
            adults: party.adults,
            children: party.children,
            card,
          }),
        })
        const result = await response.json() as {
          booking?: BookingResult
          error?: string
          message?: string
        }
        if (!response.ok) {
          setBusy(false)
          return setError(result.error === 'card_declined'
            ? 'The card was declined. Check your details and try again.'
            : result.message || (result.error === 'test_card_gateway_unavailable'
              ? 'Credit card checkout is unavailable right now. Choose another payment method or try again later.'
              : 'The card payment could not be completed. No tour was booked.'))
        }
        data = result.booking ?? null
      } catch (requestError) {
        console.error('Test-card tour booking request failed:', requestError)
        setBusy(false)
        return setError('The card payment could not be completed. No tour was booked. Please try again.')
      }
    } else {
      const { data: booking, error: bookingError } = await createClient().rpc('book_tour_for_room_stay', {
        p_hotel_entitlement: selectedChoice.hotelEntitlementId,
        p_event: tour.id,
        p_tour_date: selectedChoice.date,
        p_adults: party.adults,
        p_children: party.children,
        p_payment_method: paymentMethod,
      })
      if (bookingError) {
        setBusy(false)
        return setError(friendlyError(bookingError))
      }
      data = booking
    }
    setBusy(false)
    if (!data?.reservation_id || !data?.reference) {
      return setError('The booking response was incomplete. Refresh the page and check your reservations before trying again.')
    }
    setBooked({
      reservation_id: data.reservation_id,
      reference: data.reference,
      payment_status: data.payment_status,
    })
  }

  return (
    <>
      <button type="button" className="btn secondary tour-card-book-button" onClick={showBooking}>
        Book this tour
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div className="modal-back tour-card-modal-back" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setOpen(false)
        }}>
          <section className="modal stack tour-card-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <header className="row between">
              <div>
                <h2 id={titleId} style={{ margin: 0 }}>{booked ? 'Tour added to your stay' : 'Book this tour'}</h2>
                <div className="small muted">{tour.title}</div>
              </div>
              <button type="button" className="btn sm secondary" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </header>
            {booked ? (
              <div className="stack">
                <div className="notice ok" role="status">
                  <strong>{tour.title}</strong> is now attached to reservation {booked.reference}. The room reservation’s existing QR pass covers this tour.
                </div>
                {booked.payment_status === 'awaiting_receipt' && <p className="small muted">Upload the tour’s bank-transfer receipt from the reservation page; the existing room payment remains unchanged.</p>}
                {booked.payment_status === 'unpaid' && <p className="small muted">The tour charge is separate from your room payment and is due at the hotel.</p>}
                <div className="row between">
                  <Link className="btn" href={`/reservations/${booked.reservation_id}`} onClick={() => setOpen(false)}>
                    View reservation and QR pass
                  </Link>
                  <button type="button" className="btn secondary" onClick={() => setOpen(false)}>Done</button>
                </div>
              </div>
            ) : choices.length === 0 ? (
              <div className="stack">
                <p className="small muted">
                  {tour.booking_enabled
                    ? 'No available tour dates overlap a confirmed room stay. You need an upcoming confirmed room reservation to book a tour here.'
                    : 'This tour is not currently open for online booking.'}
                </p>
                <Link className="btn secondary" href="/book/rooms" onClick={() => setOpen(false)}>Find a room</Link>
              </div>
            ) : (
              <form className="stack" onSubmit={bookTour}>
                <label className="field">Room stay and tour date
                  <select required value={selectedChoice ? choiceKey(selectedChoice) : ''} onChange={(event) => selectChoice(event.target.value)}>
                    {choices.map((choice) => (
                      <option key={choiceKey(choice)} value={choiceKey(choice)}>
                        {fmtDate(`${choice.date}T12:00:00Z`, 'UTC')} · {choice.roomTitle} · {choice.reference}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedChoice && (
                  <>
                    <div className="tour-card-room-summary">
                      <strong>{selectedChoice.roomTitle}</strong>
                      <span>Reservation {selectedChoice.reference}</span>
                      <span>{fmtDate(`${selectedChoice.date}T12:00:00Z`, 'UTC')} · Departs {displayTime(tour.departure_start)}{tour.departure_end ? `–${displayTime(tour.departure_end)}` : ''} local hotel time</span>
                      <span>Your existing room QR pass will be used for this tour.</span>
                    </div>
                    <GuestCounters
                      adults={party.adults}
                      children={party.children}
                      maxAdults={Math.max(1, selectedChoice.adults)}
                      maxChildren={selectedChoice.children}
                      maxTotal={Math.min(20, selectedChoice.adults + selectedChoice.children)}
                      onChange={(adults, children) => setParty({ adults, children })}
                    />
                    <div className="tour-card-total">
                      <div><span>Tour</span><span>{money(subtotal, selectedChoice.currency)}</span></div>
                      {tax > 0 && <div><span>Tax</span><span>{money(tax, selectedChoice.currency)}</span></div>}
                      {fee > 0 && <div><span>Service fee</span><span>{money(fee, selectedChoice.currency)}</span></div>}
                      <div className="grand-total"><strong>Total</strong><strong>{money(total, selectedChoice.currency)}</strong></div>
                    </div>
                    <label className="field">Payment for this tour
                      <select required value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)} disabled={availableMethods.length === 0}>
                        {availableMethods.map((method) => (
                          <option key={method} value={method}>
                            {method === 'card' ? 'Credit Card' : method === 'cash_on_arrival' ? 'Cash/Card on arrival' : paymentMethods[method]?.label ?? method.replaceAll('_', ' ')}
                          </option>
                        ))}
                      </select>
                    </label>
                    {paymentMethod === 'card' && <CardDetailsFields value={card} onChange={setCard} />}
                    {paymentMethod === 'bank_transfer'
                      ? <p className="small muted">This creates a separate tour payment; your already-paid room transfer is not changed. Upload the tour receipt from your reservation page.</p>
                      : paymentMethod === 'card'
                        ? null
                        : <p className="small muted">This tour charge will be listed separately from your room payment and is payable at the hotel.</p>}
                  </>
                )}
                {!availableMethods.length && <div className="notice warn" role="status">Online tour payments are not currently available. Please contact the hotel.</div>}
                {error && <div className="notice bad" role="alert">{error}</div>}
                <div className="row between">
                  <button type="button" className="btn secondary" onClick={() => setOpen(false)}>Cancel</button>
                  <button type="submit" className="btn" disabled={busy || !selectedChoice || availableMethods.length === 0}>
                    {busy ? <span className="spinner" /> : 'Confirm tour booking'}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>,
        document.body,
      )}
    </>
  )
}
