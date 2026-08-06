import { findQuestion, type GameState, type QuestionPlayState } from './state'

/**
 * Everything the game needs that is **not** stored, because it is derivable (§1.1).
 *
 * The buzzer lockout set, the timer pause, the Jeopardy turn order and every finale clock live
 * here. Each one is a pure function of `GameState` plus, where a clock is running, `now` — passed
 * in rather than read, so a test states the instant it means.
 */

// ─── buzzer (D35) ───

/**
 * Teams denied on this question, and therefore out of the buzzing for it.
 *
 * Derived rather than stored: "teams with a `DENIED` buzz" is the same fact twice if kept
 * separately. A `BUZZERS_FORCE_REOPENED` clears the set — the master accepting they misheard
 * (rule 5) — which is why denials before that instant no longer count.
 */
export function lockedOutTeamIds(play: QuestionPlayState): string[] {
  const since = play.forceReopenedAt ?? 0
  const denied = play.buzzes.filter(
    (buzz) => buzz.outcome === 'DENIED' && (buzz.adjudicatedAt ?? 0) > since,
  )
  return [...new Set(denied.map((buzz) => buzz.teamId))]
}

/** The buzz currently being adjudicated. At most one per question (I10). */
export function awaitingBuzz(play: QuestionPlayState) {
  return play.buzzes.find((buzz) => buzz.outcome === 'AWAITING')
}

/**
 * Whether a buzz would be accepted right now.
 *
 * Closed while a buzz is being adjudicated, and reopened by the denial itself — the loop in D35 is
 * this predicate changing, not an event.
 */
export function buzzersLive(play: QuestionPlayState): boolean {
  if (play.state !== 'OPEN') return false
  if (awaitingBuzz(play)) return false
  return !play.buzzes.some((buzz) => buzz.outcome === 'ACCEPTED')
}

export function isLockedOut(play: QuestionPlayState, teamId: string): boolean {
  return lockedOutTeamIds(play).includes(teamId)
}

/** The first buzz that was or is being adjudicated — "who beat us", which is part of the fun. */
export function firstBuzzTeamId(play: QuestionPlayState): string | null {
  const ordered = [...play.buzzes].sort((a, b) => a.receivedAt - b.receivedAt)
  return ordered[0]?.teamId ?? null
}

// ─── timer (D7, D8, D35) ───

export interface Timer {
  /** Absolute epoch ms; clients render a countdown against it. */
  deadlineAt: number
  /** Set while a buzz is being adjudicated. */
  pausedAt: number | null
}

/**
 * How long this question has been paused for adjudication, in total.
 *
 * There is deliberately **no `TIMER_PAUSED` event** (protocol §4.4): each paused interval is
 * `BUZZ_RECEIVED.receivedAt → BUZZ_ADJUDICATED.createdAt`, so the effective deadline is recomputed
 * from the log. A deny loop pauses once per round of it, which is why this sums rather than taking
 * the first.
 */
export function pausedMs(play: QuestionPlayState, now: number): number {
  let total = 0
  for (const buzz of play.buzzes) {
    if (buzz.outcome === 'NOT_FIRST') continue
    if (buzz.adjudicatedAt !== null) {
      total += Math.max(0, buzz.adjudicatedAt - buzz.receivedAt)
    } else if (buzz.outcome === 'AWAITING') {
      total += Math.max(0, now - buzz.receivedAt)
    }
  }
  return total
}

/**
 * The question's timer, with pauses folded in — or `null` when it has none.
 *
 * **Advisory only** (D8): the client submits at zero, the server keeps accepting. A phone that was
 * asleep at zero submits when it wakes, and it counts.
 */
export function timerFor(play: QuestionPlayState, now: number): Timer | null {
  if (play.deadlineAt === null) return null
  const buzz = awaitingBuzz(play)
  return {
    deadlineAt: play.deadlineAt + pausedMs(play, now),
    pausedAt: buzz?.receivedAt ?? null,
  }
}

// ─── standings (D32) ───

export interface Standing {
  teamId: string
  rank: number
  score: number
  /** True when another team shares this rank. */
  tied: boolean
}

/**
 * Teams by score, highest first, with **ties sharing a rank** (D32) — so two teams on 40 are both
 * 2nd and the next is 4th. Position breaks the display order within a tie, never the rank itself.
 */
export function standings(state: GameState): Standing[] {
  const teams = [...state.teams.values()].sort(
    (a, b) => b.score - a.score || a.position - b.position,
  )

  const counts = new Map<number, number>()
  for (const team of teams) counts.set(team.score, (counts.get(team.score) ?? 0) + 1)

  let rank = 0
  let seen = 0
  let previousScore: number | undefined
  return teams.map((team) => {
    seen += 1
    if (team.score !== previousScore) {
      rank = seen
      previousScore = team.score
    }
    return {
      teamId: team.id,
      rank,
      score: team.score,
      tied: (counts.get(team.score) ?? 0) > 1,
    }
  })
}

