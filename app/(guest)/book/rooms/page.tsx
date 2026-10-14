import { createClient } from '@/lib/supabase/server'
import { getGuestBookingDetails, getSettings } from '@/lib/data'
import { addDays, todayISO } from '@/lib/format'
import StayForm from '@/components/StayForm'
import RoomCard, { type AddonVM, type RoomVM } from '@/components/RoomCard'
import { Empty, Notice } from '@/components/ui'

type SP = Promise<{ checkin?: string; checkout?: string; adults?: string; children?: string }>
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)

export default async function RoomsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams
  const checkin = isDate(sp.checkin) ? sp.checkin! : addDays(todayISO(), 1)
  const checkout = isDate(sp.checkout) && sp.checkout! > checkin ? sp.checkout! : addDays(checkin, 1)
  const adults = Math.min(10, Math.max(1, Number(sp.adults) || 2))
  const children = Math.min(10, Math.max(0, Number(sp.children) || 0))
  const nights = Math.round((Date.parse(checkout) - Date.parse(checkin)) / 86400000)

  const supabase = await createClient()
  const [settings, avail, types, addons, upgrades, user] = await Promise.all([
    getSettings(),
    supabase.rpc('room_type_availability', { p_in: checkin, p_out: checkout }),
    supabase.from('room_types').select('*, room_categories(name)').eq('active', true).order('base_rate'),
    supabase.from('room_addons').select('*').eq('active', true).eq('kind', 'addon').order('name'),
    supabase.from('room_addons').select('*').eq('active', true).eq('kind', 'upgrade').order('sort_order').order('name'),
    supabase.auth.getUser(),
  ])
  if (upgrades.error) throw new Error(`Unable to load room upgrades: ${upgrades.error.message}`)
  if (user.error && user.error.name !== 'AuthSessionMissingError') {
    throw new Error(`Unable to verify the signed-in user for room booking: ${user.error.message}`)
  }
  const isLoggedIn = Boolean(user.data.user && !user.data.user.is_anonymous)
  const [savedDetails, gymCoverageResult] = user.data.user
    ? await Promise.all([
      isLoggedIn
        ? getGuestBookingDetails(user.data.user.id, user.data.user.email ?? null)
        : Promise.resolve(null),
      supabase.rpc('gym_access_covers_stay', { p_checkin: checkin, p_checkout: checkout }),
    ])
    : [null, { data: false, error: null }]
  if (gymCoverageResult.error) throw new Error(`Unable to check gym access for these dates: ${gymCoverageResult.error.message}`)

  const byType = new Map<string, { rooms_available: number; total: number }>()
  for (const a of avail.data ?? []) byType.set(a.room_type_id, a)

  const rooms: RoomVM[] = (types.data ?? []).map((t: any) => ({
    ...t,
    category: t.room_categories?.name ?? null,
    rooms_available: byType.get(t.id)?.rooms_available ?? 0,
    total: byType.get(t.id)?.total ?? 0,
  }))

  return (
    <div className="stack">
      <StayForm key={`${checkin}:${checkout}:${adults}:${children}`} initial={{ checkin, checkout, adults, children }} live />
      {(avail.error || types.error) && <Notice tone="bad">We could not load rooms right now. Please try again shortly.</Notice>}
      {!types.error && rooms.length === 0 && <Empty>No rooms are published yet.</Empty>}
      <div className="grid cols-2">
        {rooms.map((r) => (
          <RoomCard
            key={r.id}
            room={r}
            addons={((addons.data ?? []) as AddonVM[]).filter((a) => a.room_type_id === null || a.room_type_id === r.id)}
            upgrades={(upgrades.data ?? []) as AddonVM[]}
            search={{ checkin, checkout, adults, children, nights }}
            settings={settings}
            profile={savedDetails}
            isLoggedIn={isLoggedIn}
            gymAccessCovered={gymCoverageResult.data === true}
          />
        ))}
      </div>
      <p className="small muted">{settings.booking_policy}</p>
    </div>
  )
}
