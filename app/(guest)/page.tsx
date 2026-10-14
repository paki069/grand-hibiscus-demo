import Link from 'next/link'
import Image from 'next/image'
import StayForm from '@/components/StayForm'

export default async function Home({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const { denied } = await searchParams
  return (
    <div className="home-page">
      {denied && <div className="home-denied notice warn" role="alert">You do not have access to that area.</div>}
      <section className="home-hero" aria-labelledby="home-title">
        <Image
          src="/images/home-lobby-hero.png"
          alt="Guests being welcomed at The Grand Hibiscus hotel lobby"
          fill
          priority
          sizes="100vw"
          className="home-hero-image"
        />
        <div className="home-hero-shade" />
        <div className="home-hero-content">
          <p className="home-eyebrow">A little space to be somewhere else</p>
          <h1 id="home-title">Find your<br /><em>perfect stay.</em></h1>
          <p className="home-hero-intro">A welcoming room, a table worth lingering over, and time to simply unwind.</p>
          <div className="home-hero-actions">
            <Link className="home-button home-button-light" href="/book/rooms">Explore rooms <span aria-hidden="true">↗</span></Link>
            <a className="home-text-link" href="#the-stay">Discover the hotel <span aria-hidden="true">↓</span></a>
          </div>
        </div>
        <div className="home-hero-caption"><span>Stay a little longer</span><span>Rooms · Dining · Wellness</span></div>
      </section>

      <section className="home-booking" id="booking" aria-labelledby="booking-title">
        <div className="home-booking-heading">
          <p className="home-eyebrow home-eyebrow-dark">Make it yours</p>
          <h2 id="booking-title">Start planning your stay</h2>
          <p>Choose your dates and we’ll take it from there.</p>
        </div>
        <StayForm />
      </section>

      <section className="home-story" id="the-stay">
        <div className="home-story-copy">
          <p className="home-eyebrow home-eyebrow-dark">A place to return to yourself</p>
          <h2>More than a room.<br /><em>A change of pace.</em></h2>
          <p>Ease into the day, make time for good food, and leave a little room for the unexpected. Bring your stay together in one simple booking.</p>
          <Link className="home-inline-link" href="/book/rooms">Find your room <span aria-hidden="true">↗</span></Link>
          <div className="home-story-points">
            <div><span>01</span><p>Thoughtful stays</p></div>
            <div><span>02</span><p>Dining & wellness</p></div>
            <div><span>03</span><p>Tours together</p></div>
          </div>
        </div>
        <div className="home-story-images">
          <div className="home-story-main">
            <Image src="/images/pool.jpg" alt="Sunlit pool surrounded by greenery" fill sizes="(max-width: 760px) 100vw, 48vw" />
          </div>
          <div className="home-story-inset">
            <Image src="/images/suite.jpg" alt="Warmly lit guest room with a king bed" fill sizes="220px" />
          </div>
          <span className="home-image-label">ROOM TO REST · SPACE TO BREATHE</span>
        </div>
      </section>

      <section className="home-experiences" id="experiences" aria-labelledby="experience-title">
        <div className="home-section-heading">
          <div>
            <p className="home-eyebrow home-eyebrow-dark">The good things, all together</p>
            <h2 id="experience-title">Your stay, your way.</h2>
          </div>
          <p>Build the getaway you want. Add dinner, a spa treatment, or a tour to remember—all in one reservation.</p>
        </div>
        <div className="home-experience-grid">
          <Link className="home-experience-card home-experience-stay" href="/book/rooms">
            <Image src="/images/suite.jpg" alt="A quiet, comfortable guest room" fill sizes="(max-width: 760px) 100vw, 33vw" />
            <span className="home-experience-overlay" />
            <span className="home-experience-copy"><small>STAY</small><strong>Make yourself<br />at home.</strong><span>Find your room <b aria-hidden="true">↗</b></span></span>
          </Link>
          <Link className="home-experience-card" href="/book/restaurant">
            <Image src="/images/dining.jpg" alt="An intimate restaurant ready for dinner" fill sizes="(max-width: 760px) 100vw, 33vw" />
            <span className="home-experience-overlay" />
            <span className="home-experience-copy"><small>DINE</small><strong>Stay for<br />another course.</strong><span>Reserve a table <b aria-hidden="true">↗</b></span></span>
          </Link>
          <Link className="home-experience-card" href="/book/spa">
            <Image src="/images/spa.jpg" alt="A relaxing spa treatment" fill sizes="(max-width: 760px) 100vw, 33vw" />
            <span className="home-experience-overlay" />
            <span className="home-experience-copy"><small>UNWIND</small><strong>Give the day<br />back to yourself.</strong><span>Explore spa <b aria-hidden="true">↗</b></span></span>
          </Link>
          <Link className="home-experience-card" href="/book/events">
            <Image src="/images/tours-hero-tobago.jpg" alt="A turquoise bay below Tobago's green coastal hills" fill sizes="(max-width: 760px) 100vw, 25vw" />
            <span className="home-experience-overlay" />
            <span className="home-experience-copy"><small>TOURS</small><strong>Find a day<br />to explore.</strong><span>Explore tours <b aria-hidden="true">↗</b></span></span>
          </Link>
        </div>
      </section>

      <section className="home-final-cta" id="rooms">
        <div className="home-final-image">
          <Image src="/images/resort-hero.jpg" alt="A peaceful stay beside the water" fill sizes="(max-width: 760px) 100vw, 50vw" />
        </div>
        <div className="home-final-copy">
          <p className="home-eyebrow">Your next escape starts here</p>
          <h2>Good days begin<br />with a place to stay.</h2>
          <p>Pick your dates, find the right room, and add the moments you want to remember.</p>
          <Link className="home-button home-button-gold" href="/book/rooms">Check availability <span aria-hidden="true">↗</span></Link>
        </div>
      </section>
    </div>
  )
}
