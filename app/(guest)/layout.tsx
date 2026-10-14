import Link from 'next/link'
import Image from 'next/image'
import { Banknote, CreditCard, Landmark } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { getCart, getSettings } from '@/lib/data'
import GuestHeaderBookingLink from '@/components/GuestHeaderBookingLink'
import GuestHeader from '@/components/GuestHeader'
import GuestNavigation from '@/components/GuestNavigation'
import GuestConcierge from '@/components/GuestConcierge'
import { createClient } from '@/lib/supabase/server'

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h7.5a2 2 0 0 0 1.9-1.4L20 9H6" />
      <circle cx="9.5" cy="20" r="1" />
      <circle cx="17" cy="20" r="1" />
    </svg>
  )
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="8" r="3.25" />
      <path d="M5 20c.6-3.4 3.2-5.3 7-5.3s6.4 1.9 7 5.3" />
    </svg>
  )
}

export default async function GuestLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const [profile, settings, cart, auth] = await Promise.all([
    getProfile(),
    getSettings(),
    getCart(),
    supabase.auth.getUser(),
  ])
  if (auth.error && auth.error.name !== 'AuthSessionMissingError') {
    throw new Error(`Unable to verify the signed-in user for guest navigation: ${auth.error.message}`)
  }
  const navProfile = auth.data.user?.is_anonymous ? null : profile
  const cartCount = cart?.items.length ?? 0
  const operationsHref = navProfile && navProfile.role !== 'customer'
    ? navProfile.role === 'admin' ? '/admin' : '/staff'
    : undefined
  return (
    <div className="guest-shell">
      <GuestHeader>
        <div className="guest-header-inner">
          <Link href="/" className="guest-brand" aria-label={`${settings?.hotel_name ?? 'The Grand Hibiscus'} home`}>
            <span className="guest-brand-desktop-logo" aria-hidden="true">
              <Image src="/images/grand-hibiscus-mark-black.png" alt="" width={54} height={50} className="guest-brand-logo guest-brand-logo-dark" />
              <Image src="/images/grand-hibiscus-mark-white.png" alt="" width={54} height={50} className="guest-brand-logo guest-brand-logo-light" />
            </span>
            <Image src="/images/grand-hibiscus-mobile-logo-light.png" alt="" width={78} height={78} className="guest-brand-mobile-logo guest-brand-mobile-logo-light" />
            <Image src="/images/grand-hibiscus-mobile-logo-dark.png" alt="" width={78} height={78} className="guest-brand-mobile-logo guest-brand-mobile-logo-dark" />
            <span className="guest-brand-copy">
              <strong>{settings?.hotel_name ?? 'The Grand Hibiscus'}</strong>
              <small>EAT · DINE · UNWIND</small>
            </span>
          </Link>
          <GuestNavigation operationsHref={operationsHref} />
          <div className="guest-header-actions">
            <Link
              href="/book/cart"
              className="guest-cart guest-icon-link"
              prefetch={false}
              aria-label={cartCount > 0 ? `Cart, ${cartCount} item${cartCount === 1 ? '' : 's'}` : 'Cart'}
              title="Cart"
            >
              <CartIcon />
              {cartCount > 0 && <span className="guest-cart-count" aria-hidden="true">{cartCount}</span>}
            </Link>
            {navProfile ? (
              <>
                <Link href="/account" className="guest-account guest-icon-link" aria-label="My bookings" title="My bookings"><UserIcon /></Link>
                {navProfile.role !== 'customer' && <Link href={navProfile.role === 'admin' ? '/admin' : '/staff'} className="guest-account">Operations</Link>}
                <form action="/auth/signout" method="post"><button className="guest-signout">Sign out</button></form>
              </>
            ) : (
              <Link href="/login" className="guest-account guest-icon-link" aria-label="Sign in" title="Sign in"><UserIcon /></Link>
            )}
            <GuestHeaderBookingLink />
          </div>
        </div>
      </GuestHeader>
      <main className="guest-main">{children}</main>
      <footer className="guest-footer">
        <div className="guest-footer-inner">
          <div className="guest-footer-brand">
            <Link href="/" className="guest-footer-name">{settings?.hotel_name ?? 'The Grand Hibiscus'}</Link>
            <p>A considered stay, from the first search to the last slow morning.</p>
          </div>
          <nav className="guest-footer-nav" aria-label="Footer navigation">
            <div className="guest-footer-column">
              <h2 className="guest-footer-heading">Plan your visit</h2>
              <Link href="/book/rooms">Rooms</Link>
              <Link href="/book/restaurant">Restaurant</Link>
              <Link href="/book/spa">Spa</Link>
            </div>
            <div className="guest-footer-column">
              <h2 className="guest-footer-heading">Explore</h2>
              <Link href="/book/gym">Gym</Link>
              <Link href="/book/events">Tours</Link>
              <Link href="/events">Events</Link>
            </div>
            <div className="guest-footer-column">
              <h2 className="guest-footer-heading">Guest services</h2>
              <Link href="/about">About</Link>
              <Link href="/contact">Contact</Link>
              <Link href="/account">My bookings</Link>
            </div>
            <div className="guest-footer-column">
              <h2 className="guest-footer-heading">Policies</h2>
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <Link href="/refund-policy">Refund policy</Link>
            </div>
          </nav>
          <div className="guest-footer-note">
            <small>© {new Date().getFullYear()} {settings?.hotel_name ?? 'The Grand Hibiscus'}</small>
            <div className="guest-footer-payments" aria-label="We accept cash, bank transfer, and card">
              <span className="guest-footer-payments-label">We Accept</span>
              <span className="guest-footer-payment"><Banknote aria-hidden="true" size={17} strokeWidth={1.7} />Cash</span>
              <span className="guest-footer-payment"><Landmark aria-hidden="true" size={17} strokeWidth={1.7} />Bank Transfer</span>
              <span className="guest-footer-payment"><CreditCard aria-hidden="true" size={17} strokeWidth={1.7} />Card</span>
            </div>
          </div>
        </div>
      </footer>
      <GuestConcierge
        responseStyle={settings?.concierge_response_style ?? 'trinidadian'}
        voiceInputEnabled={settings?.concierge_voice_input_enabled ?? true}
        voiceOutputEnabled={settings?.concierge_voice_output_enabled ?? true}
      />
    </div>
  )
}
