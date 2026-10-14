import { NextResponse } from 'next/server'
import { getProfile } from '@/lib/auth'
import { readLearnSource, getLearnSourceRevision } from '@/lib/learn-source'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Please sign in to view Learn sources.' }, { status: 401 })
  if (profile.role !== 'admin') return NextResponse.json({ error: 'Only administrators can view Learn sources.' }, { status: 403 })

  const path = new URL(request.url).searchParams.get('path')
  if (!path) return NextResponse.json({ error: 'Choose a source file to view.' }, { status: 400 })

  try {
    const content = await readLearnSource(path)
    return NextResponse.json(
      { path, content, revision: getLearnSourceRevision() },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    if (error instanceof Error && error.message.includes('not available')) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    console.error('[learn-source] Could not read an allowlisted source file.')
    return NextResponse.json({ error: 'The source file could not be loaded. Please try again.' }, { status: 500 })
  }
}
