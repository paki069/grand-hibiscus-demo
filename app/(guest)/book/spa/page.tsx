import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getSettings } from '@/lib/data'
import SpaBooking from '@/components/SpaBooking'
import type { SpaVM } from '@/components/SpaBooking'

export default async function SpaPage({ searchParams }: { searchParams: Promise<{ room?: string }> }) {
  const { room: hotelEntitlementId } = await searchParams
  const supabase = await createClient()
  const [settings, servicesResult, roomContext] = await Promise.all([
    getSettings(),
    supabase.from('spa_services').select('*, spa_categories(name)').eq('active', true).order('name'),
    hotelEntitlementId
      ? supabase.from('entitlements').select('title').eq('id', hotelEntitlementId).eq('service_type', 'hotel').maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (servicesResult.error) throw new Error(`Unable to load spa treatments: ${servicesResult.error.message}`)
  if (roomContext.error) throw new Error(`Unable to load your room details: ${roomContext.error.message}`)
  const services = (servicesResult.data ?? []).map((service: any) => ({
    ...service,
    category: service.spa_categories?.name ?? 'Spa',
  })) as SpaVM[]

  return (
    <div className="home-page spa-page">
      <section className="home-hero spa-hero" aria-labelledby="spa-title">
        <Image
          src="/images/spa.jpg"
          alt="A peaceful spa treatment in a softly lit room"
          fill
          priority
          sizes="100vw"
          className="home-hero-image"
        />
        <div className="home-hero-shade" />
        <div className="home-hero-content">
          <p className="home-eyebrow">Wellness at {settings.hotel_name}</p>
          <h1 id="spa-title">Make space<br /><em>to relax.</em></h1>
          <p className="home-hero-intro">Slow down with a thoughtful spa treatment, whether you’re staying with us or visiting for the day.</p>
          <div className="home-hero-actions">
            <a className="home-button home-button-light" href="#treatments">Explore treatments <span aria-hidden="true">↓</span></a>
            {!hotelEntitlementId && <Link className="home-text-link" href="/book/rooms">Make it part of your stay <span aria-hidden="true">↗</span></Link>}
          </div>
        </div>
        <div className="home-hero-caption"><span>The Grand Hibiscus spa</span><span>Time to restore · Space to unwind</span></div>
      </section>

      <section className="spa-intro" aria-labelledby="spa-intro-title">
        <div className="spa-intro-copy">
          <p className="home-eyebrow home-eyebrow-dark">Wellness, your way</p>
          <h2 id="spa-intro-title">A little time, just for you.</h2>
          <p>Choose a treatment and a time that works for you. Book a standalone spa visit, or add a treatment to your room stay.</p>
        </div>
        {hotelEntitlementId ? (
          <div className="spa-room-context">
            <p className="home-eyebrow home-eyebrow-dark">Part of your stay</p>
            <h3>{roomContext.data?.title ?? 'Your selected room'}</h3>
            <p>Choose a treatment below to add it to your room booking.</p>
          </div>
        ) : (
          <div className="spa-pathways">
            <article className="spa-pathway">
              <p className="home-eyebrow home-eyebrow-dark">01 / Standalone</p>
              <h3>A treatment on its own.</h3>
              <p>Book a spa service without a room reservation.</p>
              <a className="spa-pathway-link" href="#treatments">Browse treatments <span aria-hidden="true">↓</span></a>
            </article>
            <article className="spa-pathway spa-pathway-stay">
              <p className="home-eyebrow">02 / With your stay</p>
              <h3>Make it a getaway.</h3>
              <p>Book a room and add spa treatments to your stay for 20% off.</p>
              <Link className="spa-pathway-link" href="/book/rooms">Explore rooms <span aria-hidden="true">↗</span></Link>
            </article>
          </div>
        )}
      </section>

      <section className="spa-treatments" id="treatments" aria-labelledby="spa-services-title">
        <div className="spa-section-heading">
          <div>
            <p className="home-eyebrow home-eyebrow-dark">The treatment menu</p>
            <h2 id="spa-services-title">Find your moment of calm.</h2>
          </div>
          <p>Select a service to see available dates and appointment times. Please don’t share health information when booking; speak with the spa team on arrival about any requirements.</p>
        </div>
        {services.length === 0 ? (
          <div className="spa-empty">Spa treatments will be added soon.</div>
        ) : (
          <SpaBooking
            services={services}
            currency={settings.currency}
            tz={settings.timezone}
            holdMinutes={settings.hold_minutes}
            hotelEntitlementId={hotelEntitlementId}
          />
        )}
      </section>
    </div>
  )
}
