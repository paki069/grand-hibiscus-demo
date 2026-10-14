import { createClient } from '@/lib/supabase/server'
import { getGuestBookingDetails, getSettings } from '@/lib/data'
import RestaurantBooking from '@/components/RestaurantBooking'
import { Notice } from '@/components/ui'

export default async function RestaurantPage({ searchParams }: { searchParams: Promise<{ room?: string }> }) {
  const { room: hotelEntitlementId } = await searchParams
  const supabase = await createClient()
  const [settings, areas, tables, seats, prods, cfg, roomContext, auth] = await Promise.all([
    getSettings(),
    supabase.from('seating_areas').select('*').eq('active', true).order('name'),
    supabase.from('seating_tables').select('*').eq('active', true).order('label'),
    supabase.from('seats').select('*').eq('active', true),
    supabase.from('menu_products').select('*, menu_product_categories(menu_categories(name, sort_order))').eq('active', true).eq('available', true).order('name'),
    supabase.from('restaurant_config').select('*').eq('id', 1).single(),
    hotelEntitlementId
      ? supabase.from('entitlements').select('title, adults, children, meta').eq('id', hotelEntitlementId).eq('service_type', 'hotel').maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.auth.getUser(),
  ])
  if (auth.error && auth.error.name !== 'AuthSessionMissingError') {
    throw new Error(`Unable to verify the signed-in user for restaurant booking: ${auth.error.message}`)
  }
  const isLoggedIn = Boolean(auth.data.user && !auth.data.user.is_anonymous)
  const savedDetails = isLoggedIn && auth.data.user
    ? await getGuestBookingDetails(auth.data.user.id, auth.data.user.email ?? null)
    : null
  const products = (prods.data ?? []).map((p: any) => ({
    ...p,
    categories: (p.menu_product_categories ?? []).map((link: any) => link.menu_categories).filter(Boolean).sort((a: any, b: any) => a.sort_order - b.sort_order),
  }))
  return (
    <div className="stack">
      <h1>Restaurant</h1>
      {hotelEntitlementId && <div className="notice info">Setting up dining for {roomContext.data?.title ?? 'your selected room'}.</div>}
      {!cfg.data || (areas.data ?? []).length === 0 ? (
        <Notice tone="warn">Online table booking is not available yet.</Notice>
      ) : (
        <RestaurantBooking areas={areas.data ?? []} tables={tables.data ?? []} seats={seats.data ?? []} products={products}
          config={cfg.data as any} currency={settings.currency} holdMinutes={settings.hold_minutes} hotelEntitlementId={hotelEntitlementId}
          isLoggedIn={isLoggedIn}
          roomCheckinDate={roomContext.data?.meta?.checkin} roomCheckoutDate={roomContext.data?.meta?.checkout}
          roomAdults={roomContext.data?.adults} roomChildren={roomContext.data?.children}
          initialGuestDetails={{
            first_name: savedDetails?.first_name ?? '',
            last_name: savedDetails?.last_name ?? '',
            email: savedDetails?.email ?? '',
            phone: savedDetails?.phone ?? '',
            notes: '',
          }} />
      )}
    </div>
  )
}
