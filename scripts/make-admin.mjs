// Promote an existing user to admin: node scripts/make-admin.mjs you@example.com
import { createClient } from '@supabase/supabase-js'

const email = process.argv[2]
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!email || !url || !key) { console.error('Usage: node scripts/make-admin.mjs <email> (needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)'); process.exit(1) }
const admin = createClient(url, key, { auth: { persistSession: false } })
const { data, error } = await admin.from('profiles').update({ role: 'admin' }).eq('email', email.toLowerCase()).select('id')
if (error) { console.error(error.message); process.exit(1) }
console.log(data?.length ? `${email} is now an admin.` : 'No profile with that email. Sign up first.')
