'use client'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Settings } from '@/lib/format'
import AuthForm, { type AuthenticatedGuest } from '@/components/AuthForm'

export interface Details { first_name: string; last_name: string; email: string; phone: string; notes: string }
export interface CardDetails { number: string; expiry: string; cvc: string }

function getCardBrand(number: string) {
  if (/^4/.test(number)) return 'VISA'
  if (/^(5[1-5]|2[2-7])/.test(number)) return 'MC'
  if (/^3[47]/.test(number)) return 'AMEX'
  if (/^(6011|65|64[4-9])/.test(number)) return 'DISC'
  return 'CARD'
}

function parseCombinedCardInput(input: string) {
  const digits = input.replace(/\D/g, '')
  const brand = getCardBrand(digits)
  const numberLength = brand === 'AMEX' ? 15 : 16
  const number = digits.slice(0, numberLength)
  const expiry = digits.slice(numberLength, numberLength + 4)
  const cvc = digits.slice(numberLength + 4, numberLength + 8)
  return { brand, numberLength, number, expiry, cvc }
}

function formatCombinedCardInput(value: CardDetails) {
  const number = value.number.replace(/\D/g, '')
  const brand = getCardBrand(number)
  const numberLength = brand === 'AMEX' ? 15 : 16
  const groups = brand === 'AMEX' ? [4, 6, 5] : [4, 4, 4, 4]
  const parts: string[] = []
  let offset = 0
  for (const groupLength of groups) {
    if (offset >= number.length) break
    parts.push(number.slice(offset, offset + groupLength))
    offset += groupLength
  }
  let formatted = parts.join(' ')
  const expiry = value.expiry.replace(/\D/g, '').slice(0, 4)
  const cvc = value.cvc.replace(/\D/g, '').slice(0, 4)
  if (number.length === numberLength && expiry.length > 0) {
    formatted += `  ${expiry.slice(0, 2)}${expiry.length > 2 ? `/${expiry.slice(2)}` : ''}`
  }
  if (expiry.length === 4 && cvc.length > 0) formatted += `  ${cvc}`
  return formatted
}

export const detailsValid = (d: Details) =>
  d.first_name.trim() !== '' && d.last_name.trim() !== '' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email) && d.phone.trim().length >= 5

export const cardDetailsValid = (card: CardDetails) =>
  card.number.replace(/\D/g, '').length >= 12
  && card.number.replace(/\D/g, '').length <= 19
  && [4, 6].includes(card.expiry.replace(/\D/g, '').length)
  && [3, 4].includes(card.cvc.replace(/\D/g, '').length)

export function CardDetailsFields({ value, onChange }: {
  value: CardDetails; onChange: (card: CardDetails) => void
}) {
  const number = value.number.replace(/\D/g, '')
  const brand = getCardBrand(number)
  const numberLength = brand === 'AMEX' ? 15 : 16
  const stage = number.length < numberLength ? 1 : value.expiry.replace(/\D/g, '').length < 4 ? 2 : 3
  const expiryDigits = value.expiry.replace(/\D/g, '')
  const expiryMonth = expiryDigits.length >= 2 ? Number(expiryDigits.slice(0, 2)) : null
  const expiryError = expiryMonth !== null && (expiryMonth < 1 || expiryMonth > 12)

  return (
    <div className="stack">
      <label className="field">Card details
        <span className={`cardfield${expiryError ? ' bad' : ''}`}>
          <span className="card-brand" aria-live="polite">{brand}</span>
          <input
            value={formatCombinedCardInput(value)}
            onChange={(event) => {
              const parsed = parseCombinedCardInput(event.currentTarget.value)
              onChange({
                number: parsed.number,
                expiry: parsed.expiry.length > 2 ? `${parsed.expiry.slice(0, 2)}/${parsed.expiry.slice(2)}` : parsed.expiry,
                cvc: parsed.cvc,
              })
            }}
            autoComplete="cc-number"
            inputMode="numeric"
            maxLength={40}
            placeholder="1234 5678 9012 3456  MM/YY  CVC"
            aria-label="Card number, expiry date and security code"
            aria-invalid={expiryError}
            aria-describedby={expiryError ? 'card-entry-error' : 'card-entry-guide'}
            required
          />
        </span>
      </label>
      <div className="card-guide" id="card-entry-guide" aria-label={`Card entry progress: ${stage === 1 ? 'card number' : stage === 2 ? 'expiry' : 'security code'}`}>
        {[['Card number', 1], ['Expiry', 2], ['CVC', 3]].map(([label, index]) => {
          const currentStage = Number(index)
          const className = currentStage === stage ? 'on' : currentStage < stage ? 'done' : ''
          return <span key={label} className={className}>{label}</span>
        })}
      </div>
      {expiryError && <div className="card-entry-error" id="card-entry-error" role="alert">Expiry month must be 01 to 12.</div>}
    </div>
  )
}

