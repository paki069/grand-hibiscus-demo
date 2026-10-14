import Link from 'next/link'
import AuthForm from '@/components/AuthForm'
import { safeNext } from '@/components/ui'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  return (
    <div className="container">
      <Link href="/" className="small">← Back to site</Link>
      <AuthForm next={safeNext(next)} />
      <p className="small muted" style={{ textAlign: 'center' }}>
        Administrator? <Link href="/admin/login">Sign in here</Link>.
      </p>
    </div>
  )
}
