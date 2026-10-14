'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { friendlyError } from '@/lib/format'
import { requestCancellationNotification } from '@/lib/notifications-client'
import { deleteCancelledReservation } from '@/app/(ops)/admin/reservations/actions'

type PaymentAction = { id: string; status: string; amount: number; entitlementId: string | null; label: string }

export default function AdminReservationActions({ reservationId, status, payments }: { reservationId: string; status: string; payments: PaymentAction[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const refundPayment = payments.length === 1 && !payments[0].entitlementId && payments[0].status === 'paid'
    ? payments[0]
    : null
  const [refund, setRefund] = useState(refundPayment ? String(refundPayment.amount) : '')
  const [reason, setReason] = useState('')

  async function removeCancelledBooking() {
    if (!confirm('Permanently delete this cancelled reservation, including its services, payments/refunds, receipt files, notifications, loyalty entries, QR passes, check-ins, and linked audit details? This cannot be undone.')) return
    setBusy(true)
    setMsg(null)
    try {
      const result = await deleteCancelledReservation(reservationId)
      setBusy(false)
      setMsg({ tone: result.ok ? 'ok' : 'bad', text: result.message })
      if (result.ok) {
        router.replace('/admin/reservations')
        router.refresh()
      }
    } catch (error) {
      setBusy(false)
      setMsg({ tone: 'bad', text: error instanceof Error ? error.message : 'Could not delete this reservation.' })
    }
  }

  async function run(fn: () => PromiseLike<{ error: any }>, okText: string, confirmText?: string, sendCancellationEmail = false) {
    if (confirmText && !confirm(confirmText)) return
    setBusy(true); setMsg(null)
    const { error } = await fn()
    if (error) {
      setBusy(false)
      return setMsg({ tone: 'bad', text: friendlyError(error) })
    }
    const notification = sendCancellationEmail
      ? await requestCancellationNotification(reservationId)
      : null
    setBusy(false)
    setMsg({
      tone: notification && !notification.ok ? 'bad' : 'ok',
      text: notification ? `${okText} ${notification.message}` : okText,
    })
    router.refresh()
  }
  const sb = createClient()

  return (
    <div className="card stack">
      <h3 style={{ margin: 0 }}>Actions</h3>
      {msg && <div className={`notice ${msg.tone}`} role={msg.tone === 'bad' ? 'alert' : 'status'}>{msg.text}</div>}
      <label className="field">Reason / note (recorded in audit log)<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      {payments.map((payment) => (
        <div key={payment.id} className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: '.7rem' }}>
          <strong className="small">{payment.label} · {payment.amount.toFixed(2)}</strong>
          <div className="row">
            {['pending_verification', 'awaiting_receipt', 'unpaid'].includes(payment.status) && <button className="btn" disabled={busy} onClick={() => run(() => sb.rpc('admin_set_payment_status', { p_payment: payment.id, p_status: 'paid', p_note: reason }), 'Payment marked paid.', 'Mark this payment as received?')}>Mark paid</button>}
            {['pending_verification', 'awaiting_receipt'].includes(payment.status) && <button className="btn secondary" disabled={busy} onClick={() => run(() => sb.rpc('admin_set_payment_status', { p_payment: payment.id, p_status: 'failed', p_note: reason }), 'Payment marked failed.')}>Reject payment</button>}
          </div>
        </div>
      ))}
      <div className="row">
        {status === 'pending' && <button className="btn secondary" disabled={busy} onClick={() => run(() => sb.rpc('admin_set_reservation_status', { p_res: reservationId, p_status: 'confirmed', p_reason: reason }), 'Reservation confirmed.')}>Confirm booking</button>}
        {['pending', 'confirmed'].includes(status) && <button className="btn danger" disabled={busy} onClick={() => run(() => sb.rpc('admin_set_reservation_status', { p_res: reservationId, p_status: 'cancelled', p_reason: reason }), 'Reservation cancelled; QR pass revoked.', 'Cancel this reservation? Its pass will be revoked.', true)}>Cancel</button>}
        {status === 'cancelled' && <button className="btn danger" disabled={busy} onClick={removeCancelledBooking}>Delete cancelled reservation</button>}
        {status === 'confirmed' && <button className="btn secondary" disabled={busy} onClick={() => run(() => sb.rpc('reissue_pass', { p_res: reservationId }), 'New QR pass issued; the previous one is revoked.', 'Reissue the QR pass? The old one stops working.')}>Reissue QR</button>}
      </div>
      {refundPayment && (
        <div className="row" style={{ alignItems: 'end' }}>
          <label className="field">Refund amount<input type="number" step="0.01" min="0.01" value={refund} onChange={(e) => setRefund(e.target.value)} /></label>
          <button className="btn danger" disabled={busy || !refund} onClick={() => run(() => sb.rpc('refund_reservation', { p_res: reservationId, p_amount: Number(refund), p_reason: reason, p_cancel: true }), 'Refund recorded and reservation cancelled. This records the refund only – send the money back through your payment channel.', 'Record this refund and cancel the reservation?', true)}>Refund & cancel</button>
        </div>
      )}
    </div>
  )
}