// ─── Jeopardy turn order (D30) ───

/**
 * Who should pick the next tile, and whether the master has to break a tie.
 *
 * D30's rule: the **lowest-scoring team** picks first; afterwards whoever answered the last tile
 * correctly picks; if nobody did, it falls back to the lowest score again. Jeopardy tiles are
 * always buzzer questions, which is what makes "who got it right" a single team.
 *
 * `PICKER_ASSIGNED` is still appended even when it merely confirms this, so the log answers "whose
 * pick was it?" without the reader re-deriving the rule.
 */
export function suggestedPicker(
  state: GameState,
  roundId: string,
): { teamId: string | null; tiedTeamIds: string[] } {
  const round = state.content.rounds.find((r) => r.id === roundId)
  if (!round) return { teamId: null, tiedTeamIds: [] }

  // Most recently resolved tile in this round, by the accepted buzz on it.
  const resolved = round.questions
    .map((question) => ({ question, play: state.questions.get(question.id) }))
    .filter((entry) => entry.play && entry.play.state !== 'PENDING')
    .sort((a, b) => (b.play?.openedAt ?? 0) - (a.play?.openedAt ?? 0))

  const last = resolved[0]?.play
  if (last) {
    const accepted = last.buzzes.find((buzz) => buzz.outcome === 'ACCEPTED')
    if (accepted) return { teamId: accepted.teamId, tiedTeamIds: [] }
  }

  // Nobody was credited — or nothing has been played yet — so the lowest score picks.
  const alive = [...state.teams.values()]
  if (alive.length === 0) return { teamId: null, tiedTeamIds: [] }

  const lowest = Math.min(...alive.map((team) => team.score))
  const contenders = alive
    .filter((team) => team.score === lowest)
    .sort((a, b) => a.position - b.position)

  // A tie here is a decision, not a derivation: the master arbitrates it (D30).
  return contenders.length > 1
    ? { teamId: null, tiedTeamIds: contenders.map((team) => team.id) }
    : { teamId: contenders[0]?.id ?? null, tiedTeamIds: [] }
}

// ─── DSMTW_FINALE clocks (D50, D52) ───

/**
 * A finalist's remaining seconds — **derived, never ticked** (D52). There is no server timer, no
 * tick event, and no clock stored anywhere:
 *
 * ```
 *   remaining = startingSeconds
 *             − Σ (turnEndedAt − turnStartedAt)      that team's completed turns
 *             − penaltySeconds × keywords marked for OTHER teams while this team was still in
 *             − (now − turnStartedAt)                if this team is on turn right now
 * ```
 *
 * A restart mid-turn recovers every clock exactly, which is the same property D4 buys everywhere
 * else. Never floored at a minimum (D56); it can only be clamped at zero.
 */
export function finaleRemainingSeconds(
  state: GameState,
  teamId: string,
  now: number,
): number {
  const { finale } = state
  const starting = finale.startingSeconds.get(teamId)
  if (starting === undefined) return 0

  let remaining = starting

  for (const turn of finale.turns) {
    if (turn.teamId !== teamId) continue
    const until = turn.endedAt ?? now
    remaining -= Math.max(0, Math.floor((until - turn.startedAt) / 1000))
  }

  remaining -= finalePenaltiesAgainst(state, teamId)

  return Math.max(0, remaining)
}

/**
 * The seconds a team has lost to *other* teams' correct keywords.
 *
 * A revoked mark charges nothing — `KEYWORD_UNMARKED` has to reverse **time**, not just a score
 * (D41), and it does so by this filter rather than by a compensating event. A team already
 * eliminated accrues no further penalty (I22), which is why the mark's instant is compared against
 * the elimination.
 */
export function finalePenaltiesAgainst(state: GameState, teamId: string): number {
  const penalty = state.finale.penaltySeconds ?? 0
  if (penalty === 0) return 0

  const eliminatedAt = state.teams.get(teamId)?.eliminatedAt
  let charged = 0

  for (const mark of state.keywordMarks.values()) {
    if (mark.revokedAt !== null) continue
    // An unguessed keyword revealed by the master charges nobody.
    if (mark.teamId === null) continue
    if (mark.teamId === teamId) continue
    if (
      eliminatedAt !== null &&
      eliminatedAt !== undefined &&
      mark.markedAt > eliminatedAt
    )
      continue
    charged += penalty
  }

  return charged
}

/** Finalists still in: selected, and not eliminated. */
export function activeFinalists(state: GameState): string[] {
  return state.finale.finalistIds.filter(
    (teamId) => (state.teams.get(teamId)?.eliminatedAt ?? null) === null,
  )
}

/** Teams that have already had a turn on this question and passed it. */
export function passedThisQuestion(state: GameState, gameQuestionId: string): string[] {
  const question = findQuestion(state.content, gameQuestionId)
  if (!question) return []

  const opened = state.questions.get(gameQuestionId)?.openedAt ?? 0
  return [
    ...new Set(
      state.finale.turns
        .filter((turn) => turn.startedAt >= opened && turn.reason === 'PASSED')
        .map((turn) => turn.teamId),
    ),
  ]
}

