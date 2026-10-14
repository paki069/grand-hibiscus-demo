'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { friendlyError, fmtDateTime } from '@/lib/format'

interface EntView { id: string; title: string; detail: string; starts_at: string; ends_at: string; eligible_from: string; adults: number; children: number; meta: Record<string, any>; checked_in_at: string | null; payment_status: string | null; state: string }
interface ScanResult { state: string; reservation?: { id: string; reference: string; guest: string; status: string; payment_status: string | null }; entitlements?: EntView[] }

const LABEL: Record<string, { text: string; tone: 'valid' | 'warn' | 'bad' }> = {
  valid: { text: 'Valid', tone: 'valid' },
  already_checked_in: { text: 'Already checked in', tone: 'warn' },
  not_yet_eligible: { text: 'Not yet eligible', tone: 'warn' },
  expired: { text: 'Expired', tone: 'bad' },
  cancelled: { text: 'Cancelled', tone: 'bad' },
  refunded: { text: 'Refunded', tone: 'bad' },
  revoked: { text: 'Pass revoked / replaced', tone: 'bad' },
  unconfirmed: { text: 'Booking not confirmed (payment pending)', tone: 'warn' },
  unpaid: { text: 'Unpaid', tone: 'warn' },
  payment_pending: { text: 'Tour payment verification required', tone: 'warn' },
  unknown: { text: 'Unknown pass', tone: 'bad' },
  no_service: { text: 'No service for this area on this pass', tone: 'warn' },
  checked_in: { text: 'Checked in', tone: 'valid' },
}

