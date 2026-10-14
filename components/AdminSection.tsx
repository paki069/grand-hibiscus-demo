import Link from 'next/link'
import type { ReactNode } from 'react'
import { createClient } from '@/lib/supabase/server'
import ResourceManager, { type ResourceConfig, type Field } from '@/components/ResourceManager'

export type Opts = { value: string; label: string }[]
export interface Tab { key: string; label: string; config: ResourceConfig; selects?: Record<string, { table: string; label: string; where?: [string, any] }> }

/** Admin CRUD page: tabs of ResourceManagers, with select options resolved server-side. */
export default async function AdminSection({ title, base, tabs, tab, intro, customContent }: { title: string; base: string; tabs: Tab[]; tab?: string; intro?: string; customContent?: ReactNode }) {
  const active = tabs.find((t) => t.key === tab) ?? tabs[0]
  const supabase = await createClient()
  const fields: Field[] = []
  for (const f of active.config.fields) {
    const sel = active.selects?.[f.key]
    if (sel) {
      let q = supabase.from(sel.table).select(`id, ${sel.label}`).order(sel.label)
      if (sel.where) q = q.eq(sel.where[0], sel.where[1])
      const { data } = await q
      fields.push({ ...f, type: 'select', options: (data ?? []).map((r: any) => ({ value: r.id, label: r[sel.label] })) })
    } else fields.push(f)
  }
  return (
    <div className="stack">
      <h1>{title}</h1>
      {intro && <p className="muted small">{intro}</p>}
      <div className="tabs">{tabs.map((t) => <Link key={t.key} href={`${base}?tab=${t.key}`} className={t.key === active.key ? 'active' : ''}>{t.label}</Link>)}</div>
      {customContent ?? <ResourceManager key={active.key} config={{ ...active.config, fields }} />}
    </div>
  )
}
