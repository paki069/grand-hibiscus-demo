import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getSettings } from '@/lib/data'
import { money } from '@/lib/format'
import { HOTEL_GYM_DISCOUNT_PERCENT, priceHotelGymAccess } from '@/lib/gym'
import GymBooking, { type GymPackageVM } from '@/components/GymBooking'

export default async function GymPage() {
  const supabase = await createClient()
  const [settings, packagesResult, userResult] = await Promise.all([
    getSettings(),
    supabase.from('gym_packages').select('*').eq('active', true).order('sort_order'),
    supabase.auth.getUser(),
  ])
  if (packagesResult.error) throw new Error(`Unable to load gym packages: ${packagesResult.error.message}`)
  if (userResult.error && userResult.error.name !== 'AuthSessionMissingError') {
    throw new Error(`Unable to verify gym membership: ${userResult.error.message}`)
  }
  const packages = (packagesResult.data ?? []) as GymPackageVM[]
  const dayPassPrice = packages.find((item) => item.slug === 'day-pass')?.price ?? null
  const exampleStayPrice = dayPassPrice === null ? null : priceHotelGymAccess(dayPassPrice, 2, 2)

  let membership: { title: string; ends_at: string } | null = null
  if (userResult.data.user) {
    const { data, error } = await supabase.rpc('gym_membership_status')
    if (error) throw new Error(`Unable to check gym membership: ${error.message}`)
    membership = data?.[0] ?? null
  }

  return (
    <div className="home-page gym-page">
      <section className="gym-hero" aria-labelledby="gym-title">
        <div className="gym-hero-orbit gym-hero-orbit-one" aria-hidden="true" />
        <div className="gym-hero-orbit gym-hero-orbit-two" aria-hidden="true" />
        <div className="gym-hero-content">
          <p className="home-eyebrow">Wellness & movement · {settings.hotel_name}</p>
          <h1 id="gym-title">Make room<br /><em>to train.</em></h1>
          <p>Find your rhythm in a calm, considered space for strength, energy, and a little time for yourself.</p>
          <div className="home-hero-actions">
            <a className="home-button home-button-light" href="#gym-packages">Explore packages <span aria-hidden="true">↓</span></a>
            <Link className="home-text-link" href="/book/rooms">Staying with us? <span aria-hidden="true">↗</span></Link>
          </div>
        </div>
        <div className="gym-hero-caption">
          <span>The Grand Hibiscus fitness studio</span>
          <span>Move well · Feel well</span>
        </div>
      </section>

      <section className="gym-childcare-banner" aria-labelledby="gym-childcare-title">
        <span className="gym-childcare-banner-icon" aria-hidden="true">
          <svg viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="10.5" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="12.5" cy="13.5" r="1" fill="currentColor" />
            <circle cx="19.5" cy="13.5" r="1" fill="currentColor" />
            <path d="M11.5 18a5.5 5.5 0 0 0 9 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
        <div className="gym-childcare-banner-copy">
          <p className="home-eyebrow home-eyebrow-dark">For parents</p>
          <h2 id="gym-childcare-title">Complimentary supervised childcare</h2>
          <p>Work out while your children enjoy our supervised kids’ area. Please check age limits and availability with the hotel team.</p>
        </div>
        <div className="gym-childcare-details">
          <div className="gym-childcare-detail">
            <p className="home-eyebrow">Gym hours</p>
            <p className="gym-childcare-detail-value">Open 24/7</p>
            <p className="gym-childcare-detail-note">Childcare: 9 AM–9 PM</p>
          </div>
          <div className="gym-childcare-detail">
            <p className="home-eyebrow">Cost</p>
            <p className="gym-childcare-detail-value">No extra charge</p>
            <p className="gym-childcare-detail-note">With gym access</p>
          </div>
        </div>
      </section>

      <section className="gym-packages-section" id="gym-packages" aria-labelledby="gym-packages-title">
        <div className="gym-section-heading">
          <div>
            <p className="home-eyebrow home-eyebrow-dark">Choose your access</p>
            <h2 id="gym-packages-title">{membership ? 'You’re all set.' : 'Find your fit.'}</h2>
          </div>
          {!membership && <p>Four ways to make space for movement. Choose the access that fits your routine.</p>}
        </div>
        <GymBooking packages={packages} currency={settings.currency} membership={membership} holdMinutes={settings.hold_minutes} />
      </section>

      <section className="gym-stay-callout">
        <div className="gym-stay-copy">
          <p className="home-eyebrow">Here for a stay?</p>
          <h2>Keep your routine <em>while you’re away.</em></h2>
          <p>Save {HOTEL_GYM_DISCOUNT_PERCENT}% on gym access when you add it to a room booking. You’ll only pay for the adults who work out and the nights they need.</p>
          <Link className="home-button home-button-dark" href="/book/rooms">Explore rooms <span aria-hidden="true">↗</span></Link>
        </div>
        <div className="gym-stay-example" aria-label="Example room-stay gym access price">
          <p className="home-eyebrow home-eyebrow-dark">Example · room-stay access</p>
          <h3>2 adults · 2 nights</h3>
          {dayPassPrice === null || exampleStayPrice === null ? (
            <p className="gym-stay-example-unpriced">Day-pass pricing is being set by the hotel.</p>
          ) : (
            <>
              <div className="gym-stay-example-row"><span>{money(dayPassPrice, settings.currency)} × 2 adults</span><strong>{money(dayPassPrice * 2, settings.currency)}</strong></div>
              <div className="gym-stay-example-row"><span>× 2 nights</span><strong>{money(exampleStayPrice.subtotal, settings.currency)}</strong></div>
              <div className="gym-stay-example-row gym-stay-example-discount"><span>Hotel guest discount · {HOTEL_GYM_DISCOUNT_PERCENT}%</span><strong>−{money(exampleStayPrice.discount, settings.currency)}</strong></div>
              <div className="gym-stay-example-total"><strong>Total</strong><strong>{money(exampleStayPrice.total, settings.currency)}</strong></div>
            </>
          )}
          <p className="gym-stay-example-note">Discount applies to the room-stay day-pass rate. Childcare hours, age limits, and availability vary.</p>
        </div>
      </section>
    </div>
  )
}
