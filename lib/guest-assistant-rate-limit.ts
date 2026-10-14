import { createHash } from 'node:crypto'

const requests = new Map<string, { count: number; resetAt: number }>()
const WINDOW_MS = 60_000

export function isGuestAssistantRateLimited(request: Request, scope: string, maxRequests: number) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const address = request.headers.get('x-real-ip')?.trim() || forwarded || 'unknown'
  const addressHash = createHash('sha256').update(address).digest('hex')
  const key = `${scope}:${addressHash}`
  const now = Date.now()
  const current = requests.get(key)
  if (!current || current.resetAt <= now) {
    if (requests.size >= 5_000) {
      for (const [storedKey, value] of requests) {
        if (value.resetAt <= now) requests.delete(storedKey)
      }
      if (requests.size >= 5_000) requests.delete(requests.keys().next().value!)
    }
    requests.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  current.count += 1
  return current.count > maxRequests
}
