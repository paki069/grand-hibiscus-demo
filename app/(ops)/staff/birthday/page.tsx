import { redirect } from 'next/navigation'
import { allowedAreas, requireRole } from '@/lib/auth'
import StaffBirthdayRewards from '@/components/StaffBirthdayRewards'

export default async function StaffBirthdayPage() {
  const me = await requireRole(['admin', 'staff'], '/staff/birthday')
  if (!allowedAreas(me).includes('hotel')) redirect('/staff')

  return (
    <div className="stack">
      <h1>Birthday rewards</h1>
      <p className="muted">Verify a guest’s profile birthday and redeem their 100-point annual gift at the front desk.</p>
      <StaffBirthdayRewards />
    </div>
  )
}
