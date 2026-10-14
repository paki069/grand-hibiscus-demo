import 'server-only'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { LEARN_SOURCE_PATHS } from '@/lib/learn-content'

export type LearnSourceRevision = {
  sha: string | null
  mode: 'deployment' | 'local' | 'public-demo'
}

export function getLearnSourceRevision(): LearnSourceRevision {
  const deploymentSha = process.env.VERCEL_GIT_COMMIT_SHA
  if (deploymentSha && /^[a-f0-9]{40}$/i.test(deploymentSha)) {
    return { sha: deploymentSha, mode: 'deployment' }
  }

  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1_000,
    }).trim()
    if (/^[a-f0-9]{40}$/i.test(sha)) return { sha, mode: 'local' }
  } catch {
    return { sha: null, mode: 'local' }
  }

  return { sha: null, mode: 'local' }
}

export async function readLearnSource(path: string) {
  if (!LEARN_SOURCE_PATHS.includes(path)) {
    throw new Error('That file is not available in the Learn source browser.')
  }

  const root = process.cwd()
  const filePath = resolve(root, path)
  if (!filePath.startsWith(`${root}${sep}`)) {
    throw new Error('That file is not available in the Learn source browser.')
  }

  return readFile(filePath, 'utf8')
}
