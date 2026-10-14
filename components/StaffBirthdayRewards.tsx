'use client'

import { FormEvent, useState, useTransition } from 'react'
import { findBirthdayGuest, redeemBirthdayGift, type BirthdayGuest } from '@/app/(ops)/staff/birthday/actions'

export default function StaffBirthdayRewards() {
  const [email, setEmail] = useState('')
  const [guest, setGuest] = useState<BirthdayGuest | null>(null)
  const [message, setMessage] = useState('')
  const [success, setSuccess] = useState(false)
  const [pending, startTransition] = useTransition()

  function submitLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setGuest(null)
    setMessage('')
    startTransition(async () => {
      const result = await findBirthdayGuest(email)
      setMessage(result.message)
      setGuest(result.guest ?? null)
      setSuccess(result.ok)
    })
  }

  function redeemGift() {
    if (!guest) return
    setMessage('')
    startTransition(async () => {
      const result = await redeemBirthdayGift(guest.customer_id)
      setMessage(result.message)
      setSuccess(result.ok)
      if (result.ok) setGuest({ ...guest, already_claimed: true })
    })
  }

  return (
    <div className="stack">
      <section className="card flat">
        <h2>Find a guest</h2>
        <p className="muted">Search by the guest’s exact email address. Confirm their birthday before redeeming the annual gift.</p>
        <form className="row" onSubmit={submitLookup}>
          <label className="field" style={{ flex: '1 1 280px' }}>
            Guest email
            <input
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <button className="btn" type="submit" disabled={pending}>
            {pending ? 'Searching…' : 'Find guest'}
          </button>
        </form>
      </section>

      {message && <p className={`notice ${success ? 'ok' : 'warn'}`} role="status">{message}</p>}

      {guest && (
        <section className="card flat stack" aria-labelledby="birthday-guest-name">
          <div>
            <h2 id="birthday-guest-name">{[guest.first_name, guest.last_name].filter(Boolean).join(' ') || 'Guest account'}</h2>
            <p className="muted">
              Birthday on file: {guest.birthday ? formatBirthday(guest.birthday) : 'Not recorded'}
            </p>
          </div>
          {guest.already_claimed ? (
            <p className="notice info">This year’s birthday gift has already been claimed.</p>
          ) : guest.birthday_today ? (
            <>
              <p className="notice ok">Birthday verified for today. The guest is eligible for 100 points.</p>
              <button className="btn accent" type="button" disabled={pending} onClick={redeemGift}>
                {pending ? 'Redeeming…' : 'Redeem 100-point birthday gift'}
              </button>
            </>
          ) : (
            <p className="notice warn">The birthday on file does not match today. No points can be redeemed yet.</p>
          )}
        </section>
      )}
    </div>
  )
}

function formatBirthday(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day)))
}
