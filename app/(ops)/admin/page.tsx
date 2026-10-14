import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getSettings } from '@/lib/data'
import { money, fmtDateTime } from '@/lib/format'
import { Pill, Empty } from '@/components/ui'

const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0

export default async function Dashboard() {
  const supabase = await createClient()
  const s = await getSettings()
  const now = new Date()
  const day0 = new Date(now); day0.setUTCHours(0, 0, 0, 0)
  const day1 = new Date(day0.getTime() + 86400000)
  const head = { count: 'exact' as const, head: true }
  const [pending, confirmed, toVerify, arrivals, eventInquiries, recent, revenue] = await Promise.all([
    count(supabase.from('reservations').select('id', head).eq('status', 'pending')),
    count(supabase.from('reservations').select('id', head).eq('status', 'confirmed')),
    count(supabase.from('payments').select('id', head).eq('status', 'pending_verification')),
    count(supabase.from('entitlements').select('id', head).eq('status', 'active').is('checked_in_at', null).gte('starts_at', day0.toISOString()).lt('starts_at', day1.toISOString())),
    count(supabase.from('host_event_inquiries').select('id', head)),
    supabase.from('reservations').select('id, reference, first_name, last_name, status, total, currency, created_at').neq('status', 'cart').order('created_at', { ascending: false }).limit(8),
    supabase.from('payments').select('amount').eq('status', 'paid'),
  ])
  const paid = (revenue.data ?? []).reduce((t, p) => t + Number(p.amount), 0)
  const kpis: [string, string | number, string?][] = [
    ['Awaiting payment', pending, '/admin/reservations?status=pending'], ['Confirmed', confirmed, '/admin/reservations?status=confirmed'],
    ['Receipts to verify', toVerify, '/admin/payments?status=pending_verification'], ['Services due today (not checked in)', arrivals],
    ['Event inquiries', eventInquiries, '/admin/host-events'], ['Paid to date', money(paid, s.currency), '/admin/payments?status=paid'],
  ]
  return (
    <div className="stack">
      <h1>Dashboard</h1>
      <div className="grid cols-3">
        {kpis.map(([l, n, href]) => {
          const inner = <><div className="n">{n}</div><div className="l">{l}</div></>
          return href ? <Link key={l} href={href} className="card kpi" style={{ textDecoration: 'none' }}>{inner}</Link> : <div key={l} className="card kpi">{inner}</div>
        })}
      </div>
      <h2>Recent reservations</h2>
      {(recent.data ?? []).length === 0 ? <Empty>No reservations yet.</Empty> : (
        <div className="table-wrap"><table className="data">
          <thead><tr><th>Ref</th><th>Guest</th><th>Placed</th><th>Total</th><th>Status</th></tr></thead>
          <tbody>{(recent.data ?? []).map((r) => (
            <tr key={r.id}><td><Link href={`/admin/reservations/${r.id}`}>{r.reference}</Link></td><td>{r.first_name} {r.last_name}</td><td>{fmtDateTime(r.created_at, s.timezone)}</td><td>{money(r.total, r.currency)}</td><td><Pill value={r.status} /></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  )
}
