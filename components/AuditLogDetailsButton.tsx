'use client'

import { useEffect, useId, useRef, useState } from 'react'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function formatLabel(value: string) {
  return value
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (first) => first.toUpperCase())
}

function formatValue(value: unknown) {
  if (value === null) return '—'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value, null, 2) ?? '—'
}

export default function AuditLogDetailsButton({ details }: { details: unknown }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const entries = isRecord(details) ? Object.entries(details) : null

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
  }, [open])

  return (
    <>
      <button className="btn secondary sm" type="button" onClick={() => setOpen(true)}>
        View details
      </button>
      <dialog
        ref={dialog}
        className="modal"
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === dialog.current) setOpen(false)
        }}
        style={{ border: 0, maxWidth: 760 }}
      >
        <div className="row between">
          <h2 id={titleId} style={{ margin: 0 }}>Audit details</h2>
          <button className="btn secondary sm" type="button" onClick={() => setOpen(false)}>Close</button>
        </div>
        {entries
          ? <dl className="stack" style={{ margin: '1rem 0 0', gap: '.75rem' }}>
            {entries.map(([key, value]) => (
              <div key={key} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, .35fr) 1fr', gap: '1rem', borderTop: '1px solid var(--line)', paddingTop: '.65rem' }}>
                <dt style={{ fontWeight: 700 }}>{formatLabel(key)}</dt>
                <dd style={{ margin: 0, minWidth: 0, overflowWrap: 'anywhere' }}>
                  {value !== null && typeof value === 'object'
                    ? <pre style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{formatValue(value)}</pre>
                    : formatValue(value)}
                </dd>
              </div>
            ))}
          </dl>
          : <pre style={{ margin: '1rem 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{formatValue(details)}</pre>}
      </dialog>
    </>
  )
}
