'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { friendlyError, money, fmtDateTime, type Settings } from '@/lib/format'
import { receiptFileError, uploadReceiptFile } from '@/lib/receipt-upload'
import { ReceiptFilePicker } from '@/components/ReceiptFilePicker'
import {
  CardDetailsFields,
  DetailsFields,
  PaymentMethodPicker,
  cardDetailsValid,
  detailsValid,
  type CardDetails,
  type Details,
} from '@/components/Checkout'
import { Countdown } from '@/components/CartView'
import type { Ent } from '@/lib/data'

const STEPS = ['Guest details', 'Payment', 'Review & confirm']

export default function CheckoutFlow({ items, settings, profile, devAllowed, cardGatewayAvailable, isLoggedIn }: {
  items: Ent[]; settings: Settings; profile: { first_name: string; last_name: string; email: string; phone: string; notes: string }; devAllowed: boolean; cardGatewayAvailable: boolean; isLoggedIn: boolean
}) {
  const router = useRouter()
  const [d, setD] = useState<Details>(profile)
  const [card, setCard] = useState<CardDetails>({ number: '', expiry: '', cvc: '' })
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [receiptFileErrorMessage, setReceiptFileErrorMessage] = useState<string | null>(null)
  const [step, setStep] = useState(() => detailsValid(profile) ? 1 : 0)
  const [showErr, setShowErr] = useState(false)
  const [method, setMethod] = useState(
    settings.payment_methods.cash_on_arrival?.enabled
      ? 'cash_on_arrival'
      : settings.payment_methods.bank_transfer?.enabled
        ? 'bank_transfer'
        : settings.payment_methods.card?.enabled && cardGatewayAvailable ? 'card' : '',
  )
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [completedReservationId, setCompletedReservationId] = useState<string | null>(null)

  useEffect(() => {
    const expiries = items.flatMap((item) => item.status === 'held' && item.hold_expires_at
      ? [Date.parse(item.hold_expires_at)]
      : [])
    const nextExpiry = expiries.length ? Math.min(...expiries) : null
    if (nextExpiry === null) return
    const timeout = window.setTimeout(() => router.refresh(), Math.max(0, nextExpiry - Date.now()))
    return () => window.clearTimeout(timeout)
  }, [items, router])

  const subtotal = items.reduce((t, i) => t + Number(i.total), 0)
  const tax = (subtotal * Number(settings.tax_rate)) / 100
  const fee = (subtotal * Number(settings.service_fee_rate)) / 100
  const total = subtotal + tax + fee

  function selectReceiptFile(file: File | null) {
    if (!file) {
      setReceiptFile(null)
      setReceiptFileErrorMessage(null)
      return
    }
    const validationError = receiptFileError(file)
    setReceiptFileErrorMessage(validationError)
    setReceiptFile(validationError ? null : file)
    if (!validationError) setErr(null)
  }

  async function confirm() {
    if (method === 'bank_transfer' && (!receiptFile || receiptFileErrorMessage)) {
      const message = receiptFileErrorMessage || 'A bank-transfer receipt or screenshot is required.'
      setReceiptFileErrorMessage(message)
      setStep(1)
      return
    }
    if (method === 'card' && !cardDetailsValid(card)) {
      setErr('Enter a valid card number, expiry date, and CVC.')
      return
    }
    setBusy(true); setErr(null)
    const supabase = createClient()
    let checkout: { reservation_id: string; payment_status?: string } | null = null
    if (method === 'card') {
      try {
        const response = await fetch('/api/payments/test-card', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firstName: d.first_name,
            lastName: d.last_name,
            email: d.email,
            phone: d.phone,
            notes: d.notes,
            card,
          }),
        })
        const result = await response.json() as {
          checkout?: { reservation_id: string; payment_status?: string }
          error?: string
          message?: string
        }
        if (!response.ok) {
          setBusy(false)
          return setErr(result.error === 'card_declined'
            ? 'The card was declined. Check your details and try again.'
            : result.message || (result.error === 'test_card_gateway_unavailable'
              ? 'Credit card checkout is unavailable right now. Choose another payment method or try again later.'
              : 'The card payment could not be completed. No booking was confirmed.'))
        }
        checkout = result.checkout ?? null
      } catch (requestError) {
        console.error('Test-card checkout request failed:', requestError)
        setBusy(false)
        return setErr('The card payment could not be completed. No booking was confirmed. Please try again.')
      }
    } else {
      const { data, error } = await supabase.rpc('checkout_cart', {
        p_first: d.first_name,
        p_last: d.last_name,
        p_email: d.email,
        p_phone: d.phone,
        p_method: method,
        p_notes: d.notes,
      })
      if (error) { setBusy(false); return setErr(friendlyError(error)) }
      checkout = data
    }
    if (!checkout?.reservation_id) {
      console.error('Checkout returned an incomplete reservation result.')
      setBusy(false)
      return setErr('The booking response was incomplete. Refresh the page and check your reservations before trying again.')
    }
    const reservationId = checkout.reservation_id
    fetch('/api/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservationId, kind: 'confirmation' }) }).catch(() => {})

    const { data: auth, error: authError } = await supabase.auth.getUser()
    let receiptUploadError: string | null = null
    if (method === 'bank_transfer' && receiptFile) {
      if (!auth.user) {
        receiptUploadError = 'Your booking is confirmed, but we could not attach the receipt. Upload it from the reservation page.'
      } else if (checkout.payment_status === 'awaiting_receipt') {
        const { data: payments, error: paymentLookupError } = await supabase.from('payments')
          .select('id')
          .eq('reservation_id', reservationId)
          .eq('method', 'bank_transfer')
          .eq('status', 'awaiting_receipt')
          .order('created_at', { ascending: false })
          .limit(1)
        if (paymentLookupError) {
          console.error('Could not locate the bank-transfer payment after checkout:', paymentLookupError)
          receiptUploadError = 'Your booking is confirmed, but we could not attach the receipt. Upload it from the reservation page.'
        } else if (!payments?.[0]?.id) {
          receiptUploadError = 'Your booking is confirmed, but we could not locate the payment for the receipt. Upload it from the reservation page.'
        } else {
          try {
            receiptUploadError = await uploadReceiptFile(receiptFile, reservationId, payments[0].id, auth.user.id)
            if (receiptUploadError) {
              receiptUploadError = `Your booking is confirmed, but the receipt could not be uploaded: ${receiptUploadError} Upload it from the reservation page.`
            }
          } catch (uploadError) {
            console.error('Bank-transfer receipt upload failed after checkout:', uploadError)
            receiptUploadError = 'Your booking is confirmed, but the receipt could not be uploaded. Upload it from the reservation page.'
          }
        }
      } else if (checkout.payment_status !== 'paid') {
        receiptUploadError = 'Your booking is confirmed, but we could not attach the receipt. Upload it from the reservation page.'
      } else {
        receiptUploadError = null
      }
    }

    let accountSetupError: string | null = null
    if (authError && authError.name !== 'AuthSessionMissingError') {
      console.error('Could not verify the guest session after checkout:', authError)
      accountSetupError = 'Your booking is confirmed, but we could not finish setting up account access. You can still view this booking below.'
    } else if (!auth.user) {
      accountSetupError = 'Your booking is confirmed, but we could not finish setting up account access. You can still view this booking below.'
    } else if (auth.user.is_anonymous) {
      try {
        const response = await fetch('/api/guest-checkout/account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reservationId }),
        })
        if (!response.ok) {
          console.error('Guest account setup failed after checkout:', response.status)
          accountSetupError = 'Your booking is confirmed, but we could not finish setting up account access. You can still view this booking below, and sign in later with the same email to claim it.'
        }
      } catch (setupError) {
        console.error('Guest account setup request failed after checkout:', setupError)
        accountSetupError = 'Your booking is confirmed, but we could not finish setting up account access. You can still view this booking below, and sign in later with the same email to claim it.'
      }
    }

    const completionErrors = [receiptUploadError, accountSetupError].filter((message): message is string => Boolean(message))
    if (completionErrors.length > 0) {
      setCompletedReservationId(reservationId)
      setErr(completionErrors.join(' '))
      setBusy(false)
      return
    }
    router.push(`/reservations/${reservationId}?new=1`)
  }

  return (
    <div className="stack">
      <ol className="steps steps-text-only">{STEPS.map((s, i) => <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>{s}</li>)}</ol>
      {err && <div className="notice bad" role="alert">
        {err}{' '}
        {completedReservationId
          ? <Link href={`/reservations/${completedReservationId}`} prefetch={false}>View reservation and QR pass</Link>
          : <Link href="/book/cart" prefetch={false}>Back to cart</Link>}
      </div>}
      {step === 0 && (
        <div className="card stack">
          <h2>Who is booking?</h2>
          <DetailsFields value={d} onChange={setD} showErrors={showErr} isLoggedIn={isLoggedIn} />
          <div className="row between"><Link className="btn secondary" href="/book/cart" prefetch={false}>← Cart</Link><button className="btn" onClick={() => (detailsValid(d) ? (setShowErr(false), setStep(1)) : setShowErr(true))}>Continue</button></div>
        </div>
      )}
      {step === 1 && (
        <div className="card stack">
          <h2>Payment method</h2>
          <div className="payment-total" aria-label="Total due">
            <span className="small muted">Total due</span>
            <strong>{money(total, settings.currency)}</strong>
          </div>
          <PaymentMethodPicker settings={settings} devAllowed={devAllowed} cardGatewayAvailable={cardGatewayAvailable} value={method} onChange={setMethod}
            bankTransferInstructions={settings.payment_methods.bank_transfer?.instructions}
            bankTransferContent={
              <div className="stack">
                <ReceiptFilePicker
                  label="Transfer receipt or screenshot"
                  file={receiptFile}
                  required
                  error={receiptFileErrorMessage}
                  onFileChange={selectReceiptFile}
                />
              </div>
            }
            cardContent={cardGatewayAvailable ? <CardDetailsFields value={card} onChange={setCard} /> : undefined}
          />
          <div className="row between"><button className="btn secondary" onClick={() => setStep(0)}>Back</button><button className="btn" disabled={!method} onClick={() => {
            if (method === 'bank_transfer' && !receiptFile) {
              const message = receiptFileErrorMessage || 'A bank-transfer receipt or screenshot is required.'
              setReceiptFileErrorMessage(message)
              return
            }
            setErr(null)
            setStep(2)
          }}>Continue</button></div>
        </div>
      )}
      {step === 2 && (
        <div className="card stack">
          <h2>Review</h2>
          {items.map((i) => (
            <div key={i.id} className="stack small">
              <div className="row between">
                <span><strong>{i.title}</strong> · {fmtDateTime(i.starts_at, settings.timezone)} · {i.adults}A{i.children > 0 && ` ${i.children}C`} <Countdown until={i.hold_expires_at} /></span>
                <span>{money(i.total, settings.currency)}</span>
              </div>
              {i.service_type === 'hotel' && Array.isArray(i.meta?.room_upgrades) && i.meta.room_upgrades.map((upgrade: any, index: number) => (
                <div key={`${upgrade.id ?? upgrade.name}:${index}`} className="muted">
                  {upgrade.name} · {money(upgrade.total, settings.currency)}{upgrade.details && ` · ${upgrade.details}`}
                </div>
              ))}
            </div>
          ))}
          <table className="totals small"><tbody>
            <tr><td>Items</td><td className="right">{money(subtotal, settings.currency)}</td></tr>
            {tax > 0 && <tr><td>Taxes</td><td className="right">{money(tax, settings.currency)}</td></tr>}
            {fee > 0 && <tr><td>Service fee</td><td className="right">{money(fee, settings.currency)}</td></tr>}
            <tr><td>Total</td><td className="right">{money(total, settings.currency)}</td></tr>
          </tbody></table>
          <div className="small">Guest: {d.first_name} {d.last_name} · {d.email} · {d.phone}</div>
          <div className="small">Payment: {method === 'card' ? 'Credit Card' : method === 'cash_on_arrival' ? 'Cash/Card on arrival' : settings.payment_methods[method]?.label || method.replaceAll('_', ' ')}</div>
          <details className="small"><summary>Cancellation & booking policy</summary><p>{settings.cancellation_policy}</p><p>{settings.booking_policy}</p></details>
          <div className="row between"><button className="btn secondary" disabled={busy} onClick={() => setStep(1)}>Back</button><button className="btn accent" disabled={busy} onClick={confirm}>{busy ? <span className="spinner" /> : 'Confirm booking'}</button></div>
        </div>
      )}
    </div>
  )
}
