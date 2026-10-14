import Link from 'next/link'
import AdminLoginForm from '@/components/AdminLoginForm'
import { safeNext } from '@/components/ui'

export const metadata = {
  title: 'Admin sign in | The Grand Hibiscus',
  robots: { index: false, follow: false },
}

function safeAdminNext(value: string | undefined) {
  const next = safeNext(value)
  if (next === '/admin/login' || next.startsWith('/admin/login?')) return '/admin'
  return next === '/admin' || next.startsWith('/admin/') ? next : '/admin'
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  return (
    <main className="container">
      <Link href="/" className="small">← Back to site</Link>
      <AdminLoginForm next={safeAdminNext(next)} />
    </main>
  )
}
