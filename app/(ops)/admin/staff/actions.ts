'use server'
import { revalidatePath } from 'next/cache'
import { requireRole, AREAS } from '@/lib/auth'
import { createAdminClient, adminConfigured } from '@/lib/supabase/admin'
import { listReceiptPaths, removeReceiptFiles } from '@/lib/admin-receipt-files'

export type StaffResult = { ok: boolean; message: string; refresh?: boolean }

export async function createStaffAccount(_prev: StaffResult | null, form: FormData): Promise<StaffResult> {
  const me = await requireRole(['admin'], '/admin/staff')
  if (!adminConfigured()) return { ok: false, message: 'SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so accounts cannot be created here.' }
  const email = String(form.get('email') ?? '').trim().toLowerCase()
  const password = String(form.get('password') ?? '')
  const role = form.get('role') === 'admin' ? 'admin' : 'staff'
  const areas = form.getAll('areas').map(String).filter((a) => (AREAS as readonly string[]).includes(a))
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, message: 'Enter a valid email.' }
  if (password.length < 12) return { ok: false, message: 'Password must be at least 12 characters.' }

  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { first_name: String(form.get('first_name') ?? ''), last_name: String(form.get('last_name') ?? '') },
  })
  if (error || !data.user) return { ok: false, message: error?.message ?? 'Could not create the user.' }
  const { error: pe } = await admin.from('profiles').update({
    role, staff_areas: role === 'staff' ? areas : [], first_name: String(form.get('first_name') ?? ''), last_name: String(form.get('last_name') ?? ''),
  }).eq('id', data.user.id)
  await admin.from('audit_log').insert({ actor_id: me.id, action: 'staff.created', entity_type: 'profile', entity_id: data.user.id, details: { email, role, areas } })
  revalidatePath('/admin/staff')
  return pe ? { ok: false, message: 'User created but the role could not be set: ' + pe.message } : { ok: true, message: `Account created for ${email}. Share the password securely; ask them to change it.` }
}

export async function updateStaffAccount(
  profileId: string,
  firstName: string,
  lastName: string,
  password: string,
): Promise<StaffResult> {
  const me = await requireRole(['admin'], '/admin/staff')
  if (!adminConfigured()) return { ok: false, message: 'SUPABASE_SERVICE_ROLE_KEY is not configured on the server.' }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(profileId)) {
    return { ok: false, message: 'Invalid account.' }
  }

  const first = firstName.trim()
  const last = lastName.trim()
  if (!first || !last || first.length > 100 || last.length > 100) {
    return { ok: false, message: 'Enter a first and last name (100 characters or fewer).' }
  }
  if (password && password.length < 12) {
    return { ok: false, message: 'A new password must be at least 12 characters.' }
  }

  const admin = createAdminClient()
  const { data: target, error: targetError } = await admin
    .from('profiles')
    .select('id, email, role')
    .eq('id', profileId)
    .maybeSingle()
  if (targetError) return { ok: false, message: `Could not load the account: ${targetError.message}` }
  if (!target || (target.role !== 'admin' && target.role !== 'staff')) {
    return { ok: false, message: 'Only admin and staff accounts can be edited here.' }
  }

  if (password) {
    const { error } = await admin.auth.admin.updateUserById(profileId, { password })
    if (error) return { ok: false, message: `Could not update the password: ${error.message}` }
  }

  const { error: profileError } = await admin
    .from('profiles')
    .update({ first_name: first, last_name: last })
    .eq('id', profileId)
  if (profileError) {
    return {
      ok: false,
      refresh: Boolean(password),
      message: password
        ? `The password was updated, but the name could not be saved: ${profileError.message}`
        : `Could not update the name: ${profileError.message}`,
    }
  }

  if (password) {
    const { error: auditError } = await admin.from('audit_log').insert({
      actor_id: me.id,
      action: 'staff.password_updated',
      entity_type: 'profile',
      entity_id: profileId,
      details: { email: target.email },
    })
    if (auditError) {
      revalidatePath('/admin/staff')
      return { ok: false, refresh: true, message: `The account was updated, but the password-change audit entry could not be saved: ${auditError.message}` }
    }
  }

  revalidatePath('/admin/staff')
  return { ok: true, refresh: true, message: password ? 'Name and password updated.' : 'Name updated.' }
}

