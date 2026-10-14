'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { fmtDate, friendlyError } from '@/lib/format'

interface RoomTypeReward { id: string; name: string; loyalty_free_night_points: number }
interface LedgerEntry { id: string; points: number; description: string; created_at: string }
interface Coupon { id: string; code: string; room_type_id: string; points_cost: number; status: string; created_at: string }
interface RedeemedCoupon { coupon_code: string; room_name: string; points_spent: number }

export default function LoyaltyWallet({ balance, ledger, coupons, roomTypes, showActivity = true }: {
  balance: number
  ledger: LedgerEntry[]
  coupons: Coupon[]
  roomTypes: RoomTypeReward[]
  showActivity?: boolean
}) {
  const router = useRouter()
  const [roomTypeId, setRoomTypeId] = useState(roomTypes[0]?.id ?? '')
  const [quantity, setQuantity] = useState(1)
  const [redeemed, setRedeemed] = useState<RedeemedCoupon[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const selectedRoom = roomTypes.find((room) => room.id === roomTypeId)
  const cost = (selectedRoom?.loyalty_free_night_points ?? 0) * quantity

  async function redeem() {
    setBusy(true)
    setMessage(null)
    setRedeemed([])
    const { data, error } = await createClient().rpc('redeem_loyalty_points', {
      p_room_type: roomTypeId,
      p_quantity: quantity,
    })
    setBusy(false)
    if (error) {
      setMessage({ tone: 'bad', text: friendlyError(error) })
      return
    }
    setRedeemed((data ?? []) as RedeemedCoupon[])
    setMessage({ tone: 'ok', text: `Created ${(data ?? []).length} free-night coupon${(data ?? []).length === 1 ? '' : 's'}.` })
    router.refresh()
  }

  return (
    <section className="card stack" aria-labelledby="loyalty-title">
      <div className="row between">
        <div><h2 id="loyalty-title" style={{ margin: 0 }}>Redeem points</h2><p className="small muted" style={{ marginBottom: 0 }}>Use your balance for room-specific free-night coupons.</p></div>
        <strong className="pill ok">{balance.toLocaleString()} points</strong>
      </div>
      {message && <div className={`notice ${message.tone}`} role={message.tone === 'bad' ? 'alert' : 'status'}>{message.text}</div>}
      {redeemed.length > 0 && <div className="notice info small">Save these codes and add them in your cart before payment: {redeemed.map((coupon) => <span key={coupon.coupon_code} style={{ display: 'block' }}><strong>{coupon.coupon_code}</strong> · {coupon.room_name} · {coupon.points_spent} points</span>)}</div>}
      <div className="stack">
        <h3 style={{ margin: 0 }}>Redeem points</h3>
        {roomTypes.length === 0 ? <p className="small muted">No room rewards are available right now.</p> : (
          <div className="form-grid" style={{ alignItems: 'end' }}>
            <label className="field">Room type
              <select value={roomTypeId} onChange={(event) => setRoomTypeId(event.target.value)}>
                {roomTypes.map((room) => <option key={room.id} value={room.id}>{room.name} · {room.loyalty_free_night_points} points/night</option>)}
              </select>
            </label>
            <label className="field">Number of free nights
              <input type="number" min={1} max={20} step={1} value={quantity} onChange={(event) => setQuantity(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} />
            </label>
            <button className="btn" type="button" disabled={busy || !selectedRoom || balance < cost} onClick={redeem}>
              {busy ? <span className="spinner" /> : `Redeem ${cost.toLocaleString()} points`}
            </button>
          </div>
        )}
      </div>
      <div className="stack">
        <h3 style={{ margin: 0 }}>Your free-night coupons</h3>
        {coupons.filter((coupon) => coupon.status === 'available').length === 0
          ? <p className="small muted" style={{ margin: 0 }}>No available coupons yet.</p>
          : <ul className="stack small" style={{ margin: 0, paddingLeft: '1.25rem' }}>
            {coupons.filter((coupon) => coupon.status === 'available').map((coupon) => {
              const room = roomTypes.find((item) => item.id === coupon.room_type_id)
              return <li key={coupon.id}><strong>{coupon.code}</strong> · {room?.name ?? 'Room type unavailable'} · {coupon.points_cost} points</li>
            })}
          </ul>}
      </div>
      {showActivity && <div className="stack">
        <h3 style={{ margin: 0 }}>Recent points activity</h3>
        {ledger.length === 0
          ? <p className="small muted" style={{ margin: 0 }}>Your points activity will appear here.</p>
          : <div className="table-wrap"><table className="data"><thead><tr><th>Date</th><th>Activity</th><th className="right">Points</th></tr></thead>
            <tbody>{ledger.map((entry) => <tr key={entry.id}><td>{fmtDate(entry.created_at)}</td><td>{entry.description}</td><td className="right">{entry.points > 0 ? '+' : ''}{entry.points}</td></tr>)}</tbody>
          </table></div>}
      </div>}
    </section>
  )
}
