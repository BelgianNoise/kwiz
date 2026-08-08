import { findAttachmentFile, listGames, loadQuizTree } from '@kwiz/db'
import { preflight } from '@kwiz/domain'
import { notFound } from 'next/navigation'

import { PlayFlow } from '@/components/admin/play-flow'
import { findBrokenAttachments } from '@/lib/server/attachments'
import { getRuntime } from '@/lib/server/runtime'

/**
 * PRD 2 §10 then §11 — `[Play]` runs pre-flight, and pre-flight leads to game setup.
 *
 * One route for both because they are one act: a master pressing Play is fifteen minutes from doors
 * open (§1.1) and wants to be running a game, not navigating. Pre-flight is the gate they pass
 * through — and it is a gate that **never actually blocks** (§10).
 *
 * The attachment re-hash happens here, server-side, because it is the one check the pure rules
 * cannot make. It is also the one that catches *"the audio for question 12 is damaged"* before a
 * room is waiting for it.
 */
export const dynamic = 'force-dynamic'

export default async function PlayPage({
  params,
}: {
  params: Promise<{ quizId: string }>
}) {
  const runtime = await getRuntime()
  const { quizId } = await params

  const quiz = loadQuizTree(runtime.database, quizId)
  if (!quiz) notFound()

  const files = quiz.rounds
    .flatMap((round) => round.questions)
    .flatMap((question) => question.media)
    .map((media) => ({
      id: media.id,
      file: findAttachmentFile(runtime.database, media.id),
    }))
    .flatMap((entry) =>
      entry.file
        ? [{ id: entry.id, checksum: entry.file.checksum, ext: entry.file.ext }]
        : [],
    )

  const report = preflight(quiz, {
    brokenAttachmentIds: await findBrokenAttachments(runtime.paths, files),
  })

  /**
   * §11's `[Copy from last game]` — the same pub tends to have the same teams, and re-typing eight
   * names against the clock is exactly the §1.1 pressure point.
   */
  const previous = listGames(runtime.database).find(
    (game) => game.sourceQuizId === quizId,
  )
  const previousState = previous ? runtime.registry.get(previous.id) : undefined
  const lastTeams = [...(previousState?.teams.values() ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((team) => ({ name: team.name, colour: team.colour }))

  return <PlayFlow quiz={quiz} report={report} lastTeams={lastTeams} />
}
