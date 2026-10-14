'use client'

import { useRef, useState, type KeyboardEvent } from 'react'
import Link from 'next/link'

const links = [
  ['Stay', '/'],
  ['Dining', '/dining'],
  ['Spa', '/book/spa'],
  ['Gym', '/book/gym'],
  ['Tours', '/book/events'],
  ['Events', '/events'],
] as const

export default function GuestNavigation({ operationsHref }: { operationsHref?: string }) {
  const [open, setOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  function handleMenuKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      setOpen(false)
      menuButtonRef.current?.focus()
    }
  }

  return (
    <>
      <button
        ref={menuButtonRef}
        type="button"
        className="guest-menu-toggle"
        aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={open}
        aria-controls="guest-main-navigation"
        onClick={() => setOpen((isOpen) => !isOpen)}
        onKeyDown={handleMenuKeyDown}
      >
        {open
          ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>}
      </button>
      <nav
        id="guest-main-navigation"
        className={`guest-nav${open ? ' is-open' : ''}`}
        aria-label="Main navigation"
        onKeyDown={handleMenuKeyDown}
      >
        {links.map(([label, href]) => (
          <Link key={href} href={href} onClick={() => setOpen(false)}>{label}</Link>
        ))}
        {operationsHref && (
          <Link className="guest-mobile-account" href={operationsHref} onClick={() => setOpen(false)}>
            Operations
          </Link>
        )}
      </nav>
    </>
  )
}
