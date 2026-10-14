'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { adminConfigured, createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { removeReceiptFiles } from '@/lib/admin-receipt-files'

export type DeleteCancelledReservationResult = { ok: boolean; message: string }

const reservationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function deleteCancelledReservation(reservationId: string): Promise<DeleteCancelledReservationResult> {
  await requireRole(['admin'], '/admin/reservations')
  if (!adminConfigured()) {
    return { ok: false, message: 'SUPABASE_SERVICE_ROLE_KEY is not configured on the server.' }
  }
  if (!reservationIdPattern.test(reservationId)) {
    return { ok: false, message: 'Invalid reservation.' }
  }

  const admin = createAdminClient()
  const { data: reservation, error: reservationError } = await admin
    .from('reservations')
    .select('id, status')
    .eq('id', reservationId)
    .maybeSingle()
  if (reservationError) return { ok: false, message: `Could not load the reservation: ${reservationError.message}` }
  if (!reservation) return { ok: false, message: 'Reservation not found.' }
  if (reservation.status !== 'cancelled') return { ok: false, message: 'Only cancelled reservations can be permanently deleted.' }

  const { data: payments, error: paymentError } = await admin
    .from('payments')
    .select('receipt_path')
    .eq('reservation_id', reservationId)
  if (paymentError) return { ok: false, message: `Could not list reservation receipts: ${paymentError.message}` }
  const receiptPaths = [...new Set((payments ?? []).map((payment) => payment.receipt_path).filter((path): path is string => Boolean(path)))]
  const receiptError = await removeReceiptFiles(admin, receiptPaths)
  if (receiptError) return { ok: false, message: `Could not remove reservation receipt files: ${receiptError}. The reservation was not deleted; retry to finish cleanup.` }

  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_delete_cancelled_reservation', { p_reservation_id: reservationId })
  if (error) {
    return {
      ok: false,
      message: `Could not delete the cancelled reservation: ${error.message}. Receipt files may already have been removed; retry to finish cleanup.`,
    }
  }

  revalidatePath('/admin/reservations')
  return { ok: true, message: 'The cancelled reservation and its linked booking records were permanently deleted.' }
}
