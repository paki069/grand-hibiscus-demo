import { requireRole, allowedAreas } from '@/lib/auth'
import { getSettings } from '@/lib/data'
import { createClient } from '@/lib/supabase/server'
import { fmtDateTime } from '@/lib/format'
import { Empty, Pill } from '@/components/ui'

export default async function StaffList({ searchParams }: { searchParams: Promise<{ area?: string; date?: string }> }) {
  const sp = await searchParams
  const me = await requireRole(['admin', 'staff'], '/staff/list')
  const areas = allowedAreas(me)
  const s = await getSettings()
  const area = areas.includes(sp.area ?? '') ? sp.area! : areas[0]
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') ? sp.date! : new Date().toISOString().slice(0, 10)
  const supabase = await createClient()
  const { data, error } = area ? await supabase.rpc('staff_service_list', { p_area: area, p_date: date }) : { data: [], error: null }

  return (
    <div className="stack">
      <h1>Today’s list</h1>
      <form className="row" style={{ alignItems: 'end' }}>
        <label className="field">Area<select name="area" defaultValue={area}>{areas.map((a) => <option key={a}>{a}</option>)}</select></label>
        <label className="field">Date<input type="date" name="date" defaultValue={date} /></label>
        <button className="btn secondary">Apply</button>
      </form>
      {error && <div className="notice bad">Could not load the list.</div>}
      {(data ?? []).length === 0 ? <Empty>Nothing scheduled for this area and date.</Empty> : (
        <div className="table-wrap"><table className="data">
          <thead><tr><th>Time</th><th>Guest</th><th>Service</th><th>Party</th><th>Ref</th><th>State</th></tr></thead>
          <tbody>{(data as any[]).map((r) => (
            <tr key={r.entitlement_id}>
              <td className="nowrap">{fmtDateTime(r.starts_at, s.timezone)}</td><td>{r.guest_name}</td>
              <td>{r.title}<div className="small muted">{r.detail}{r.meta?.table_label ? ` · Table ${r.meta.table_label}` : ''}</div>
                {r.meta?.early_checkin_guaranteed === true && <div className="notice warn small">
                  Guaranteed early check-in — prepare room {r.meta.room_number} by {fmtDateTime(String(r.meta.early_checkin_at), s.timezone)} after dining.
                </div>}
              </td>
              <td>{r.adults}A {r.children > 0 && `${r.children}C`}</td><td>{r.reference}</td>
              <td>{r.checked_in_at ? <Pill value="checked_in" label="checked in" /> : <Pill value={r.status} />}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  )
}
