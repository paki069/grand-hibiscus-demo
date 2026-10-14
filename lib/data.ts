import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type { Settings } from '@/lib/format'

export async function getSettings(): Promise<Settings> {
  const supabase = await createClient()
  const { data } = await supabase.from('settings').select('*').eq('id', 1).single()
  return data as Settings
}

export interface Ent {
  id: string
  parent_entitlement_id: string | null
  service_type: 'hotel' | 'restaurant' | 'spa' | 'event' | 'gym'
  title: string
  detail: string
  starts_at: string
  ends_at: string
  adults: number
  children: number
  total: number
  meta: Record<string, any>
  status: string
  hold_expires_at: string | null
  checked_in_at: string | null
}

export interface GuestBookingDetails {
  first_name: string
  last_name: string
  email: string
  phone: string
}

export async function getGuestBookingDetails(customerId: string, accountEmail: string | null = null): Promise<GuestBookingDetails> {
  const supabase = await createClient()
  const [profileResult, reservationResult] = await Promise.all([
    supabase.from('profiles').select('first_name,last_name,email,phone').eq('id', customerId).maybeSingle(),
    supabase.from('reservations')
      .select('first_name,last_name,email,phone')
      .eq('customer_id', customerId)
      .neq('status', 'cart')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (profileResult.error) throw new Error(`Unable to load saved guest contact details: ${profileResult.error.message}`)
  if (reservationResult.error) throw new Error(`Unable to load contact details from the guest’s previous booking: ${reservationResult.error.message}`)

  const profile = profileResult.data
  const previousBooking = reservationResult.data
  return {
    first_name: profile?.first_name || previousBooking?.first_name || '',
    last_name: profile?.last_name || previousBooking?.last_name || '',
    email: profile?.email || previousBooking?.email || accountEmail || '',
    phone: profile?.phone || previousBooking?.phone || '',
  }
}

export type CartInterest = 'restaurant' | 'spa' | 'event' | 'gym'
export interface CartServiceInterest {
  service_type: CartInterest
  hotel_entitlement_id: string | null
}

export interface CartCoupon {
  id: string
  code: string
  discount: number
}

export async function getCart() {
  const supabase = await createClient()
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError && authError.name !== 'AuthSessionMissingError') {
    throw new Error(`Unable to verify the signed-in user for the cart: ${authError.message}`)
  }
  if (!auth.user) return null
  const { data: cart, error: cartError } = await supabase.from('reservations')
    .select('id, first_name, last_name, email, phone, notes')
    .eq('status', 'cart').maybeSingle()
  if (cartError) throw new Error(`Unable to load the cart reservation: ${cartError.message}`)
  if (!cart) return {
    id: null as string | null,
    items: [] as Ent[],
    orders: 0,
    coupons: [] as CartCoupon[],
    interests: [] as CartServiceInterest[],
    guestDetails: { first_name: '', last_name: '', email: '', phone: '', notes: '' },
  }
  const [itemsResult, ordersResult, interestsResult, couponsResult] = await Promise.all([
    supabase.from('entitlements').select('*').eq('reservation_id', cart.id).order('starts_at'),
    supabase.from('menu_orders').select('total').eq('reservation_id', cart.id),
    supabase.from('cart_service_interests').select('service_type, hotel_entitlement_id').eq('reservation_id', cart.id),
    supabase.from('loyalty_coupons').select('id, code, reserved_entitlement_id')
      .eq('reservation_id', cart.id).eq('status', 'reserved').order('created_at'),
  ])
  if (itemsResult.error) throw new Error(`Unable to load cart bookings: ${itemsResult.error.message}`)
  if (ordersResult.error) throw new Error(`Unable to load cart orders: ${ordersResult.error.message}`)
  if (interestsResult.error) throw new Error(`Unable to load cart add-ons: ${interestsResult.error.message}`)
  if (couponsResult.error) throw new Error(`Unable to load applied cart coupons: ${couponsResult.error.message}`)
  const now = Date.now()
  const visibleItems = ((itemsResult.data ?? []) as Ent[]).filter((item) => item.status === 'active'
    || (item.status === 'held' && (!item.hold_expires_at || Date.parse(item.hold_expires_at) > now)))
  const activeRoomIds = new Set(visibleItems.filter((item) => item.service_type === 'hotel').map((item) => item.id))
  const hotelItemsById = new Map(visibleItems.filter((item) => item.service_type === 'hotel').map((item) => [item.id, item]))
  return {
    id: cart.id as string,
    items: visibleItems,
    orders: (ordersResult.data ?? []).reduce((a, o) => a + Number(o.total), 0),
    coupons: (couponsResult.data ?? []).map((coupon) => {
      const allocation = hotelItemsById.get(coupon.reserved_entitlement_id ?? '')?.meta.loyalty_coupon_allocations?.[coupon.id]
      const discount = Number(allocation?.discount)
      return { id: coupon.id, code: coupon.code, discount: Number.isFinite(discount) ? discount : 0 }
    }),
    guestDetails: {
      first_name: cart.first_name ?? '',
      last_name: cart.last_name ?? '',
      email: cart.email ?? '',
      phone: cart.phone ?? '',
      notes: cart.notes ?? '',
    },
    interests: (interestsResult.data ?? [])
      .filter((interest) => interest.hotel_entitlement_id === null || activeRoomIds.has(interest.hotel_entitlement_id))
      .map((interest) => ({
      service_type: interest.service_type as CartInterest,
      hotel_entitlement_id: interest.hotel_entitlement_id,
      })),
  }
}

export const devPaymentsAllowed = () => process.env.ALLOW_DEV_PAYMENTS === 'true' && process.env.NODE_ENV !== 'production'
