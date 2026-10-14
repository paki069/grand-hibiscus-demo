import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { getSettings } from '@/lib/data'
import AccountDashboard from '@/components/AccountDashboard'
import type { LoyaltyGuide } from '@/components/AccountDashboard'

export default async function Account() {
  const me = await requireRole(['customer', 'staff', 'admin'], '/account')
  const supabase = await createClient()
  const s = await getSettings()
  const [reservations, balance, ledger, coupons, roomTypes, loyaltyGuide, birthdayReward] = await Promise.all([
    supabase.from('reservations').select('id, reference, status, total, currency, created_at, entitlements(service_type, starts_at, ends_at, status)').neq('status', 'cart').order('created_at', { ascending: false }),
    supabase.rpc('my_loyalty_balance'),
    supabase.from('loyalty_point_ledger').select('id, points, description, created_at').order('created_at', { ascending: false }).limit(20),
    supabase.from('loyalty_coupons').select('id, code, room_type_id, points_cost, status, created_at').order('created_at', { ascending: false }),
    supabase.from('room_types').select('id, name, loyalty_free_night_points').eq('active', true).order('name'),
    supabase.rpc('guest_loyalty_guide'),
    supabase.rpc('my_birthday_reward_status'),
  ])
  for (const result of [reservations, balance, ledger, coupons, roomTypes, loyaltyGuide, birthdayReward]) if (result.error) throw result.error
  const earnGuide = loyaltyGuide.data as LoyaltyGuide | null
  if (!earnGuide) throw new Error('The loyalty earning guide is unavailable.')
  const birthdayStatus = birthdayReward.data?.[0]
  if (!birthdayStatus) throw new Error('The birthday reward status is unavailable.')
  const now = Date.now()
  const accountReservations = (reservations.data ?? []).map((reservation) => ({
    ...reservation,
    isActive: ['pending', 'confirmed'].includes(reservation.status)
      && (reservation.entitlements ?? []).some((entitlement) => (
        ['held', 'active'].includes(entitlement.status)
        && new Date(entitlement.ends_at).getTime() >= now
      )),
  }))
  return (
    <AccountDashboard
      firstName={me.first_name.trim()}
      email={me.email}
      birthday={birthdayStatus.birthday}
      birthdayStatus={birthdayStatus}
      canClaimBirthdayReward={me.role === 'customer'}
      balance={balance.data ?? 0}
      ledger={ledger.data ?? []}
      coupons={coupons.data ?? []}
      roomTypes={roomTypes.data ?? []}
      reservations={accountReservations}
      timezone={s.timezone}
      loyaltyGuide={earnGuide}
      canBackfill={me.role === 'customer'}
    />
  )
}
