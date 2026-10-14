import LearnCenter from '@/components/LearnCenter'
import { getLearnSourceRevision } from '@/lib/learn-source'

export const dynamic = 'force-dynamic'

export default function LearnPage() {
  return <LearnCenter revision={getLearnSourceRevision()} />
}
