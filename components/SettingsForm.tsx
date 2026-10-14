'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { friendlyError, type Settings } from '@/lib/format'

type S = Settings & { checkin_time: string; checkout_time: string }

export default function SettingsForm({ initial }: { initial: S }) {
  const router = useRouter()
  const voiceSettingsConfigured = typeof initial.concierge_voice_input_enabled === 'boolean'
    && typeof initial.concierge_voice_output_enabled === 'boolean'
    && ['autumn', 'diana', 'hannah'].includes(initial.concierge_speech_voice)
  const [s, setS] = useState<S>({
    ...initial,
    concierge_voice_input_enabled: initial.concierge_voice_input_enabled ?? true,
    concierge_voice_output_enabled: initial.concierge_voice_output_enabled ?? true,
    concierge_speech_voice: initial.concierge_speech_voice ?? 'autumn',
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const set = <K extends keyof S>(k: K, v: S[K]) => setS({ ...s, [k]: v })
  const pm = (k: string, patch: object) => set('payment_methods', { ...s.payment_methods, [k]: { ...s.payment_methods[k], ...patch } })
  const num = (k: keyof S) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never)

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null)
    if (!/^[A-Z]{3}$/.test(s.currency)) { setBusy(false); return setMsg({ tone: 'bad', text: 'Currency must be a 3-letter ISO code, e.g. USD.' }) }
    try { new Intl.DateTimeFormat('en', { timeZone: s.timezone }) } catch { setBusy(false); return setMsg({ tone: 'bad', text: 'Unknown timezone. Use an IANA name like Europe/London.' }) }
    const { id: _id, ...rest } = s as any
    const settingsToSave = { ...rest }
    if (!voiceSettingsConfigured) {
      delete settingsToSave.concierge_voice_input_enabled
      delete settingsToSave.concierge_voice_output_enabled
      delete settingsToSave.concierge_speech_voice
    }
    const { error } = await createClient().from('settings').update({ ...settingsToSave, updated_at: new Date().toISOString() }).eq('id', 1)
    setBusy(false)
    if (error) return setMsg({ tone: 'bad', text: friendlyError(error) })
    setMsg({ tone: 'ok', text: 'Settings saved.' }); router.refresh()
  }

  return (
    <form className="stack" onSubmit={save} style={{ maxWidth: 760 }}>
      {msg && <div className={`notice ${msg.tone}`} role={msg.tone === 'bad' ? 'alert' : 'status'}>{msg.text}</div>}
      <div className="card stack"><h3 style={{ margin: 0 }}>General</h3>
        <div className="form-grid">
          <label className="field">Hotel name<input value={s.hotel_name} onChange={(e) => set('hotel_name', e.target.value)} required /></label>
          <label className="field">Currency (ISO)<input value={s.currency} maxLength={3} onChange={(e) => set('currency', e.target.value.toUpperCase())} required /></label>
          <label className="field">Timezone (IANA)<input value={s.timezone} onChange={(e) => set('timezone', e.target.value)} required /></label>
          <label className="field">Check-in time<input type="time" value={s.checkin_time.slice(0, 5)} onChange={(e) => set('checkin_time', e.target.value)} /></label>
          <label className="field">Check-out time<input type="time" value={s.checkout_time.slice(0, 5)} onChange={(e) => set('checkout_time', e.target.value)} /></label>
        </div>
      </div>
      <div className="card stack"><h3 style={{ margin: 0 }}>Guest concierge</h3>
        {!voiceSettingsConfigured && (
          <div className="notice warn" role="status">Apply the latest guest-concierge speech migration to enable voice input and spoken replies.</div>
        )}
        <label className="field">Petal’s response style
          <select value={s.concierge_response_style} onChange={(e) => set('concierge_response_style', e.target.value === 'standard' ? 'standard' : 'trinidadian')}>
            <option value="trinidadian">Trinidadian English — warm, light local phrasing</option>
            <option value="standard">Standard English</option>
          </select>
          <span className="help">This changes how Petal writes her replies, not the hotel information she provides. Trinidadian style keeps local expressions natural and easy to understand.</span>
        </label>
        <label className="small"><input type="checkbox" checked={s.concierge_voice_input_enabled} disabled={!voiceSettingsConfigured} onChange={(e) => set('concierge_voice_input_enabled', e.target.checked)} /> Allow guests to ask Petal questions by voice</label>
        <label className="small"><input type="checkbox" checked={s.concierge_voice_output_enabled} disabled={!voiceSettingsConfigured} onChange={(e) => set('concierge_voice_output_enabled', e.target.checked)} /> Allow guests to play spoken replies</label>
        <label className="field">Petal’s spoken voice
          <select value={s.concierge_speech_voice} disabled={!voiceSettingsConfigured} onChange={(e) => set('concierge_speech_voice', e.target.value === 'diana' || e.target.value === 'hannah' ? e.target.value : 'autumn')}>
            <option value="autumn">Autumn</option>
            <option value="diana">Diana</option>
            <option value="hannah">Hannah</option>
          </select>
          <span className="help">Voice recordings are sent to Groq for transcription and are not stored by this app. Replies to spoken questions play automatically when enabled; guests can tap Listen to replay other non-private replies.</span>
        </label>
      </div>
      <div className="card stack"><h3 style={{ margin: 0 }}>Fees, taxes & holds</h3>
        <div className="form-grid">
          <label className="field">Tax rate %<input type="number" step="0.01" min={0} max={100} value={s.tax_rate} onChange={num('tax_rate')} /></label>
          <label className="field">Service fee %<input type="number" step="0.01" min={0} max={100} value={s.service_fee_rate} onChange={num('service_fee_rate')} /></label>
          <label className="field">Cart hold (minutes)<input type="number" min={1} max={240} value={s.hold_minutes} onChange={num('hold_minutes')} /></label>
          <label className="field">Unpaid booking expiry (hours)<input type="number" min={1} value={s.unpaid_expiry_hours} onChange={num('unpaid_expiry_hours')} /></label>
        </div>
      </div>
      <div className="card stack"><h3 style={{ margin: 0 }}>Cancellation</h3>
        <div className="form-grid">
          <label className="field">Free cancellation until (hours before start)<input type="number" min={0} value={s.free_cancel_hours} onChange={num('free_cancel_hours')} /></label>
          <label className="field">Late cancellation fee %<input type="number" min={0} max={100} step="0.01" value={s.late_cancel_fee_percent} onChange={num('late_cancel_fee_percent')} /></label>
        </div>
        <label className="field">Cancellation policy text<textarea value={s.cancellation_policy} onChange={(e) => set('cancellation_policy', e.target.value)} /></label>
        <label className="field">Booking policy text<textarea value={s.booking_policy} onChange={(e) => set('booking_policy', e.target.value)} /></label>
      </div>
      <div className="card stack"><h3 style={{ margin: 0 }}>Payment methods</h3>
        <label className="small"><input type="checkbox" checked={!!s.payment_methods.bank_transfer?.enabled} onChange={(e) => pm('bank_transfer', { enabled: e.target.checked })} /> Bank transfer (private receipt upload)</label>
        <label className="field">Bank transfer instructions <span className="help">Shown to guests when they choose bank transfer. Do not enter anything you would not show publicly.</span>
          <textarea value={s.payment_methods.bank_transfer?.instructions ?? ''} onChange={(e) => pm('bank_transfer', { instructions: e.target.value })} /></label>
        <label className="small"><input type="checkbox" checked={!!s.payment_methods.cash_on_arrival?.enabled} onChange={(e) => pm('cash_on_arrival', { enabled: e.target.checked })} /> Cash/Card on arrival</label>
        <label className="small"><input type="checkbox" checked={!!s.payment_methods.card?.enabled} onChange={(e) => pm('card', { enabled: e.target.checked, label: 'Credit Card' })} /> Credit Card <span className="pill warn">LOCAL TEST ONLY</span>
          <span className="muted"> (requires CARD_NUM, CARD_EXP and CARD_CVC on the server; no real charge is processed)</span>
        </label>
        <label className="small"><input type="checkbox" checked={!!s.payment_methods.dev_test?.enabled} onChange={(e) => pm('dev_test', { enabled: e.target.checked })} /> Development test payment <span className="pill warn">DEVELOPMENT ONLY</span> <span className="muted">(also requires ALLOW_DEV_PAYMENTS=true on a non-production server; ignored otherwise)</span></label>
      </div>
      <div className="card stack"><h3 style={{ margin: 0 }}>Notifications</h3>
        <label className="small"><input type="checkbox" checked={s.notification_settings.confirmation_email} onChange={(e) => set('notification_settings', { ...s.notification_settings, confirmation_email: e.target.checked })} /> Confirmation emails</label>
        <label className="small"><input type="checkbox" checked={s.notification_settings.reminder_email} onChange={(e) => set('notification_settings', { ...s.notification_settings, reminder_email: e.target.checked })} /> Reminder emails</label>
        <div className="form-grid">
          <label className="field">Reminder lead time (hours)<input type="number" min={1} value={s.notification_settings.reminder_hours_before} onChange={(e) => set('notification_settings', { ...s.notification_settings, reminder_hours_before: Number(e.target.value) })} /></label>
          <label className="field">Staff and contact inquiry email<input type="email" value={s.notification_settings.staff_notify_email} onChange={(e) => set('notification_settings', { ...s.notification_settings, staff_notify_email: e.target.value })} /><span className="help">Booking staff alerts and messages from the public Contact page are sent here.</span></label>
        </div>
        <div className="small muted">Emails use SMTP_USER as the sender address and EMAIL_FROM as the sender name; both are configured on the server.</div>
      </div>
      <div><button className="btn" disabled={busy}>{busy ? <span className="spinner" /> : 'Save settings'}</button></div>
    </form>
  )
}
