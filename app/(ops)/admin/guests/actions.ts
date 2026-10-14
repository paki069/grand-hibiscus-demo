'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { adminConfigured, createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { listReceiptPaths, removeReceiptFiles } from '@/lib/admin-receipt-files'

export type GuestDeleteResult = { ok: boolean; refresh: boolean; message: string }
export type GuestBirthdayResult = { ok: boolean; message: string }

const guestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function validBirthday(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime())
    && date.toISOString().slice(0, 10) === value
    && value <= new Date().toISOString().slice(0, 10)
}

export async function updateGuestBirthday(profileId: string, value: string): Promise<GuestBirthdayResult> {
  await requireRole(['admin'], '/admin/guests')
  if (!guestIdPattern.test(profileId)) return { ok: false, message: 'Invalid guest account.' }
  if (value && !validBirthday(value)) return { ok: false, message: 'Enter a valid birthday that is not in the future.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('profiles')
    .update({ birthday: value || null })
    .eq('id', profileId)
    .eq('role', 'customer')
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, message: `Could not update this guest's birthday: ${error.message}` }
  if (!data) return { ok: false, message: 'Guest account not found.' }

  revalidatePath('/admin/guests')
  revalidatePath('/account')
  return { ok: true, message: value ? 'Birthday saved.' : 'Birthday removed.' }
}

export async function deleteGuestAccount(profileId: string): Promise<GuestDeleteResult> {
  const me = await requireRole(['admin'], '/admin/guests')
  if (!adminConfigured()) {
    return { ok: false, refresh: false, message: 'SUPABASE_SERVICE_ROLE_KEY is not configured on the server.' }
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(profileId)) {
    return { ok: false, refresh: false, message: 'Invalid guest account.' }
  }
  if (profileId === me.id) {
    return { ok: false, refresh: false, message: 'You cannot delete your own account from the guest list.' }
  }

  const admin = createAdminClient()
  const { data: guest, error: guestError } = await admin
    .from('profiles')
    .select('id, role')
    .eq('id', profileId)
    .maybeSingle()
  if (guestError) return { ok: false, refresh: false, message: `Could not load the guest account: ${guestError.message}` }
  if (!guest || guest.role !== 'customer') {
    return { ok: false, refresh: false, message: 'Only guest accounts can be permanently deleted here.' }
  }

  const receiptResult = await listReceiptPaths(admin, profileId)
  if (receiptResult.error) {
    return { ok: false, refresh: false, message: `Could not list the guest's receipt files: ${receiptResult.error}` }
  }
  const receiptError = await removeReceiptFiles(admin, receiptResult.paths)
  if (receiptError) {
    return {
      ok: false,
      refresh: false,
      message: `Could not remove receipt files: ${receiptError}. The guest's records were not deleted; retry to finish cleanup.`,
    }
  }

  const { error: recordsError } = await admin.rpc('admin_delete_guest_records', { p_guest_id: profileId })
  if (recordsError) {
    return {
      ok: false,
      refresh: false,
      message: `Could not delete the guest's linked records: ${recordsError.message}. Receipt files may already have been removed; retry to finish cleanup.`,
    }
  }

  const { error: authDeleteError } = await admin.auth.admin.deleteUser(profileId)
  if (authDeleteError) {
    return {
      ok: false,
      refresh: true,
      message: `Linked records and receipts were removed, but the login account could not be deleted: ${authDeleteError.message}. Retry to finish cleanup.`,
    }
  }

  const { error: actorAuditError } = await admin.from('audit_log').delete().eq('actor_id', profileId)
  const { error: profileAuditError } = await admin
    .from('audit_log')
    .delete()
    .eq('entity_type', 'profiles')
    .eq('entity_id', profileId)
  if (actorAuditError || profileAuditError) {
    revalidatePath('/admin/guests')
    return {
      ok: false,
      refresh: true,
      message: `The guest account and linked records were deleted, but some audit entries could not be removed: ${actorAuditError?.message ?? profileAuditError?.message}`,
    }
  }

  const { error: auditError } = await admin.from('audit_log').insert({
    actor_id: me.id,
    action: 'guest.account_deleted',
    entity_type: 'guest_data',
    details: { permanent: true },
  })
  revalidatePath('/admin/guests')
  if (auditError) {
    return {
      ok: false,
      refresh: true,
      message: `The guest and linked records were deleted, but the deletion audit entry could not be saved: ${auditError.message}`,
    }
  }
  return {
    ok: true,
    refresh: true,
    message: 'The guest account, reservations, payments, loyalty data, receipts, and linked audit details were permanently deleted.',
  }
}
