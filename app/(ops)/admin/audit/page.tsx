import { createClient } from '@/lib/supabase/server'
import { getSettings } from '@/lib/data'
import { fmtDateTime } from '@/lib/format'
import { Empty } from '@/components/ui'
import AdminLogDeleteButton from '@/components/AdminLogDeleteButton'
import AuditLogDetailsButton from '@/components/AuditLogDetailsButton'

export default async function Audit({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
  const { action } = await searchParams
  const supabase = await createClient()
  const s = await getSettings()
  let q = supabase.from('audit_log').select('id, at, actor_id, action, entity_type, entity_id, details').order('at', { ascending: false }).limit(300)
  if (action) q = q.ilike('action', `%${action.replace(/[%,]/g, '')}%`)
  const { data } = await q
  const actorIds = [...new Set((data ?? []).map((a) => a.actor_id).filter(Boolean))]
  const { data: actors } = actorIds.length ? await supabase.from('profiles').select('id, email').in('id', actorIds) : { data: [] }
  const email = (id: string | null) => (actors ?? []).find((a) => a.id === id)?.email ?? (id ? id.slice(0, 8) : 'system')
  return (
    <div className="stack">
      <div className="row between">
        <h1 style={{ margin: 0 }}>Audit log</h1>
        <AdminLogDeleteButton resource="audit_log" />
      </div>
      <form className="row" style={{ alignItems: 'end' }}><label className="field">Action contains<input name="action" defaultValue={action} placeholder="checkin, reservation, …" /></label><button className="btn secondary">Filter</button></form>
      {(data ?? []).length === 0 ? <Empty>No entries.</Empty> : (
        <div className="table-wrap"><table className="data"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Details</th><th>Actions</th></tr></thead>
          <tbody>{(data ?? []).map((a) => (
            <tr key={a.id}>
              <td className="nowrap">{fmtDateTime(a.at, s.timezone)}</td>
              <td>{email(a.actor_id)}</td>
              <td>{a.action}</td>
              <td className="small">{a.entity_type} {a.entity_id?.slice(0, 8)}</td>
              <td><AuditLogDetailsButton details={a.details} /></td>
              <td><AdminLogDeleteButton resource="audit_log" id={a.id} /></td>
            </tr>
          ))}</tbody></table></div>
      )}
    </div>
  )
}
