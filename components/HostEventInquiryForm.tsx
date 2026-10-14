'use client'
import { useState } from 'react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { friendlyError } from '@/lib/format'

type Category = 'personal' | 'cultural' | 'corporate'
type ContactProfile = { first_name: string; last_name: string; email: string | null; phone: string } | null

const CATEGORIES: { id: Category; title: string; description: string; types: string[] }[] = [
  {
    id: 'personal',
    title: 'Personal celebrations',
    description: 'Gather your favorite people for a milestone or celebration.',
    types: ['Weddings and Receptions', 'Anniversaries and Birthday Parties', 'Proms and Graduations', 'Family Reunions', 'Religious Celebrations'],
  },
  {
    id: 'cultural',
    title: 'Cultural & entertainment events',
    description: 'Bring people together through culture, food, music, or wellness.',
    types: ['Gala Dinners and Fundraisers', 'Live Music and Concerts', 'Wine Tastings and Cooking Classes', 'Art Exhibitions and Artist Residencies', 'Wellness Retreats', 'Themed and Holiday Parties'],
  },
  {
    id: 'corporate',
    title: 'Corporate events',
    description: 'Plan a focused gathering for your team, clients, or industry.',
    types: ['Conferences and Congresses', 'Seminars and Workshops', 'Company Meetings', 'Product Launches', 'Trade Shows and Exhibitions', 'Team-Building Activities'],
  },
]

const SPACES = [
  'Banquet Hall',
  'Auditorium',
  'Pool',
  'Restaurant / Private Dining',
  'Garden / Outdoor Space',
  'Guest Rooms',
  'Open to hotel recommendations',
  'Other',
]

