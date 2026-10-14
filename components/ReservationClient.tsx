'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import QRCode from 'qrcode'
import { createClient } from '@/lib/supabase/client'
import { friendlyError } from '@/lib/format'
import { requestCancellationNotification } from '@/lib/notifications-client'
import { receiptFileError, uploadReceiptFile } from '@/lib/receipt-upload'
import { ReceiptFilePicker } from '@/components/ReceiptFilePicker'

export function QrPass({ token, reference }: { token: string; reference: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => { QRCode.toDataURL(token, { width: 280, margin: 2, errorCorrectionLevel: 'M' }).then(setSrc) }, [token])
  return (
    <div className="stack" style={{ alignItems: 'center' }}>
      {src ? <img src={src} alt={`QR pass for reservation ${reference}`} width={220} height={220} /> : <span className="spinner" />}
      <div className="small muted">Show this at each service. It contains no personal details.</div>
    </div>
  )
}

export function ReceiptUpload({ reservationId, paymentId, userId, hasReceipt }: { reservationId: string; paymentId: string; userId: string; hasReceipt: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  async function upload(file: File) {
    const validationError = receiptFileError(file)
    if (validationError) {
      setSelectedFile(null)
      return setMsg({ tone: 'bad', text: validationError })
    }
    setSelectedFile(file)
    setBusy(true); setMsg(null)
    try {
      const error = await uploadReceiptFile(file, reservationId, paymentId, userId)
      setBusy(false)
      if (error) return setMsg({ tone: 'bad', text: friendlyError(error) })
      setSelectedFile(null)
      setMsg({ tone: 'ok', text: 'Receipt uploaded for this payment. Our team will verify it.' })
      router.refresh()
    } catch (uploadError) {
      console.error('Transfer receipt upload failed:', uploadError)
      setBusy(false)
      setMsg({ tone: 'bad', text: 'The receipt could not be uploaded. Please check your connection and try again.' })
    }
  }
  return (
    <div className="stack">
      <ReceiptFilePicker
        label={hasReceipt ? 'Replace receipt' : 'Upload transfer receipt'}
        file={selectedFile}
        disabled={busy}
        onFileChange={(file) => {
          if (file) void upload(file)
          else setSelectedFile(null)
        }}
      />
      {busy && <span className="small muted"><span className="spinner" /> Uploading…</span>}
      {msg && <div className={`notice ${msg.tone}`} role={msg.tone === 'bad' ? 'alert' : 'status'}>{msg.text}</div>}
    </div>
  )
}

export function GuestActions({ reservationId, canCancel, canReissue }: { reservationId: string; canCancel: boolean; canReissue: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  async function cancel() {
    if (!confirm('Cancel this whole reservation? A cancellation fee may apply under the policy.')) return
    setBusy('cancel'); setMsg(null)
    const { data, error } = await createClient().rpc('cancel_my_reservation', { p_res: reservationId, p_reason: 'Cancelled by guest' })
    if (error) {
      setBusy(null)
      return setMsg({ tone: 'bad', text: friendlyError(error) })
    }
    const notification = await requestCancellationNotification(reservationId)
    setBusy(null)
    setMsg({
      tone: notification.ok ? 'ok' : 'bad',
      text: `Reservation cancelled. Cancellation fee: ${data?.cancellation_fee ?? 0}. ${notification.message}`,
    })
    router.refresh()
  }
  async function reissue() {
    if (!confirm('Issue a new QR pass? The current one will stop working.')) return
    setBusy('reissue'); setMsg(null)
    const { error } = await createClient().rpc('reissue_pass', { p_res: reservationId })
    setBusy(null)
    if (error) return setMsg({ tone: 'bad', text: friendlyError(error) })
    router.refresh()
  }
  return (
    <div className="stack">
      <div className="row">
        {canReissue && <button className="btn secondary" disabled={!!busy} onClick={reissue}>{busy === 'reissue' ? <span className="spinner" /> : 'Reissue QR pass'}</button>}
        {canCancel && <button className="btn danger" disabled={!!busy} onClick={cancel}>{busy === 'cancel' ? <span className="spinner" /> : 'Cancel reservation'}</button>}
      </div>
      {msg && <div className={`notice ${msg.tone}`} role={msg.tone === 'bad' ? 'alert' : 'status'}>{msg.text}</div>}
    </div>
  )
}
