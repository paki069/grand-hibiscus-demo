// Creates demo users in a local Supabase instance only.
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = process.env.DEMO_PASSWORD
if (!url || !key || !password) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and DEMO_PASSWORD.')
  process.exit(1)
}
let parsedUrl
try {
  parsedUrl = new URL(url)
} catch {
  console.error('NEXT_PUBLIC_SUPABASE_URL must be a valid local Supabase URL.')
  process.exit(1)
}
if (parsedUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsedUrl.hostname)) {
  console.error('Refusing to create demo users unless Supabase is running locally.')
  process.exit(1)
}
const admin = createClient(url, key, { auth: { persistSession: false } })
const users = [
  { email: 'admin@demo.local', role: 'admin', first: 'Demo', last: 'Admin', areas: [] },
  { email: 'staff@demo.local', role: 'staff', first: 'Demo', last: 'Staff', areas: ['hotel', 'restaurant', 'spa', 'events'] },
  { email: 'guest@demo.local', role: 'customer', first: 'Demo', last: 'Guest', areas: [] },
]
for (const u of users) {
  let { data, error } = await admin.auth.admin.createUser({ email: u.email, password, email_confirm: true, user_metadata: { first_name: u.first, last_name: u.last } })
  if (error) {
    const list = await admin.auth.admin.listUsers({ perPage: 1000 })
    data = { user: list.data.users.find((x) => x.email === u.email) }
    if (!data.user) { console.error(u.email, error.message); continue }
  }
  const { error: pe } = await admin.from('profiles').update({ role: u.role, staff_areas: u.areas, first_name: u.first, last_name: u.last }).eq('id', data.user.id)
  console.log(u.email, pe ? 'profile error: ' + pe.message : 'ok (' + u.role + ')')
}
