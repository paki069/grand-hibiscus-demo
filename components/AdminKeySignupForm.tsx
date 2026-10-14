'use client'

import { useActionState } from 'react'
import { registerAdminWithKey, type RegistrationResult } from '@/app/admin/register/actions'

export default function AdminKeySignupForm({ onBack }: { onBack: (email?: string) => void }) {
  const [state, action, pending] = useActionState<RegistrationResult | null, FormData>(registerAdminWithKey, null)

  if (state?.ok) {
    return (
      <div className="card stack auth-form">
        <h1>Admin account approved</h1>
        <div className="notice ok" role="status">{state.message}</div>
        <button className="btn" type="button" onClick={() => onBack(state.email)}>Continue to sign in</button>
      </div>
    )
  }

  return (
    <form action={action} className="card stack auth-form">
      <h1>Create admin account</h1>
      {state && <div className="notice bad" role="alert">{state.message}</div>}
      <p className="muted">Enter your details and the numeric admin code. A valid code approves the account immediately.</p>
      <div className="form-grid">
        <label className="field">First name<input name="first_name" required autoComplete="given-name" maxLength={100} /></label>
        <label className="field">Last name<input name="last_name" required autoComplete="family-name" maxLength={100} /></label>
        <label className="field">Email<input name="email" type="email" required autoComplete="email" /></label>
        <label className="field">Phone<input name="phone" type="tel" autoComplete="tel" /></label>
        <label className="field">Password (at least 12 characters)<input name="password" type="password" required minLength={12} autoComplete="new-password" /></label>
        <label className="field">Numeric admin code
          <input name="admin_key" type="password" required inputMode="numeric" pattern="[0-9]+" autoComplete="off" />
        </label>
      </div>
      <div className="row">
        <button className="btn" type="submit" disabled={pending}>{pending ? <span className="spinner" /> : 'Create admin account'}</button>
        <button className="btn secondary" type="button" onClick={() => onBack()} disabled={pending}>Back to sign in</button>
      </div>
    </form>
  )
}
