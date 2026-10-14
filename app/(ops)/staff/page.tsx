import Link from 'next/link'
import { requireRole, allowedAreas } from '@/lib/auth'

export default async function StaffHome() {
  const me = await requireRole(['admin', 'staff'], '/staff')
  const areas = allowedAreas(me)
  return (
    <div className="stack">
      <h1>Front desk</h1>
      <p className="muted">Scan guest QR passes and check in one service at a time. You only see what you need for your area.</p>
      <div className="grid cols-3">
        <Link href="/staff/scan" className="card" style={{ textDecoration: 'none' }}><h3>QR scanner</h3><p className="muted small">Camera or manual entry</p></Link>
        <Link href="/staff/list" className="card" style={{ textDecoration: 'none' }}><h3>Today’s list</h3><p className="muted small">Expected arrivals for your area</p></Link>
        {(me.role === 'admin' || areas.includes('hotel')) && <>
          <Link href="/staff/birthday" className="card" style={{ textDecoration: 'none' }}><h3>Birthday rewards</h3><p className="muted small">Verify and redeem a guest’s birthday gift</p></Link>
          <Link href="/staff/requests" className="card" style={{ textDecoration: 'none' }}><h3>Requests</h3><p className="muted small">Upcoming room add-ons and upgrades</p></Link>
        </>}
      </div>
      <div className="small">Your areas: {areas.length ? areas.join(', ') : 'none assigned'}</div>
    </div>
  )
}
