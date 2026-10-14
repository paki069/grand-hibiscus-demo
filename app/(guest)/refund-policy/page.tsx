import Link from 'next/link'
import { getSettings } from '@/lib/data'

export default async function RefundPolicyPage() {
  const settings = await getSettings()
  const hotelName = settings?.hotel_name || 'The Grand Hibiscus Hotel and Restaurant'

  return (
    <article className="stack policy-page legal-copy">
      <header className="card stack">
        <p className="small muted" style={{ margin: 0 }}>Last updated: October 13, 2026</p>
        <h1 style={{ margin: 0 }}>Refund Policy</h1>
        <p>This policy explains how {hotelName} reviews and processes refunds for bookings made through this website. It should be read together with the cancellation terms shown for the specific booking.</p>
      </header>

      <section className="card stack">
        <h2>1. When a refund may be available</h2>
        <p>Refund eligibility depends on the cancellation terms disclosed when you booked, whether any part of the service has already been used, and any additional terms shown for a third-party service. Some cancellations may be subject to a fee. The current cancellation policy configured for this platform is:</p>
        <blockquote>{settings?.cancellation_policy || 'Please review the cancellation terms shown during checkout.'}</blockquote>
      </section>

      <section className="card stack">
        <h2>2. Requesting a cancellation or refund</h2>
        <p>If an online cancellation option is available, use it from <Link href="/account">My bookings</Link>. If you cannot cancel online or believe a refund is due, <Link href="/contact">contact us</Link> with your reservation reference and the reason for your request. Please do not include full card numbers, security codes, or passwords.</p>
        <p>We will review the booking, the applicable policy, and any payment records before confirming the refund amount. A cancellation confirmation will show the recorded fee and payment information when available.</p>
      </section>

      <section className="card stack">
        <h2>3. How refunds are processed</h2>
        <p>Once approved, a refund is arranged through the original payment channel where possible. Bank-transfer or cash payments may require a separate arrangement with the hotel. The time for funds to appear depends on the payment provider or financial institution and will be communicated for the individual request.</p>
        <p>A refund record or status in the booking platform is not, by itself, proof that money has been transferred. The platform does not currently process live card payments.</p>
      </section>

      <section className="card stack">
        <h2>4. Third-party services and cancellations by the hotel</h2>
        <p>Where a booking involves an independent tour or service provider, any refund is subject to the terms disclosed for that service. If the hotel or provider cancels a service, we will contact you with the available refund or rescheduling options for the affected portion.</p>
      </section>

      <section className="card stack">
        <h2>5. Questions</h2>
        <p>For a refund request or question about a decision, please <Link href="/contact">contact us</Link> and include your reservation reference. These terms do not limit any rights that cannot lawfully be limited under applicable law. You can also review our <Link href="/terms">Terms and Conditions</Link>.</p>
      </section>
    </article>
  )
}
