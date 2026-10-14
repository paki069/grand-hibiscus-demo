'use client'
import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { friendlyError } from '@/lib/format'
import { approveAdminRegistration, createStaffAccount, deleteStaffAccount, updateStaffAccount, type StaffResult } from '@/app/(ops)/admin/staff/actions'

const AREAS = ['hotel', 'restaurant', 'spa', 'gym', 'events']
export interface StaffRow { id: string; email: string | null; first_name: string; last_name: string; role: string; staff_areas: string[]; active: boolean; admin_approval_pending: boolean }

export default function StaffManager({ rows, me }: { rows: StaffRow[]; me: string }) {
  const router = useRouter()
  const [state, action, pending] = useActionState<StaffResult | null, FormData>(createStaffAccount, null)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [editing, setEditing] = useState<{ id: string; firstName: string; lastName: string; password: string } | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const pendingCount = rows.filter((row) => row.admin_approval_pending).length

  function startEditing(account: StaffRow) {
    setMsg(null)
    setEditing({ id: account.id, firstName: account.first_name, lastName: account.last_name, password: '' })
  }

  async function saveAccount() {
    if (!editing) return
    setMsg(null)
    setSavingId(editing.id)
    try {
      const result = await updateStaffAccount(editing.id, editing.firstName, editing.lastName, editing.password)
      setMsg({ text: result.message, ok: result.ok })
      if (result.refresh) router.refresh()
      if (result.ok) setEditing(null)
    } catch (error) {
      setMsg({ text: error instanceof Error ? error.message : 'Could not update this account.', ok: false })
    } finally {
      setSavingId(null)
    }
  }

  async function patch(id: string, p: Partial<StaffRow>) {
    setMsg(null)
    const { error } = await createClient().from('profiles').update(p).eq('id', id)
    if (error) return setMsg({ text: friendlyError(error), ok: false })
    router.refresh()
  }

  async function approve(id: string) {
    setMsg(null)
    setApprovingId(id)
    try {
      const result = await approveAdminRegistration(id)
      setMsg({ text: result.message, ok: result.ok })
      if (result.refresh) router.refresh()
    } catch (error) {
      setMsg({ text: error instanceof Error ? error.message : 'Could not approve this registration.', ok: false })
    } finally {
      setApprovingId(null)
    }
  }

  async function removeAccount(account: StaffRow) {
    const name = `${account.first_name} ${account.last_name}`.trim() || account.email || 'this account'
    if (!window.confirm(`Permanently delete ${name} and all linked data? This removes the account's reservations, check-ins it performed, payment and refund history, loyalty data, receipt files, and linked audit details. References to this account on other customers' records will be cleared. This cannot be undone.`)) return
    setMsg(null)
    setDeletingId(account.id)
    try {
      const result = await deleteStaffAccount(account.id)
      setMsg({ text: result.message, ok: result.ok })
      if (result.refresh) router.refresh()
    } catch (error) {
      setMsg({ text: error instanceof Error ? error.message : 'Could not delete this account.', ok: false })
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="stack">
      {msg && <div className={`notice ${msg.ok ? 'ok' : 'bad'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <p className="small muted" style={{ margin: 0 }}>{pendingCount} pending admin {pendingCount === 1 ? 'registration' : 'registrations'}.</p>
        <button className="btn secondary sm" type="button" onClick={() => router.refresh()}>Refresh list</button>
      </div>
      <div className="table-wrap"><table className="data">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Areas (staff)</th><th>Active</th><th>Registration</th><th>Actions</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id}>
            <td>{editing?.id === r.id ? <div className="stack">
              <label className="field">First name<input value={editing.firstName} maxLength={100} onChange={(e) => setEditing({ ...editing, firstName: e.target.value })} /></label>
              <label className="field">Last name<input value={editing.lastName} maxLength={100} onChange={(e) => setEditing({ ...editing, lastName: e.target.value })} /></label>
              <label className="field">New password (leave blank to keep current)<input type="password" value={editing.password} minLength={12} autoComplete="new-password" onChange={(e) => setEditing({ ...editing, password: e.target.value })} /></label>
            </div> : <>{r.first_name} {r.last_name}</>}</td><td>{r.email}</td>
            <td><select value={r.role} disabled={r.id === me || r.admin_approval_pending} onChange={(e) => patch(r.id, { role: e.target.value })}><option value="staff">staff</option><option value="admin">admin</option><option value="customer">customer</option></select></td>
            <td>{r.role === 'staff' ? AREAS.map((a) => (
              <label key={a} className="small" style={{ marginRight: '.5rem' }}><input type="checkbox" checked={r.staff_areas.includes(a)} disabled={r.admin_approval_pending} onChange={(e) => patch(r.id, { staff_areas: e.target.checked ? [...r.staff_areas, a] : r.staff_areas.filter((x) => x !== a) })} /> {a}</label>
            )) : <span className="muted small">{r.role === 'admin' ? 'all' : '—'}</span>}</td>
            <td><input type="checkbox" aria-label="Active" checked={r.active} disabled={r.id === me || r.admin_approval_pending} onChange={(e) => patch(r.id, { active: e.target.checked })} /></td>
            <td>{r.admin_approval_pending ? <button className="btn sm" disabled={approvingId !== null} onClick={() => approve(r.id)}>{approvingId === r.id ? 'Approving…' : 'Approve as admin'}</button> : <span className="muted small">—</span>}</td>
            <td>{editing?.id === r.id ? <div className="row">
              <button className="btn sm" type="button" disabled={savingId !== null} onClick={saveAccount}>{savingId === r.id ? 'Saving…' : 'Save'}</button>
              <button className="btn secondary sm" type="button" disabled={savingId !== null} onClick={() => setEditing(null)}>Cancel</button>
            </div> : <div className="row">
              <button className="btn secondary sm" type="button" disabled={savingId !== null || deletingId !== null || approvingId !== null} onClick={() => startEditing(r)}>Edit</button>
              {r.id !== me && <button className="btn danger sm" disabled={deletingId !== null || savingId !== null} onClick={() => removeAccount(r)}>{deletingId === r.id ? 'Deleting…' : 'Delete'}</button>}
            </div>}</td>
          </tr>
        ))}</tbody>
      </table></div>

      <form action={action} className="card stack" style={{ maxWidth: 560 }}>
        <h3 style={{ margin: 0 }}>Create staff account</h3>
        <div className="form-grid">
          <label className="field">First name<input name="first_name" required /></label>
          <label className="field">Last name<input name="last_name" required /></label>
          <label className="field">Email<input name="email" type="email" required /></label>
          <label className="field">Temporary password (12+ chars)<input name="password" type="password" minLength={12} required autoComplete="new-password" /></label>
          <label className="field">Role<select name="role"><option value="staff">Staff</option><option value="admin">Admin</option></select></label>
        </div>
        <div className="row">{AREAS.map((a) => <label key={a} className="small"><input type="checkbox" name="areas" value={a} /> {a}</label>)}</div>
        {state && <div className={`notice ${state.ok ? 'ok' : 'bad'}`} role={state.ok ? 'status' : 'alert'}>{state.message}</div>}
        <div><button className="btn" disabled={pending}>{pending ? <span className="spinner" /> : 'Create account'}</button></div>
      </form>
    </div>
  )
}
