'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { deleteGuestAccount } from '@/app/(ops)/admin/guests/actions'

export default function GuestDeleteButton({ guestId, guestName }: { guestId: string; guestName: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function removeGuest() {
    if (!window.confirm(`Permanently delete ${guestName} and all linked bookings, check-ins, payment and refund history, loyalty points and coupons, receipt files, notifications, and audit details? This cannot be undone.`)) return
    setBusy(true)
    setMessage(null)
    try {
      const result = await deleteGuestAccount(guestId)
      setMessage(result.message)
      if (result.refresh) router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not delete this guest.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack" style={{ alignItems: 'start' }}>
      <button className="btn danger sm" type="button" onClick={removeGuest} disabled={busy}>
        {busy ? <span className="spinner" /> : 'Delete guest'}
      </button>
      {message && <span className="small" role="alert">{message}</span>}
    </div>
  )
}
