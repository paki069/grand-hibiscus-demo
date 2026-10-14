'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { GuestCounters } from '@/components/Stepper'
import { addDays, todayISO } from '@/lib/format'

export default function StayForm({ initial, live = false }: { initial?: { checkin: string; checkout: string; adults: number; children: number }; live?: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [checkin, setCheckin] = useState(initial?.checkin ?? addDays(todayISO(), 1))
  const [checkout, setCheckout] = useState(initial?.checkout ?? addDays(todayISO(), 2))
  const [g, setG] = useState({ a: initial?.adults ?? 2, c: initial?.children ?? 0 })
  const invalid = !checkin || !checkout || checkout <= checkin

  function navigateToResults(nextCheckin: string, nextCheckout: string, adults: number, children: number) {
    if (!live || !nextCheckin || !nextCheckout || nextCheckout <= nextCheckin) return
    const params = new URLSearchParams({
      checkin: nextCheckin,
      checkout: nextCheckout,
      adults: String(adults),
      children: String(children),
    })
    startTransition(() => router.replace(`/book/rooms?${params.toString()}`, { scroll: false }))
  }

  return (
    <form
      className={`hero stack stay-search${live ? ' stay-search-live' : ''}`}
      onSubmit={(e) => {
        e.preventDefault()
        if (!invalid && !live) router.push(`/book/rooms?checkin=${checkin}&checkout=${checkout}&adults=${g.a}&children=${g.c}`)
      }}
    >
      <div className="form-grid" style={{ alignItems: 'end' }}>
        <label className="field">Check-in<input type="date" value={checkin} min={todayISO()} onChange={(e) => {
          const nextCheckin = e.target.value
          const nextCheckout = checkout <= nextCheckin ? addDays(nextCheckin, 1) : checkout
          setCheckin(nextCheckin)
          if (nextCheckout !== checkout) setCheckout(nextCheckout)
          navigateToResults(nextCheckin, nextCheckout, g.a, g.c)
        }} required /></label>
        <label className="field">Check-out<input type="date" value={checkout} min={addDays(checkin, 1)} onChange={(e) => {
          const nextCheckout = e.target.value
          setCheckout(nextCheckout)
          navigateToResults(checkin, nextCheckout, g.a, g.c)
        }} required /></label>
        <GuestCounters adults={g.a} children={g.c} onChange={(a, c) => {
          setG({ a, c })
          navigateToResults(checkin, checkout, a, c)
        }} />
        {!live && <button className="btn accent" disabled={invalid}>Search rooms</button>}
      </div>
      {invalid && <div className="notice bad">Check-out must be after check-in.</div>}
      {live && isPending && <div className="small muted" role="status">Updating room availability…</div>}
    </form>
  )
}
