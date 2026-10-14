import { createClient } from '@/lib/supabase/server'
import { getSettings } from '@/lib/data'
import { fmtDate } from '@/lib/format'
import { Empty, Pill } from '@/components/ui'
import GuestDeleteButton from '@/components/GuestDeleteButton'
import GuestBirthdayForm from '@/components/GuestBirthdayForm'

export default async function Guests({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams
  const supabase = await createClient()
  const s = await getSettings()
  let query = supabase.from('profiles').select('id, email, first_name, last_name, phone, birthday, created_at, active').eq('role', 'customer').order('created_at', { ascending: false }).limit(200)
  const search = q?.trim().replace(/[%,()]/g, '') ?? ''
  if (search) query = query.or(`email.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone.ilike.%${search}%`)
  const { data: profileMatches, error: profileError } = await query
  if (profileError) throw new Error(`Unable to load guest profiles: ${profileError.message}`)
  const { data: adminProfiles, error: adminProfilesError } = await supabase.from('profiles')
    .select('email')
    .eq('role', 'admin')
  if (adminProfilesError) throw new Error(`Unable to load admin account emails: ${adminProfilesError.message}`)
  const adminEmails = new Set((adminProfiles ?? [])
    .map((profile) => profile.email?.trim().toLowerCase())
    .filter((email): email is string => Boolean(email)))

  let reservationMatches: { customer_id: string }[] = []
  if (search) {
    const { data, error } = await supabase.from('reservations').select('customer_id')
      .neq('status', 'cart')
      .or(`email.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone.ilike.%${search}%`)
      .limit(200)
    if (error) throw new Error(`Unable to search guest reservations: ${error.message}`)
    reservationMatches = data ?? []
  }

  const profiles = profileMatches ?? []
  const profileIds = new Set(profiles.map((guest) => guest.id))
  const additionalIds = [...new Set(reservationMatches.map((reservation) => reservation.customer_id))]
    .filter((id) => !profileIds.has(id))
  let additionalProfiles: typeof profiles = []
  if (additionalIds.length > 0) {
    const { data, error } = await supabase.from('profiles')
      .select('id, email, first_name, last_name, phone, birthday, created_at, active')
      .eq('role', 'customer')
      .in('id', additionalIds)
    if (error) throw new Error(`Unable to load guests matching reservations: ${error.message}`)
    additionalProfiles = data ?? []
  }

  const data = [...profiles, ...additionalProfiles]
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
    .slice(0, 200)
  const ids = (data ?? []).map((g) => g.id)
  let res: { customer_id: string; first_name: string; last_name: string; email: string; phone: string; created_at: string }[] = []
  if (ids.length > 0) {
    const { data, error } = await supabase.from('reservations')
      .select('customer_id, first_name, last_name, email, phone, created_at')
      .neq('status', 'cart')
      .in('customer_id', ids)
      .order('created_at', { ascending: false })
    if (error) throw new Error(`Unable to load guest reservations: ${error.message}`)
    res = data ?? []
  }
  const latestReservationByGuest = new Map<string, typeof res[number]>()
  for (const reservation of res) {
    if (!latestReservationByGuest.has(reservation.customer_id)) {
      latestReservationByGuest.set(reservation.customer_id, reservation)
    }
  }
  const visibleGuests = data.filter((guest) => {
    const reservation = latestReservationByGuest.get(guest.id)
    const email = (guest.email || reservation?.email || '').trim().toLowerCase()
    const hasContactDetails = Boolean(
      guest.first_name || guest.last_name || guest.phone
      || reservation?.first_name || reservation?.last_name || reservation?.phone || email,
    )
    return hasContactDetails && (!email || !adminEmails.has(email))
  })
  return (
    <div className="stack">
      <h1>Guests</h1>
      <form className="row" style={{ alignItems: 'end' }}><label className="field">Search<input name="q" defaultValue={q} placeholder="Name, email, phone" /></label><button className="btn secondary">Search</button></form>
      {visibleGuests.length === 0 ? <Empty>No guests found.</Empty> : (
        <div className="table-wrap"><table className="data"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Birthday</th><th>Joined</th><th>Actions</th></tr></thead>
          <tbody>{visibleGuests.map((g) => {
            const reservation = latestReservationByGuest.get(g.id)
            const firstName = g.first_name || reservation?.first_name || ''
            const lastName = g.last_name || reservation?.last_name || ''
            const email = g.email || reservation?.email || ''
            const phone = g.phone || reservation?.phone || ''
            return (
              <tr key={g.id}>
                <td>{firstName} {lastName} {!g.active && <Pill value="expired" label="disabled" />}</td>
                <td>{email}</td>
                <td>{phone}</td>
                <td><GuestBirthdayForm guestId={g.id} birthday={g.birthday} /></td>
                <td>{fmtDate(g.created_at, s.timezone)}</td>
                <td><GuestDeleteButton guestId={g.id} guestName={`${firstName} ${lastName}`.trim() || email || 'this guest'} /></td>
              </tr>
            )
          })}</tbody></table></div>
      )}
    </div>
  )
}
