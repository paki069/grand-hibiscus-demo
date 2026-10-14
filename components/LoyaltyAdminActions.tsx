'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { friendlyError } from '@/lib/format'

interface CustomerOption {
  id: string
  name: string
  email: string | null
  role: 'customer' | 'admin'
}

interface RoomOption {
  id: string
  name: string
  loyalty_free_night_points: number
}

interface IssuedCoupon {
  coupon_code: string
  room_name: string
  points_value: number
}

function customerOptionLabel(customer: CustomerOption) {
  const role = customer.role === 'admin' ? 'Admin' : 'Guest'
  return `${customer.name}${customer.email ? ` · ${customer.email}` : ''} · ${role}`
}

export function LoyaltyPointAdjustment({ customerId }: { customerId: string }) {
  const router = useRouter()
  const [points, setPoints] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  async function addPoints(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setMessage(null)
    const { data, error } = await createClient().rpc('admin_adjust_loyalty_points', {
      p_customer: customerId,
      p_points: Number(points),
      p_reason: reason,
    })
    setBusy(false)
    if (error) {
      setMessage({ tone: 'bad', text: friendlyError(error) })
      return
    }
    setMessage({ tone: 'ok', text: `Points added. New balance: ${Number(data ?? 0).toLocaleString()}.` })
    setPoints('')
    setReason('')
    router.refresh()
  }

  return (
    <form className="stack" onSubmit={addPoints}>
      <div className="row" style={{ alignItems: 'end' }}>
        <label className="field">Points to add
          <input type="number" min={1} max={100000} step={1} required value={points}
            onChange={(event) => setPoints(event.target.value)} disabled={busy} />
        </label>
        <label className="field">Reason
          <input type="text" maxLength={250} required value={reason}
            onChange={(event) => setReason(event.target.value)} disabled={busy} />
        </label>
        <button className="btn sm" disabled={busy}>{busy ? <span className="spinner" /> : 'Add points'}</button>
      </div>
      {message && <span className={`small ${message.tone === 'bad' ? 'error' : 'muted'}`} role={message.tone === 'bad' ? 'alert' : 'status'}>{message.text}</span>}
    </form>
  )
}

export function LoyaltyCouponForm({ customers, roomTypes }: {
  customers: CustomerOption[]
  roomTypes: RoomOption[]
}) {
  const router = useRouter()
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? '')
  const [customerSearch, setCustomerSearch] = useState(customers[0] ? customerOptionLabel(customers[0]) : '')
  const [roomTypeId, setRoomTypeId] = useState(roomTypes[0]?.id ?? '')
  const [quantity, setQuantity] = useState(1)
  const [busy, setBusy] = useState(false)
  const [issued, setIssued] = useState<IssuedCoupon[]>([])
  const [error, setError] = useState<string | null>(null)

  async function createCoupons(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    setIssued([])
    const { data, error: issueError } = await createClient().rpc('admin_issue_loyalty_coupons', {
      p_customer: customerId,
      p_room_type: roomTypeId,
      p_quantity: quantity,
    })
    setBusy(false)
    if (issueError) {
      setError(friendlyError(issueError))
      return
    }
    setIssued((data ?? []) as IssuedCoupon[])
    router.refresh()
  }

  return (
    <section className="card stack">
      <div>
        <h2 style={{ margin: 0 }}>Create complimentary free-night coupons</h2>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Coupons are assigned to the selected guest or admin account and room type. Creating them does not deduct loyalty points.
        </p>
      </div>
      {customers.length === 0 || roomTypes.length === 0
        ? <p className="small muted">Add a guest or admin account and an active room type before creating coupons.</p>
        : <form className="form-grid" style={{ alignItems: 'end' }} onSubmit={createCoupons}>
          <label className="field">Guest or admin
            <input
              type="search"
              list="loyalty-coupon-accounts"
              value={customerSearch}
              onChange={(event) => {
                const value = event.target.value
                setCustomerSearch(value)
                setCustomerId(customers.find((customer) => customerOptionLabel(customer) === value)?.id ?? '')
              }}
              placeholder="Search by name or email"
              autoComplete="off"
              disabled={busy}
              required
            />
            <datalist id="loyalty-coupon-accounts">
              {customers.map((customer) => <option key={customer.id} value={customerOptionLabel(customer)} />)}
            </datalist>
          </label>
          <label className="field">Room type
            <select value={roomTypeId} onChange={(event) => setRoomTypeId(event.target.value)} disabled={busy} required>
              {roomTypes.map((room) => <option key={room.id} value={room.id}>
                {room.name} · {room.loyalty_free_night_points.toLocaleString()} point value
              </option>)}
            </select>
          </label>
          <label className="field">Number of coupons / nights
            <input type="number" min={1} max={20} step={1} value={quantity}
              onChange={(event) => setQuantity(Math.max(1, Math.min(20, Number(event.target.value) || 1)))}
              disabled={busy} required />
          </label>
          <button className="btn" disabled={busy || !customerId || !roomTypeId}>
            {busy ? <span className="spinner" /> : 'Create coupons'}
          </button>
        </form>}
      {error && <div className="notice bad" role="alert">{error}</div>}
      {issued.length > 0 && <div className="notice ok" role="status">
        Save these generated codes. They are also listed in the coupon tracker.
        {issued.map((coupon) => <strong key={coupon.coupon_code} style={{ display: 'block' }}>
          {coupon.coupon_code} · {coupon.room_name}
        </strong>)}
      </div>}
    </section>
  )
}
