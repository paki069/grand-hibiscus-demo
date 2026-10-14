import { redirect } from 'next/navigation'
import { safeNext } from '@/components/ui'

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  redirect(`/login?next=${encodeURIComponent(safeNext(next))}`)
}
