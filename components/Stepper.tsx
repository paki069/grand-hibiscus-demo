'use client'

export function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="guest-counter">
      <span className="guest-counter-label">{label}</span>
      <div className="stepper" role="group" aria-label={label}>
        <button type="button" aria-label={`Fewer ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
        <span aria-live="polite">{value}</span>
        <button type="button" aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
      </div>
    </div>
  )
}

/** Adults + children counters. Children are optional; at least one adult is required. */
export function GuestCounters({ adults, children, onChange, maxAdults = 10, maxChildren = 10, maxTotal = 20 }: {
  adults: number; children: number; onChange: (a: number, c: number) => void; maxAdults?: number; maxChildren?: number; maxTotal?: number
}) {
  return (
    <div className="guest-counters">
      <Stepper label="Adults" value={adults} min={1} max={Math.min(maxAdults, maxTotal - children)} onChange={(a) => onChange(a, children)} />
      <Stepper label="Children" value={children} min={0} max={Math.min(maxChildren, maxTotal - adults)} onChange={(c) => onChange(adults, c)} />
    </div>
  )
}
