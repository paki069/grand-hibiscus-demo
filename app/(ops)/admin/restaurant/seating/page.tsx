import Link from 'next/link'
import SeatingEditor from '@/components/SeatingEditor'

export default function SeatingPage() {
  return (
    <div className="stack">
      <div className="row between"><h1 style={{ margin: 0 }}>Seating-map editor</h1><Link className="btn secondary sm" href="/admin/restaurant">← Restaurant</Link></div>
      <p className="muted small">Create areas, place tables, add selectable seats and set capacities. Double booking is prevented by the database regardless of layout.</p>
      <SeatingEditor />
    </div>
  )
}