export default function Scanner({ areas, tz, canOpenReservations }: { areas: string[]; tz: string; canOpenReservations: boolean }) {
  const [area, setArea] = useState(areas[0] ?? '')
  const [token, setToken] = useState<string | null>(null)
  const [manual, setManual] = useState('')
  const [result, setResult] = useState<ScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [camera, setCamera] = useState<'off' | 'starting' | 'on' | 'denied' | 'unsupported'>('off')
  const [busy, setBusy] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const lastRef = useRef<{ t: string; at: number } | null>(null)
  const areaRef = useRef(area)
  areaRef.current = area

  const lookup = useCallback(async (t: string) => {
    const clean = t.trim()
    if (!clean) return
    setError(null); setBusy('lookup'); setToken(clean)
    const { data, error } = await createClient().rpc('scan_pass', { p_token: clean, p_area: areaRef.current })
    setBusy(null)
    if (error) { setResult(null); return setError(friendlyError(error)) }
    setResult(data as ScanResult)
  }, [])

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop())
    streamRef.current = null
    setCamera('off')
  }, [])

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) return setCamera('unsupported')
    setCamera('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play() }
      setCamera('on')
    } catch {
      setCamera('denied')
    }
  }

  useEffect(() => {
    if (camera !== 'on') return
    let raf = 0
    const tick = () => {
      const v = videoRef.current, c = canvasRef.current
      if (v && c && v.readyState === v.HAVE_ENOUGH_DATA) {
        c.width = v.videoWidth; c.height = v.videoHeight
        const ctx = c.getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(v, 0, 0)
        const img = ctx.getImageData(0, 0, c.width, c.height)
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
        if (code?.data) {
          const now = Date.now()
          if (!lastRef.current || lastRef.current.t !== code.data || now - lastRef.current.at > 4000) {
            lastRef.current = { t: code.data, at: now }
            lookup(code.data)
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [camera, lookup])

  useEffect(() => stop, [stop])

  async function checkIn(e: EntView) {
    if (!token) return
    setBusy(e.id); setError(null)
    const { data, error } = await createClient().rpc('check_in', { p_token: token, p_entitlement: e.id, p_area: area })
    setBusy(null)
    if (error) return setError(friendlyError(error))
    await lookup(token) // re-read so the display reflects the stored state, never an assumption
    if (!data?.ok) setError(`Check-in not completed: ${LABEL[data?.state]?.text ?? data?.state}`)
  }

  const overall = result
    ? result.reservation?.payment_status === 'unpaid'
      ? LABEL.unpaid
      : LABEL[result.state] ?? { text: result.state, tone: 'warn' as const }
    : null

  if (areas.length === 0) return <div className="notice warn">No areas are assigned to your account.</div>

  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <label className="field">Scanning for
        <select value={area} onChange={(e) => { setArea(e.target.value); setResult(null); if (token) setToken(null) }}>
          {areas.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </label>
      <video ref={videoRef} className="scan-video" playsInline muted style={{ display: camera === 'on' ? 'block' : 'none' }} />
      <canvas ref={canvasRef} hidden />
      <div className="row">
        {camera !== 'on' ? <button className="btn" onClick={start} disabled={camera === 'starting'}>{camera === 'starting' ? <span className="spinner" /> : 'Start camera'}</button> : <button className="btn secondary" onClick={stop}>Stop camera</button>}
      </div>
      {camera === 'denied' && <div className="notice warn">Camera access was denied or no camera was found. Allow camera permission in the browser (HTTPS or localhost required), or enter the code manually below.</div>}
      {camera === 'unsupported' && <div className="notice warn">This browser cannot access the camera. Use manual entry.</div>}
      <form className="row" onSubmit={(e) => { e.preventDefault(); lookup(manual) }}>
        <input style={{ flex: 1 }} placeholder="Or enter pass / booking reference" aria-label="Pass code or booking reference" value={manual} onChange={(e) => setManual(e.target.value)} autoComplete="off" />
        <button className="btn secondary" disabled={!manual.trim() || busy === 'lookup'}>Look up</button>
      </form>

      {busy === 'lookup' && <div className="small muted"><span className="spinner" /> Checking pass…</div>}
      {error && <div className="notice bad" role="alert">{error}</div>}
      {result && overall && (
        <div className={`scan-result ${overall.tone}`} role="status" aria-live="polite">
          <h2 style={{ margin: 0 }}>{overall.text}</h2>
          {result.reservation && <div className="small">{result.reservation.guest} · {result.reservation.reference}</div>}
          {canOpenReservations && result.reservation?.id && <Link className="btn sm secondary" href={`/admin/reservations/${result.reservation.id}`}>View reservation</Link>}
          <div className="stack" style={{ marginTop: '.6rem' }}>
            {(result.entitlements ?? []).map((e) => {
                const serviceState = LABEL[e.state] ?? { text: e.state, tone: 'warn' as const }
                const paymentStatus = e.payment_status ?? result.reservation?.payment_status
                const isUnpaid = paymentStatus === 'unpaid'
                const paymentPending = ['awaiting_receipt', 'pending_verification', 'failed'].includes(paymentStatus ?? '')
                const st = isUnpaid ? LABEL.unpaid : paymentPending ? LABEL.payment_pending : serviceState
                return (
                  <div key={e.id} className="card flat stack">
                    <div className="row between"><strong>{e.title}</strong><span className={`pill ${st.tone === 'valid' ? 'ok' : st.tone === 'bad' ? 'bad' : 'warn'}`}>{st.text}</span></div>
                    {(isUnpaid || paymentPending) && e.state !== 'valid' && <div className="small muted">Service status: {serviceState.text}</div>}
                    <div className="small">{e.detail}</div>
                  <div className="small">{fmtDateTime(e.starts_at, tz)} · {e.adults} adult{e.adults !== 1 ? 's' : ''}{e.children > 0 && `, ${e.children} child${e.children > 1 ? 'ren' : ''}`}</div>
                  {area === 'restaurant' && e.meta?.table_label && <div className="small"><strong>Table {e.meta.table_label}</strong> · {e.meta.area}{e.meta.seat_labels?.length ? ` · seats ${e.meta.seat_labels.join(', ')}` : ''}</div>}
                  {area === 'hotel' && e.meta?.room_number && <div className="small"><strong>Room {e.meta.room_number}</strong></div>}
                  {e.checked_in_at && <div className="small muted">Checked in {fmtDateTime(e.checked_in_at, tz)}</div>}
                  {['valid', 'not_yet_eligible'].includes(e.state) && <>
                    <button className="btn accent" disabled={!!busy || e.state !== 'valid' || paymentPending} onClick={() => checkIn(e)}>{busy === e.id ? <span className="spinner" /> : `Check in ${area}`}</button>
                    {e.state === 'not_yet_eligible' && <div className="small muted">Check-in opens {fmtDateTime(e.eligible_from, tz)}.</div>}
                  </>}
                </div>
              )
            })}
          </div>
          <button className="btn sm secondary" style={{ marginTop: '.6rem' }} onClick={() => { setResult(null); setToken(null); setManual(''); setError(null); lastRef.current = null }}>Scan next</button>
        </div>
      )}
    </div>
  )
}
