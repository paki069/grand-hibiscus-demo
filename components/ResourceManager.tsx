'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { friendlyError } from '@/lib/format'

export type FieldType = 'text' | 'email' | 'textarea' | 'number' | 'checkbox' | 'select' | 'date' | 'datetime' | 'time' | 'images' | 'image' | 'tags' | 'weekdays'
export interface Field {
  key: string; label: string; type?: FieldType; required?: boolean; options?: { value: string; label: string }[]
  nullable?: boolean; step?: string; help?: string; hideInTable?: boolean; defaultValue?: unknown
  visibleWhen?: { key: string; value: string }; clearWhen?: { key: string; value: string }
}
export interface ResourceConfig {
  table: string; title: string; fields: Field[]; orderBy?: string; searchKeys?: string[]; canDelete?: boolean; canCreate?: boolean; keys?: string[]
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function ImageUpload({ value, onChange, multiple }: { value: string[]; onChange: (v: string[]) => void; multiple?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function upload(files: FileList) {
    setBusy(true); setErr(null)
    const supabase = createClient()
    const urls: string[] = []
    for (const f of Array.from(files)) {
      if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > 5 * 1024 * 1024) { setErr('Images must be JPG/PNG/WebP under 5 MB.'); continue }
      const path = `${crypto.randomUUID()}.${f.type.split('/')[1]}`
      const { error } = await supabase.storage.from('media').upload(path, f, { contentType: f.type })
      if (error) { setErr(error.message); continue }
      urls.push(supabase.storage.from('media').getPublicUrl(path).data.publicUrl)
    }
    setBusy(false)
    if (urls.length) onChange(multiple ? [...value, ...urls] : urls)
  }
  return (
    <div className="stack">
      <div className="row">{value.map((u) => (
        <span key={u} style={{ position: 'relative' }}>
          <img src={u} alt="" width={64} height={64} style={{ objectFit: 'cover', borderRadius: 6 }} />
          <button type="button" aria-label="Remove image" className="btn sm danger" style={{ position: 'absolute', top: -6, right: -6, padding: '0 .3rem' }} onClick={() => onChange(value.filter((x) => x !== u))}>×</button>
        </span>
      ))}</div>
      <input type="file" accept="image/jpeg,image/png,image/webp" multiple={multiple} disabled={busy} onChange={(e) => e.target.files && upload(e.target.files)} />
      {busy && <span className="small muted"><span className="spinner" /> Uploading…</span>}
      {err && <span className="small" style={{ color: 'var(--bad)' }}>{err}</span>}
    </div>
  )
}

const toLocalInput = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : '')

