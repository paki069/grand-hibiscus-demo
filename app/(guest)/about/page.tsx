import Image from 'next/image'
import Link from 'next/link'
import { getSettings } from '@/lib/data'

export default async function AboutPage() {
  const settings = await getSettings()
  const hotelName = settings?.hotel_name || 'The Grand Hibiscus'

  return (
    <div className="home-page about-page">
      <section className="home-hero about-hero" aria-labelledby="about-title">
        <Image
          src="/images/resort-hero.jpg"
          alt="A calm resort pool framed by tropical greenery"
          fill
          priority
          sizes="100vw"
          className="home-hero-image"
        />
        <div className="home-hero-shade" />
        <div className="home-hero-content">
          <p className="home-eyebrow">A little about {hotelName}</p>
          <h1 id="about-title">A stay made<br /><em>to feel easy.</em></h1>
          <p className="home-hero-intro">A welcoming room, something good to eat, and space in the day to unwind or explore.</p>
          <div className="home-hero-actions">
            <Link className="home-button home-button-light" href="/book/rooms">Find your stay <span aria-hidden="true">↗</span></Link>
            <a className="home-text-link" href="#our-approach">Get to know us <span aria-hidden="true">↓</span></a>
          </div>
        </div>
        <div className="home-hero-caption"><span>{hotelName}</span><span>Stay · Dining · Wellness · Experiences</span></div>
      </section>

      <section className="about-story" id="our-approach" aria-labelledby="about-story-title">
        <div className="about-story-copy">
          <p className="home-eyebrow home-eyebrow-dark">Our story</p>
          <h2 id="about-story-title">A welcoming stay,<br /><em>rooted in Piarco.</em></h2>
          <p>On Golden Grove Road in Piarco, {hotelName} brings together hotel stays, dining, wellness, and experiences. Make space to rest, share a meal, or explore Trinidad and Tobago. Plan the parts that matter to you and make your stay your own.</p>
          <Link className="home-inline-link" href="/book/rooms">Explore your stay <span aria-hidden="true">↗</span></Link>
          <div className="home-story-points" aria-label="Ways to enjoy your visit">
            <div><span>01</span><p>Stay</p></div>
            <div><span>02</span><p>Dine</p></div>
            <div><span>03</span><p>Unwind</p></div>
            <div><span>04</span><p>Explore</p></div>
          </div>
        </div>
        <figure className="about-story-media">
          <Image
            src="/images/about-piarco-airport.png"
            alt="Vintage-style illustration of an aircraft at Piarco Airport, Trinidad"
            fill
            sizes="(max-width: 860px) 100vw, 48vw"
          />
          <span className="about-story-image-label">PIARCO AIRPORT · THROUGH THE YEARS</span>
        </figure>
      </section>

      <section className="about-journey-section" aria-labelledby="about-journey-title">
        <div className="about-journey-heading">
          <p className="home-eyebrow home-eyebrow-dark">The experience</p>
          <h2 id="about-journey-title">Make the day<br /><em>your own.</em></h2>
          <p>There is no single way to stay. Start with what you need, then leave room for what feels right.</p>
        </div>
        <ol className="about-journey-list">
          <li><span>01</span><div><h3>Find your place</h3><p>Choose a room and dates that work for your visit.</p></div></li>
          <li><span>02</span><div><h3>Settle into the moment</h3><p>Bring together dining, spa, or gym experiences during your stay.</p></div></li>
          <li><span>03</span><div><h3>See a little more</h3><p>Explore available tours and experiences across Trinidad and Tobago.</p></div></li>
        </ol>
      </section>

      <section className="about-values-section" aria-labelledby="about-values-title">
        <div className="about-values-heading">
          <p className="home-eyebrow">What we care about</p>
          <h2 id="about-values-title">Good days are<br /><em>made of little things.</em></h2>
        </div>
        <div className="about-values-grid">
          <article><span>01</span><h3>Thoughtful stays</h3><p>A welcoming place to pause, rest, and make the most of your time away.</p></article>
          <article><span>02</span><h3>Food worth lingering over</h3><p>A restaurant experience to bring people together around the table.</p></article>
          <article><span>03</span><h3>Time well spent</h3><p>Space for wellness, movement, and experiences beyond your room.</p></article>
        </div>
      </section>

      <section className="about-gallery-section" aria-labelledby="about-gallery-title">
        <div className="home-section-heading">
          <div>
            <p className="home-eyebrow home-eyebrow-dark">A few ways to spend your time</p>
            <h2 id="about-gallery-title">Room to rest.<br />Reasons to stay.</h2>
          </div>
          <Link className="home-inline-link" href="/">Explore the hotel <span aria-hidden="true">↗</span></Link>
        </div>
        <div className="about-gallery-grid">
          <Link className="about-gallery-card" href="/book/rooms" aria-label="Book a stay">
            <figure><Image src="/images/suite.jpg" alt="A comfortable guest suite" fill sizes="(max-width: 760px) 100vw, 40vw" /><figcaption>Stay awhile</figcaption></figure>
          </Link>
          <Link className="about-gallery-card" href="/book/restaurant" aria-label="Book a restaurant table">
            <figure><Image src="/images/dining.jpg" alt="A warmly lit restaurant table ready for dinner" fill sizes="(max-width: 760px) 100vw, 30vw" /><figcaption>Gather around the table</figcaption></figure>
          </Link>
          <Link className="about-gallery-card" href="/book/spa" aria-label="Book a spa treatment">
            <figure><Image src="/images/spa.jpg" alt="A calm setting for a spa treatment" fill sizes="(max-width: 760px) 100vw, 30vw" /><figcaption>Take time to unwind</figcaption></figure>
          </Link>
        </div>
      </section>

      <section className="about-location-section" aria-labelledby="about-location-title">
        <div className="about-location-copy">
          <p className="home-eyebrow">Find us</p>
          <h2 id="about-location-title">A warm welcome<br /><em>in Piarco.</em></h2>
          <p>Find The Grand Hibiscus on Golden Grove Road in Piarco, Trinidad and Tobago. We look forward to welcoming you.</p>
          <div className="about-location-actions">
            <a className="home-button home-button-light" href="https://maps.google.com/?q=Golden+Grove+Road%2C+Piarco%2C+Trinidad+and+Tobago" target="_blank" rel="noreferrer">Open map <span aria-hidden="true">↗</span></a>
            <Link className="home-text-link" href="/contact">Get in touch <span aria-hidden="true">↗</span></Link>
          </div>
        </div>
        <div className="about-destination-ticket" aria-label="Hotel destination and address">
          <p className="about-ticket-eyebrow">Your destination</p>
          <h3>{hotelName}</h3>
          <div className="about-ticket-address">
            <span>Address</span>
            <address>Golden Grove Road<br />Piarco, Trinidad and Tobago</address>
          </div>
          <div className="about-ticket-divider" aria-hidden="true" />
          <div className="about-ticket-barcode" aria-hidden="true" />
        </div>
      </section>
    </div>
  )
}
