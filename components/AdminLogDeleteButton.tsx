'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export type AdminLogResource = 'notifications' | 'audit_log'

export default function AdminLogDeleteButton({ resource, id }: {
  resource: AdminLogResource
  id?: string | number
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const clearingAll = id === undefined
  const resourceName = resource === 'notifications' ? 'notifications' : 'audit log entries'

  async function remove() {
    const confirmation = clearingAll
      ? `Clear all ${resourceName}? This cannot be undone.`
      : `Delete this ${resource === 'notifications' ? 'notification' : 'audit log entry'}? This cannot be undone.`
    if (!window.confirm(confirmation)) return

    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/admin/logs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clearingAll ? { resource, clearAll: true } : { resource, id }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        setMessage(result.error === 'forbidden'
          ? 'Only active administrators can delete logs.'
          : 'The log entries could not be deleted.')
        return
      }
      setMessage(clearingAll ? `Cleared ${result.deleted} ${resourceName}.` : 'Deleted.')
      router.refresh()
    } catch {
      setMessage('The delete request failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack" style={{ gap: '.35rem', alignItems: 'start' }}>
      <button className={`btn ${clearingAll ? '' : 'sm '}danger`} type="button" onClick={remove} disabled={busy}>
        {busy ? 'Deleting…' : clearingAll ? 'Clear all' : 'Delete'}
      </button>
      {message && <span className="small muted" role="status">{message}</span>}
    </div>
  )
}