function FieldInput({ f, v, set }: { f: Field; v: any; set: (x: any) => void }) {
  const t = f.type ?? 'text'
  switch (t) {
    case 'textarea': return <textarea value={v ?? ''} onChange={(e) => set(e.target.value)} required={f.required} />
    case 'email': return <input type="email" value={v ?? ''} required={f.required} onChange={(e) => set(e.target.value)} />
    case 'checkbox': return <input type="checkbox" checked={!!v} onChange={(e) => set(e.target.checked)} />
    case 'number': return <input type="number" step={f.step ?? '1'} value={v ?? ''} required={f.required} onChange={(e) => set(e.target.value === '' ? null : Number(e.target.value))} />
    case 'select': return (
      <select value={v ?? ''} required={f.required} onChange={(e) => set(e.target.value === '' ? null : e.target.value)}>
        <option value="">{f.nullable ? '— none —' : 'Select…'}</option>
        {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
    case 'date': return <input type="date" value={v ?? ''} required={f.required} onChange={(e) => set(e.target.value || null)} />
    case 'time': return <input type="time" value={(v ?? '').slice(0, 5)} required={f.required} onChange={(e) => set(e.target.value || null)} />
    case 'datetime': return <input type="datetime-local" value={toLocalInput(v)} required={f.required} onChange={(e) => set(e.target.value ? new Date(e.target.value + 'Z').toISOString() : null)} />
    case 'images': return <ImageUpload multiple value={v ?? []} onChange={set} />
    case 'image': return <ImageUpload value={v ? [v] : []} onChange={(a) => set(a[0] ?? null)} />
    case 'tags': return <input value={(v ?? []).join(', ')} placeholder="comma, separated" onChange={(e) => set(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
    case 'weekdays': return (
      <div className="row" style={{ gap: '.5rem' }}>{WD.map((d, i) => (
        <label key={d} className="small"><input type="checkbox" checked={(v ?? []).includes(i)} onChange={(e) => set(e.target.checked ? [...(v ?? []), i].sort() : (v ?? []).filter((x: number) => x !== i))} /> {d}</label>
      ))}</div>
    )
    default: return <input value={v ?? ''} required={f.required} onChange={(e) => set(e.target.value)} />
  }
}

function cell(f: Field, v: any): string {
  if (v === null || v === undefined || v === '') return '—'
  switch (f.type) {
    case 'checkbox': return v ? 'Yes' : 'No'
    case 'select': return f.options?.find((o) => o.value === v)?.label ?? String(v)
    case 'tags': return (v as string[]).join(', ')
    case 'images': return `${(v as string[]).length} photo(s)`
    case 'image': return 'photo'
    case 'weekdays': return (v as number[]).map((i) => WD[i]).join(' ')
    case 'datetime': return new Date(v).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
    default: return String(v)
  }
}

export default function ResourceManager({ config, filter }: { config: ResourceConfig; filter?: { key: string; value: string } }) {
  const [rows, setRows] = useState<any[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [editing, setEditing] = useState<any | null>(null)
  const [original, setOriginal] = useState<any | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [q, setQ] = useState('')

  const blank = useMemo(() => {
    const o: Record<string, any> = {}
    for (const f of config.fields) o[f.key] = f.defaultValue ?? (f.type === 'checkbox' ? (f.key === 'active' ? true : false) : f.type === 'images' || f.type === 'tags' || f.type === 'weekdays' ? [] : null)
    return o
  }, [config])

  const load = useCallback(async () => {
    let query = createClient().from(config.table).select('*')
    if (filter) query = query.eq(filter.key, filter.value)
    const { data, error } = await query.order(config.orderBy ?? 'created_at', { ascending: true })
    if (error) {
      const retry = await createClient().from(config.table).select('*')
      if (retry.error) return setError(friendlyError(retry.error))
      return setRows(retry.data)
    }
    setError(null); setRows(data)
  }, [config, filter])
  useEffect(() => { load() }, [load])

  const keys = config.keys ?? ['id']
  const match = (q: any, row: any) => keys.reduce((acc, k) => acc.eq(k, row[k]), q)

  async function save(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError(null)
    const payload: Record<string, any> = {}
    for (const f of config.fields) payload[f.key] = editing[f.key]
    if (filter) payload[filter.key] = filter.value
    const sb = createClient().from(config.table)
    const { error } = isNew ? await sb.insert(payload) : await match(sb.update(payload), original)
    setSaving(false)
    if (error) return setError(friendlyError(error))
    setFlash(isNew ? 'Created.' : 'Saved.'); setEditing(null); load()
  }
  async function remove(r: any) {
    if (!confirm('Delete this record? Use "active" off to hide it instead if it is already in use.')) return
    const { error } = await match(createClient().from(config.table).delete(), r)
    if (error) return setError(friendlyError(error))
    setFlash('Deleted.'); load()
  }

  const visible = (rows ?? []).filter((r) => !q || (config.searchKeys ?? config.fields.filter((f) => !f.type || f.type === 'text').map((f) => f.key)).some((k) => String(r[k] ?? '').toLowerCase().includes(q.toLowerCase())))
  const cols = config.fields.filter((f) => !f.hideInTable && f.type !== 'textarea').slice(0, 7)

  return (
    <div className="stack">
      <div className="row between">
        <h2 style={{ margin: 0 }}>{config.title}</h2>
        <div className="row">
          <input placeholder="Filter…" aria-label="Filter" value={q} onChange={(e) => setQ(e.target.value)} />
          {config.canCreate !== false && <button className="btn" onClick={() => { setEditing({ ...blank }); setIsNew(true); setFlash(null) }}>+ New</button>}
        </div>
      </div>
      {error && <div className="notice bad" role="alert">{error}</div>}
      {flash && <div className="notice ok" role="status">{flash}</div>}
      {rows === null && !error ? <div className="muted"><span className="spinner" /> Loading…</div> : visible.length === 0 ? <div className="empty">Nothing here yet.</div> : (
        <div className="table-wrap"><table className="data">
          <thead><tr>{cols.map((f) => <th key={f.key}>{f.label}</th>)}<th /></tr></thead>
          <tbody>{visible.map((r) => (
            <tr key={r.id ?? JSON.stringify(r)}>
              {cols.map((f) => <td key={f.key}>{cell(f, r[f.key])}</td>)}
              <td className="nowrap right">
                <button className="btn sm secondary" onClick={() => { setEditing({ ...r }); setOriginal(r); setIsNew(false); setFlash(null) }}>Edit</button>{' '}
                {config.canDelete !== false && <button className="btn sm danger" onClick={() => remove(r)}>Delete</button>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {editing && (
        <div className="modal-back" role="dialog" aria-modal="true" aria-label={config.title}>
          <form className="modal stack" onSubmit={save}>
            <h3 style={{ margin: 0 }}>{isNew ? 'New' : 'Edit'} · {config.title}</h3>
            {config.fields.filter((f) => !f.visibleWhen || editing[f.visibleWhen.key] === f.visibleWhen.value).map((f) => (
              <label key={f.key} className="field">{f.label}{f.type === 'datetime' && ' (UTC)'}{f.required && ' *'}
                <FieldInput f={f} v={editing[f.key]} set={(x) => {
                  const next = { ...editing, [f.key]: x }
                  for (const dependent of config.fields) {
                    if (dependent.clearWhen?.key === f.key && dependent.clearWhen.value === x) {
                      next[dependent.key] = dependent.defaultValue ?? null
                    }
                  }
                  setEditing(next)
                }} />
                {f.help && <span className="help">{f.help}</span>}
              </label>
            ))}
            {error && <div className="notice bad" role="alert">{error}</div>}
            <div className="row between"><button type="button" className="btn secondary" onClick={() => setEditing(null)}>Cancel</button><button className="btn" disabled={saving}>{saving ? <span className="spinner" /> : 'Save'}</button></div>
          </form>
        </div>
      )}
    </div>
  )
}
