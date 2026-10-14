'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { friendlyError } from '@/lib/format'

export default function BackfillLoyaltyPointsButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function checkBookings() {
    setBusy(true)
    setMessage(null)
    try {
      const { data, error } = await createClient().rpc('backfill_my_loyalty_points')
      if (error) {
        setMessage(friendlyError(error))
        return
      }
      if (data === null) {
        setMessage('The points check did not return a balance. Please try again.')
        return
      }
      setMessage(`Points checked. Your current balance is ${data.toLocaleString()} points.`)
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not check your past bookings for points.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack" style={{ alignItems: 'start' }}>
      <button className="btn secondary" type="button" disabled={busy} onClick={checkBookings}>
        {busy ? <span className="spinner" /> : 'Check past bookings'}
      </button>
      {message && <span className="small" role="status">{message}</span>}
    </div>
  )
}
