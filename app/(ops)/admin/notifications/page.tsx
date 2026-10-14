import { createClient } from '@/lib/supabase/server'
import { getSettings } from '@/lib/data'
import { emailConfigured } from '@/lib/email'
import { fmtDateTime } from '@/lib/format'
import { Empty, Notice, Pill } from '@/components/ui'
import ResendNotificationButton from '@/components/ResendNotificationButton'
import AdminLogDeleteButton from '@/components/AdminLogDeleteButton'

export default async function Notifications() {
  const supabase = await createClient()
  const s = await getSettings()
  const { data } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(200)
  return (
    <div className="stack">
      <div className="row between">
        <h1 style={{ margin: 0 }}>Notifications outbox</h1>
        <AdminLogDeleteButton resource="notifications" />
      </div>
      {emailConfigured()
        ? <Notice tone="ok">Email provider is configured.</Notice>
        : <Notice tone="warn">No SMTP email provider is configured (set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and EMAIL_FROM). SMTP_USER is the sender address; EMAIL_FROM is its display name. Messages below are logged as “not configured” and were <strong>not</strong> sent.</Notice>}
      {(data ?? []).length === 0 ? <Empty>No messages yet.</Empty> : (
        <div className="table-wrap"><table className="data"><thead><tr><th>When</th><th>Kind</th><th>To</th><th>Subject</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>{(data ?? []).map((n) => (
            <tr key={n.id}>
              <td className="nowrap">{fmtDateTime(n.created_at, s.timezone)}</td>
              <td>{n.kind.replaceAll('_', ' ')}</td>
              <td>{n.to_email}</td>
              <td>{n.subject}</td>
              <td><Pill value={n.status} />{n.error && <div className="small muted">{n.error}</div>}</td>
              <td><div className="row">
                {n.reservation_id && ['confirmation', 'confirmation_resend', 'cancellation', 'cancellation_resend'].includes(n.kind)
                  ? <ResendNotificationButton notificationId={n.id} toEmail={n.to_email} />
                  : null}
                <AdminLogDeleteButton resource="notifications" id={n.id} />
              </div></td>
            </tr>
          ))}</tbody></table></div>
      )}
    </div>
  )
}