export function DetailsFields({ value, onChange, showErrors, notesLabel = 'Notes for the hotel (optional)', showNotesHelp = true, isLoggedIn }: {
  value: Details; onChange: (d: Details) => void; showErrors: boolean; notesLabel?: string; showNotesHelp?: boolean; isLoggedIn: boolean
}) {
  const [signedIn, setSignedIn] = useState(isLoggedIn)
  const [loginOpen, setLoginOpen] = useState(false)
  const [loginEmail, setLoginEmail] = useState('')
  const [dismissedEmail, setDismissedEmail] = useState('')
  const [lookupMessage, setLookupMessage] = useState('')
  const normalizedEmail = value.email.trim().toLowerCase()
  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)

  useEffect(() => {
    if (isLoggedIn) setSignedIn(true)
  }, [isLoggedIn])

  useEffect(() => {
    if (signedIn || !validEmail || normalizedEmail === dismissedEmail) return
    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/guest-bookings/check-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: normalizedEmail }),
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        if (!response.ok) {
          console.error('Previous booking email check failed:', response.status)
          setLookupMessage('We couldn’t check for a previous booking right now. You can still continue with your booking.')
          return
        }
        const result = await response.json() as { hasPreviousBooking?: unknown }
        if (controller.signal.aborted) return
        if (typeof result.hasPreviousBooking !== 'boolean') {
          console.error('Previous booking email check returned an invalid response.')
          setLookupMessage('We couldn’t check for a previous booking right now. You can still continue with your booking.')
          return
        }
        setLookupMessage('')
        if (result.hasPreviousBooking) {
          setLoginEmail(normalizedEmail)
          setLoginOpen(true)
        }
      } catch (error) {
        if (controller.signal.aborted) return
        console.error('Previous booking email check request failed:', error)
        setLookupMessage('We couldn’t check for a previous booking right now. You can still continue with your booking.')
      }
    }, 550)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [dismissedEmail, normalizedEmail, signedIn, validEmail])

  const set = (k: keyof Details) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (k === 'email') setLookupMessage('')
    onChange({ ...value, [k]: e.target.value })
  }
  const completeLogin = (guest: AuthenticatedGuest) => {
    setSignedIn(true)
    setLoginOpen(false)
    setDismissedEmail(guest.email.toLowerCase())
    onChange({ ...value, ...guest })
  }
  const dismissLogin = () => {
    setLoginOpen(false)
    setDismissedEmail(normalizedEmail)
  }
  const bad = (cond: boolean) => (showErrors && cond ? { borderColor: 'var(--bad)' } : undefined)
  return (
    <>
      <div className="stack">
        <div className="form-grid">
          <label className="field">First name<input value={value.first_name} onChange={set('first_name')} autoComplete="given-name" style={bad(!value.first_name.trim())} required /></label>
          <label className="field">Last name<input value={value.last_name} onChange={set('last_name')} autoComplete="family-name" style={bad(!value.last_name.trim())} required /></label>
          <label className="field">Email<input type="email" value={value.email} onChange={set('email')} autoComplete="email" style={bad(!validEmail)} required /></label>
          <label className="field">Phone<input type="tel" value={value.phone} onChange={set('phone')} autoComplete="tel" style={bad(value.phone.trim().length < 5)} required /></label>
        </div>
        {lookupMessage && <div className="notice warn small" role="status">{lookupMessage}</div>}
        <label className="field">{notesLabel} {showNotesHelp && <span className="help">Please do not include health information.</span>}
          <textarea value={value.notes} onChange={set('notes')} maxLength={1000} />
        </label>
        {showErrors && !detailsValid(value) && <div className="notice bad" role="alert">Please complete all required fields with a valid email and phone number.</div>}
      </div>
      {loginOpen && (
        <div className="modal-back returning-guest-login-back" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) dismissLogin()
        }}>
          <section className="modal stack returning-guest-login" role="dialog" aria-modal="true" aria-labelledby="returning-guest-title">
            <div className="row between">
              <h2 id="returning-guest-title" style={{ margin: 0 }}>Welcome back</h2>
              <button className="btn sm secondary" type="button" onClick={dismissLogin} aria-label="Close sign-in prompt">✕</button>
            </div>
            <p className="small muted">It looks like you’ve booked with us before. Sign in to access your previous bookings. You can continue the new booking afterward.</p>
            <AuthForm next="/" initialEmail={loginEmail} onComplete={completeLogin} />
          </section>
        </div>
      )}
    </>
  )
}

