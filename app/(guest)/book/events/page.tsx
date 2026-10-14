import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getCart } from '@/lib/data'
import { getSettings } from '@/lib/data'
import ToursShowcase, { type TourVM } from '@/components/ToursShowcase'
import { hotelDateString, tourDateChoices, type TourStay } from '@/lib/tour-dates'
import { testCardGatewayAvailable } from '@/lib/test-card-gateway'

export default async function EventsPage() {
  const supabase = await createClient()
  const [cart, eventsResult, settings, userResult] = await Promise.all([
    getCart(),
    supabase.from('public_events').select('*').order('title'),
    getSettings(),
    supabase.auth.getUser(),
  ])
  if (userResult.error && userResult.error.name !== 'AuthSessionMissingError') {
    throw new Error(`Could not verify sign-in for tour booking: ${userResult.error.message}`)
  }
  if (eventsResult.error) throw new Error(`Could not load tour listings: ${eventsResult.error.message}`)
  const events = (eventsResult.data ?? []) as TourVM[]
  events.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.title.localeCompare(b.title))
  const hasRoomInCart = cart?.items.some((item) => item.service_type === 'hotel') ?? false
  let bookingChoices: Record<string, ReturnType<typeof tourDateChoices>> | undefined

  if (userResult.data.user && !userResult.data.user.is_anonymous) {
    const { data: reservations, error } = await supabase.from('reservations')
      .select('id, reference, currency, entitlements(id, service_type, title, adults, children, status, meta)')
      .eq('customer_id', userResult.data.user.id)
      .eq('status', 'confirmed')
    if (error) throw new Error(`Could not load confirmed room stays for tour booking: ${error.message}`)

    const today = hotelDateString(new Date(), settings.timezone)
    const stays = (reservations ?? []).flatMap((reservation) =>
      (reservation.entitlements ?? []).flatMap((room) => {
        const meta = room.meta as Record<string, unknown>
        const checkin = typeof meta?.checkin === 'string' ? meta.checkin : ''
        const checkout = typeof meta?.checkout === 'string' ? meta.checkout : ''
        if (room.service_type !== 'hotel' || room.status !== 'active' || !checkin || !checkout || checkout <= today) return []
        return [{
          hotelEntitlementId: room.id,
          reservationId: reservation.id,
          reference: reservation.reference,
          roomTitle: room.title,
          checkin,
          checkout,
          adults: room.adults,
          children: room.children,
          currency: reservation.currency,
        } satisfies TourStay]
      }),
    )
    bookingChoices = Object.fromEntries(events.map((tour) => [
      tour.id,
      tourDateChoices(tour, stays, settings.timezone),
    ]))
  }

  return (
    <div className="home-page tours-page">
      <section className="home-hero tours-hero" aria-labelledby="tours-title">
        <Image
          src="/images/tours-hero-tobago.jpg"
          alt="A turquoise bay below Tobago's green coastal hills"
          fill
          priority
          sizes="100vw"
          className="home-hero-image"
        />
        <div className="home-hero-shade" />
        <div className="home-hero-content">
          <p className="home-eyebrow">The Grand Hibiscus · Trinidad</p>
          <h1 id="tours-title">Find your<br /><em>island story.</em></h1>
          <p className="home-hero-intro">From rainforest bird watching to waterfalls, coastal drives, and cultural discoveries—explore the experiences waiting beyond the hotel.</p>
          <div className="home-hero-actions">
            <a className="home-button home-button-light" href="#tours">Explore the tours <span aria-hidden="true">↓</span></a>
            <Link className="home-text-link" href={hasRoomInCart ? '/book/cart' : '/book/rooms'}>
              {hasRoomInCart ? 'Choose a tour for your stay' : 'Plan a hotel stay'} <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </div>
        <div className="home-hero-caption"><span>Discover Trinidad</span><span>Nine ways to explore</span></div>
      </section>

      <section className="tours-intro" aria-labelledby="tours-intro-title">
        <div className="tours-intro-heading">
          <p className="home-eyebrow home-eyebrow-dark">A little more than a getaway</p>
          <h2 id="tours-intro-title">Make room for<br /><em>discovery.</em></h2>
        </div>
        <div className="tours-intro-copy">
          <p>Slow mornings in the rainforest. Waterfalls, coastlines, and culture in the same unforgettable day. Add a room to your stay, then choose a scheduled departure that falls between check-in and checkout.</p>
          <div className="tours-intro-count">
            <strong>{String(events.length).padStart(2, '0')}</strong>
            <span>curated island experiences</span>
          </div>
        </div>
      </section>

      <section className="tours-catalog" id="tours" aria-labelledby="tours-list-title">
        <div className="tours-section-heading">
          <div>
            <p className="home-eyebrow home-eyebrow-dark">The island, in every direction</p>
            <h2 id="tours-list-title">Choose your kind of day.</h2>
          </div>
          <p>Guests with a confirmed room stay can book a tour for an eligible day of that stay. Choose the room and date on the tour card; its existing reservation QR pass will cover the tour.</p>
        </div>
        {events.length > 0
          ? <ToursShowcase
            events={events}
            bookingChoices={bookingChoices}
            paymentMethods={settings.payment_methods}
            cardGatewayAvailable={testCardGatewayAvailable()}
            taxRate={Number(settings.tax_rate)}
            feeRate={Number(settings.service_fee_rate)}
          />
          : <div className="tours-empty">Tour experiences will be added soon.</div>}
      </section>

      <section className="tours-stay">
        <div className="tours-stay-image">
          <Image src="/images/pool.jpg" alt="A peaceful pool beside the sea" fill sizes="(max-width: 760px) 100vw, 50vw" />
        </div>
        <div className="tours-stay-copy">
          <p className="home-eyebrow">Make the island part of your stay</p>
          <h2>Stay for the<br /><em>whole story.</em></h2>
          <p>Make The Grand Hibiscus your home base for discovery. Ask our team about guest offers and find a room that gives you time to see more.</p>
          <Link className="home-button home-button-gold" href="/book/rooms">Find your stay <span aria-hidden="true">↗</span></Link>
        </div>
      </section>
    </div>
  )
}
