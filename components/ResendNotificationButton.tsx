'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface ResendState {
  tone: 'ok' | 'bad'
  text: string
}

export default function ResendNotificationButton({ notificationId, toEmail }: {
  notificationId: string
  toEmail: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<ResendState | null>(null)

  async function resend() {
    setBusy(true)
    setState(null)
    try {
      const response = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resendNotificationId: notificationId }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        const message = result.error === 'forbidden'
          ? 'Only active administrators can resend notifications.'
          : result.error === 'notification_not_resendable'
            ? 'This notification cannot be resent.'
            : 'The email could not be resent.'
        setState({ tone: 'bad', text: message })
        return
      }

      if (result.status === 'sent') {
        setState({ tone: 'ok', text: `Email sent to ${toEmail}.` })
      } else if (result.status === 'not_configured') {
        setState({ tone: 'bad', text: 'Email is not configured, so the message was not sent.' })
      } else {
        setState({ tone: 'bad', text: `Email was not sent${result.error ? `: ${result.error}` : '.'}` })
      }
      router.refresh()
    } catch {
      setState({ tone: 'bad', text: 'The resend request failed. Please try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack" style={{ gap: '.35rem', alignItems: 'start' }}>
      <button className="btn sm secondary" type="button" onClick={resend} disabled={busy}>
        {busy ? 'Sending…' : 'Resend'}
      </button>
      {state && <span className={`small ${state.tone === 'ok' ? 'muted' : ''}`} role={state.tone === 'bad' ? 'alert' : 'status'}>{state.text}</span>}
    </div>
  )
}
