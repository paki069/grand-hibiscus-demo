import 'server-only'
import { createClient } from '@supabase/supabase-js'

// Service-role client. Bypasses RLS: only use after an explicit server-side authorization check.
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured')
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export const adminConfigured = () => Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
