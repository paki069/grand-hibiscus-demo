import 'server-only'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type Role = 'admin' | 'staff' | 'customer'
export interface Profile {
  id: string
  email: string | null
  first_name: string
  last_name: string
  phone: string
  birthday: string | null
  role: Role
  staff_areas: string[]
  active: boolean
}

export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) return null
  const { data: p } = await supabase.from('profiles').select('*').eq('id', data.user.id).single()
  if (!p || !p.active) return null
  return p as Profile
}

/** Server-side authorization for pages. RLS and SECURITY DEFINER checks are the real enforcement; this keeps UIs honest. */
export async function requireRole(roles: Role[], next = '/'): Promise<Profile> {
  const p = await getProfile()
  if (!p) {
    const loginPath = roles.length === 1 && roles[0] === 'admin' ? '/admin/login' : '/login'
    redirect(`${loginPath}?next=${encodeURIComponent(next)}`)
  }
  if (!roles.includes(p.role)) redirect('/?denied=1')
  return p
}

export const AREAS = ['hotel', 'restaurant', 'spa', 'gym', 'events'] as const
export const allowedAreas = (p: Profile) => (p.role === 'admin' ? [...AREAS] : p.staff_areas.filter((a) => (AREAS as readonly string[]).includes(a)))