function PaymentMethodIcon({ method }: { method: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {method === 'bank_transfer'
        ? <><path d="M3 9.5 12 4l9 5.5M4.5 10v8M9.5 10v8M14.5 10v8M19.5 10v8M3 20h18" /><path d="M2.5 9.5h19" /></>
        : method === 'cash_on_arrival'
          ? <><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 9.5v.01M18 14.5v.01" /></>
          : method === 'card'
            ? <><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 10h19M6 15h4" /></>
            : <><circle cx="12" cy="12" r="9" /><path d="M12 7v10M8.5 10h7" /></>}
    </svg>
  )
}

function formatBankTransferInstructions(instructions: string) {
  return instructions.trim().replace(
    /\s+(?=(?:Bank name|Account name|Account number|Account type|Branch|Routing number|Sort code|SWIFT(?:\/BIC)?|IBAN)\s*:)/gi,
    '\n',
  )
}

export function PaymentMethodPicker({ settings, devAllowed, cardGatewayAvailable, value, onChange, bankTransferInstructions, bankTransferContent, cardContent }: {
  settings: Settings; devAllowed: boolean; cardGatewayAvailable: boolean; value: string; onChange: (m: string) => void
  bankTransferInstructions?: string; bankTransferContent?: ReactNode; cardContent?: ReactNode
}) {
  const pm = settings.payment_methods
  const opts: { key: string; title: string; desc: string; disabled?: boolean; tag?: string }[] = []
  if (pm.bank_transfer?.enabled) opts.push({ key: 'bank_transfer', title: pm.bank_transfer.label || 'Bank transfer', desc: 'Attach your transfer receipt or screenshot below to submit this booking for review.' })
  if (pm.cash_on_arrival?.enabled) opts.push({ key: 'cash_on_arrival', title: 'Cash/Card on arrival', desc: 'Booking is confirmed now. You pay when you arrive.' })
  if (pm.card?.enabled) opts.push({
    key: 'card',
    title: 'Credit Card',
    desc: cardGatewayAvailable
      ? 'Enter your card details to complete your booking.'
      : 'Credit card payments are unavailable on this server.',
    disabled: !cardGatewayAvailable,
  })
  if (pm.dev_test?.enabled && devAllowed) opts.push({ key: 'dev_test', title: 'Development test payment', tag: 'DEVELOPMENT ONLY', desc: 'Marks the booking as paid for testing. No real money moves. Not available in production.' })
  return (
    <div className="stack payment-method-options" role="radiogroup" aria-label="Payment method">
      {opts.map((o) => (
        <div key={o.key} className={`card flat payment-method-option${value === o.key ? ' is-selected' : ''}${o.disabled ? ' is-disabled' : ''}`}>
          <label className="payment-method-choice">
            <input className="payment-method-radio" type="radio" name="pay" disabled={o.disabled} checked={value === o.key} onChange={() => onChange(o.key)} />
            <span className="payment-method-head">
              <span className="payment-method-icon"><PaymentMethodIcon method={o.key} /></span>
              <span className="payment-method-copy">
                <strong>{o.title} {o.tag && <span className="pill warn">{o.tag}</span>}</strong>
                <span>{o.desc}</span>
              </span>
              <span className="payment-method-tick" aria-hidden="true" />
            </span>
          </label>
          {value === o.key && (o.key === 'bank_transfer' || o.key === 'card') && (
            <div className="payment-method-panel">
              {o.key === 'bank_transfer' && bankTransferInstructions && (
                <div className="notice info small">{formatBankTransferInstructions(bankTransferInstructions)}</div>
              )}
              {o.key === 'bank_transfer' ? bankTransferContent : cardContent}
            </div>
          )}
        </div>
      ))}
      {opts.filter((o) => !o.disabled).length === 0 && <div className="notice warn">No payment method is currently enabled. Please contact the hotel.</div>}
    </div>
  )
}
