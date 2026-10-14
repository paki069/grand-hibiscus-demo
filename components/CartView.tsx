'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { friendlyError, money, fmtDateTime } from '@/lib/format'
import type { CartCoupon, CartInterest, CartServiceInterest, Ent } from '@/lib/data'
import CartExtraModal from '@/components/CartExtraModal'

const ICON: Record<string, string> = { hotel: 'Room', restaurant: 'Restaurant', spa: 'Spa', gym: 'Gym', event: 'Event' }

export function Countdown({ until, onExpire }: { until: string | null; onExpire?: () => void }) {
  const [now, setNow] = useState<number | null>(null)
  const notifiedExpiry = useRef<string | null>(null)
  useEffect(() => {
    const updateNow = () => setNow(Date.now())
    updateNow()
    const i = setInterval(updateNow, 1000)
    return () => clearInterval(i)
  }, [])
  useEffect(() => {
    if (now === null || !until || !onExpire || Date.parse(until) > now || notifiedExpiry.current === until) return
    notifiedExpiry.current = until
    onExpire()
  }, [now, onExpire, until])
  if (!until) return null
  if (now === null) return <span className="pill">held</span>
  const s = Math.floor((Date.parse(until) - now) / 1000)
  if (s <= 0) return <span className="pill bad">hold expired</span>
  return <span className={`pill ${s < 120 ? 'warn' : ''}`}>held {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>
}

const INTERESTS: Record<CartInterest, { label: string; href: string; action: string; description: string }> = {
  restaurant: { label: 'Dining', href: '/book/restaurant', action: 'Set up dining', description: 'Select a date, time, and table for this room.' },
  spa: { label: 'Spa', href: '/book/spa', action: 'Set up spa', description: 'Choose a treatment and appointment for this room.' },
  gym: { label: 'Gym access', href: '/book/gym', action: 'Set up gym access', description: 'Choose how many adults need access; save 35% with your stay.' },
  event: { label: 'Tours', href: '/book/events', action: 'Browse tours', description: 'Choose a departure during your room stay.' },
}

export default function CartView({ items, interests, orders, coupons, currency, tz, holdMinutes, checkinTime, taxRate, feeRate }: {
  items: Ent[]; interests: CartServiceInterest[]; orders: number; coupons: CartCoupon[]; currency: string; tz: string; holdMinutes: number; checkinTime: string; taxRate: number; feeRate: number
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [couponInput, setCouponInput] = useState('')
  const [couponBusy, setCouponBusy] = useState(false)
  const [couponMessage, setCouponMessage] = useState<string | null>(null)
  const [activeExtra, setActiveExtra] = useState<{ type: CartInterest; roomId: string; roomTitle: string } | null>(null)
  const closeExtra = useCallback(() => {
    setActiveExtra(null)
    router.refresh()
  }, [router])
  const extraAdded = useCallback(() => {
    setActiveExtra(null)
    router.refresh()
  }, [router])
  const refreshAfterExpiry = useCallback(() => router.refresh(), [router])
  const subtotal = items.reduce((t, i) => t + Number(i.total), 0)
  const tax = (subtotal * taxRate) / 100
  const fee = (subtotal * feeRate) / 100
  const activeRoom = activeExtra ? items.find((item) => item.id === activeExtra.roomId) : undefined

  async function remove(id: string) {
    setBusy(id); setErr(null)
    const { error } = await createClient().rpc('remove_cart_item', { p_ent: id })
    setBusy(null)
    if (error) return setErr(friendlyError(error))
    router.refresh()
  }

  async function applyCoupon() {
    const code = couponInput.trim().toUpperCase()
    if (!code || couponBusy) return
    setCouponBusy(true); setErr(null); setCouponMessage(null)
    try {
      const { data, error } = await createClient().rpc('apply_cart_coupon', { p_code: code })
      if (error) {
        setErr(friendlyError(error))
        return
      }
      const discount = Number(data)
      setCouponMessage(`Coupon applied${Number.isFinite(discount) ? ` · saves ${money(discount, currency)}` : ''}.`)
      setCouponInput('')
      router.refresh()
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'We could not apply that coupon. Please try again.')
    } finally {
      setCouponBusy(false)
    }
  }

  async function removeCoupon(code: string) {
    if (couponBusy) return
    setCouponBusy(true); setErr(null); setCouponMessage(null)
    try {
      const { error } = await createClient().rpc('remove_cart_coupon', { p_code: code })
      if (error) {
        setErr(friendlyError(error))
        return
      }
      setCouponMessage(`Coupon ${code} removed.`)
      router.refresh()
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'We could not remove that coupon. Please try again.')
    } finally {
      setCouponBusy(false)
    }
  }

  async function removeInterest(serviceType: CartInterest, hotelEntitlementId: string | null) {
    const key = `${hotelEntitlementId ?? 'general'}:${serviceType}`
    setBusy(key); setErr(null)
    const { error } = await createClient().rpc('set_cart_service_interest', {
      p_service_type: serviceType, p_enabled: false, p_hotel_entitlement: hotelEntitlementId,
    })
    setBusy(null)
    if (error) return setErr(friendlyError(error))
    router.refresh()
  }

  const hotelItems = items.filter((item) => item.service_type === 'hotel')
  const maxCouponCount = hotelItems.reduce((count, room) => count + Math.max(0, Number(room.meta.nights) || 0), 0)
  const standaloneItems = items.filter((item) => item.service_type !== 'hotel' && !item.parent_entitlement_id)
  const heldStandaloneItems = standaloneItems.filter((item) => item.status === 'held')
  const pendingInterests = interests.filter((interest) => interest.hotel_entitlement_id === null
    && !heldStandaloneItems.some((item) => item.service_type === interest.service_type))
  const pendingRoomInterests = interests.filter((interest) => interest.hotel_entitlement_id !== null
    && !items.some((item) => item.parent_entitlement_id === interest.hotel_entitlement_id
      && item.service_type === interest.service_type && item.status === 'held'))
  const setupIncomplete = pendingInterests.some((interest) => interest.service_type !== 'event')
    || pendingRoomInterests.length > 0
  const renderService = (item: Ent, nested = false) => (
    <div key={item.id} className={`cart-service-item${nested ? ' nested' : ''}`}>
      <div>
        <span className="pill">{ICON[item.service_type]}</span> <strong>{item.title}</strong>
        <div className="small muted">{item.detail}</div>
        <div className="small">{fmtDateTime(item.starts_at, tz)} · {item.adults} adult{item.adults !== 1 ? 's' : ''}{item.children > 0 && `, ${item.children} child${item.children > 1 ? 'ren' : ''}`}</div>
        <Countdown until={item.hold_expires_at} onExpire={refreshAfterExpiry} />
      </div>
      <div className="right">
        <div><strong>{money(item.total, currency)}</strong></div>
        <button className="btn sm danger" disabled={busy === item.id} onClick={() => remove(item.id)}>{busy === item.id ? <span className="spinner" /> : 'Remove'}</button>
      </div>
    </div>
  )

  return (
    <div className="stack">
      {err && <div className="notice bad" role="alert">{err}</div>}
      {pendingInterests.length > 0 && (
        <section className="stack" aria-labelledby="cart-interests-heading">
          <div>
            <h2 id="cart-interests-heading" style={{ marginBottom: '.25rem' }}>Review your saved extras</h2>
            <p className="small muted" style={{ marginTop: 0 }}>These are saved choices, not bookings. Set up each selected service before checkout.</p>
          </div>
          {pendingInterests.map((interest) => {
            const service = INTERESTS[interest.service_type]
            const key = `general:${interest.service_type}`
            return <div key={interest.service_type} className="card row between">
              <div>
                <strong>{service.label}</strong>
                <div className="small muted">{service.description}</div>
              </div>
              <div className="row">
                <Link className="btn sm" href={service.href}>{service.action} →</Link>
                <button className="btn sm secondary" disabled={busy === key} onClick={() => removeInterest(interest.service_type, null)}>{busy === key ? <span className="spinner" /> : 'Remove'}</button>
              </div>
            </div>
          })}
        </section>
      )}
      <div className="grid cart-bookings" style={{ gap: '.6rem' }}>
        {hotelItems.map((room) => {
          const attachedItems = items.filter((item) => item.parent_entitlement_id === room.id)
          const roomUpgrades = Array.isArray(room.meta.room_upgrades) ? room.meta.room_upgrades : []
          const roomInterests = interests.filter((interest) => interest.hotel_entitlement_id === room.id)
          const hasTour = attachedItems.some((item) => item.service_type === 'event' && item.status === 'held')
          const hasTourInterest = roomInterests.some((interest) => interest.service_type === 'event')
          const tourInterestKey = `${room.id}:event`
          return (
            <section key={room.id} className="card stack cart-room-booking" aria-label={`${room.title} booking`}>
              <div className="row between">
                <div>
                  <span className="pill">{ICON.hotel}</span> <strong>{room.title}</strong>
                  <div className="small muted">{room.detail}</div>
                  <div className="small">{fmtDateTime(room.starts_at, tz)} · {room.adults} adult{room.adults !== 1 ? 's' : ''}{room.children > 0 && `, ${room.children} child${room.children > 1 ? 'ren' : ''}`}</div>
                  {room.meta.early_checkin_guaranteed === true && <div className="notice ok small">
                    Guaranteed early check-in after dining by {fmtDateTime(String(room.meta.early_checkin_at), tz)}. Reception can hold your luggage until then.
                  </div>}
                  {roomUpgrades.length > 0 && <div className="small">
                    <strong>Room upgrades:</strong>
                    {roomUpgrades.map((upgrade: any, index: number) => (
                      <div key={`${upgrade.id ?? upgrade.name}:${index}`} className="muted">
                        {upgrade.name} · {money(upgrade.total, currency)}{upgrade.details && ` · ${upgrade.details}`}
                      </div>
                    ))}
                  </div>}
                  <Countdown until={room.hold_expires_at} onExpire={refreshAfterExpiry} />
                </div>
                <div className="right">
                  <div><strong>{money(room.total, currency)}</strong></div>
                  <button className="btn sm danger" disabled={busy === room.id} onClick={() => remove(room.id)}>{busy === room.id ? <span className="spinner" /> : 'Remove room'}</button>
                </div>
              </div>
              {(roomInterests.length > 0 || hasTour) && (
                <div className="cart-room-extras">
                <strong className="small">Add to this room</strong>
                <div className="row">
                  {roomInterests.filter((interest) => interest.service_type !== 'event').map((interest) => {
                    const serviceType = interest.service_type
                    const service = INTERESTS[serviceType]
                    const isConfigured = attachedItems.some((item) => item.service_type === serviceType && item.status === 'held')
                    const needsSetup = serviceType !== 'event' && !isConfigured
                    const busyKey = `${room.id}:${serviceType}`
                    return (
                      <span className="cart-room-extra" key={serviceType}>
                        {serviceType === 'event'
                          ? <Link className="btn sm secondary" href={service.href}>{service.action} →</Link>
                          : isConfigured && serviceType === 'gym'
                            ? <span className="pill ok">Access added</span>
                            : <button type="button" className="btn sm secondary"
                              onClick={() => setActiveExtra({ type: serviceType, roomId: room.id, roomTitle: room.title })}>
                              {isConfigured && serviceType === 'restaurant' ? 'Edit dining' : isConfigured ? `Add ${service.label.toLowerCase()}` : service.action} →
                            </button>}
                        {needsSetup && <span className="pill warn">Setup needed</span>}
                        {!isConfigured && <button className="btn sm secondary" disabled={busy === busyKey}
                          aria-label={`Remove ${service.label} interest from ${room.title}`}
                          onClick={() => removeInterest(serviceType, room.id)}>{busy === busyKey ? <span className="spinner" /> : '×'}</button>}
                      </span>
                    )
                  })}
                  {(hasTour || hasTourInterest) && <span className="cart-room-extra">
                    <button type="button" className="btn sm secondary"
                      onClick={() => setActiveExtra({ type: 'event', roomId: room.id, roomTitle: room.title })}>
                      {hasTour ? 'Add another tour' : 'Choose a tour'} →
                    </button>
                    {hasTourInterest && !hasTour && <>
                      <span className="pill warn">Setup needed</span>
                      <button className="btn sm secondary" disabled={busy === tourInterestKey}
                        aria-label={`Remove Tours interest from ${room.title}`}
                        onClick={() => removeInterest('event', room.id)}>{busy === tourInterestKey ? <span className="spinner" /> : '×'}</button>
                    </>}
                  </span>}
                </div>
                </div>
              )}
              {attachedItems.length > 0 && (
                <div className="cart-room-attached" aria-label={`Services attached to ${room.title}`}>
                  {attachedItems.map((item) => renderService(item, true))}
                </div>
              )}
            </section>
          )
        })}
        {standaloneItems.map((item) => renderService(item))}
      </div>
      {(items.length > 0 || orders > 0) && <div className="card">
        <table className="totals"><tbody>
          <tr><td>Items</td><td className="right">{money(subtotal, currency)}</td></tr>
          {orders > 0 && <tr><td className="muted small">Includes menu pre-order {money(orders, currency)}</td><td /></tr>}
          {tax > 0 && <tr><td>Taxes ({taxRate}%)</td><td className="right">{money(tax, currency)}</td></tr>}
          {fee > 0 && <tr><td>Service fee ({feeRate}%)</td><td className="right">{money(fee, currency)}</td></tr>}
          <tr><td>Estimated total</td><td className="right">{money(subtotal + tax + fee, currency)}</td></tr>
        </tbody></table>
        <div className="small muted">Final amounts are calculated when you pay. Items are held only for a limited time; adding to the cart does not reserve them permanently and is not a payment.</div>
      </div>}
      <div className={`row cart-footer-actions${hotelItems.length > 0 ? ' with-coupon' : ''}`}>
        {items.length > 0 && <div className={`cart-pay-actions${hotelItems.length > 0 ? ' with-coupon' : ''}`}>
          {hotelItems.length > 0 && <>
            <label className="small cart-coupon-label" htmlFor="cart-coupon-code">Enter coupon</label>
            <div className="cart-coupon-input-row">
              <input id="cart-coupon-code" type="text" value={couponInput} placeholder="Enter coupon code"
                autoComplete="off" disabled={busy !== null || couponBusy || coupons.length >= maxCouponCount}
                onChange={(event) => { setCouponInput(event.target.value); setCouponMessage(null) }} />
              <button className="btn secondary" type="button" onClick={applyCoupon}
                disabled={busy !== null || couponBusy || !couponInput.trim() || coupons.length >= maxCouponCount}>
                {couponBusy ? <span className="spinner" /> : 'Add'}
              </button>
            </div>
            <span className="small muted cart-coupon-help">Coupons are redeemed after payment. Up to {maxCouponCount} {maxCouponCount === 1 ? 'coupon' : 'coupons'}, one per room night.</span>
            {couponMessage && <span className="small cart-coupon-message" role="status">{couponMessage}</span>}
            {coupons.length > 0 && <div className="cart-coupon-list" aria-label="Applied coupon codes">
              <strong className="small">Applied coupons</strong>
              {coupons.map((coupon) => <div className="row between" key={coupon.id}>
                <span><code>{coupon.code}</code>{coupon.discount > 0 && ` · −${money(coupon.discount, currency)}`}</span>
                <button className="btn sm secondary" type="button" disabled={couponBusy}
                  onClick={() => removeCoupon(coupon.code)} aria-label={`Remove coupon ${coupon.code}`}>Remove</button>
              </div>)}
            </div>}
          </>}
          <div className="cart-payment-button">
            {setupIncomplete || couponBusy
              ? <button className="btn accent" disabled title={setupIncomplete ? 'Finish setting up each selected extra before payment' : 'Wait for the coupon to finish applying'}>Pay now →</button>
              : <Link className="btn accent" href="/book/checkout">Pay now →</Link>}
          </div>
        </div>}
      </div>
      {setupIncomplete && <div className="notice warn" role="status">Set up or remove each selected extra before continuing to payment.</div>}
      {activeExtra && <CartExtraModal
        serviceType={activeExtra.type}
        hotelEntitlementId={activeExtra.roomId}
        existingItems={activeExtra.type === 'restaurant'
          ? items.filter((item) => item.parent_entitlement_id === activeExtra.roomId && item.service_type === 'restaurant' && item.status === 'held')
          : []}
        roomTitle={activeExtra.roomTitle}
        currency={currency}
        tz={tz}
        holdMinutes={holdMinutes}
        roomCheckinDate={String(activeRoom?.meta.checkin ?? '')}
        roomCheckoutDate={String(activeRoom?.meta.checkout ?? '')}
        roomAdults={activeRoom?.adults ?? 0}
        roomChildren={activeRoom?.children ?? 0}
        hotelCheckinTime={checkinTime}
        onClose={closeExtra}
        onAdded={extraAdded}
      />}
    </div>
  )
}
