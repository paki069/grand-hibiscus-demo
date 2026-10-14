import type { Metadata, Viewport } from 'next'
import './globals.css'
import { supabaseConfigured } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'The Grand Hibiscus | Hotel and Restaurant', description: 'Stay, dine and unwind at The Grand Hibiscus.' }
export const viewport: Viewport = { width: 'device-width', initialScale: 1 }
export const dynamic = 'force-dynamic'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {supabaseConfigured() ? (
          children
        ) : (
          <div className="container">
            <div className="card stack" role="alert">
              <h1>Supabase is not configured</h1>
              <p>
                Copy <code>.env.example</code> to <code>.env.local</code> and set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
                <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, then apply the migrations in <code>supabase/migrations</code>. See the README.
              </p>
            </div>
          </div>
        )}
      </body>
    </html>
  )
}
