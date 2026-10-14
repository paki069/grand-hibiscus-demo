import { getProfile } from '@/lib/auth'
import HostEventInquiryForm from '@/components/HostEventInquiryForm'

export default async function HostEventsPage() {
  const profile = await getProfile()
  const contact = profile
    ? { first_name: profile.first_name, last_name: profile.last_name, email: profile.email, phone: profile.phone }
    : null

  return (
    <div className="home-page host-events-page">
      <HostEventInquiryForm profile={contact} />
    </div>
  )
}
