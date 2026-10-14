import Link from 'next/link'
import { getSettings } from '@/lib/data'

function displayTime(value: string) {
  return value.slice(0, 5)
}

export default async function TermsPage() {
  const settings = await getSettings()
  const hotelName = settings?.hotel_name || 'The Grand Hibiscus Hotel and Restaurant'

  return (
    <article className="stack policy-page legal-copy">
      <header className="card stack">
        <p className="small muted" style={{ margin: 0 }}>Last updated: October 14, 2026</p>
        <h1 style={{ margin: 0 }}>Terms and Conditions</h1>
        <p>These terms apply to your use of {hotelName}’s website and online booking platform, and to reservations made through it. By using the platform or making a booking, you agree to these terms. If you do not agree, do not use the booking platform.</p>
      </header>

      <section className="card stack">
        <h2>1. Services and bookings</h2>
        <p>The platform may offer hotel rooms, restaurant services, spa appointments, gym access, tours, and event or contact inquiries. Availability, service details, and eligibility vary by offering. An inquiry is a request for follow-up and is not a confirmed reservation or event booking. Some tours or activities may be operated by independent providers; where applicable, their service terms also apply.</p>
        <p>Some services have age, health, or participation requirements. Review the information shown for the service before booking; an adult must make bookings on behalf of minors and follow any supervision requirements that apply.</p>
        <p>You must provide accurate contact and booking information and have authority to make a reservation for anyone included in it. You are responsible for keeping account sign-in details secure and for activity carried out through your account.</p>
      </section>

      <section className="card stack">
        <h2>2. Rates and payment</h2>
        <p>Prices, currency, taxes, fees, payment method, and payment timing are shown during checkout and in your booking details. The information shown for your reservation is the applicable information for that booking. Bank-transfer receipts submitted through the platform are reviewed by staff.</p>
        <p>The platform does not currently process live card payments. Do not submit card numbers or security codes through booking notes, the contact form, or receipt uploads. A test-card option, if present in a non-production environment, is for testing only and does not charge a card.</p>
        <p>Any refund, amount, and method will be confirmed for the individual booking. Recording a refund in the platform does not itself transfer money; refunds may require separate processing through the relevant payment channel.</p>
      </section>

      <section className="card stack">
        <h2>3. Cancellation and changes</h2>
        <p>Cancellation eligibility, deadlines, and any applicable fee are governed by the policy disclosed for the booking. The current cancellation policy configured for this platform is:</p>
        <blockquote>{settings?.cancellation_policy || 'Please review the cancellation policy shown during checkout.'}</blockquote>
        <p>Where a cancellation option is available in your account, you may use it there. If you cannot cancel online or need to request a change, please <Link href="/contact">contact us</Link>. Any third-party provider may have additional cancellation rules shown with its offering. See the separate <Link href="/refund-policy">Refund Policy</Link> for how eligible refunds are handled.</p>
      </section>

      <section className="card stack">
        <h2>4. Check-in, check-out, and property rules</h2>
        <p>Current standard times are check-in from {displayTime(settings.checkin_time)} and check-out by {displayTime(settings.checkout_time)} ({settings.timezone}). Your booking confirmation or a service-specific notice may provide different instructions. The current booking policy configured for the platform is:</p>
        <blockquote>{settings?.booking_policy || 'Please review the booking instructions shown during checkout.'}</blockquote>
        <p>Guests must follow reasonable safety instructions and property rules. Smoking, pets, late checkout, damage, or other charges apply only where the relevant rule or fee has been disclosed for the property or booking and is permitted by applicable law. Please raise food-allergy or treatment-safety questions directly with the hotel team before using the service.</p>
      </section>

      <section className="card stack">
        <h2>5. Third-party services</h2>
        <p>Where a tour, event, or other service is operated by an independent provider, the provider’s disclosed schedules, safety requirements, and service terms may apply. We will identify provider involvement where it is relevant to your booking. Please contact us if you need help understanding which party is responsible for a particular service.</p>
      </section>

      <section className="card stack">
        <h2>6. Acceptable use and content</h2>
        <p>You must not misuse the platform, interfere with its operation, attempt unauthorized access, upload malicious code, or use automated means to collect data without permission. Site text, images, logos, and software are owned by or licensed to the relevant rights holder and may not be reused without authorization.</p>
      </section>

      <section className="card stack">
        <h2>7. Service availability and events beyond our control</h2>
        <p>We may need to change or cancel a service because of safety, operational, weather, or other circumstances beyond reasonable control. Where this affects a confirmed booking, we will communicate the available options and any applicable refund or rescheduling information.</p>
      </section>

      <section className="card stack">
        <h2>8. Liability</h2>
        <p>Nothing in these terms excludes or limits liability or consumer rights that cannot lawfully be excluded or limited. To the extent permitted by applicable law, we are not responsible for indirect loss resulting from circumstances outside our reasonable control. This section does not change any rights you may have under applicable law.</p>
      </section>

      <section className="card stack">
        <h2>9. Privacy</h2>
        <p>How information is handled through the platform is explained in our <Link href="/privacy">Privacy Policy</Link>.</p>
      </section>

      <section className="card stack">
        <h2>10. Governing law and updates</h2>
        <p>These terms are intended to be governed by the laws of Trinidad and Tobago, subject to any mandatory consumer protections that apply to you. We may update the terms as our services or legal obligations change. The revised date above identifies the latest version.</p>
      </section>

      <section className="card stack">
        <h2>11. Contact</h2>
        <p>{hotelName} is located on Golden Grove Road, Piarco, Trinidad and Tobago. For questions about these terms or a reservation, please use the <Link href="/contact">Contact page</Link>.</p>
      </section>
    </article>
  )
}
