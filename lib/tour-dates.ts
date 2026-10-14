import { addDays } from '@/lib/format'
import type { TourVM } from '@/components/ToursShowcase'

export type TourStay = {
  hotelEntitlementId: string
  reservationId: string
  reference: string
  roomTitle: string
  checkin: string
  checkout: string
  adults: number
  children: number
  currency: string
}

export type TourDateChoice = TourStay & { date: string }

export function hotelDateString(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

function departureHasPassedToday(time: string, timezone: string, now: Date) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return time.slice(0, 5) <= `${value('hour')}:${value('minute')}`
}

export function tourDatesForStay(tour: TourVM, checkin: string, checkout: string, timezone: string, now = new Date()) {
  if (!tour.booking_enabled || !tour.available_from || !tour.available_until
    || !tour.departure_start || !tour.departure_end || !checkin || !checkout) return []

  const today = hotelDateString(now, timezone)
  const first = [checkin, tour.available_from, today].sort().pop()!
  const last = [addDays(checkout, -1), tour.available_until].sort()[0]
  const dates: string[] = []
  for (let date = first; date <= last; date = addDays(date, 1)) {
    if (date === today && departureHasPassedToday(tour.departure_start, timezone, now)) continue
    dates.push(date)
  }
  return dates
}

export function tourDateChoices(tour: TourVM, stays: TourStay[], timezone: string, now = new Date()): TourDateChoice[] {
  return stays.flatMap((stay) =>
    tourDatesForStay(tour, stay.checkin, stay.checkout, timezone, now)
      .map((date) => ({ ...stay, date })),
  ).sort((a, b) =>
    a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference) || a.roomTitle.localeCompare(b.roomTitle),
  )
}
