'use client'
import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { friendlyError, money, fmtTime, addDays, todayISO } from '@/lib/format'
import { GuestCounters } from '@/components/Stepper'

export interface SpaVM { id: string; name: string; description: string; photos: string[]; duration_min: number; price: number | null; max_guests: number; category: string }

export default function SpaBooking({ services, currency, tz, holdMinutes, hotelEntitlementId, embedded = false, onAdded }: {
  services: SpaVM[]; currency: string; tz: string; holdMinutes: number; hotelEntitlementId?: string; embedded?: boolean; onAdded?: () => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const [date, setDate] = useState(addDays(todayISO(), 1))
  const [slots, setSlots] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [g, setG] = useState({ a: 1, c: 0 })
  const [slot, setSlot] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ id: string; tone: 'ok' | 'bad'; text: string } | null>(null)

  async function load(id: string, d: string) {
    setLoading(true); setSlot(''); setSlots(null)
    const { data, error } = await createClient().rpc('spa_available_slots', { p_service: id, p_date: d })
    setLoading(false)
    if (error) return setMsg({ id, tone: 'bad', text: friendlyError(error) })
    setSlots((data ?? []).map((r: { slot_start: string }) => r.slot_start))
  }
  async function add(s: SpaVM) {
    setBusy(true); setMsg(null)
    const client = createClient()
    const { error } = hotelEntitlementId
      ? await client.rpc('add_spa_to_room_cart', {
        p_hotel_entitlement: hotelEntitlementId, p_service: s.id, p_start: slot, p_adults: g.a, p_children: g.c,
      })
      : await client.rpc('add_spa_to_cart', { p_service: s.id, p_start: slot, p_adults: g.a, p_children: g.c })
    setBusy(false)
    if (error) {
      if (error.message === 'not_authenticated') {
        const next = hotelEntitlementId ? `/book/spa?room=${encodeURIComponent(hotelEntitlementId)}` : '/book/spa'
        window.location.href = `/login?next=${encodeURIComponent(next)}`
        return
      }
      setMsg({ id: s.id, tone: 'bad', text: friendlyError(error) }); load(s.id, date); return
    }
    if (onAdded) return onAdded()
    setMsg({ id: s.id, tone: 'ok', text: `Added to cart and held for ${holdMinutes} minutes.` }); load(s.id, date)
  }

  return (
    <div className={`spa-service-grid${embedded ? ' is-embedded' : ''}`}>
      {services.map((s) => (
        <article key={s.id} className="card stack spa-service-card">
          {s.photos[0] ? <img className="spa-service-photo" src={s.photos[0]} alt={s.name} loading="lazy" /> : <div className="spa-service-photo spa-service-placeholder">The Grand Hibiscus Spa</div>}
          <div className="row between spa-service-heading"><h3>{s.name}</h3><span className="pill">{s.category}</span></div>
          <p className="muted small spa-service-description">{s.description}</p>
          <div className="spa-service-meta small"><span>{s.duration_min} minutes</span><strong>{s.price == null ? 'Price on request – settled at the spa' : money(s.price, currency)}</strong></div>
          {open !== s.id ? (
            <button className="btn secondary" onClick={() => { setOpen(s.id); setMsg(null); load(s.id, date) }}>Choose a time</button>
          ) : (
            <div className="stack spa-booking-panel">
              <label className="field">Date<input type="date" min={todayISO()} value={date} onChange={(e) => { setDate(e.target.value); load(s.id, e.target.value) }} /></label>
              {s.max_guests > 1 && <GuestCounters adults={g.a} children={g.c} maxTotal={s.max_guests} onChange={(a, c) => setG({ a, c })} />}
              {loading && <div className="small muted"><span className="spinner" /> Loading times…</div>}
              {slots && slots.length === 0 && <div className="empty">No times available on this date.</div>}
              <div className="row" style={{ gap: '.35rem' }} role="radiogroup" aria-label="Available times">
                {slots?.map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={slot === t} className={`btn sm ${slot === t ? '' : 'secondary'}`} onClick={() => setSlot(t)}>{fmtTime(t, tz)}</button>
                ))}
              </div>
              {msg?.id === s.id && <div className={`notice ${msg.tone}`} role={msg.tone === 'bad' ? 'alert' : 'status'}>{msg.text}</div>}
              <div className="row spa-service-actions">
                <button className="btn" disabled={!slot || busy} onClick={() => add(s)}>{busy ? <span className="spinner" /> : 'Add to cart'}</button>
                <button className="btn secondary" onClick={() => setOpen(null)}>Close</button>
              </div>
            </div>
          )}
        </article>
      ))}
      {!embedded && <div className="row between spa-booking-footer">
        <Link className="btn secondary" href={hotelEntitlementId ? '/book/cart' : '/book/extras'} prefetch={hotelEntitlementId ? false : undefined}>← Back</Link>
        <Link className="btn" href="/book/cart" prefetch={false}>Go to cart</Link>
      </div>}
    </div>
  )
}
