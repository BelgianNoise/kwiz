import { ReviewScreen } from '@/components/admin/review-screen'

/**
 * PRD 2 §13 — post-game review and correction, *"the reason PRD 1 promises a master can fix a
 * validation mistake."*
 *
 * A thin route: everything is fetched client-side through `api.review` (protocol §7.4) and re-fetched
 * after each correction, because only the server's fold knows what a flipped verdict did to a score.
 * Rendering it on the server would mean either a stale grid after every click or a full round trip
 * plus a re-render for each one.
 */
export default async function ReviewPage({
  params,
}: {
  params: Promise<{ gameId: string }>
}) {
  const { gameId } = await params
  return <ReviewScreen gameId={gameId} />
}
