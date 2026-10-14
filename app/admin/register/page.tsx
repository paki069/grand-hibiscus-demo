import Link from 'next/link'
import AdminRegistrationForm from '@/components/AdminRegistrationForm'

export const metadata = {
  title: 'Team registration | The Grand Hibiscus',
  robots: { index: false, follow: false },
}

export default function AdminRegistrationPage() {
  return (
    <main className="container">
      <div className="card stack" style={{ maxWidth: 560, margin: '2rem auto' }}>
        <Link href="/" className="small">← Back to site</Link>
        <h1 style={{ marginBottom: 0 }}>Team registration</h1>
        {process.env.SUPABASE_SERVICE_ROLE_KEY ? (
          <>
            <p className="muted">Register for an admin account. Email confirmation is not required; an existing administrator must approve your account before you can sign in.</p>
            <AdminRegistrationForm />
          </>
        ) : (
          <div className="notice warn" role="status">
            Registration is unavailable because <code>SUPABASE_SERVICE_ROLE_KEY</code> is not configured on the server.
          </div>
        )}
      </div>
    </main>
  )
}
