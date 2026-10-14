'use client'

import { useActionState } from 'react'
import { registerAdmin, type RegistrationResult } from '@/app/admin/register/actions'

export default function AdminRegistrationForm() {
  const [state, action, pending] = useActionState<RegistrationResult | null, FormData>(registerAdmin, null)

  if (state?.ok) {
    return (
      <div className="stack">
        <div className="notice ok" role="status">{state.message} Registration email: {state.email}.</div>
      </div>
    )
  }

  return (
    <form action={action} className="stack">
      {state && <div className="notice bad" role="alert">{state.message}</div>}
      <div className="form-grid">
        <label className="field">First name<input name="first_name" required autoComplete="given-name" maxLength={100} /></label>
        <label className="field">Last name<input name="last_name" required autoComplete="family-name" maxLength={100} /></label>
        <label className="field">Email<input name="email" type="email" required autoComplete="email" /></label>
        <label className="field">Phone<input name="phone" type="tel" autoComplete="tel" /></label>
        <label className="field">Password (at least 12 characters)<input name="password" type="password" required minLength={12} autoComplete="new-password" /></label>
      </div>
      <p className="small muted">New accounts are inactive until an existing administrator approves them.</p>
      <div><button className="btn" disabled={pending}>{pending ? <span className="spinner" /> : 'Create account'}</button></div>
    </form>
  )
}
