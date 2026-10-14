'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

const ADMIN_GROUPS: { title: string; items: [string, string][] }[] = [
  { title: 'Overview', items: [['/admin', 'Dashboard'], ['/admin/reservations', 'Reservations'], ['/admin/payments', 'Payments'], ['/admin/guests', 'Guests']] },
  { title: 'Inventory', items: [['/admin/rooms', 'Rooms'], ['/admin/restaurant', 'Restaurant'], ['/admin/restaurant/seating', 'Seating map'], ['/admin/spa', 'Spa'], ['/admin/gym', 'Gym'], ['/admin/events', 'Tours'], ['/admin/host-events', 'Events']] },
  { title: 'System', items: [['/admin/staff', 'Staff accounts'], ['/admin/settings', 'Settings'], ['/admin/learn', 'Learn with Hibi'], ['/admin/loyalty', 'Loyalty rewards'], ['/admin/notifications', 'Notifications'], ['/admin/audit', 'Audit log']] },
]

export default function OpsNav({ role, areas, name }: { role: string; areas: string[]; name: string }) {
  const path = usePathname()
  const [open, setOpen] = useState(false)
  const link = (href: string, label: string) => {
    const active = href === '/admin' ? path === '/admin' : path === href || (path.startsWith(href + '/') && !(href === '/admin/restaurant' && path.startsWith('/admin/restaurant/seating')))
    return <Link key={href} href={href} className={active ? 'active' : ''} onClick={() => setOpen(false)}>{label}</Link>
  }
  return (
    <>
      <button className="btn sm secondary menu-btn" style={{ position: 'fixed', top: 8, right: 8, zIndex: 30 }} onClick={() => setOpen(!open)} aria-label="Toggle menu">☰ Menu</button>
      <nav className={`side ${open ? 'open' : ''}`} aria-label="Operations">
        <span className="brand" style={{ color: '#fff', fontFamily: 'Georgia, serif', fontSize: '1.1rem' }}>Hotel Ops<br /><small style={{ color: '#8fb0a8', fontFamily: 'inherit', fontSize: '.75rem' }}>{name} · {role}</small></span>
        <h4>Front desk</h4>
        {link('/staff', 'Staff home')}
        {link('/staff/scan', 'QR scanner')}
        {link('/staff/list', 'Today’s list')}
        {(role === 'admin' || areas.includes('hotel')) && <>
          {link('/staff/birthday', 'Birthday rewards')}
          {link('/staff/requests', 'Requests')}
        </>}
        {role === 'admin' && ADMIN_GROUPS.map((g) => <div key={g.title}><h4>{g.title}</h4>{g.items.map(([h, l]) => link(h, l))}</div>)}
        <h4>Account</h4>
        <form action="/auth/signout" method="post"><button className="btn sm secondary" style={{ margin: '.3rem .7rem' }}>Sign out</button></form>
      </nav>
    </>
  )
}
