'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const RESEND_DELAY_SECONDS = 60

export interface AuthenticatedGuest {
  first_name: string
  last_name: string
  email: string
  phone: string
}

export default function AuthForm({ next, initialEmail = '', onComplete }: {
  next: string
  initialEmail?: string
  onComplete?: (guest: AuthenticatedGuest) => void
}) {
  const router = useRouter()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [verified, setVerified] = useState(false)
  const [verifiedUserId, setVerifiedUserId] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const resendSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000))

  async function finishSignIn(userId: string) {
    if (onComplete) {
      const supabase = createClient()
      const [profileResult, reservationResult] = await Promise.all([
        supabase.from('profiles').select('first_name,last_name,email,phone').eq('id', userId).maybeSingle(),
        supabase.from('reservations')
          .select('first_name,last_name,email,phone')
          .eq('customer_id', userId)
          .neq('status', 'cart')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])
      if (profileResult.error) {
        setError(`You’re signed in, but we couldn’t load your saved profile details: ${profileResult.error.message}`)
        return
      }
      if (reservationResult.error) {
        setError(`You’re signed in, but we couldn’t load your previous booking details: ${reservationResult.error.message}`)
        return
      }
      const profile = profileResult.data
      const previousBooking = reservationResult.data
      onComplete({
        first_name: profile?.first_name || previousBooking?.first_name || '',
        last_name: profile?.last_name || previousBooking?.last_name || '',
        email: profile?.email || previousBooking?.email || email,
        phone: profile?.phone || previousBooking?.phone || '',
      })
      router.refresh()
      return
    }
    router.replace(next)
    router.refresh()
  }

  async function sendCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setBusy(true)
    const normalizedEmail = email.trim().toLowerCase()
    try {
      const { error: sendError } = await createClient().auth.signInWithOtp({
        email: normalizedEmail,
        options: { shouldCreateUser: true },
      })
      if (sendError) {
        setError(sendError.message)
        return
      }
      setEmail(normalizedEmail)
      setCode('')
      setResendAt(Date.now() + RESEND_DELAY_SECONDS * 1000)
      setStep('code')
      setInfo(`We sent a sign-in code to ${normalizedEmail}.`)
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Unable to send a sign-in code. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function resendCode() {
    if (busy || resendSeconds > 0) return
    setError(null)
    setInfo(null)
    setBusy(true)
    try {
      const { error: sendError } = await createClient().auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      })
      if (sendError) {
        setError(sendError.message)
        return
      }
      setCode('')
      setResendAt(Date.now() + RESEND_DELAY_SECONDS * 1000)
      setInfo(`A new sign-in code was sent to ${email}.`)
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Unable to resend the sign-in code. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function verifyCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setBusy(true)
    try {
      const supabase = createClient()
      const { data: verifiedSession, error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: code.trim(),
        type: 'email',
      })
      if (verifyError) {
        setError(verifyError.message)
        return
      }
      if (!verifiedSession.user) {
        setError('The sign-in code was accepted, but no account session was returned. Please try again.')
        return
      }
      setVerifiedUserId(verifiedSession.user.id)
      setVerified(true)
      const { error: claimError } = await supabase.rpc('claim_guest_reservations')
      if (claimError) {
        console.error('Could not link guest reservations after email verification:', claimError)
        setInfo('You are signed in, but we could not link previous guest bookings. Continue to your account and contact the hotel if a booking is missing.')
        return
      }
      await finishSignIn(verifiedSession.user.id)
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'Unable to verify the sign-in code. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function changeEmail() {
    setStep('email')
    setCode('')
    setError(null)
    setInfo(null)
    setVerified(false)
    setVerifiedUserId(null)
  }

  async function continueAfterVerification() {
    if (!verifiedUserId) {
      setError('Your sign-in session is unavailable. Please request a new code.')
      setVerified(false)
      setStep('email')
      return
    }
    setError(null)
    setBusy(true)
    try {
      await finishSignIn(verifiedUserId)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={step === 'email' ? sendCode : verifyCode} className="card stack auth-form">
      <h1>Sign in</h1>
      {error && <div className="notice bad" role="alert">{error}</div>}
      {info && <div className="notice info" role="status">{info}</div>}
      <div className="auth-form-slider">
        <div className={`auth-form-track${step === 'code' ? ' is-code' : ''}`}>
          <section className="auth-form-page stack" aria-hidden={step !== 'email'}>
            <p className="muted">Enter your email and we’ll send you a one-time sign-in code. Use the same email you gave us at checkout to access your bookings.</p>
            <label className="field">Email
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={step !== 'email' || busy}
                tabIndex={step === 'email' ? 0 : -1}
              />
            </label>
            <button className="btn" type="submit" disabled={busy || step !== 'email'}>
              {busy ? <span className="spinner" /> : 'Send sign-in code'}
            </button>
            <p className="small muted">New to the hotel? Your account is created automatically when you complete a guest booking.</p>
          </section>
          <section className="auth-form-page stack" aria-hidden={step !== 'code'}>
            {verified ? (
              <button className="btn" type="button" onClick={continueAfterVerification} disabled={step !== 'code' || busy}>
                {busy ? <span className="spinner" /> : 'Continue'}
              </button>
            ) : (
              <>
                <p className="muted">Enter the code we emailed to <strong>{email}</strong>.</p>
                <label className="field">Sign-in code
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={12}
                    required
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    disabled={step !== 'code' || busy}
                    tabIndex={step === 'code' ? 0 : -1}
                  />
                </label>
                <button className="btn" type="submit" disabled={busy || step !== 'code' || !code.trim()}>
                  {busy ? <span className="spinner" /> : 'Verify and sign in'}
                </button>
                <div className="row between">
                  <button className="btn secondary" type="button" onClick={changeEmail} disabled={busy || step !== 'code'} tabIndex={step === 'code' ? 0 : -1}>Change email</button>
                  <button className="btn secondary" type="button" onClick={resendCode} disabled={busy || step !== 'code' || resendSeconds > 0} tabIndex={step === 'code' ? 0 : -1}>
                    {resendSeconds > 0 ? `Resend in ${resendSeconds}s` : 'Resend code'}
                  </button>
                </div>
                <p className="small muted">Codes expire after 5 minutes. If it doesn’t arrive, check your spam or junk folder before requesting another.</p>
              </>
            )}
          </section>
        </div>
      </div>
    </form>
  )
}