/**
 * Whose turn is next: **fewest remaining seconds** among finalists still in and not yet passed this
 * question.
 *
 * Deliberately not an event (protocol §4.6) — it is fully derivable, so storing it would be a
 * second source of truth. It also means the order **recomputes** as clocks drain, which is the
 * whole mechanic: passing changes who is cheapest.
 */
export function finaleTurnOrder(
  state: GameState,
  gameQuestionId: string,
  now: number,
): string[] {
  const passed = new Set(passedThisQuestion(state, gameQuestionId))
  return activeFinalists(state)
    .filter((teamId) => !passed.has(teamId))
    .sort((a, b) => {
      const diff =
        finaleRemainingSeconds(state, a, now) - finaleRemainingSeconds(state, b, now)
      if (diff !== 0) return diff
      // A genuine tie falls back to board order, so the sequence is at least deterministic.
      return (state.teams.get(a)?.position ?? 0) - (state.teams.get(b)?.position ?? 0)
    })
}

export function currentFinaleTurn(state: GameState) {
  const turn = state.finale.turns.at(-1)
  return turn && turn.endedAt === null ? turn : undefined
}

/**
 * Finalists whose clock has reached zero but who carry no `eliminatedAt` yet.
 *
 * Control detects this and posts `TEAM_ELIMINATED`; the **server recomputes `at` from the log and
 * ignores any client-supplied instant**, so a slow or fast browser cannot alter a team's fate.
 */
export function finalistsAtZero(state: GameState, now: number): string[] {
  return activeFinalists(state).filter(
    (teamId) => finaleRemainingSeconds(state, teamId, now) === 0,
  )
}

/**
 * The finale's final ranking: rank **groups**, best first.
 *
 * Simultaneous elimination shares a rank (D51, PRD 1 §8.8) — two teams taken to zero by the same
 * keyword's penalty tie, consistent with D32 everywhere else. A single survivor is first; if every
 * finalist went out at once there is **no winner** and first place is shared, which is reachable
 * with equal banks and a high penalty.
 */
export function finaleRanking(state: GameState): string[][] {
  const survivors = activeFinalists(state)

  const eliminated = state.finale.finalistIds
    .map((teamId) => ({ teamId, at: state.teams.get(teamId)?.eliminatedAt ?? null }))
    .filter((entry): entry is { teamId: string; at: number } => entry.at !== null)
    // Last out ranks highest among the eliminated.
    .sort((a, b) => b.at - a.at)

  const groups: string[][] = []
  if (survivors.length > 0) groups.push(survivors)

  let currentAt: number | undefined
  for (const entry of eliminated) {
    if (entry.at !== currentAt) {
      groups.push([entry.teamId])
      currentAt = entry.at
    } else {
      groups.at(-1)?.push(entry.teamId)
    }
  }

  return groups
}

/**
 * conventions §8.1 (D58) — how many questions a finale plausibly needs to reach one survivor.
 *
 * Each alive team loses `penalty × k × (T−1)/T` per question: a team is not charged for its own
 * finds, and that term **shrinks as teams drop out**, which is why this is simulated rather than
 * solved. Two assumptions, both biased toward suggesting more, because over-supplying questions
 * costs nothing — the round ends at one survivor whatever is left:
 *
 * - **3 of 5 keywords found** per question; a generous room finishes sooner, a hard question later.
 * - **Turn time ignored entirely**, and a guessing team's clock also drains, so real games consume
 *   banks *faster* than this.
 */
export function suggestFinaleQuestions(
  banks: readonly number[],
  penaltySeconds: number,
  keywordsAssumedFound = 3,
): number {
  let alive = [...banks]
  let questions = 0

  while (alive.length > 1 && questions < 60) {
    questions++
    const teams = alive.length
    const loss = (penaltySeconds * keywordsAssumedFound * (teams - 1)) / teams
    alive = alive.map((bank) => bank - loss).filter((bank) => bank > 0)
  }

  return questions + 1 // one question of headroom
}

/**
 * conventions §8 (D53) — the shape the room sees instead of a keyword.
 *
 * Counts **characters, not UTF-16 code units**, so an accent or emoji never widens a tile
 * misleadingly. Punctuation counts as part of its word, and whitespace is collapsed first so a
 * stray double space cannot produce a phantom zero-width word.
 */
export function wordLengths(keyword: string): number[] {
  return (
    keyword
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      // conventions §8 pins this exact implementation, and it must match wherever authoring
      // computes the stored value (I19) or the tiles stop matching the text they resolve to.
      // Code points, not graphemes: an emoji counts as several. A real limitation, accepted for
      // pub-quiz keywords, and changing it would change every already-stored `wordLengths`.
      // oxlint-disable-next-line typescript/no-misused-spread
      .map((word) => [...word].length)
  )
}
