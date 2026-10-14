import TourCardBooking from '@/components/TourCardBooking'
import type { Settings } from '@/lib/format'
import type { TourDateChoice } from '@/lib/tour-dates'

export interface TourVM {
  id: string
  title: string
  description: string
  photo_url: string | null
  provider_name: string | null
  location: string
  price: number
  child_price: number | null
  capacity: number | null
  booking_enabled: boolean
  available_from: string | null
  available_until: string | null
  departure_start: string | null
  departure_end: string | null
  sort_order?: number
}

function fallbackPhoto(tour: TourVM) {
  const title = tour.title.toLowerCase()
  if (/bird|nature|waterfall|hike|river|rio seco/.test(title)) return '/images/tour-nature.svg'
  if (/cave|cruise|boat|coast|maracas|sanctuary/.test(title)) return '/images/tour-water.svg'
  return '/images/tour-culture.svg'
}

export default function ToursShowcase({
  events, bookingChoices, paymentMethods, cardGatewayAvailable = false, taxRate = 0, feeRate = 0,
}: {
  events: TourVM[]
  bookingChoices?: Record<string, TourDateChoice[]>
  paymentMethods?: Settings['payment_methods']
  cardGatewayAvailable?: boolean
  taxRate?: number
  feeRate?: number
}) {
  return (
    <div className="tours-grid">
      {events.map((tour, index) => {
        const photo = tour.photo_url || fallbackPhoto(tour)
        return (
          <article key={tour.id} className={`tour-card${index === 0 ? ' tour-card-featured' : ''}`}>
            <div className="tour-card-image">
              <img
                src={photo}
                alt={tour.photo_url ? tour.title : `Illustration for ${tour.title}`}
                loading={index < 3 ? 'eager' : 'lazy'}
              />
              <span className="tour-card-number">{String(index + 1).padStart(2, '0')}</span>
            </div>
            <div className="tour-card-copy">
              <p className="home-eyebrow home-eyebrow-dark">Discover Trinidad</p>
              <h3>{tour.title}</h3>
              <p>{tour.description}</p>
              {tour.provider_name && <span className="tour-provider">Presented by {tour.provider_name}</span>}
              {bookingChoices && paymentMethods && (
                <TourCardBooking
                  tour={tour}
                  choices={bookingChoices[tour.id] ?? []}
                  paymentMethods={paymentMethods}
                  cardGatewayAvailable={cardGatewayAvailable}
                  taxRate={taxRate}
                  feeRate={feeRate}
                />
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}
