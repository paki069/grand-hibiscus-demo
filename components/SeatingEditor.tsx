'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { friendlyError } from '@/lib/format'
import DiningRoomDecor from '@/components/DiningRoomDecor'

interface Area { id: string; name: string; width: number; height: number; active: boolean }
interface Tbl { id: string; area_id: string; label: string; shape: string; x: number; y: number; w: number; h: number; capacity: number; min_party: number; seat_selectable: boolean; active: boolean }
interface Seat { id: string; table_id: string; label: string; x: number; y: number; active: boolean }
type Sel = { kind: 'table' | 'seat'; id: string } | null

const SNAP = 10
const snap = (n: number) => Math.round(n / SNAP) * SNAP

export default function SeatingEditor() {
  const sb = createClient()
  const [areas, setAreas] = useState<Area[]>([])
  const [tables, setTables] = useState<Tbl[]>([])
  const [seats, setSeats] = useState<Seat[]>([])
  const [areaId, setAreaId] = useState<string>('')
  const [sel, setSel] = useState<Sel>(null)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const drag = useRef<{ kind: 'table' | 'seat'; id: string; dx: number; dy: number; ox: number; oy: number } | null>(null)
  const mapRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const [a, t, s] = await Promise.all([sb.from('seating_areas').select('*').order('name'), sb.from('seating_tables').select('*').order('label'), sb.from('seats').select('*').order('label')])
    const e = a.error ?? t.error ?? s.error
    if (e) setErr(friendlyError(e))
    setAreas((a.data ?? []) as Area[]); setTables((t.data ?? []) as Tbl[]); setSeats((s.data ?? []) as Seat[])
    setAreaId((cur) => cur || (a.data?.[0]?.id ?? ''))
    setLoading(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  const area = areas.find((a) => a.id === areaId)
  const areaTables = tables.filter((t) => t.area_id === areaId)
  const selTable = sel?.kind === 'table' ? tables.find((t) => t.id === sel.id) : undefined
  const selSeat = sel?.kind === 'seat' ? seats.find((s) => s.id === sel.id) : undefined
  const flash = (m: string) => { setOk(m); setErr(null); setTimeout(() => setOk(null), 2500) }
  const fail = (e: unknown) => { setErr(friendlyError(e)); setOk(null) }

  async function addArea() {
    const name = prompt('Area name (e.g. Main Dining, Terrace)')?.trim()
    if (!name) return
    const { data, error } = await sb.from('seating_areas').insert({ name, width: 800, height: 500 }).select().single()
    if (error) return fail(error)
    setAreas([...areas, data as Area]); setAreaId(data.id); flash('Area created.')
  }
  async function patchArea(p: Partial<Area>) {
    if (!area) return
    setAreas(areas.map((a) => (a.id === area.id ? { ...a, ...p } : a)))
    const { error } = await sb.from('seating_areas').update(p).eq('id', area.id)
    if (error) fail(error); else flash('Saved.')
  }
  async function deleteArea() {
    if (!area || !confirm(`Delete area "${area.name}" and all its tables? Tables with reservations cannot be deleted; deactivate them instead.`)) return
    const { error } = await sb.from('seating_areas').delete().eq('id', area.id)
    if (error) return fail(error)
    setAreaId(''); await load(); flash('Area deleted.')
  }
  function nextTableLabel(prefix: 'D' | 'Q' | 'VIP', areaId: string, currentLabel?: string, currentId?: string) {
    const used = new Set(tables.filter((t) => t.area_id === areaId && t.id !== currentId).map((t) => t.label))
    const number = currentLabel?.match(/^(?:T\d+|D|Q|VIP)(?:-(\d+))?$/)?.[1]
    if (number) {
      const preferred = `${prefix}-${number.padStart(2, '0')}`
      if (!used.has(preferred)) return preferred
    }
    let n = 1
    while (used.has(`${prefix}-${String(n).padStart(2, '0')}`)) n++
    return `${prefix}-${String(n).padStart(2, '0')}`
  }
  async function addTable(shape: 'round' | 'rect') {
    if (!area) return
    const { data, error } = await sb.from('seating_tables').insert({ area_id: area.id, label: nextTableLabel('Q', area.id), shape, x: 40, y: 40, w: shape === 'round' ? 80 : 140, h: shape === 'round' ? 80 : 70, capacity: 4, min_party: 1, seat_selectable: false }).select().single()
    if (error) return fail(error)
    setTables([...tables, data as Tbl]); setSel({ kind: 'table', id: data.id }); flash('Table added – drag it into place.')
  }
  async function patchTable(id: string, p: Partial<Tbl>, persist = true) {
    const table = tables.find((t) => t.id === id)
    const updates = { ...p }
    if (table && p.capacity !== undefined && p.capacity !== table.capacity && /^(?:T\d+|D|Q|VIP)(?:-\d+)?$/.test(table.label)) {
      const prefix = p.capacity === 2 ? 'D' : p.capacity === 4 ? 'Q' : p.capacity === 8 ? 'VIP' : null
      if (prefix) updates.label = nextTableLabel(prefix, table.area_id, table.label, table.id)
    }
    setTables((ts) => ts.map((t) => (t.id === id ? { ...t, ...updates } : t)))
    if (!persist) return
    const { error } = await sb.from('seating_tables').update(updates).eq('id', id)
    if (error) { fail(error); load() }
  }
  async function deleteTable(t: Tbl) {
    if (!confirm(`Delete table ${t.label}?`)) return
    const { error } = await sb.from('seating_tables').delete().eq('id', t.id)
    if (error) return fail(error)
    setSel(null); await load(); flash('Table deleted.')
  }
  async function addSeat(t: Tbl) {
    const n = seats.filter((s) => s.table_id === t.id).length + 1
    const { data, error } = await sb.from('seats').insert({ table_id: t.id, label: `${t.label}-${n}`, x: snap(t.w / 2), y: snap(t.h / 2) }).select().single()
    if (error) return fail(error)
    setSeats([...seats, data as Seat]); setSel({ kind: 'seat', id: data.id })
  }
  async function patchSeat(id: string, p: Partial<Seat>, persist = true) {
    setSeats((ss) => ss.map((s) => (s.id === id ? { ...s, ...p } : s)))
    if (!persist) return
    const { error } = await sb.from('seats').update(p).eq('id', id)
    if (error) { fail(error); load() }
  }
  async function deleteSeat(s: Seat) {
    const { error } = await sb.from('seats').delete().eq('id', s.id)
    if (error) return fail(error)
    setSel(null); setSeats(seats.filter((x) => x.id !== s.id))
  }

  function down(e: React.PointerEvent, kind: 'table' | 'seat', id: string, ox: number, oy: number) {
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const rect = mapRef.current!.getBoundingClientRect()
    drag.current = { kind, id, dx: e.clientX - rect.left - ox, dy: e.clientY - rect.top - oy, ox, oy }
    setSel({ kind, id })
  }
  function move(e: React.PointerEvent) {
    const d = drag.current
    if (!d || d.kind !== 'table' || !mapRef.current || !area) return
    const rect = mapRef.current.getBoundingClientRect()
    let x = snap(e.clientX - rect.left - d.dx), y = snap(e.clientY - rect.top - d.dy)
    const t = tables.find((q) => q.id === d.id)!
    x = Math.max(0, Math.min(area.width - t.w, x)); y = Math.max(0, Math.min(area.height - t.h, y))
    patchTable(d.id, { x, y }, false)
  }
  async function up() {
    const d = drag.current; drag.current = null
    if (!d) return
    if (d.kind === 'table') { const t = tables.find((q) => q.id === d.id); if (t) await patchTable(d.id, { x: t.x, y: t.y }) }
    else { const s = seats.find((q) => q.id === d.id); if (s) await patchSeat(d.id, { x: s.x, y: s.y }) }
  }
  // Seats are dragged in table-relative coordinates, so translate pointer position accordingly.
  function seatDown(e: React.PointerEvent, s: Seat, t: Tbl) {
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const rect = mapRef.current!.getBoundingClientRect()
    drag.current = { kind: 'seat', id: s.id, dx: e.clientX - rect.left - (t.x + s.x), dy: e.clientY - rect.top - (t.y + s.y), ox: t.x, oy: t.y }
    setSel({ kind: 'seat', id: s.id })
  }
  function seatMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d || d.kind !== 'seat' || !mapRef.current) return
    const rect = mapRef.current.getBoundingClientRect()
    patchSeat(d.id, { x: snap(e.clientX - rect.left - d.dx - d.ox), y: snap(e.clientY - rect.top - d.dy - d.oy) }, false)
  }

  if (loading) return <div className="muted"><span className="spinner" /> Loading…</div>

  return (
    <div className="stack">
      {err && <div className="notice bad" role="alert">{err}</div>}
      {ok && <div className="notice ok" role="status">{ok}</div>}
      <div className="row">
        <select aria-label="Area" value={areaId} onChange={(e) => { setAreaId(e.target.value); setSel(null) }}>
          {areas.length === 0 && <option value="">No areas</option>}
          {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <button className="btn sm secondary" onClick={addArea}>+ Area</button>
        {area && <>
          <button className="btn sm secondary" onClick={() => addTable('round')}>+ Round table</button>
          <button className="btn sm secondary" onClick={() => addTable('rect')}>+ Rect table</button>
          <button className="btn sm danger" onClick={deleteArea}>Delete area</button>
        </>}
      </div>
      {!area ? <div className="empty">Create an area (e.g. “Main Dining”) to start laying out tables.</div> : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', alignItems: 'start' }}>
          <div style={{ gridColumn: 'span 2' }}>
            <div className="map-scroll" style={{ maxHeight: '70vh' }}>
              <div ref={mapRef} className="map" style={{ width: area.width, height: area.height }} onPointerMove={(e) => { move(e); seatMove(e) }} onPointerUp={up} onPointerCancel={up} onPointerDown={() => setSel(null)}>
                {area.name === 'Main Dining' && <DiningRoomDecor />}
                {areaTables.map((t) => (
                  <div key={t.id}>
                    <button type="button" className={`tbl seating-${t.capacity === 8 ? 'vip' : t.capacity === 2 ? 'two' : 'four'} ${t.shape === 'round' ? 'round' : ''} free ${sel?.kind === 'table' && sel.id === t.id ? 'selected' : ''}`}
                      style={{ left: t.x, top: t.y, width: t.w, height: t.h, touchAction: 'none', opacity: t.active ? 1 : 0.5 }}
                      onPointerDown={(e) => down(e, 'table', t.id, t.x, t.y)} aria-label={`Table ${t.label}`}>
                      <span>{t.label}<small>{t.capacity} seats</small></span>
                    </button>
                    {seats.filter((s) => s.table_id === t.id).map((s) => (
                      <button key={s.id} type="button" className={`seat ${sel?.kind === 'seat' && sel.id === s.id ? 'selected' : ''}`} aria-label={`Seat ${s.label}`}
                        style={{ left: t.x + s.x, top: t.y + s.y, touchAction: 'none' }} onPointerDown={(e) => seatDown(e, s, t)}>•</button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="small muted">Drag tables and seats to position them (snaps to a {SNAP}px grid). Changes save automatically. Seat positions are relative to their table.</div>
            {area.name === 'Main Dining' && <div className="legend"><span><i className="map-key seating-two" />Duo</span><span><i className="map-key seating-four" />Quartet</span><span><i className="map-key seating-vip" />VIP</span></div>}
          </div>
          <div className="card stack">
            <h3 style={{ margin: 0 }}>Area</h3>
            <label className="field">Name<input value={area.name} onChange={(e) => setAreas(areas.map((a) => (a.id === area.id ? { ...a, name: e.target.value } : a)))} onBlur={(e) => patchArea({ name: e.target.value })} /></label>
            <div className="form-grid">
              <label className="field">Width<input type="number" min={200} max={2000} step={10} value={area.width} onChange={(e) => patchArea({ width: Number(e.target.value) })} /></label>
              <label className="field">Height<input type="number" min={200} max={2000} step={10} value={area.height} onChange={(e) => patchArea({ height: Number(e.target.value) })} /></label>
            </div>
            <label className="small"><input type="checkbox" checked={area.active} onChange={(e) => patchArea({ active: e.target.checked })} /> Active (visible to guests)</label>
            {selTable && (
              <>
                <hr />
                <h3 style={{ margin: 0 }}>Table</h3>
                <label className="field">Label<input value={selTable.label} onChange={(e) => patchTable(selTable.id, { label: e.target.value }, false)} onBlur={(e) => patchTable(selTable.id, { label: e.target.value })} /></label>
                <div className="form-grid">
                  <label className="field">Capacity<input type="number" min={1} max={40} value={selTable.capacity} onChange={(e) => patchTable(selTable.id, { capacity: Math.max(1, Number(e.target.value)) })} /></label>
                  <label className="field">Min party<input type="number" min={1} max={selTable.capacity} value={selTable.min_party} onChange={(e) => patchTable(selTable.id, { min_party: Math.max(1, Math.min(selTable.capacity, Number(e.target.value))) })} /></label>
                  <label className="field">Width<input type="number" min={30} step={10} value={selTable.w} onChange={(e) => patchTable(selTable.id, { w: Number(e.target.value) })} /></label>
                  <label className="field">Height<input type="number" min={30} step={10} value={selTable.h} onChange={(e) => patchTable(selTable.id, { h: Number(e.target.value) })} /></label>
                </div>
                <label className="field">Shape<select value={selTable.shape} onChange={(e) => patchTable(selTable.id, { shape: e.target.value })}><option value="round">Round</option><option value="rect">Rectangle</option></select></label>
                <label className="small"><input type="checkbox" checked={selTable.seat_selectable} onChange={(e) => patchTable(selTable.id, { seat_selectable: e.target.checked })} /> Guests choose individual seats</label>
                <label className="small"><input type="checkbox" checked={selTable.active} onChange={(e) => patchTable(selTable.id, { active: e.target.checked })} /> Active</label>
                <div className="row"><button className="btn sm secondary" onClick={() => addSeat(selTable)}>+ Seat</button><button className="btn sm danger" onClick={() => deleteTable(selTable)}>Delete table</button></div>
                <div className="small muted">Seats: {seats.filter((s) => s.table_id === selTable.id).length}</div>
              </>
            )}
            {selSeat && (
              <>
                <hr />
                <h3 style={{ margin: 0 }}>Seat</h3>
                <label className="field">Label<input value={selSeat.label} onChange={(e) => patchSeat(selSeat.id, { label: e.target.value }, false)} onBlur={(e) => patchSeat(selSeat.id, { label: e.target.value })} /></label>
                <button className="btn sm danger" onClick={() => deleteSeat(selSeat)}>Delete seat</button>
              </>
            )}
            {!selTable && !selSeat && <div className="small muted">Select a table or seat to edit it.</div>}
          </div>
        </div>
      )}
    </div>
  )
}
