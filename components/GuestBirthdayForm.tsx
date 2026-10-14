'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { updateGuestBirthday } from '@/app/(ops)/admin/guests/actions'

export default function GuestBirthdayForm({ guestId, birthday }: { guestId: string; birthday: string | null }) {
  const router = useRouter()
  const [value, setValue] = useState(birthday ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => setValue(birthday ?? ''), [birthday])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      const result = await updateGuestBirthday(guestId, value)
      setMessage(result.message)
      if (result.ok) router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update this guest’s birthday.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack" style={{ minWidth: '180px', gap: '.35rem' }} onSubmit={save}>
      <label className="small">
        <span className="concierge-sr-only">Guest birthday</span>
        <input
          type="date"
          value={value}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(event) => setValue(event.target.value)}
          aria-label="Guest birthday"
        />
      </label>
      <div className="row">
        <button className="btn secondary sm" type="submit" disabled={busy}>
          {busy ? <span className="spinner" /> : 'Save birthday'}
        </button>
        {value && <button className="btn sm" type="button" onClick={() => setValue('')} disabled={busy}>Clear</button>}
      </div>
      {message && <span className="small" role={message.includes('Could not') || message.startsWith('Enter') ? 'alert' : 'status'}>{message}</span>}
    </form>
  )
}
