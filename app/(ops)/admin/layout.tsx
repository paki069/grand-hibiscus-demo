import { requireRole } from '@/lib/auth'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole(['admin'], '/admin')
  return <>{children}</>
}
