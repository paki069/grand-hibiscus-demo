'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { friendlyError } from '@/lib/format'
import RestaurantBooking, { type AreaVM, type ConfigVM, type ProductVM, type SeatVM, type TableVM } from '@/components/RestaurantBooking'
import SpaBooking, { type SpaVM } from '@/components/SpaBooking'
import GymBooking, { type GymPackageVM } from '@/components/GymBooking'
import TourBooking from '@/components/TourBooking'
import type { TourVM } from '@/components/ToursShowcase'
import { Empty } from '@/components/ui'
import type { CartInterest, Ent } from '@/lib/data'

type Props = {
  serviceType: CartInterest
  hotelEntitlementId: string
  existingItems: Ent[]
  roomTitle: string
  roomCheckinDate: string
  roomCheckoutDate: string
  roomAdults: number
  roomChildren: number
  hotelCheckinTime: string
  currency: string
  tz: string
  holdMinutes: number
  onClose: () => void
  onAdded: () => void
}

type RestaurantCatalog = {
  type: 'restaurant'
  areas: AreaVM[]
  tables: TableVM[]
  seats: SeatVM[]
  products: ProductVM[]
  config: ConfigVM | null
}
type SpaCatalog = { type: 'spa'; services: SpaVM[] }
type GymCatalog = { type: 'gym'; packages: GymPackageVM[]; membershipCoversStay: boolean }
type EventsCatalog = { type: 'event'; events: TourVM[] }
type Catalog = RestaurantCatalog | SpaCatalog | GymCatalog | EventsCatalog

const shortDate = (date: string) => new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', timeZone: 'UTC',
}).format(new Date(`${date}T12:00:00Z`))

function toDiningBooking(item: Ent, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(item.starts_at))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
    tableId: typeof item.meta.table_id === 'string' ? item.meta.table_id : '',
    seats: Array.isArray(item.meta.seats) ? item.meta.seats.filter((seat: unknown): seat is string => typeof seat === 'string') : [],
  }
}

function stayRange(checkin: string, checkout: string) {
  const start = new Date(`${checkin}T12:00:00Z`)
  const end = new Date(`${checkout}T12:00:00Z`)
  if (start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear()) {
    return `${new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(start)} ${start.getUTCDate()}–${end.getUTCDate()}`
  }
  return `${shortDate(checkin)}–${shortDate(checkout)}`
}

