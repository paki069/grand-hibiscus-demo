'use server'

import { createHash, timingSafeEqual } from 'node:crypto'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createAdminClient, adminConfigured } from '@/lib/supabase/admin'

export type RegistrationResult = {
  ok: boolean
  message: string
  email?: string
}

export async function registerAdmin(
  _previous: RegistrationResult | null,
  form: FormData,
): Promise<RegistrationResult> {
  if (!adminConfigured()) {
    return { ok: false, message: 'Registration is unavailable because server account creation is not configured.' }
  }

  const firstName = String(form.get('first_name') ?? '').trim()
  const lastName = String(form.get('last_name') ?? '').trim()
  const phone = String(form.get('phone') ?? '').trim()
  const email = String(form.get('email') ?? '').trim().toLowerCase()
  const password = String(form.get('password') ?? '')

  if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100) {
    return { ok: false, message: 'Enter a first and last name (100 characters or fewer).' }
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, message: 'Enter a valid email address.' }
  }
  if (password.length < 12) {
    return { ok: false, message: 'Choose a password with at least 12 characters.' }
  }

  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: firstName, last_name: lastName, phone },
  })
  if (error || !data.user) {
    return { ok: false, message: error?.message ?? 'Could not create the account.' }
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .update({
      email,
      first_name: firstName,
      last_name: lastName,
      phone,
      role: 'staff',
      staff_areas: [],
      active: false,
    })
    .eq('id', data.user.id)
    .select('id')
    .maybeSingle()

  if (profileError || !profile) {
    const { error: cleanupError } = await admin.auth.admin.deleteUser(data.user.id)
    if (cleanupError) {
      return {
        ok: false,
        message: `The account could not be marked for approval (${profileError?.message ?? 'profile not found'}), and cleanup failed (${cleanupError.message}). Contact the site administrator.`,
      }
    }
    return { ok: false, message: `The account could not be marked for approval and was removed. ${profileError?.message ?? ''}`.trim() }
  }

  const { error: auditError } = await admin.from('audit_log').insert({
    action: 'admin_registration.pending',
    entity_type: 'profile',
    entity_id: data.user.id,
    details: { email },
  })
  if (auditError) {
    const { error: cleanupError } = await admin.auth.admin.deleteUser(data.user.id)
    if (cleanupError) {
      return {
        ok: false,
        message: `The pending registration could not be recorded (${auditError.message}), and cleanup failed (${cleanupError.message}). Contact the site administrator.`,
      }
    }
    return { ok: false, message: `The pending registration could not be recorded and was removed. ${auditError.message}` }
  }

  revalidatePath('/admin/staff')
  return {
    ok: true,
    message: 'Your registration is submitted. Email confirmation is not required. Wait for an administrator to approve your account before signing in.',
    email,
  }
}

const signupAttempts = new Map<string, { count: number; resetAt: number }>()
const SIGNUP_ATTEMPT_WINDOW_MS = 15 * 60 * 1000
const SIGNUP_ATTEMPT_LIMIT = 5

function isAdminSignupRateLimited(requestHeaders: Headers) {
  const address = requestHeaders.get('x-real-ip')?.trim()
    || requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown'
  const key = createHash('sha256').update(address).digest('hex')
  const now = Date.now()
  const current = signupAttempts.get(key)

  if (signupAttempts.size >= 5_000) {
    for (const [storedKey, attempt] of signupAttempts) {
      if (attempt.resetAt <= now) signupAttempts.delete(storedKey)
    }
    if (signupAttempts.size >= 5_000) signupAttempts.delete(signupAttempts.keys().next().value!)
  }

  if (!current || current.resetAt <= now) {
    signupAttempts.set(key, { count: 1, resetAt: now + SIGNUP_ATTEMPT_WINDOW_MS })
    return false
  }
  if (current.count >= SIGNUP_ATTEMPT_LIMIT) return true
  current.count += 1
  return false
}

export async function registerAdminWithKey(
  _previous: RegistrationResult | null,
  form: FormData,
): Promise<RegistrationResult> {
  if (!adminConfigured()) {
    return { ok: false, message: 'Admin signup is unavailable because server account creation is not configured.' }
  }

  const expectedKey = process.env.ADMIN_KEY?.trim()
  if (!expectedKey || !/^\d+$/.test(expectedKey)) {
    console.error('Admin signup requires ADMIN_KEY to be configured as a numeric code.')
    return { ok: false, message: 'Admin signup is not configured. Please contact the site administrator.' }
  }

  if (isAdminSignupRateLimited(await headers())) {
    return { ok: false, message: 'Too many signup attempts. Please wait 15 minutes and try again.' }
  }

  const firstName = String(form.get('first_name') ?? '').trim()
  const lastName = String(form.get('last_name') ?? '').trim()
  const phone = String(form.get('phone') ?? '').trim()
  const email = String(form.get('email') ?? '').trim().toLowerCase()
  const password = String(form.get('password') ?? '')
  const submittedKey = String(form.get('admin_key') ?? '')

  if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100) {
    return { ok: false, message: 'Enter a first and last name (100 characters or fewer).' }
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, message: 'Enter a valid email address.' }
  }
  if (password.length < 12) {
    return { ok: false, message: 'Choose a password with at least 12 characters.' }
  }
  const submittedBytes = Buffer.from(submittedKey)
  const expectedBytes = Buffer.from(expectedKey)
  if (!/^\d+$/.test(submittedKey) || submittedBytes.length !== expectedBytes.length || !timingSafeEqual(submittedBytes, expectedBytes)) {
    return { ok: false, message: 'The admin code is incorrect.' }
  }

  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: firstName, last_name: lastName, phone },
  })
  if (error || !data.user) {
    return { ok: false, message: error?.message ?? 'Could not create the account.' }
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .update({
      email,
      first_name: firstName,
      last_name: lastName,
      phone,
      role: 'admin',
      staff_areas: [],
      active: true,
    })
    .eq('id', data.user.id)
    .select('id')
    .maybeSingle()

  if (profileError || !profile) {
    const { error: cleanupError } = await admin.auth.admin.deleteUser(data.user.id)
    if (cleanupError) {
      return {
        ok: false,
        message: `Admin access could not be assigned (${profileError?.message ?? 'profile not found'}), and cleanup failed (${cleanupError.message}). Contact the site administrator.`,
      }
    }
    return { ok: false, message: `Admin access could not be assigned and the account was removed. ${profileError?.message ?? ''}`.trim() }
  }

  const { error: auditError } = await admin.from('audit_log').insert({
    action: 'admin_registration.approved',
    entity_type: 'profile',
    entity_id: data.user.id,
    details: { email },
  })
  if (auditError) {
    const { error: cleanupError } = await admin.auth.admin.deleteUser(data.user.id)
    if (cleanupError) {
      return {
        ok: false,
        message: `Admin signup could not be recorded (${auditError.message}), and cleanup failed (${cleanupError.message}). Contact the site administrator.`,
      }
    }
    return { ok: false, message: `Admin signup could not be recorded and the account was removed. ${auditError.message}` }
  }

  revalidatePath('/admin/staff')
  return {
    ok: true,
    message: 'Admin account created and approved. You can sign in with your email and password.',
    email,
  }
}
