'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { friendlyError, money } from '@/lib/format'
import { HOTEL_GYM_DISCOUNT_PERCENT, priceHotelGymAccess } from '@/lib/gym'

export interface GymPackageVM {
  id: string
  slug: 'day-pass' | 'monthly' | 'three-month' | 'yearly'
  title: string
  description: string
  benefits: string[]
  price: number | null
}

type Membership = { title: string; ends_at: string } | null

const nightsBetween = (checkin: string, checkout: string) => Math.max(
  0,
  Math.round((Date.parse(`${checkout}T00:00:00Z`) - Date.parse(`${checkin}T00:00:00Z`)) / 86400000),
)

function GymChildcareNote({ compact = false }: { compact?: boolean }) {
  return (
    <aside className={`gym-childcare-note${compact ? ' is-compact' : ''}`}>
      <p><strong>Complimentary supervised childcare</strong> is available for gym guests. Children are not permitted in the gym; ask the hotel team about age limits, hours, and availability.</p>
    </aside>
  )
}

export default function GymBooking({
  packages,
  currency,
  membership = null,
  hotelEntitlementId,
  roomCheckinDate = '',
  roomCheckoutDate = '',
  roomAdults = 0,
  membershipCoversStay = false,
  holdMinutes,
  embedded = false,
  onAdded,
}: {
  packages: GymPackageVM[]
  currency: string
  membership?: Membership
  hotelEntitlementId?: string
  roomCheckinDate?: string
  roomCheckoutDate?: string
  roomAdults?: number
  membershipCoversStay?: boolean
  holdMinutes: number
  embedded?: boolean
  onAdded?: () => void
}) {
  const router = useRouter()
  const [adults, setAdults] = useState(roomAdults)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [canRemoveGymItems, setCanRemoveGymItems] = useState(false)
  const [removingGymItems, setRemovingGymItems] = useState(false)
  const stayNights = nightsBetween(roomCheckinDate, roomCheckoutDate)
  const dayPass = packages.find((item) => item.slug === 'day-pass')
  const visiblePackages = hotelEntitlementId ? (dayPass ? [dayPass] : []) : packages

  async function addPackage(item: GymPackageVM) {
    setBusy(item.id)
    setError(null)
    setCanRemoveGymItems(false)
    const supabase = createClient()
    const { error: rpcError } = hotelEntitlementId
      ? await supabase.rpc('add_gym_access_to_room_cart', {
        p_hotel_entitlement: hotelEntitlementId,
        p_adults: adults,
        p_children: 0,
      })
      : await supabase.rpc('add_gym_package_to_cart', { p_package: item.id })
    setBusy(null)
    if (rpcError) {
      if (rpcError.message === 'not_authenticated') {
        const next = hotelEntitlementId ? '/book/cart' : '/book/gym'
        window.location.href = `/login?next=${encodeURIComponent(next)}`
        return
      }
      setCanRemoveGymItems(rpcError.message === 'gym_item_in_cart')
      setError(friendlyError(rpcError))
      return
    }
    if (onAdded) return onAdded()
    router.push('/book/cart')
  }

  async function removeGymItemsFromCart() {
    setRemovingGymItems(true)
    setError(null)
    const supabase = createClient()
    const { data: cart, error: cartError } = await supabase.from('reservations')
      .select('id').eq('status', 'cart').maybeSingle()
    if (cartError) {
      setError(friendlyError(cartError))
      setRemovingGymItems(false)
      return
    }
    if (!cart) {
      setError('We could not find your current cart. Refresh and try again.')
      setRemovingGymItems(false)
      return
    }
    const [gymItemsResult, gymInterestsResult] = await Promise.all([
      supabase.from('entitlements').select('id')
        .eq('reservation_id', cart.id).eq('service_type', 'gym').eq('status', 'held'),
      supabase.from('cart_service_interests').select('hotel_entitlement_id')
        .eq('reservation_id', cart.id).eq('service_type', 'gym'),
    ])
    const { data: gymItems, error: gymItemsError } = gymItemsResult
    if (gymItemsError) {
      setError(friendlyError(gymItemsError))
      setRemovingGymItems(false)
      return
    }
    const { data: gymInterests, error: gymInterestsError } = gymInterestsResult
    if (gymInterestsError) {
      setError(friendlyError(gymInterestsError))
      setRemovingGymItems(false)
      return
    }
    if (!gymItems?.length && !gymInterests?.length) {
      setError('There are no gym products in your cart to remove.')
      setRemovingGymItems(false)
      return
    }
    for (const item of gymItems) {
      const { error: removeError } = await supabase.rpc('remove_cart_item', { p_ent: item.id })
      if (removeError) {
        setError(friendlyError(removeError))
        setRemovingGymItems(false)
        return
      }
    }
    for (const interest of gymInterests ?? []) {
      const { error: removeError } = await supabase.rpc('set_cart_service_interest', {
        p_service_type: 'gym',
        p_enabled: false,
        p_hotel_entitlement: interest.hotel_entitlement_id,
      })
      if (removeError) {
        setError(friendlyError(removeError))
        setRemovingGymItems(false)
        return
      }
    }
    setRemovingGymItems(false)
    setCanRemoveGymItems(false)
    if (onAdded) return onAdded()
    router.refresh()
  }

  if (membership || membershipCoversStay) {
    return (
      <>
        <div className="gym-member-notice" role="status">
          <span className="gym-member-mark" aria-hidden="true">✓</span>
          <div>
            <p className="home-eyebrow home-eyebrow-dark">{hotelEntitlementId ? 'Already included' : 'Your membership'}</p>
            <h3>{hotelEntitlementId ? 'Your membership covers this stay.' : membership?.title}</h3>
            <p>{hotelEntitlementId
              ? 'Your active gym package covers these reservation dates, so there is no need to add another pass.'
              : `Your gym access is active through ${new Date(membership!.ends_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}.`}</p>
          </div>
        </div>
        {embedded && <GymChildcareNote compact />}
      </>
    )
  }

  return (
    <>
      {error && <div className={`notice bad${canRemoveGymItems ? ' gym-cart-conflict' : ''}`} role="alert">
        <span>{error}</span>
        {canRemoveGymItems && <button
          type="button"
          className="btn sm danger"
          disabled={removingGymItems || busy !== null}
          onClick={removeGymItemsFromCart}
        >
          {removingGymItems ? <span className="spinner" /> : 'Remove gym items'}
        </button>}
      </div>}
      {embedded && visiblePackages.length === 0 && <GymChildcareNote compact />}
      {visiblePackages.length === 0 ? (
        <div className="gym-empty">Gym packages are not available right now. Please contact the hotel team.</div>
      ) : (
        <div className={`gym-package-grid${embedded ? ' is-embedded' : ''}`}>
          {visiblePackages.map((item) => {
            const isStayPass = !!hotelEntitlementId
            const guests = adults
            const stayPrice = item.price == null || !isStayPass ? null : priceHotelGymAccess(item.price, guests, stayNights)
            const total = stayPrice?.total ?? null
            if (embedded && isStayPass) {
              return (
                <div className="gym-stay-modal" key={item.id}>
                  <div className="gym-stay-pass-summary">
                    <span className="gym-stay-pass-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none">
                        <path d="M6.5 8v8M4 9.5v5M17.5 8v8M20 9.5v5M6.5 12h11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                      </svg>
                    </span>
                    <span className="gym-stay-pass-copy">
                        <strong>{item.title} · {HOTEL_GYM_DISCOUNT_PERCENT}% OFF WITH YOUR STAY</strong>
                      <span>{item.description}</span>
                    </span>
                  </div>

                  <div className="gym-stay-guest-list">
                    <div className="gym-stay-guest-row">
                      <span className="gym-stay-guest-label">
                        <strong>Adults</strong>
                        <small>Who needs access?</small>
                      </span>
                      <span className="gym-stay-stepper" role="group" aria-label="Adults needing gym access">
                        <button type="button" aria-label="Remove one adult" disabled={adults <= 0} onClick={() => setAdults(adults - 1)}>−</button>
                        <strong aria-live="polite">{adults}</strong>
                        <button type="button" aria-label="Add one adult" disabled={adults >= roomAdults} onClick={() => setAdults(adults + 1)}>+</button>
                      </span>
                    </div>
                  </div>

                  <GymChildcareNote compact />
                  <div className="gym-stay-price-breakdown" aria-live="polite">
                    {item.price === null ? (
                      <p className="gym-stay-price-unavailable">The hotel has not set a price for this pass yet.</p>
                    ) : (
                      <>
                        <div><span>{money(item.price, currency)} × {guests} adult{guests === 1 ? '' : 's'}</span><strong>{money(item.price * guests, currency)}</strong></div>
                        <div><span>× {stayNights} night{stayNights === 1 ? '' : 's'}</span><strong>{money(stayPrice?.subtotal, currency)}</strong></div>
                        <div className="gym-stay-discount"><span>Hotel guest discount · {HOTEL_GYM_DISCOUNT_PERCENT}%</span><strong>−{money(stayPrice?.discount, currency)}</strong></div>
                      </>
                    )}
                    <div className="gym-stay-grand-total"><strong>Total</strong><strong>{total === null ? '—' : money(total, currency)}</strong></div>
                    <p>35% off the day-pass rate per adult, per night. Added to your room bill.</p>
                  </div>

                  <button
                    className="btn gym-stay-submit"
                    disabled={item.price === null || busy !== null || guests < 1 || stayNights < 1}
                    onClick={() => addPackage(item)}
                  >
                    {busy === item.id ? <span className="spinner" /> : `Add gym access · ${total === null ? 'Price unavailable' : money(total, currency)}`}
                  </button>
                </div>
              )
            }
            return (
              <article className={`gym-package-card${item.slug === 'yearly' && !embedded ? ' is-featured' : ''}`} key={item.id}>
                {item.slug === 'yearly' && !embedded && <span className="gym-package-ribbon">Best for the long run</span>}
                <p className="home-eyebrow home-eyebrow-dark">{isStayPass ? 'With your stay' : item.slug === 'day-pass' ? 'One day' : 'Membership'}</p>
                <h3>{item.title}</h3>
                <p className="gym-package-description">{item.description}</p>
                {item.benefits.length > 0 && <ul className="gym-benefits">{item.benefits.map((benefit) => <li key={benefit}>{benefit}</li>)}</ul>}
                {isStayPass && (
                  <div className="gym-guest-selectors">
                    <label className="field">Adults needing gym access
                      <select value={adults} onChange={(event) => setAdults(Number(event.target.value))}>
                        {Array.from({ length: roomAdults + 1 }, (_, count) => <option key={count} value={count}>{count}</option>)}
                      </select>
                    </label>
                    <p className="small muted">You’ll be charged per adult, per night ({stayNights} night{stayNights === 1 ? '' : 's'}).</p>
                  </div>
                )}
                <div className="gym-package-price">
                  <strong>{item.price == null ? 'Price to be set' : money(item.price, currency)}</strong>
                  <span>{isStayPass ? 'per adult, per night' : item.slug === 'day-pass' ? 'one-time day pass' : 'one-time membership'}</span>
                </div>
                {isStayPass && stayPrice && <div className="gym-stay-total">{money(total, currency)} after {HOTEL_GYM_DISCOUNT_PERCENT}% hotel guest discount <del>{money(stayPrice.subtotal, currency)}</del></div>}
                <button
                  className="btn"
                  disabled={item.price == null || busy !== null || (isStayPass && (guests < 1 || stayNights < 1))}
                  onClick={() => addPackage(item)}
                >
                  {busy === item.id ? <span className="spinner" /> : isStayPass ? 'Add access for this stay' : 'Choose this package'}
                </button>
              </article>
            )
          })}
        </div>
      )}
      {!embedded && (
        <p className="gym-hold-note">Packages are one-time purchases, not recurring subscriptions. Selected access is held in your cart for {holdMinutes} minutes.</p>
      )}
    </>
  )
}
