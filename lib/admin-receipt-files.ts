import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export async function listReceiptPaths(
  admin: AdminClient,
  folder: string,
  depth = 0,
): Promise<{ paths: string[]; error: string | null }> {
  if (depth > 4) return { paths: [], error: 'Receipt folder nesting is unexpectedly deep.' }

  const paths: string[] = []
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await admin.storage.from('receipts').list(folder, { limit: 100, offset })
    if (error) return { paths: [], error: error.message }
    const entries = data ?? []

    for (const entry of entries) {
      const path = `${folder}/${entry.name}`
      if (entry.id === null) {
        const nested = await listReceiptPaths(admin, path, depth + 1)
        if (nested.error) return nested
        paths.push(...nested.paths)
      } else {
        paths.push(path)
      }
    }

    if (entries.length < 100) break
  }
  return { paths, error: null }
}

export async function removeReceiptFiles(
  admin: AdminClient,
  paths: string[],
): Promise<string | null> {
  for (let index = 0; index < paths.length; index += 100) {
    const { error } = await admin.storage.from('receipts').remove(paths.slice(index, index + 100))
    if (error) return error.message
  }
  return null
}