export default function CartExtraModal({ serviceType, hotelEntitlementId, existingItems, roomTitle, roomCheckinDate, roomCheckoutDate, roomAdults, roomChildren, hotelCheckinTime, currency, tz, holdMinutes, onClose, onAdded }: Props) {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    async function loadCatalog() {
      setLoading(true)
      setError(null)
      setCatalog(null)
      const supabase = createClient()
      try {
        if (serviceType === 'restaurant') {
          const [areas, tables, seats, products, config] = await Promise.all([
            supabase.from('seating_areas').select('*').eq('active', true).order('name'),
            supabase.from('seating_tables').select('*').eq('active', true).order('label'),
            supabase.from('seats').select('*').eq('active', true),
            supabase.from('menu_products').select('*, menu_product_categories(menu_categories(name, sort_order))').eq('active', true).eq('available', true).order('name'),
            supabase.from('restaurant_config').select('*').eq('id', 1).single(),
          ])
          const configNotPublished = config.error?.code === 'PGRST116'
          const failure = areas.error ?? tables.error ?? seats.error ?? products.error ?? (configNotPublished ? null : config.error)
          if (failure) throw failure
          if (existingItems.length > 0 && config.data && areas.data?.length && tables.data?.length) {
            const { error } = await supabase.rpc('begin_restaurant_edit_for_room_cart', {
              p_hotel_entitlement: hotelEntitlementId,
            })
            if (error) throw error
          }
          const productList = (products.data ?? []).map((product: any) => ({
            ...product,
            categories: (product.menu_product_categories ?? []).map((link: any) => link.menu_categories).filter(Boolean)
              .sort((a: any, b: any) => a.sort_order - b.sort_order),
          }))
          if (!cancelled) setCatalog({
            type: 'restaurant',
            areas: (areas.data ?? []) as AreaVM[],
            tables: (tables.data ?? []) as TableVM[],
            seats: (seats.data ?? []) as SeatVM[],
            products: productList as ProductVM[],
            config: (config.data as ConfigVM | null) ?? null,
          })
        } else if (serviceType === 'spa') {
          const { data, error } = await supabase.from('spa_services').select('*, spa_categories(name)').eq('active', true).order('name')
          if (error) throw error
          const services = (data ?? []).map((service: any) => ({ ...service, category: service.spa_categories?.name ?? 'Spa' })) as SpaVM[]
          if (!cancelled) setCatalog({ type: 'spa', services })
        } else if (serviceType === 'gym') {
          if (!roomCheckinDate || !roomCheckoutDate) throw new Error('Room dates are missing. Close this window and refresh your cart.')
          const [packages, membership] = await Promise.all([
            supabase.from('gym_packages').select('*').eq('active', true).order('sort_order'),
            supabase.rpc('gym_access_covers_stay', { p_checkin: roomCheckinDate, p_checkout: roomCheckoutDate }),
          ])
          if (packages.error) throw packages.error
          if (membership.error) throw membership.error
          if (!cancelled) setCatalog({
            type: 'gym',
            packages: (packages.data ?? []) as GymPackageVM[],
            membershipCoversStay: membership.data === true,
          })
        } else {
          const { data, error } = await supabase.from('public_events').select('*').order('title')
          if (error) throw error
          if (!cancelled) {
            const events = (data ?? []) as TourVM[]
            events.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.title.localeCompare(b.title))
            setCatalog({ type: 'event', events })
          }
        }
      } catch (cause) {
        if (!cancelled) setError(friendlyError(cause))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadCatalog()
    return () => { cancelled = true }
  }, [serviceType, existingItems.length, hotelEntitlementId])

  const diningSummary = [
    roomTitle,
    `${roomAdults} adult${roomAdults === 1 ? '' : 's'}${roomChildren > 0 ? ` · ${roomChildren} child${roomChildren === 1 ? '' : 'ren'}` : ''}`,
    roomCheckinDate && roomCheckoutDate ? stayRange(roomCheckinDate, roomCheckoutDate) : '',
  ].filter(Boolean).join(' · ')
  const gymNights = roomCheckinDate && roomCheckoutDate
    ? Math.max(0, Math.round((Date.parse(`${roomCheckoutDate}T00:00:00Z`) - Date.parse(`${roomCheckinDate}T00:00:00Z`)) / 86400000))
    : 0
  const gymSummary = roomCheckinDate && roomCheckoutDate
    ? `${roomTitle} · ${shortDate(roomCheckinDate)} – ${shortDate(roomCheckoutDate)} · ${gymNights} night${gymNights === 1 ? '' : 's'}`
    : roomTitle

  return (
    <div className="modal-back cart-extra-modal-back" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className={`modal stack cart-extra-modal${serviceType === 'restaurant' ? ' restaurant-extra-modal' : ''}${serviceType === 'gym' ? ' gym-extra-modal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="cart-extra-modal-title">
        <header className="row between">
          <div>
            <h2 id="cart-extra-modal-title" style={{ margin: 0 }}>{serviceType === 'restaurant' ? existingItems.length > 0 ? 'Edit dining' : 'Set up dining' : serviceType === 'spa' ? 'Set up Spa' : serviceType === 'gym' ? 'Add gym access' : 'Choose a tour'}</h2>
            <div className="small muted">{serviceType === 'restaurant' ? diningSummary : serviceType === 'spa' ? `For ${roomTitle}` : serviceType === 'gym' ? gymSummary : `Choose a departure during ${stayRange(roomCheckinDate, roomCheckoutDate)} · ${roomTitle}`}</div>
          </div>
          <button type="button" className="btn sm secondary" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className={`cart-extra-modal-content${serviceType === 'gym' ? ' gym-extra-modal-content' : ''}`}>
          {loading && <div className="small muted" role="status"><span className="spinner" /> Loading options…</div>}
          {error && <div className="notice bad" role="alert">{error}</div>}
          {!loading && !error && serviceType === 'restaurant' && catalog?.type === 'restaurant' && (
            !catalog.config || catalog.areas.length === 0
              ? <div className="notice warn">Online table booking is not available yet.</div>
              : <RestaurantBooking
                areas={catalog.areas} tables={catalog.tables} seats={catalog.seats} products={catalog.products}
                config={catalog.config} currency={currency} holdMinutes={holdMinutes}
                hotelEntitlementId={hotelEntitlementId} roomCheckinDate={roomCheckinDate} roomCheckoutDate={roomCheckoutDate}
                roomAdults={roomAdults} roomChildren={roomChildren}
                hotelCheckinTime={hotelCheckinTime} existingBookings={existingItems.map((item) => toDiningBooking(item, tz))}
                embedded onAdded={onAdded}
              />
          )}
          {!loading && !error && serviceType === 'spa' && catalog?.type === 'spa' && (
            catalog.services.length === 0
              ? <Empty>No spa services are published yet.</Empty>
              : <SpaBooking services={catalog.services} currency={currency} tz={tz} holdMinutes={holdMinutes}
                hotelEntitlementId={hotelEntitlementId} embedded onAdded={onAdded} />
          )}
          {!loading && !error && serviceType === 'gym' && catalog?.type === 'gym' && (
            <GymBooking packages={catalog.packages} currency={currency} hotelEntitlementId={hotelEntitlementId}
              roomCheckinDate={roomCheckinDate} roomCheckoutDate={roomCheckoutDate}
              roomAdults={roomAdults}
              membershipCoversStay={catalog.membershipCoversStay} holdMinutes={holdMinutes}
              embedded onAdded={onAdded} />
          )}
          {!loading && !error && serviceType === 'event' && catalog?.type === 'event' && (
            <TourBooking events={catalog.events} hotelEntitlementId={hotelEntitlementId}
              roomCheckinDate={roomCheckinDate} roomCheckoutDate={roomCheckoutDate}
              roomAdults={roomAdults} roomChildren={roomChildren}
              currency={currency} tz={tz} onAdded={onAdded} />
          )}
        </div>
      </section>
    </div>
  )
}
