'use client'

import { useState, type FormEvent } from 'react'

const ERROR_MESSAGES: Record<string, string> = {
  rate_limited: 'Please wait a minute before sending another message.',
  invalid_submission: 'Please check the form and try again.',
  contact_unavailable: 'The contact service is temporarily unavailable. Please try again later.',
}

export default function ContactForm() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setResult(null)

    const form = event.currentTarget
    const data = new FormData(form)
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.get('name'),
          email: data.get('email'),
          subject: data.get('subject'),
          message: data.get('message'),
          website: data.get('website'),
        }),
      })
      const payload = await response.json() as { status?: string; error?: string }
      if (!response.ok || payload.status !== 'sent') {
        setResult({ ok: false, message: ERROR_MESSAGES[payload.error ?? ''] ?? 'Your message could not be sent. Please try again later.' })
      } else {
        form.reset()
        setResult({ ok: true, message: 'Message sent.' })
      }
    } catch {
      setResult({ ok: false, message: 'We could not reach the contact service. Please check your connection and try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="contact-form" onSubmit={submit}>
      <label className="field">Your name<input name="name" autoComplete="name" maxLength={100} required /></label>
      <label className="field">Email address<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
      <label className="field">Subject<input name="subject" maxLength={140} required /></label>
      <label className="field">Message<textarea name="message" rows={6} maxLength={5000} required /></label>
      <label className="contact-honeypot" aria-hidden="true">
        Leave this field blank
        <input name="website" tabIndex={-1} autoComplete="off" />
      </label>
      {result && <div className={`notice ${result.ok ? 'ok' : 'bad'}`} role={result.ok ? 'status' : 'alert'}>{result.message}</div>}
      <button className="home-button home-button-gold contact-submit" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send message'} <span aria-hidden="true">↗</span></button>
    </form>
  )
}
