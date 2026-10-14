import Link from 'next/link'
import { requireRole, allowedAreas } from '@/lib/auth'
import OpsNav from '@/components/OpsNav'

export const dynamic = 'force-dynamic'

export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  const me = await requireRole(['admin', 'staff'], '/staff')
  const areas = allowedAreas(me)
  return (
    <div className="shell">
      <OpsNav role={me.role} areas={areas} name={`${me.first_name} ${me.last_name}`.trim() || me.email || 'User'} />
      <main className="main" style={{ padding: '1.25rem', minWidth: 0 }}>
        {me.role === 'staff' && areas.length === 0 && <div className="notice warn">Your account has no service areas assigned yet. Ask an administrator.</div>}
        {children}
        <p className="small muted" style={{ marginTop: '2rem' }}><Link href="/">← Guest site</Link></p>
      </main>
    </div>
  )
}
