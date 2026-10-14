'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function GuestHeaderBookingLink() {
  const pathname = usePathname()
  const isDiningPage = pathname === '/dining'

  return (
    <Link href={isDiningPage ? '/book/restaurant' : '/book/rooms'} className="guest-book-link">
      {isDiningPage ? 'Book a table' : 'Book a stay'} <span aria-hidden="true">↗</span>
    </Link>
  )
}
