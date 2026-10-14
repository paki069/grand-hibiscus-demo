import { requireRole, allowedAreas } from '@/lib/auth'
import { getSettings } from '@/lib/data'
import Scanner from '@/components/Scanner'

export default async function ScanPage() {
  const me = await requireRole(['admin', 'staff'], '/staff/scan')
  const s = await getSettings()
  return (
    <div className="stack">
      <h1>QR scanner</h1>
      <Scanner areas={allowedAreas(me)} tz={s.timezone} canOpenReservations={me.role === 'admin'} />
    </div>
  )
}
