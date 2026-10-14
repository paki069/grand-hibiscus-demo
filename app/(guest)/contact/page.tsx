import Image from 'next/image'
import Link from 'next/link'
import { getSettings } from '@/lib/data'
import ContactForm from '@/components/ContactForm'

export default async function ContactPage() {
  const settings = await getSettings()
  const hotelName = settings?.hotel_name || 'The Grand Hibiscus'

  return (
    <div className="home-page contact-page">
      <section className="home-hero contact-hero" aria-labelledby="contact-title">
        <Image
          src="/images/suite.jpg"
          alt="A welcoming guest room at the hotel"
          fill
          priority
          sizes="100vw"
          className="home-hero-image"
        />
        <div className="home-hero-shade" />
        <div className="home-hero-content">
          <p className="home-eyebrow">A note to {hotelName}</p>
          <h1 id="contact-title">We’re here<br /><em>to make it easier.</em></h1>
          <p className="home-hero-intro">Questions about a stay, a booking, or an experience? Send the hotel team a message.</p>
          <div className="home-hero-actions">
            <a className="home-button home-button-light" href="#contact-form">Send us a message <span aria-hidden="true">↓</span></a>
            <Link className="home-text-link" href="/account">View my bookings <span aria-hidden="true">↗</span></Link>
          </div>
        </div>
        <div className="home-hero-caption"><span>{hotelName}</span><span>Here to help you plan your visit</span></div>
      </section>

      <section className="contact-section" aria-labelledby="contact-section-title">
        <div className="contact-intro">
          <p className="home-eyebrow home-eyebrow-dark">How can we help?</p>
          <h2 id="contact-section-title">Let’s start<br /><em>with a hello.</em></h2>
          <p>Tell us what you need and our team will get back to the email address you provide. If you already have a reservation, you can include its reference number in your message.</p>
          <div className="contact-help-links">
            <Link className="contact-help-card" href="/account">
              <span className="contact-help-number">01</span>
              <span><strong>Already booked?</strong><small>Find your reservation and account actions.</small></span>
              <span className="contact-help-arrow" aria-hidden="true">↗</span>
            </Link>
            <Link className="contact-help-card" href="/book/rooms">
              <span className="contact-help-number">02</span>
              <span><strong>Planning a visit?</strong><small>Explore rooms and begin a booking.</small></span>
              <span className="contact-help-arrow" aria-hidden="true">↗</span>
            </Link>
          </div>
        </div>

        <div className="contact-form-card" id="contact-form" aria-label="Send a message to the hotel">
          <div className="contact-form-heading">
            <p className="home-eyebrow home-eyebrow-dark">Send a message</p>
            <h3>We’re listening.</h3>
            <p>Please don’t include payment card numbers, passwords, or sensitive health information.</p>
          </div>
          <ContactForm />
          <p className="contact-booking-note">Need booking details? Visit <Link href="/account">My bookings</Link>.</p>
        </div>
      </section>

      <section className="contact-location" aria-labelledby="contact-location-title">
        <div>
          <p className="home-eyebrow home-eyebrow-dark">Come and find us</p>
          <h2 id="contact-location-title">Visit {hotelName}</h2>
          <address>Golden Grove Road<br />Piarco, Trinidad and Tobago</address>
          <div className="contact-direct-details" aria-label="Demo hotel contact details">
            <p className="contact-details-label">Demo contact details</p>
            <div><span>Email</span><strong>book@grandhibiscus.com</strong></div>
            <div><span>Phone</span><strong>+1-868-33-GRAND</strong></div>
          </div>
        </div>
        <a className="home-inline-link" href="https://maps.google.com/?q=Golden+Grove+Road%2C+Piarco%2C+Trinidad+and+Tobago" target="_blank" rel="noreferrer">
          Open in Google Maps <span aria-hidden="true">↗</span>
        </a>
      </section>

      <section className="contact-visit-cta" aria-labelledby="contact-cta-title">
        <Image src="/images/pool.jpg" alt="" fill sizes="100vw" aria-hidden="true" className="contact-visit-image" />
        <div className="contact-visit-shade" />
        <div className="contact-visit-copy">
          <p className="home-eyebrow">When you’re ready</p>
          <h2 id="contact-cta-title">Your next stay<br /><em>starts with a plan.</em></h2>
          <Link className="home-button home-button-light" href="/book/rooms">Explore your stay <span aria-hidden="true">↗</span></Link>
        </div>
      </section>
    </div>
  )
}
