import 'server-only'
import { LEARN_SOURCE_PATHS } from '@/lib/learn-content'

export type LearnSourceRevision = {
  sha: string
  mode: 'public-demo'
}

const DEMO_REPOSITORY = 'paki069/grand-hibiscus-demo'
const DEMO_REVISION = '3359f5deca32eb553ad35ee9e7edfa4b4190ec73'

export function getLearnSourceRevision(): LearnSourceRevision {
  return { sha: DEMO_REVISION, mode: 'public-demo' }
}

export async function readLearnSource(path: string) {
  if (!LEARN_SOURCE_PATHS.includes(path)) {
    throw new Error('That file is not available in the Learn source browser.')
  }

  const encodedPath = path.split('/').map((segment) => encodeURIComponent(segment)).join('/')
  let response: Response
  try {
    response = await fetch(`https://raw.githubusercontent.com/${DEMO_REPOSITORY}/${DEMO_REVISION}/${encodedPath}`, {
      cache: 'force-cache',
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    throw new Error('The public demo source could not be loaded.', { cause: error })
  }

  if (response.status === 404) {
    throw new Error('That file is not available in the public demo repository.')
  }
  if (!response.ok) {
    throw new Error(`The public demo source request failed with status ${response.status}.`)
  }

  return response.text()
}