export async function approveAdminRegistration(profileId: string): Promise<StaffResult> {
  const me = await requireRole(['admin'], '/admin/staff')
  if (!adminConfigured()) return { ok: false, message: 'SUPABASE_SERVICE_ROLE_KEY is not configured on the server.' }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(profileId)) {
    return { ok: false, message: 'Invalid registration account.' }
  }

  const admin = createAdminClient()
  const { data: registrationEvent, error: eventError } = await admin
    .from('audit_log')
    .select('action')
    .eq('entity_type', 'profile')
    .eq('entity_id', profileId)
    .in('action', ['admin_registration.pending', 'admin_registration.approved'])
    .order('at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (eventError) return { ok: false, message: `Could not verify the registration: ${eventError.message}` }
  if (registrationEvent?.action !== 'admin_registration.pending') {
    return { ok: false, message: 'This account is no longer awaiting approval. Refresh the page and check its status.' }
  }

  const { data, error } = await admin
    .from('profiles')
    .update({ role: 'admin', staff_areas: [], active: true })
    .eq('id', profileId)
    .eq('role', 'staff')
    .eq('active', false)
    .select('id, email')
    .maybeSingle()

  if (error) return { ok: false, message: `Could not approve the registration: ${error.message}` }
  if (!data) return { ok: false, message: 'This account is no longer awaiting approval. Refresh the page and check its status.' }

  const { error: auditError } = await admin.from('audit_log').insert({
    actor_id: me.id,
    action: 'admin_registration.approved',
    entity_type: 'profile',
    entity_id: data.id,
    details: { email: data.email },
  })
  revalidatePath('/admin/staff')
  if (auditError) {
    return { ok: false, refresh: true, message: `Admin access was granted, but the approval audit entry could not be saved: ${auditError.message}` }
  }
  return { ok: true, refresh: true, message: `Admin registration approved for ${data.email ?? 'the selected account'}.` }
}

export async function deleteStaffAccount(profileId: string): Promise<StaffResult> {
  const me = await requireRole(['admin'], '/admin/staff')
  if (!adminConfigured()) return { ok: false, message: 'SUPABASE_SERVICE_ROLE_KEY is not configured on the server.' }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(profileId)) {
    return { ok: false, message: 'Invalid account.' }
  }
  if (profileId === me.id) return { ok: false, message: 'You cannot delete your own account.' }

  const admin = createAdminClient()
  const { data: target, error: targetError } = await admin
    .from('profiles')
    .select('id, email, role, active')
    .eq('id', profileId)
    .maybeSingle()
  if (targetError) return { ok: false, message: `Could not load the account: ${targetError.message}` }
  if (!target || (target.role !== 'admin' && target.role !== 'staff')) {
    return { ok: false, message: 'Only admin and staff accounts can be deleted here.' }
  }

  if (target.role === 'admin' && target.active) {
    const { count, error: countError } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
      .eq('active', true)
    if (countError || count === null) {
      return { ok: false, message: `Could not verify the active administrator count: ${countError?.message ?? 'count unavailable'}` }
    }
    if (count <= 1) return { ok: false, message: 'The last active administrator cannot be deleted.' }
  }

  const receiptResult = await listReceiptPaths(admin, profileId)
  if (receiptResult.error) {
    return { ok: false, message: `Could not list the account's receipt files: ${receiptResult.error}` }
  }
  const receiptError = await removeReceiptFiles(admin, receiptResult.paths)
  if (receiptError) {
    return { ok: false, message: `Could not remove receipt files: ${receiptError}. The account's records were not deleted; retry to finish cleanup.` }
  }

  const { error: recordsError } = await admin.rpc('admin_delete_account_records', { p_account_id: profileId })
  if (recordsError) {
    return {
      ok: false,
      message: `Could not delete the account's linked records: ${recordsError.message}. Receipt files may already have been removed; retry to finish cleanup.`,
    }
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(profileId)
  if (deleteError) {
    return {
      ok: false,
      refresh: true,
      message: `Linked records and receipts were removed, but the login account could not be deleted: ${deleteError.message}. Retry to finish cleanup.`,
    }
  }

  const { error: actorAuditError } = await admin.from('audit_log').delete().eq('actor_id', profileId)
  const { error: profileAuditError } = await admin
    .from('audit_log')
    .delete()
    .eq('entity_type', 'profiles')
    .eq('entity_id', profileId)
  if (actorAuditError || profileAuditError) {
    revalidatePath('/admin/staff')
    return {
      ok: false,
      refresh: true,
      message: `The account and linked records were deleted, but some audit entries could not be removed: ${actorAuditError?.message ?? profileAuditError?.message}`,
    }
  }

  const { error: auditError } = await admin.from('audit_log').insert({
    actor_id: me.id,
    action: 'staff.account_deleted',
    entity_type: 'account_data',
    details: { permanent: true, role: target.role },
  })
  revalidatePath('/admin/staff')
  if (auditError) {
    return { ok: false, refresh: true, message: `The account and linked records were deleted, but the deletion audit entry could not be saved: ${auditError.message}` }
  }
  return { ok: true, refresh: true, message: `The account, reservations, payments, check-ins, loyalty data, receipts, and linked audit details were permanently deleted.` }
}
