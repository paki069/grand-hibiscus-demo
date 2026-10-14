'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { friendlyError } from '@/lib/format'

export interface LoyaltyRules {
  room_night_points: number
  room_addon_points: number
  spa_spend_block_amount: number
  spa_spend_block_points: number
  gym_points_per_guest_day: number
  tour_booking_points: number
}

export default function LoyaltySettingsForm({ initial }: { initial: LoyaltyRules }) {
  const router = useRouter()
  const [rules, setRules] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const set = <K extends keyof LoyaltyRules>(key: K, value: LoyaltyRules[K]) => setRules((current) => ({ ...current, [key]: value }))
  const numberInput = (key: keyof LoyaltyRules) => (event: React.ChangeEvent<HTMLInputElement>) => set(key, Number(event.target.value))

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    if (Object.entries(rules).some(([key, value]) => key === 'spa_spend_block_amount' ? !Number.isFinite(value) || value <= 0 : !Number.isInteger(value) || value < 0)) {
      setBusy(false)
      setMessage({ tone: 'bad', text: 'Point values must be whole numbers of zero or more, and the spa spend block must be greater than zero.' })
      return
    }
    const { error } = await createClient().from('loyalty_settings').update({ ...rules, updated_at: new Date().toISOString() }).eq('id', 1)
    setBusy(false)
    if (error) {
      setMessage({ tone: 'bad', text: friendlyError(error) })
      return
    }
    setMessage({ tone: 'ok', text: 'Loyalty rules saved.' })
    router.refresh()
  }

  return (
    <form className="stack" onSubmit={save} style={{ maxWidth: 760 }}>
      {message && <div className={`notice ${message.tone}`} role={message.tone === 'bad' ? 'alert' : 'status'}>{message.text}</div>}
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Points earned</h2>
        <p className="small muted" style={{ margin: 0 }}>Points are awarded when a booking is confirmed. Cancellations and full refunds reverse points earned from that booking.</p>
        <div className="form-grid">
          <label className="field">Per room night<input type="number" min={0} step={1} value={rules.room_night_points} onChange={numberInput('room_night_points')} required /></label>
          <label className="field">Per room add-on<input type="number" min={0} step={1} value={rules.room_addon_points} onChange={numberInput('room_addon_points')} required /></label>
          <label className="field">Spa spend block amount<input type="number" min={0.01} step="0.01" value={rules.spa_spend_block_amount} onChange={numberInput('spa_spend_block_amount')} required /></label>
          <label className="field">Points per spa block<input type="number" min={0} step={1} value={rules.spa_spend_block_points} onChange={numberInput('spa_spend_block_points')} required /></label>
          <label className="field">Gym points per guest, per day<input type="number" min={0} step={1} value={rules.gym_points_per_guest_day} onChange={numberInput('gym_points_per_guest_day')} required /></label>
          <label className="field">Points per tour booking<input type="number" min={0} step={1} value={rules.tour_booking_points} onChange={numberInput('tour_booking_points')} required /></label>
        </div>
      </div>
      <button className="btn" disabled={busy}>{busy ? <span className="spinner" /> : 'Save loyalty rules'}</button>
    </form>
  )
}
