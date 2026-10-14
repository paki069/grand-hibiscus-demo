import Link from 'next/link'
import { getCart } from '@/lib/data'
import { Notice } from '@/components/ui'

export default async function Extras() {
  const cart = await getCart()
  const hasRoom = cart?.items.some((i) => i.service_type === 'hotel')
  const opts = [
    { href: '/book/restaurant', t: 'Restaurant', d: 'Pick a date, time and your table or seat on the floor plan.' },
    { href: '/book/spa', t: 'Spa', d: 'Browse treatments and choose an available time.' },
    { href: '/book/gym', t: 'Gym', d: 'Choose a day pass or a membership, or add daily access to your stay.' },
    ...(hasRoom ? [{ href: '/book/upgrades', t: 'Room upgrades', d: 'Add airport transfers, early check-in, late checkout, and other room upgrades to selected rooms.' }] : []),
    { href: hasRoom ? '/book/cart' : '/book/events', t: 'Tours', d: hasRoom ? 'Choose a departure that falls within your stay from the room in your cart.' : 'Browse island tours. Bookings are added to a room stay.' },
  ]
  return (
    <div className="stack">
      <ol className="steps"><li className="done">1 · Choose room</li><li className="on">2 · Dining, spa, gym, tours & upgrades</li><li>3 · Cart & pay</li></ol>
      <h1>Add to your stay</h1>
      {!hasRoom && <Notice tone="info">Your cart has no room yet. You can still add other services, or <Link href="/">choose a room first</Link>.</Notice>}
      <div className="grid cols-3">
        {opts.map((o) => (
          <Link key={o.href} href={o.href} className="card stack" style={{ textDecoration: 'none' }}>
            <h3 style={{ margin: 0 }}>{o.t}</h3><p className="muted small">{o.d}</p><span className="btn secondary">Set up {o.t.toLowerCase()} →</span>
          </Link>
        ))}
      </div>
      <div className="row between">
        <Link className="btn secondary" href="/">← Rooms</Link>
        <Link className="btn" href="/book/cart" prefetch={false}>Review cart ({cart?.items.length ?? 0})</Link>
      </div>
    </div>
  )
}