export default function HostEventInquiryForm({ profile }: { profile: ContactProfile }) {
  const [category, setCategory] = useState<Category | null>(null)
  const [eventType, setEventType] = useState('')
  const [customEventType, setCustomEventType] = useState('')
  const [organization, setOrganization] = useState('')
  const [contactName, setContactName] = useState(profile ? `${profile.first_name} ${profile.last_name}`.trim() : '')
  const [contactTitle, setContactTitle] = useState('')
  const [email, setEmail] = useState(profile?.email ?? '')
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [website, setWebsite] = useState('')
  const [preferredDate, setPreferredDate] = useState('')
  const [dateFlexible, setDateFlexible] = useState(false)
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [expectedGuests, setExpectedGuests] = useState('')
  const [spaces, setSpaces] = useState<string[]>([])
  const [customSpace, setCustomSpace] = useState('')
  const [requestRates, setRequestRates] = useState(false)
  const [estimatedRooms, setEstimatedRooms] = useState('')
  const [checkinSystem, setCheckinSystem] = useState('undecided')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const selectedCategory = CATEGORIES.find((item) => item.id === category)

  function chooseCategory(value: Category) {
    setCategory(value)
    setEventType('')
    setCustomEventType('')
  }

  function toggleSpace(value: string) {
    setSpaces((current) => current.includes(value)
      ? current.filter((space) => space !== value)
      : [...current, value])
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!category) return
    if (spaces.length === 0) {
      setError('Select at least one hotel space for the team to consider.')
      return
    }
    if (spaces.includes('Other') && !customSpace.trim()) {
      setError('Describe the other hotel space you would like us to consider.')
      return
    }
    if (startTime && endTime && endTime <= startTime) {
      setError('The end time must be later than the start time.')
      return
    }
    setBusy(true)
    setError(null)
    const { error: submitError } = await createClient().rpc('submit_host_event_inquiry', {
      p_submission: {
        category,
        event_type: eventType,
        custom_event_type: customEventType.trim(),
        organization_name: organization.trim(),
        contact_name: contactName.trim(),
        contact_title: contactTitle.trim(),
        email: email.trim(),
        phone: phone.trim(),
        website: website.trim(),
        preferred_date: preferredDate,
        date_flexible: dateFlexible,
        start_time: startTime || null,
        end_time: endTime || null,
        expected_guests: Number(expectedGuests),
        spaces_requested: spaces,
        custom_space: customSpace.trim(),
        request_special_room_rates: requestRates,
        estimated_room_count: requestRates && estimatedRooms ? Number(estimatedRooms) : null,
        checkin_system: checkinSystem,
        details: details.trim(),
      },
    })
    setBusy(false)
    if (submitError) {
      setError(friendlyError(submitError))
      return
    }
    setSubmitted(true)
  }

  return (
    <div className="host-event-inquiry">
      <section className="home-hero tours-hero host-events-hero" aria-labelledby="host-events-title">
        <Image src="/images/events.jpg" alt="" fill priority sizes="100vw" className="home-hero-image" />
        <div className="home-hero-shade" />
        <div className="home-hero-content">
          <p className="home-eyebrow">Events at The Grand Hibiscus</p>
          <h1 id="host-events-title">Bring your<br /><em>event to life.</em></h1>
          <p className="home-hero-intro">From personal celebrations to company gatherings, tell us what you have in mind and where you’d like to host it.</p>
          <div className="home-hero-actions">
            <a className="home-button home-button-light" href="#event-categories">Explore event options <span aria-hidden="true">↓</span></a>
          </div>
        </div>
        <div className="home-hero-caption"><span>Gather at The Grand Hibiscus</span><span>Tell us what you’re planning</span></div>
      </section>

      <section className="host-event-content" id="event-categories">
        <p className="home-eyebrow home-eyebrow-dark">Start with the kind of gathering</p>
        <h2>What are you planning?</h2>
        <p className="host-event-lede">Choose a category to begin an event inquiry. You can select a listed event type or tell us about another idea.</p>
        <div className="host-event-categories">
          {CATEGORIES.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={`host-event-category${category === item.id ? ' selected' : ''}`}
              aria-pressed={category === item.id}
              onClick={() => chooseCategory(item.id)}
            >
              <span className="host-event-category-number">{String(index + 1).padStart(2, '0')}</span>
              <strong>{item.title}</strong>
              <span>{item.description}</span>
            </button>
          ))}
        </div>

        {category && selectedCategory && !submitted && (
          <form className="host-event-form stack" onSubmit={submit}>
            <div className="row between host-event-form-heading">
              <div>
                <p className="home-eyebrow home-eyebrow-dark">Event inquiry</p>
                <h2>{selectedCategory.title}</h2>
              </div>
              <button className="btn secondary" type="button" onClick={() => setCategory(null)} disabled={busy}>Change category</button>
            </div>
            {error && <div className="notice bad" role="alert">{error}</div>}

            <fieldset className="host-event-fieldset stack">
              <legend>About your event</legend>
              <div className="form-grid">
                <label className="field"><span className="host-event-field-label">Event type</span>
                  <select value={eventType} onChange={(event) => setEventType(event.target.value)} required disabled={busy}>
                    <option value="">Choose an event type</option>
                    {selectedCategory.types.map((type) => <option key={type} value={type}>{type}</option>)}
                    <option value="Other">Other</option>
                  </select>
                </label>
                {eventType === 'Other' && <label className="field"><span className="host-event-field-label">Tell us what kind of event</span>
                  <input value={customEventType} onChange={(event) => setCustomEventType(event.target.value)} maxLength={120} required disabled={busy} />
                </label>}
                <label className="field"><span className="host-event-field-label">Preferred date</span><input type="date" value={preferredDate} onChange={(event) => setPreferredDate(event.target.value)} required disabled={busy} /></label>
                <label className="field host-event-flexible-date">
                  <span className="host-event-field-label">Can the date be flexible?</span>
                  <span><input type="checkbox" checked={dateFlexible} onChange={(event) => setDateFlexible(event.target.checked)} disabled={busy} /> We can consider other dates</span>
                </label>
                <label className="field"><span className="host-event-field-label">Start time (optional)</span><input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} disabled={busy} /></label>
                <label className="field"><span className="host-event-field-label">End time (optional)</span><input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} disabled={busy} /></label>
                <label className="field"><span className="host-event-field-label">Estimated number of guests</span><input type="number" min={1} max={100000} step={1} value={expectedGuests} onChange={(event) => setExpectedGuests(event.target.value)} required disabled={busy} /></label>
              </div>
              <fieldset className="host-event-spaces">
                <legend>Which hotel spaces would you like us to consider? <span className="muted">(select all that apply)</span></legend>
                <div className="host-event-space-grid">
                  {SPACES.map((space) => (
                    <label key={space} className="host-event-check">
                      <input type="checkbox" checked={spaces.includes(space)} onChange={() => toggleSpace(space)} disabled={busy} />
                      {space}
                    </label>
                  ))}
                </div>
                {spaces.includes('Other') && <label className="field">Other space
                  <input value={customSpace} onChange={(event) => setCustomSpace(event.target.value)} maxLength={200} required disabled={busy} />
                </label>}
              </fieldset>
              <label className="field">Tell us about the event
                <textarea value={details} onChange={(event) => setDetails(event.target.value)} minLength={10} maxLength={5000} required disabled={busy} placeholder="Share your vision, any setup needs, and what you would like our team to know." />
              </label>
            </fieldset>

            <fieldset className="host-event-fieldset stack">
              <legend>Organizer contact</legend>
              <div className="form-grid">
                <label className="field"><span className="host-event-field-label">Company or organization (optional)</span><input value={organization} onChange={(event) => setOrganization(event.target.value)} maxLength={200} disabled={busy} /></label>
                <label className="field"><span className="host-event-field-label">Contact person</span><input value={contactName} onChange={(event) => setContactName(event.target.value)} maxLength={200} required disabled={busy} /></label>
                <label className="field"><span className="host-event-field-label">Title (optional)</span><input value={contactTitle} onChange={(event) => setContactTitle(event.target.value)} maxLength={100} disabled={busy} /></label>
                <label className="field"><span className="host-event-field-label">Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required disabled={busy} /></label>
                <label className="field"><span className="host-event-field-label">Phone</span><input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} minLength={7} maxLength={50} required disabled={busy} /></label>
                <label className="field"><span className="host-event-field-label">Website or social media (optional)</span><input type="url" value={website} onChange={(event) => setWebsite(event.target.value)} maxLength={500} placeholder="https://" disabled={busy} /></label>
              </div>
            </fieldset>

            <fieldset className="host-event-fieldset stack">
              <legend>Guest arrangements</legend>
              <label className="host-event-check">
                <input type="checkbox" checked={requestRates} onChange={(event) => setRequestRates(event.target.checked)} disabled={busy} />
                I’d like to request special room rates for event attendees
              </label>
              {requestRates && <label className="field">Estimated number of rooms (optional)
                <input type="number" min={1} max={9999} step={1} value={estimatedRooms} onChange={(event) => setEstimatedRooms(event.target.value)} disabled={busy} />
              </label>}
              <fieldset className="host-event-checkin">
                <legend>Guest check-in system for your event</legend>
                {[
                  ['hotel', 'Request the hotel’s check-in system'],
                  ['own', 'We will use our own system'],
                  ['undecided', 'Not sure — let’s discuss'],
                  ['not_needed', 'Check-in system not needed'],
                ].map(([value, label]) => (
                  <label key={value} className="host-event-check">
                    <input type="radio" name="checkin-system" value={value} checked={checkinSystem === value} onChange={() => setCheckinSystem(value)} disabled={busy} />
                    {label}
                  </label>
                ))}
              </fieldset>
            </fieldset>

            <div className="host-event-submit">
              <p className="small muted">Submitting this form sends an inquiry to the hotel team. It does not reserve a space or confirm an event.</p>
              <button className="btn accent" disabled={busy}>{busy ? <span className="spinner" /> : 'Send event inquiry'}</button>
            </div>
          </form>
        )}

        {submitted && (
          <div className="notice ok host-event-success" role="status">
            <strong>Thank you for reaching out.</strong>
            <p>Your event inquiry has been sent to The Grand Hibiscus team. This is not a booking or approval; our team will follow up with you directly.</p>
          </div>
        )}
      </section>
    </div>
  )
}
