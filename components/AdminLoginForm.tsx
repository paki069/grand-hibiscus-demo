'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AdminKeySignupForm from '@/components/AdminKeySignupForm'

export default function AdminLoginForm({ next }: { next: string }) {
  const router = useRouter()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    const supabase = createClient()
    let authenticated = false

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })
      if (signInError || !data.user) {
        setError(signInError?.message ?? 'Unable to sign in. Please check your email and password.')
        return
      }
      authenticated = true

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role, active')
        .eq('id', data.user.id)
        .maybeSingle()

      if (profileError) {
        console.error('Could not verify admin access after sign-in:', profileError)
        const { error: signOutError } = await supabase.auth.signOut()
        if (signOutError) console.error('Could not clear session after admin verification failed:', signOutError)
        authenticated = false
        setError('We could not verify administrator access. Please try again.')
        return
      }

      if (!profile || profile.role !== 'admin' || !profile.active) {
        const { error: signOutError } = await supabase.auth.signOut()
        if (signOutError) console.error('Could not clear session after admin access was denied:', signOutError)
        authenticated = false
        setError('This account does not have active administrator access.')
        return
      }

      router.replace(next)
      router.refresh()
    } catch (signInError) {
      if (authenticated) {
        const { error: signOutError } = await supabase.auth.signOut()
        if (signOutError) console.error('Could not clear session after admin sign-in failed:', signOutError)
      }
      setError(signInError instanceof Error ? signInError.message : 'Unable to sign in. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'signup') {
    return (
      <AdminKeySignupForm onBack={(registeredEmail) => {
        if (registeredEmail) setEmail(registeredEmail)
        setMode('signin')
      }} />
    )
  }

  return (
    <form onSubmit={signIn} className="card stack auth-form">
      <h1>Admin sign in</h1>
      {error && <div className="notice bad" role="alert">{error}</div>}
      <p className="muted">Sign in with your administrator email and password.</p>
      <label className="field">Email
        <input
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={busy}
        />
      </label>
      <label className="field">Password
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
        />
      </label>
      <button className="btn" type="submit" disabled={busy}>
        {busy ? <span className="spinner" /> : 'Sign in'}
      </button>
      <button className="btn secondary" type="button" onClick={() => setMode('signup')} disabled={busy}>Create admin account</button>
      <p className="small muted">Guest? <Link href="/login">Use email-code sign in</Link>.</p>
    </form>
  )
}
