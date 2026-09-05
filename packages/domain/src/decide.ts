import { normaliseAnswer } from './answers'
import type { Command } from './commands'
import { doConfigSchema } from './content-config'
import {
  activeFinalists,
  currentFinaleTurn,
  finaleRanking,
  finaleRemainingSeconds,
  isLockedOut,
  lockedOutTeamIds,
} from './derive'
import type { ErrorCode } from './errors'
import type { GameEvent } from './events/payload'
import type { Notice } from './notices'
import { canTransition } from './question-state'
import {
  effectiveTimerMs,
  findQuestion,
  type GameState,
  type QuestionContent,
  type QuestionPlayState,
} from './state'
import type { TiePayout } from './vocabulary'

/**
 * PRD 1 §6.4 — *"the domain layer decides: reject, or produce one or more events"*.
 *
 * Every one of protocol §7's actions resolves here, as a pure function of `(state, command, now)`.
 * The route handler above it validates the request shape, mints ids, and appends whatever comes
 * back; it makes no game decisions of its own. That split is what keeps CLAUDE.md §3.2's test
 * satisfied — *could this be tested with a literal array and no mocks?* — for the rules that decide
 * whether a submission counts, who may buzz, and when a finale ends.
 *
 * Three properties worth stating, because each is load-bearing:
 *
 * 1. **Nothing here mints an id or reads a clock.** Both arrive in the command, so a test can
 *    compare the returned events against a literal array.
 * 2. **A refusal is a typed code** (conventions §4), never a thrown error and never a generic
 *    failure — clients branch on it (protocol §7.3).
 * 3. **`{ ok: true, events: [] }` is a real answer**, and a common one: an idempotent retry, a
 *    second click on a button, a stale observation the server declines to act on. It is not the
 *    same as a refusal, and collapsing the two would make every retry look like an error.
 */
export type Decision =
  | { ok: true; events: GameEvent[]; notices: Notice[] }
  | { ok: false; error: ErrorCode; message: string; detail?: unknown }

function deny(error: ErrorCode, message: string, detail?: unknown): Decision {
  return detail === undefined
    ? { ok: false, error, message }
    : { ok: false, error, message, detail }
}

function allow(events: GameEvent[] = [], notices: Notice[] = []): Decision {
  return { ok: true, events, notices }
}

/** The server accepted the request and deliberately did nothing. See property 3 above. */
const NOTHING_TO_DO: Decision = { ok: true, events: [], notices: [] }

export function decide(state: GameState, command: Command, now: number): Decision {
  switch (command.type) {
    // ─── §7.1 player ───

    case 'JOIN': {
      if (state.status === 'FINISHED' || state.status === 'ABANDONED') {
        return deny('GAME_NOT_JOINABLE', `game is ${state.status}`)
      }
      const team = state.teams.get(command.teamId)
      if (!team) return deny('TEAM_NOT_FOUND', `no team ${command.teamId} in this game`)

      if (team.deviceCount >= command.maxDevicesPerTeam) {
        // The response lists the other teams so the UI can offer them (D20) — a device is never
        // silently connected, and never silently evicts one that is already playing.
        return deny(
          'TEAM_FULL',
          `team ${command.teamId} already has ${team.deviceCount} devices`,
          { otherTeams: otherTeamsFor(state, command.teamId, command.maxDevicesPerTeam) },
        )
      }

      return allow(
        [
          {
            type: 'DEVICE_JOINED',
            payload: {
              deviceId: command.deviceId,
              teamId: command.teamId,
              deviceToken: command.deviceToken,
            },
          },
        ],
        // Once per team, not once per phone: three players on one team is one arrival.
        team.deviceCount === 0 ? [{ kind: 'TEAM_JOINED', teamId: command.teamId }] : [],
      )
    }

    case 'SWITCH_TEAM': {
      // Mirrors `JOIN`'s own guard just above, not `requireLive` — a device that joined during
      // `SETUP` must be able to switch teams before the game goes live too (P2 #11).
      if (state.status === 'FINISHED' || state.status === 'ABANDONED') {
        return deny('GAME_NOT_JOINABLE', `game is ${state.status}`)
      }
      const fromTeamId = state.devices.get(command.deviceId)
      if (fromTeamId === undefined) {
        return deny('UNKNOWN_DEVICE', `device ${command.deviceId} is not in this game`)
      }
      const target = state.teams.get(command.toTeamId)
      if (!target) return deny('TEAM_NOT_FOUND', `no team ${command.toTeamId}`)
      if (fromTeamId === command.toTeamId) return NOTHING_TO_DO
      if (target.deviceCount >= command.maxDevicesPerTeam) {
        return deny('TEAM_FULL', `team ${command.toTeamId} is at its device cap`, {
          otherTeams: otherTeamsFor(state, command.toTeamId, command.maxDevicesPerTeam),
        })
      }

      // The old team's draft is deliberately left where it is (protocol §9 P4): a draft belongs to
      // `(question, team)`, and carrying one team's in-progress answer to another is worse than
      // losing it.
      return allow([
        {
          type: 'DEVICE_SWITCHED_TEAM',
          payload: { deviceId: command.deviceId, fromTeamId, toTeamId: command.toTeamId },
        },
      ])
    }

    case 'SUBMIT_ANSWER': {
      /*
       * Absent until now — deliberately different from every other action's *first* line, and a
       * real gap rather than a considered omission: D8 is about a phone that woke up late, not
       * about a phone submitting after the whole game ended. Without this, a device could go on
       * submitting indefinitely once the master had finished or abandoned the game.
       */
      const live = requireLive(state)
      if (live) return live
      const found = locate(state, command.gameQuestionId)
      if (!found) return deny('QUESTION_NOT_OPEN', 'unknown question')
      const { question, play } = found
      if (!state.teams.has(command.teamId)) {
        return deny('TEAM_NOT_FOUND', `no team ${command.teamId}`)
      }
      if (!acceptsTypedAnswers(question)) {
        return deny(
          'VALIDATION_ERROR',
          `question ${question.id} is ${question.answerMethod} and takes no submitted answer`,
        )
      }

      // protocol §7.3's rule table, in its order. The already-submitted checks come **first**, so a
      // retry that arrives after the master locked the question still reports `ok` rather than
      // sending the client into an error state over a submission that landed.
      const mine = play.answers.get(command.teamId)
      if (mine) {
        return sameAnswer(mine, command.text, command.selectedOptionId)
          ? NOTHING_TO_DO // the D8 retry case
          : deny(
              'ALREADY_SUBMITTED',
              `team ${command.teamId} already submitted an answer to ${question.id}`,
              // Never silently discard the second device's text: the canonical answer goes back so
              // its UI can switch to "Your team answered: …" (protocol §7.3).
              {
                answer: {
                  text: mine.text,
                  optionId: mine.selectedOptionId,
                  submittedAt: mine.submittedAt,
                },
              },
            )
      }

      const notOpen = requireOpen(play, question.id)
      if (notOpen) return notOpen
      const optionError = checkOption(question, command.selectedOptionId)
      if (optionError) return optionError
      const emptyError = checkNotEmpty(command.text, command.selectedOptionId)
      if (emptyError) return emptyError

      return allow([
        {
          type: 'ANSWER_SUBMITTED',
          payload: {
            gameQuestionId: question.id,
            teamId: command.teamId,
            ...(command.text === undefined ? {} : { text: command.text }),
            ...(command.selectedOptionId === undefined
              ? {}
              : { selectedOptionId: command.selectedOptionId }),
            fromDraft: false,
            enteredByMaster: false,
          },
        },
      ])
    }

    case 'BUZZ': {
      // Same reasoning as `SUBMIT_ANSWER` immediately above: a buzz after the game ended is not a
      // late-arriving one (D35 is silent on that), it is a device talking to a game that is over.
      const live = requireLive(state)
      if (live) return live
      const found = locate(state, command.gameQuestionId)
      if (!found) return deny('QUESTION_NOT_OPEN', 'unknown question')
      const { question, play } = found
      if (!state.teams.has(command.teamId)) {
        return deny('TEAM_NOT_FOUND', `no team ${command.teamId}`)
      }
      if (question.answerMethod !== 'BUZZER') {
        return deny('BUZZERS_NOT_LIVE', `question ${question.id} has no buzzer`)
      }
      // A late buzz is still recorded (D35): two teams 40 ms apart is normal and the timings are
      // the answer to any dispute. `LOCKED` is included for exactly that race. Once a buzz has been
      // *accepted* the question is decided, and recording another would raise a second
      // adjudication out of nowhere.
      if (play.state !== 'OPEN' && play.state !== 'LOCKED') {
        return deny('BUZZERS_NOT_LIVE', `question ${question.id} is ${play.state}`)
      }
      if (play.buzzes.some((buzz) => buzz.outcome === 'ACCEPTED')) {
        return deny('BUZZERS_NOT_LIVE', `question ${question.id} is already credited`)
      }
      if (isLockedOut(play, command.teamId)) {
        return deny(
          'TEAM_LOCKED_OUT',
          `team ${command.teamId} was denied on this question`,
        )
      }
      // A second tap while the master is judging this team's buzz. Idempotent rather than a second
      // row, because the phone retries on a lost response (D8) and the first tap is the true one.
      if (
        play.buzzes.some(
          (buzz) => buzz.teamId === command.teamId && buzz.outcome === 'AWAITING',
        )
      ) {
        return NOTHING_TO_DO
      }

      return allow(
        [
          {
            type: 'BUZZ_RECEIVED',
            payload: {
              buzzId: command.buzzId,
              gameQuestionId: question.id,
              teamId: command.teamId,
              receivedAt: command.receivedAt,
              // Time from the question opening, un-adjusted for adjudication pauses: it is a
              // reaction time, and the room reads it as one.
              offsetMs: Math.max(
                0,
                command.receivedAt - (play.openedAt ?? command.receivedAt),
              ),
            },
          },
        ],
        [{ kind: 'BUZZ', teamId: command.teamId }],
      )
    }

    // ─── §7.2 lifecycle ───

    case 'START_GAME':
      if (state.status === 'LIVE') return NOTHING_TO_DO
      if (state.status !== 'SETUP') return deny('NOT_IN_SETUP', `game is ${state.status}`)
      return allow([{ type: 'GAME_STARTED', payload: {} }])

    /*
     * **Deliberately no open-question guard**, unlike `OPEN_ROUND`'s "lock or skip it first". PRD
     * 3 §1.1 lists ending and abandoning as the two genuinely irreversible acts and the only ones
     * worth a confirmation — that framing only holds if they work as a true emergency stop, at any
     * moment, including mid-question. A master mid-fire-drill does not get to be told "there's an
     * open question" first.
     */
    case 'FINISH_GAME':
      if (state.status === 'FINISHED') return NOTHING_TO_DO
      if (state.status !== 'LIVE') return deny('GAME_NOT_LIVE', `game is ${state.status}`)
      return allow([{ type: 'GAME_FINISHED', payload: {} }])

    case 'ABANDON_GAME':
      if (state.status === 'ABANDONED') return NOTHING_TO_DO
      if (state.status === 'FINISHED') {
        return deny('GAME_NOT_LIVE', 'a finished game cannot be abandoned')
      }
      return allow([{ type: 'GAME_ABANDONED', payload: {} }])

    case 'OPEN_ROUND': {
      const live = requireLive(state)
      if (live) return live
      const round = state.content.rounds.find((r) => r.id === command.gameRoundId)
      if (!round) return deny('VALIDATION_ERROR', `no round ${command.gameRoundId}`)
      if (state.currentRoundId === command.gameRoundId) return NOTHING_TO_DO
      const open = currentPlay(state)
      if (open?.state === 'OPEN') {
        return deny('QUESTION_STILL_OPEN', 'lock or skip the open question first')
      }
      return allow([
        { type: 'ROUND_OPENED', payload: { gameRoundId: command.gameRoundId } },
      ])
    }

    case 'CLOSE_ROUND': {
      const live = requireLive(state)
      if (live) return live
      if (state.currentRoundId !== command.gameRoundId) return NOTHING_TO_DO
      /*
       * The symmetric half of `OPEN_ROUND`'s own guard. Without it, closing a round with a
       * question still `OPEN` cleared `currentQuestionId` (see `reduce.ts`'s `ROUND_CLOSED`
       * handler) but left that question's own `play.state` at `OPEN` — invisible to
       * `OPEN_QUESTION`'s "one open question at a time" check, which reads only through
       * `currentQuestionId`. A team could then still submit or buzz against the abandoned
       * question while a new one opened in the next round, both live at once.
       */
      const open = currentPlay(state)
      if (open?.state === 'OPEN') {
        return deny('QUESTION_STILL_OPEN', 'lock or skip the open question first')
      }
      return allow([
        { type: 'ROUND_CLOSED', payload: { gameRoundId: command.gameRoundId } },
      ])
    }

    // ─── §7.2 question flow ───

    case 'OPEN_QUESTION': {
      const live = requireLive(state)
      if (live) return live
      const found = locate(state, command.gameQuestionId)
      if (!found) return deny('QUESTION_NOT_OPEN', 'unknown question')
      const { question, play } = found
      // A round the master ended is over: opening its remaining questions would reopen gameplay
      // the closing contradicted. Before this guard, `advanceSuggestion` kept pointing into a
      // closed round and the timeline could reopen played-out gameplay (slice 9's review).
      if (state.closedRoundIds.has(question.roundId)) {
        return deny('ROUND_CLOSED', `question ${question.id} is in a closed round`)
      }
      if (play.state === 'OPEN') return NOTHING_TO_DO
      if (!canTransition(play.state, 'QUESTION_OPENED')) {
        return deny('QUESTION_NOT_OPEN', `question ${question.id} is ${play.state}`)
      }
      const other = currentPlay(state)
      if (other?.state === 'OPEN') {
        return deny('QUESTION_STILL_OPEN', 'lock or skip the open question first')
      }

      // The server computes the deadline from the question's own timer, falling back to the round
      // default (I12). Absolute, so a screen connecting late shows the right remaining time (D7) —
      // and advisory, because the server never enforces it (D8).
      const timerMs = effectiveTimerMs(state.content, question)
      return allow([
        {
          type: 'QUESTION_OPENED',
          payload: {
            gameQuestionId: question.id,
            ...(timerMs === null ? {} : { deadlineAt: now + timerMs }),
          },
        },
      ])
    }

    case 'LOCK_QUESTION': {
      const live = requireLive(state)
      if (live) return live
      const found = locate(state, command.gameQuestionId)
      if (!found) return deny('QUESTION_NOT_OPEN', 'unknown question')
      const { question, play } = found
      if (play.state === 'LOCKED') return NOTHING_TO_DO
      if (!canTransition(play.state, 'QUESTION_LOCKED')) {
        return deny('QUESTION_NOT_OPEN', `question ${question.id} is ${play.state}`)
      }

      /*
       * Draft commitment (protocol §4.3): a team that typed something but never pressed Submit gets
       * an `ANSWER_SUBMITTED { fromDraft: true }`, which is what surfaces D26's "not confirmed by
       * team" marker in review.
       *
       * Appended **before** the lock rather than after, because that is the truthful order — the
       * text was typed while the question was open. Nothing in the fold depends on the order; the
       * audit trail does.
       */
      const drafted: GameEvent[] = command.drafts
        .filter((draft) => !play.answers.has(draft.teamId))
        .filter((draft) => state.teams.has(draft.teamId))
        // An empty or whitespace-only draft is not an answer. Committing one would create a
        // `NO_ANSWER` row that reads in review as if the team deliberately submitted nothing.
        .filter(
          (draft) =>
            normaliseAnswer(draft.text ?? '') !== '' || draft.selectedOptionId !== null,
        )
        .map((draft) => ({
          type: 'ANSWER_SUBMITTED',
          payload: {
            gameQuestionId: question.id,
            teamId: draft.teamId,
            ...(draft.text === null ? {} : { text: draft.text }),
            ...(draft.selectedOptionId === null
              ? {}
              : { selectedOptionId: draft.selectedOptionId }),
            fromDraft: true,
            enteredByMaster: false,
          },
        }))

      return allow([
        ...drafted,
        ...endOpenFinaleTurn(state),
        { type: 'QUESTION_LOCKED', payload: { gameQuestionId: question.id } },
      ])
    }

    case 'REVEAL_QUESTION': {
      const live = requireLive(state)
      if (live) return live
      const found = locate(state, command.gameQuestionId)
      if (!found) return deny('QUESTION_NOT_OPEN', 'unknown question')
      if (found.play.state === 'REVEALED') return NOTHING_TO_DO
      if (!canTransition(found.play.state, 'QUESTION_REVEALED')) {
        // Reveal is legal from `LOCKED` only. An open question must be locked first — which is also
        // what the `ADVANCE / REVEAL` suggestion means when every team is locked out (D35 rule 4).
        return deny('QUESTION_NOT_OPEN', `question is ${found.play.state}`)
      }
      /*
       * P2 #12 — coupled with `REVEAL_KEYWORDS` below, in both directions, so a finale question's
       * two REVEALED-ish facts (the question itself, and its keywords) can never diverge no
       * matter which command a client happens to send. This is the one universal transition
       * every question type shares (`question-state.ts`), so nothing upstream stops a stray
       * `REVEAL_QUESTION` from reaching a finale question — it should just do the right thing.
       */
      return allow([
        { type: 'QUESTION_REVEALED', payload: { gameQuestionId: found.question.id } },
        ...(found.question.keywords.length > 0
          ? [
              {
                type: 'KEYWORDS_REVEALED' as const,
                payload: { gameQuestionId: found.question.id },
              },
            ]
          : []),
      ])
    }

    case 'SCORE_QUESTION': {
      const live = requireLive(state)
      if (live) return live
      const found = locate(state, command.gameQuestionId)
      if (!found) return deny('QUESTION_NOT_OPEN', 'unknown question')
      if (found.play.state === 'SCORED') return NOTHING_TO_DO
      if (!canTransition(found.play.state, 'QUESTION_SCORED')) {
        return deny('QUESTION_NOT_OPEN', `question is ${found.play.state}`)
      }
      return allow([
        { type: 'QUESTION_SCORED', payload: { gameQuestionId: found.question.id } },
      ])
    }

    case 'SKIP_QUESTION': {
      const live = requireLive(state)
      if (live) return live
      const found = locate(state, command.gameQuestionId)
      if (!found) return deny('QUESTION_NOT_OPEN', 'unknown question')
      if (found.play.state === 'SKIPPED') return NOTHING_TO_DO
      // Legal from `PENDING` or `OPEN` only (D46): a question already revealed cannot be un-played.
      if (!canTransition(found.play.state, 'QUESTION_SKIPPED')) {
        return deny('QUESTION_NOT_OPEN', `question is ${found.play.state}`)
      }
      return allow([
        ...endOpenFinaleTurn(state),
        { type: 'QUESTION_SKIPPED', payload: { gameQuestionId: found.question.id } },
      ])
    }

    // ─── §7.2 buzzer, validation, DO ───

    case 'ADJUDICATE_BUZZ': {
      const live = requireLive(state)
      if (live) return live
      const found = findBuzz(state, command.buzzId)
      if (!found) return deny('VALIDATION_ERROR', `no buzz ${command.buzzId}`)
      // A skipped question awards nothing to anyone (I8, D46), and adjudication is what credits a
      // buzzer question — so this has to be refused rather than resolved to zero. It is also the
      // one place the two halves could not agree by construction: `game_answer` carries no question
      // state, so the projection cannot see a skip that the reducer can.
      if (found.play.state === 'SKIPPED') {
        return deny('QUESTION_NOT_OPEN', 'that question was skipped')
      }
      // Already judged — the master's second click, or a duplicated request. The first decision
      // stands; re-judging is a `validate` (there is no un-deny).
      if (found.buzz.outcome !== 'AWAITING') return NOTHING_TO_DO
      return allow([
        {
          type: 'BUZZ_ADJUDICATED',
          payload: { buzzId: found.buzz.buzzId, accepted: command.accepted },
        },
      ])
    }

    case 'REOPEN_BUZZERS': {
      const live = requireLive(state)
      if (live) return live
      const found = locate(state, command.gameQuestionId)
      if (!found) return deny('QUESTION_NOT_OPEN', 'unknown question')
      // D35 rule 5 — the master accepting they misheard. A no-op when nobody is locked out, rather
      // than an event that says nothing happened.
      if (lockedOutTeamIds(found.play).length === 0) return NOTHING_TO_DO
      return allow([
        {
          type: 'BUZZERS_FORCE_REOPENED',
          payload: { gameQuestionId: found.question.id },
        },
      ])
    }

    case 'VALIDATE_ANSWER': {
      /*
       * No `requireLive`, deliberately — the one action this file has that must keep working
       * after `FINISHED`. PRD 2 §13.1's post-game review grid is explicit: "clicking any cell
       * toggles the verdict, appending `ANSWER_VALIDATED`" on "two views on a finished (or live)
       * game." A guard here would break the one screen this whole feature promises.
       */
      const found = locate(state, command.gameQuestionId)
      if (!found) return deny('QUESTION_NOT_OPEN', 'unknown question')
      const answer = found.play.answers.get(command.teamId)
      // Nothing to judge. Not an error the master can act on, but not a silent success either —
      // a validate against a team that never answered is a client bug.
      if (!answer) {
        return deny('VALIDATION_ERROR', `team ${command.teamId} has no answer to judge`)
      }
      // Legal from the moment the answer is submitted (D42), and repeatable: a second
      // `ANSWER_VALIDATED` supersedes the first, which is how revalidation works — there is
      // deliberately no `ANSWER_REVALIDATED` (protocol §4.3).
      return allow([
        {
          type: 'ANSWER_VALIDATED',
          payload: {
            gameQuestionId: found.question.id,
            teamId: command.teamId,
            accepted: command.accepted,
          },
        },
      ])
    }

    case 'SPOTLIGHT_ANSWER': {
      /*
       * Unlike `VALIDATE_ANSWER` just above, this one has no post-game life of its own — PRD 3
       * §5.3 frames it entirely as the live reveal's curation ("spotlights clear when the next
       * question opens"), and §13.1's review grid never mentions re-spotlighting. A real gap,
       * not a documented omission.
       */
      const live = requireLive(state)
      if (live) return live
      const found = locate(state, command.gameQuestionId)
      if (!found) return deny('QUESTION_NOT_OPEN', 'unknown question')
      const answer = found.play.answers.get(command.teamId)
      if (!answer) {
        return deny('VALIDATION_ERROR', `team ${command.teamId} has no answer to show`)
      }
      if (answer.spotlit === command.spotlit) return NOTHING_TO_DO
      return allow([
        {
          type: 'ANSWER_SPOTLIT',
          payload: {
            gameQuestionId: found.question.id,
            teamId: command.teamId,
            spotlit: command.spotlit,
          },
        },
      ])
    }

    case 'SET_DO_WINNERS': {
      const live = requireLive(state)
      if (live) return live
      const found = locate(state, command.gameQuestionId)
      if (!found) return deny('QUESTION_NOT_OPEN', 'unknown question')
      if (found.question.answerMethod !== 'DO') {
        return deny(
          'VALIDATION_ERROR',
          `question ${found.question.id} is not a DO question`,
        )
      }
      const unknownTeam = requireKnownTeams(state, command.teamIds)
      if (unknownTeam) return unknownTeam

      // `teamIds: []` is the explicit "nobody got it" (D23) and still resolves every team, so no
      // row is left pending. The payout comes from the question's authored config, never from the
      // request — the master chose it while writing the quiz (D23).
      //
      // Resolving every team **completes the question**: `DO` has no reveal beat (PRD 3 §8), so
      // the verdict is the last thing that happens to it, and `QUESTION_SCORED` is appended here
      // rather than left for a second master act that does not exist on the desk. Without it the
      // question sat `LOCKED` forever and `attention` stayed `SCORE_DO`, stranding the master with
      // no route onward but the timeline (slice 9's review). The state machine has carried
      // `LOCKED → SCORED` for exactly this case since PRD 1 §7.1 was drawn.
      return allow([
        {
          type: 'DO_WINNERS_SET',
          payload: {
            gameQuestionId: found.question.id,
            teamIds: [...command.teamIds],
            tiePayout: tiePayoutOf(found.question),
          },
        },
        { type: 'QUESTION_SCORED', payload: { gameQuestionId: found.question.id } },
      ])
    }

    case 'SET_DO_SCORES': {
      const live = requireLive(state)
      if (live) return live
      const found = locate(state, command.gameQuestionId)
      if (!found) return deny('QUESTION_NOT_OPEN', 'unknown question')
      if (found.question.answerMethod !== 'DO') {
        return deny(
          'VALIDATION_ERROR',
          `question ${found.question.id} is not a DO question`,
        )
      }
      for (const { teamId, score } of command.scores) {
        if (!state.teams.has(teamId)) return deny('TEAM_NOT_FOUND', `no team ${teamId}`)
        // Rejected rather than silently clamped (D24): the master typed a number and should see it
        // refused. The reducer clamps as well, so an older build's payload cannot inflate a score.
        if (score < 0 || score > found.question.points) {
          return deny(
            'SCORE_OUT_OF_RANGE',
            `${score} is outside 0…${found.question.points}`,
            { teamId, max: found.question.points },
          )
        }
      }

      /*
       * A partial save is a real state (D24: "1 of 4 scored"), so the question completes only when
       * **every** team has an outcome — the entries already saved plus this payload's. D24's
       * empty-vs-zero distinction is what makes that check honest: a blank box means "not judged
       * yet", so it keeps the desk up; an explicit 0 resolves that team. Once coverage is complete
       * there is nothing left to judge and `QUESTION_SCORED` closes the question, exactly as
       * `SET_DO_WINNERS` does — without this, the last team's score landed and the master was
       * stranded on a finished desk (slice 9's review).
       */
      const resolved = new Set([
        ...[...found.play.answers.keys()],
        ...command.scores.map((entry) => entry.teamId),
      ])
      const complete = [...state.teams.keys()].every((teamId) => resolved.has(teamId))

      return allow([
        {
          type: 'DO_SCORES_SET',
          payload: {
            gameQuestionId: found.question.id,
            scores: command.scores.map((entry) => ({ ...entry })),
          },
        },
        ...(complete
          ? [
              {
                type: 'QUESTION_SCORED' as const,
                payload: { gameQuestionId: found.question.id },
              },
            ]
          : []),
      ])
    }

    case 'SUBMIT_FOR_TEAM': {
      const live = requireLive(state)
      if (live) return live
      const found = locate(state, command.gameQuestionId)
      if (!found) return deny('QUESTION_NOT_OPEN', 'unknown question')
      if (!state.teams.has(command.teamId)) {
        return deny('TEAM_NOT_FOUND', `no team ${command.teamId}`)
      }
      /*
       * D47's "an answer on a team's behalf" presumes there is an answer to submit — `SUBMIT_ANSWER`
       * already refuses this against `BUZZER`/`DO`, which score by adjudication (`BUZZ_ADJUDICATED`)
       * or by the master's own dedicated verdict (`DO_WINNERS_SET`/`DO_SCORES_SET`) and never by a
       * typed submission at all. `SUBMIT_FOR_TEAM` had no such guard, so a request that never goes
       * through the control desk — the desk offers no proxy input on those question types — could
       * still create an `ANSWER_SUBMITTED` row on one, which `autoVerdict` grades `PENDING` with no
       * text and nothing for the master to judge: the same ghost-row shape ISSUE-1 found.
       */
      if (!acceptsTypedAnswers(found.question)) {
        return deny(
          'VALIDATION_ERROR',
          `question ${found.question.id} is ${found.question.answerMethod} and takes no submitted answer`,
        )
      }
      /*
       * D47's own rationale is a live-play mitigation — a team's phone cannot reach the server
       * *while the question is open* — so the bound is the same as an ordinary submission's, not
       * looser. Without it this was legal against `LOCKED`/`REVEALED`/even `SCORED`, silently
       * changing a team's score with no new `QUESTION_SCORED` event to signal it happened.
       * Post-game correction has its own, more visible mechanism (protocol §7.2's `validate` and
       * `adjust-score`) for after the room has moved on.
       */
      const notOpen = requireOpen(found.play, found.question.id)
      if (notOpen) return notOpen
      const optionError = checkOption(found.question, command.selectedOptionId)
      if (optionError) return optionError
      const emptyError = checkNotEmpty(command.text, command.selectedOptionId)
      if (emptyError) return emptyError

      // **The one legitimate overwrite** (D47): an explicit master act, flagged as such, which
      // resets the verdict because the answer genuinely changed. First-write-wins protects players
      // from each other, not the master from the room.
      return allow([
        {
          type: 'ANSWER_SUBMITTED',
          payload: {
            gameQuestionId: found.question.id,
            teamId: command.teamId,
            ...(command.text === undefined ? {} : { text: command.text }),
            ...(command.selectedOptionId === undefined
              ? {}
              : { selectedOptionId: command.selectedOptionId }),
            fromDraft: false,
            enteredByMaster: true,
          },
        },
      ])
    }

    // ─── §7.2 pacing ───

    case 'TOGGLE_SCOREBOARD': {
      const live = requireLive(state)
      if (live) return live
      if (state.scoreboardShown === command.shown) return NOTHING_TO_DO
      return allow([{ type: 'SCOREBOARD_TOGGLED', payload: { shown: command.shown } }])
    }

    /*
     * PRD 4 §10.2's two tabs (D51). The one master action in the product that is legal **only** once
     * the game is over — `requireLive` would refuse it at exactly the moment it exists for, and there
     * is no `FINISHED` stage to switch a tab on before then.
     */
    case 'SET_FINISHED_TAB': {
      if (state.status !== 'FINISHED') {
        return deny('GAME_NOT_FINISHED', 'the two tabs exist once the game has ended')
      }
      if (state.finishedTab === command.tab) return NOTHING_TO_DO
      return allow([{ type: 'FINISHED_TAB_SET', payload: { tab: command.tab } }])
    }

    case 'START_BREAK': {
      const live = requireLive(state)
      if (live) return live
      // The open-question guard (protocol §4.5). Otherwise the question stays live with a running
      // deadline while the room is at the bar: late auto-submits arrive from whichever phones are
      // still awake, and the teams who walked away lose the question.
      if (currentPlay(state)?.state === 'OPEN') {
        return deny(
          'QUESTION_STILL_OPEN',
          'lock or skip the open question before a break',
        )
      }
      // Re-sending during a break is how a break is **extended** — it supersedes `resumesAt`.
      return allow([
        {
          type: 'BREAK_STARTED',
          payload:
            command.durationMs === undefined ? {} : { durationMs: command.durationMs },
        },
      ])
    }

    case 'END_BREAK': {
      // Symmetric with `START_BREAK`'s own guard, above — a break can only ever have started on
      // a `LIVE` game, but `FINISH_GAME`/`ABANDON_GAME` don't clear it (they are the emergency
      // stop, not a lifecycle guard — see their own comment), so a stray `END_BREAK` against a
      // game that ended mid-break must refuse rather than append a `BREAK_ENDED` after the fact.
      const live = requireLive(state)
      if (live) return live
      if (!state.break) return NOTHING_TO_DO
      return allow([{ type: 'BREAK_ENDED', payload: {} }])
    }

    case 'ASSIGN_PICKER': {
      const live = requireLive(state)
      if (live) return live
      if (!state.teams.has(command.teamId)) {
        return deny('TEAM_NOT_FOUND', `no team ${command.teamId}`)
      }
      // Appended even when it merely confirms the derived rule (protocol §4.7), so the log answers
      // "whose pick was it?" without the reader re-deriving D30.
      return allow([
        {
          type: 'PICKER_ASSIGNED',
          payload: { teamId: command.teamId, reason: command.reason },
        },
      ])
    }

    // ─── §7.2 DSMTW_FINALE (D50) ───

    case 'CONFIGURE_FINALE':
      // `SETUP` only (D54): the live values depend on how many teams are playing, and editing
      // `game_round.config` after the copy is taken would violate I16.
      if (state.status !== 'SETUP') return deny('NOT_IN_SETUP', `game is ${state.status}`)
      if (!state.content.rounds.some((round) => round.type === 'DSMTW_FINALE')) {
        return deny('NOT_A_FINALE_ROUND', 'this game has no finale round')
      }
      return allow([
        {
          type: 'FINALE_CONFIGURED',
          payload: {
            secondsPerPoint: command.secondsPerPoint,
            penaltySeconds: command.penaltySeconds,
          },
        },
      ])

    case 'SET_FINALISTS': {
      const live = requireLive(state)
      if (live) return live
      const finaleError = requireFinaleRound(state)
      if (finaleError) return finaleError
      // Fixed once the round opens (D55): each finalist's bank was computed from their score at
      // that instant, so a later change would silently rewrite the arithmetic.
      if (state.finale.finalistIds.length > 0) {
        return deny('FINALISTS_ALREADY_SET', 'the finalists are already selected')
      }
      if (command.teamIds.length < 2) {
        return deny('TOO_FEW_FINALISTS', 'a finale needs at least two finalists')
      }
      const unknownTeam = requireKnownTeams(state, command.teamIds)
      if (unknownTeam) return unknownTeam
      return allow([
        { type: 'FINALISTS_SET', payload: { teamIds: [...command.teamIds] } },
      ])
    }

    case 'START_TURN': {
      const live = requireLive(state)
      if (live) return live
      const finaleError = requireFinaleRound(state)
      if (finaleError) return finaleError
      if (!state.finale.finalistIds.includes(command.teamId)) {
        return deny('TEAM_NOT_A_FINALIST', `team ${command.teamId} is not a finalist`)
      }
      if ((state.teams.get(command.teamId)?.eliminatedAt ?? null) !== null) {
        return deny('TEAM_ELIMINATED', `team ${command.teamId} is out (I22)`)
      }

      const open = currentFinaleTurn(state)
      if (open?.teamId === command.teamId) return NOTHING_TO_DO
      // Starting someone else's turn while a turn is running **is** a pass: that is the master
      // saying "they're done, this team is next", and PRD 3 §10.2's desk offers both as one move.
      // Charging the pass explicitly keeps the clock arithmetic honest.
      const ending: GameEvent[] = open
        ? [{ type: 'TURN_ENDED', payload: { teamId: open.teamId, reason: 'PASSED' } }]
        : []

      return allow([
        ...ending,
        { type: 'TURN_STARTED', payload: { teamId: command.teamId } },
      ])
    }

    case 'PASS_TURN': {
      const live = requireLive(state)
      if (live) return live
      const turn = currentFinaleTurn(state)
      if (!turn) return deny('NO_TURN_ACTIVE', 'no finale turn is running')
      return allow([
        { type: 'TURN_ENDED', payload: { teamId: turn.teamId, reason: 'PASSED' } },
      ])
    }

    case 'MARK_KEYWORD': {
      const live = requireLive(state)
      if (live) return live
      const keyword = findKeyword(state, command.gameKeywordId)
      if (!keyword) return deny('VALIDATION_ERROR', `no keyword ${command.gameKeywordId}`)
      const turn = currentFinaleTurn(state)
      if (!turn) return deny('NO_TURN_ACTIVE', 'no finale turn is running')
      if (keyword.questionId !== state.currentQuestionId) {
        return deny('NOT_A_FINALE_ROUND', 'that keyword belongs to another question')
      }

      const existing = state.keywordMarks.get(command.gameKeywordId)
      if (existing && existing.revokedAt === null) {
        // Idempotent for the same team — the master's double press — and an error for a different
        // one, because that is a mis-click that would move a penalty from one team to another.
        return existing.teamId === turn.teamId
          ? NOTHING_TO_DO
          : deny(
              'KEYWORD_ALREADY_MARKED',
              'that keyword is already credited to another team',
            )
      }

      // Charges every *other* remaining finalist `penaltySeconds` — derived from this mark, not
      // stored, which is what lets `KEYWORD_UNMARKED` give the time back (D41).
      return allow([
        {
          type: 'KEYWORD_MARKED',
          payload: { gameKeywordId: command.gameKeywordId, teamId: turn.teamId },
        },
      ])
    }

    case 'UNMARK_KEYWORD': {
      const live = requireLive(state)
      if (live) return live
      const mark = state.keywordMarks.get(command.gameKeywordId)
      if (!mark || mark.revokedAt !== null) return NOTHING_TO_DO
      return allow([
        { type: 'KEYWORD_UNMARKED', payload: { gameKeywordId: command.gameKeywordId } },
      ])
    }

    case 'REVEAL_KEYWORDS': {
      const live = requireLive(state)
      if (live) return live
      const found = locate(state, command.gameQuestionId)
      if (!found) return deny('QUESTION_NOT_OPEN', 'unknown question')
      if (found.question.keywords.length === 0) {
        return deny('NOT_A_FINALE_ROUND', 'that question has no keywords')
      }

      // P2 #12 — coupled with `REVEAL_QUESTION` above: `[Reveal remaining]` (PRD 3 §10.5) is the
      // finale desk's actual, only reveal button, so this is the path that must mark the question
      // `REVEALED` too, or the common case never gets there at all.
      if (found.play.state === 'REVEALED') {
        return allow([
          { type: 'KEYWORDS_REVEALED', payload: { gameQuestionId: found.question.id } },
        ])
      }
      if (!canTransition(found.play.state, 'QUESTION_REVEALED')) {
        // Same bound as `REVEAL_QUESTION`'s: legal from `LOCKED` only. A finale question is
        // locked the same way any other is (`LOCK_QUESTION`'s finale-awareness ends the open
        // turn first) — revealing before that would leave a turn silently still charging time.
        return deny('QUESTION_NOT_OPEN', `question is ${found.play.state}`)
      }
      return allow([
        { type: 'QUESTION_REVEALED', payload: { gameQuestionId: found.question.id } },
        { type: 'KEYWORDS_REVEALED', payload: { gameQuestionId: found.question.id } },
      ])
    }

    case 'ELIMINATE_TEAM': {
      const live = requireLive(state)
      if (live) return live
      if (!state.finale.finalistIds.includes(command.teamId)) {
        return deny('TEAM_NOT_A_FINALIST', `team ${command.teamId} is not a finalist`)
      }
      if ((state.teams.get(command.teamId)?.eliminatedAt ?? null) !== null) {
        return NOTHING_TO_DO
      }
      // The server is the authority on whether a clock has expired. A request for a team still
      // above zero is a stale client observation — the same shape as a late auto-submit (D8) — so
      // it is accepted and ignored rather than reported as an error the master cannot act on.
      if (finaleRemainingSeconds(state, command.teamId, now) > 0) return NOTHING_TO_DO

      const at = eliminationInstant(state, command.teamId, now)
      const turn = currentFinaleTurn(state)
      const ending: GameEvent[] =
        turn?.teamId === command.teamId
          ? [
              {
                type: 'TURN_ENDED',
                payload: { teamId: command.teamId, reason: 'ELIMINATED' },
              },
            ]
          : []

      return allow([
        ...ending,
        { type: 'TEAM_ELIMINATED', payload: { teamId: command.teamId, at } },
      ])
    }

    case 'END_FINALE': {
      if (state.finale.finalistIds.length === 0) return NOTHING_TO_DO
      if (state.finale.ranking !== null) return NOTHING_TO_DO
      // One finalist left, all of them out, or the questions exhausted (PRD 3 §10.6).
      if (activeFinalists(state).length > 1 && finaleQuestionsRemain(state)) {
        return NOTHING_TO_DO
      }

      // `finaleRanking` derives exactly what the payload carries. They must not disagree: the
      // deriver is what every view uses until this event lands, and the event is what an imported
      // game replays.
      return allow([{ type: 'FINALE_ENDED', payload: { ranking: finaleRanking(state) } }])
    }

    // ─── §7.2 scores & setup ───

    case 'ADJUST_SCORE': {
      if (!state.teams.has(command.teamId)) {
        return deny('TEAM_NOT_FOUND', `no team ${command.teamId}`)
      }
      // Any time, any amount, positive or negative (D15) — including after the game ends, which is
      // why there is no status guard here.
      return allow(
        [
          {
            type: 'SCORE_ADJUSTED',
            payload: {
              adjustmentId: command.adjustmentId,
              teamId: command.teamId,
              delta: command.delta,
              ...(command.reason === undefined ? {} : { reason: command.reason }),
              announced: command.announced,
            },
          },
        ],
        // `announced: false` suppresses the banner only (D25); the row exists either way, so the
        // audit trail stays complete.
        command.announced
          ? [
              {
                kind: 'SCORE_ADJUSTED',
                teamId: command.teamId,
                delta: command.delta,
                reason: command.reason ?? null,
              },
            ]
          : [],
      )
    }

    case 'REVOKE_ADJUSTMENT': {
      const adjustment = state.adjustments.find((a) => a.id === command.adjustmentId)
      if (!adjustment) {
        return deny('VALIDATION_ERROR', `no adjustment ${command.adjustmentId}`)
      }
      // Revoking an already-revoked adjustment is a no-op (D41), and the row is never deleted.
      if (adjustment.revokedAt !== null) return NOTHING_TO_DO
      return allow([
        {
          type: 'SCORE_ADJUSTMENT_REVOKED',
          payload: { adjustmentId: command.adjustmentId },
        },
      ])
    }

    case 'REGENERATE_CODE':
      if (state.status !== 'SETUP') return deny('NOT_IN_SETUP', `game is ${state.status}`)
      return allow([{ type: 'CODE_REGENERATED', payload: { code: command.code } }])

    /**
     * PRD 2 §11.2 — **no status guard, deliberately.** A table arriving during round 1 is normal in
     * a pub and PRD 1 does not block late joins; the gate is a dialog that shows what they missed,
     * not a refusal here.
     *
     * `position` is appended, because ordering is an explicit column and never insertion order
     * (CLAUDE.md §2.7). Two teams may share a name (§2.7 again), so nothing is checked for
     * uniqueness — the id is the identity.
     */
    case 'ADD_TEAM': {
      if (state.teams.has(command.teamId)) {
        // Idempotent on retry, the same way submission is (D8): the same team added twice is the
        // network having doubted itself, not a second table.
        return NOTHING_TO_DO
      }

      const added: GameEvent[] = [
        {
          type: 'TEAM_ADDED',
          payload: {
            teamId: command.teamId,
            name: command.name,
            colour: command.colour,
            position: state.teams.size,
          },
        },
      ]

      /*
       * §11.2's inline generosity, written as an **ordinary** `SCORE_ADJUSTED` with a generated
       * reason (D15). That is the whole point of doing it here: it lands in the audit trail like any
       * other adjustment and can be revoked (D41), rather than being a magic opening balance.
       */
      if (command.startingScore && command.startingScore.delta !== 0) {
        added.push({
          type: 'SCORE_ADJUSTED',
          payload: {
            adjustmentId: command.startingScore.adjustmentId,
            teamId: command.teamId,
            delta: command.startingScore.delta,
            reason: command.startingScore.reason,
            // Silent: the room does not need a banner about bookkeeping for a team just arriving.
            announced: false,
          },
        })
      }

      return allow(added)
    }

    /** Legal at every status, including `FINISHED` — a misspelled name is worth fixing (§13.4). */
    case 'UPDATE_TEAM': {
      if (!state.teams.has(command.teamId)) {
        return deny('TEAM_NOT_FOUND', `no team ${command.teamId}`)
      }
      if (command.name === undefined && command.colour === undefined) return NOTHING_TO_DO

      return allow([
        {
          type: 'TEAM_UPDATED',
          payload: {
            teamId: command.teamId,
            ...(command.name === undefined ? {} : { name: command.name }),
            ...(command.colour === undefined ? {} : { colour: command.colour }),
          },
        },
      ])
    }

    default: {
      // Unreachable while every command is handled, and a **compile error** the moment one is added
      // without a decision — which is the point of spelling it out rather than falling off the end.
      const unhandled: never = command
      throw new Error(`no decision for command ${JSON.stringify(unhandled)}`)
    }
  }
}

// ─── guards and lookups ───

function requireLive(state: GameState): Decision | null {
  return state.status === 'LIVE' ? null : deny('GAME_NOT_LIVE', `game is ${state.status}`)
}

/**
 * The bound both `SUBMIT_ANSWER` and `SUBMIT_FOR_TEAM` share: a submission — typed by a team or
 * entered by the master on their behalf — is only ever legal against an `OPEN` question.
 *
 * D8: the deadline is advisory and the server never enforces it, so a phone asleep at zero still
 * submits when it wakes and it counts — that is what keeps this a bound on *state*, `OPEN`, rather
 * than on *time*. Only the master locking the question stops submissions.
 *
 * Written once so the two call sites cannot silently drift apart, the way `SUBMIT_FOR_TEAM` once
 * did by omitting the second half of this check entirely.
 */
/** Shared by `SET_DO_WINNERS` and `SET_FINALISTS` — both take a team-id list from the request. */
function requireKnownTeams(
  state: GameState,
  teamIds: readonly string[],
): Decision | null {
  const unknown = teamIds.find((teamId) => !state.teams.has(teamId))
  return unknown === undefined ? null : deny('TEAM_NOT_FOUND', `no team ${unknown}`)
}

function requireOpen(play: QuestionPlayState, questionId: string): Decision | null {
  if (play.state === 'PENDING' || play.state === 'SKIPPED') {
    return deny('QUESTION_NOT_OPEN', `question ${questionId} is ${play.state}`)
  }
  if (play.state !== 'OPEN') {
    return deny('QUESTION_LOCKED', `question ${questionId} is ${play.state}`)
  }
  return null
}

function requireFinaleRound(state: GameState): Decision | null {
  const round = state.content.rounds.find((r) => r.id === state.currentRoundId)
  return round?.type === 'DSMTW_FINALE'
    ? null
    : deny('NOT_A_FINALE_ROUND', 'the open round is not a finale')
}

/**
 * Locking or skipping a question is a handover the master may never have made through
 * `PASS_TURN` — the common case is a team finding the deciding keyword with seconds still on the
 * clock, and the master moving straight to the next question. PRD 3 §10.2 is explicit that
 * *marking* never pauses the clock, only a handover does — but ending the question **is** a
 * handover the code did not use to recognise as one.
 *
 * Left open, `START_TURN`'s own no-op guard (`open?.teamId === command.teamId`) treats the next
 * start by the same team as a repeat of an already-running turn, so the stale `turnStartedAt`
 * from the previous question keeps draining that team's clock with no new `TURN_STARTED` event —
 * breaking D52's "a restart mid-turn recovers every clock exactly" the moment there is no restart
 * to trigger the recovery.
 *
 * A no-op outside the finale (or with no turn running), so every caller can call it unconditionally
 * rather than guard first.
 */
function endOpenFinaleTurn(state: GameState): GameEvent[] {
  const open = currentFinaleTurn(state)
  return open
    ? [
        {
          type: 'TURN_ENDED',
          payload: { teamId: open.teamId, reason: 'QUESTION_CLOSED' },
        },
      ]
    : []
}

function locate(
  state: GameState,
  gameQuestionId: string,
): { question: QuestionContent; play: QuestionPlayState } | null {
  const question = findQuestion(state.content, gameQuestionId)
  const play = state.questions.get(gameQuestionId)
  return question && play ? { question, play } : null
}

function currentPlay(state: GameState): QuestionPlayState | undefined {
  return state.currentQuestionId
    ? state.questions.get(state.currentQuestionId)
    : undefined
}

/** A buzz carries no question id of its own, so the lookup returns the question it was found on. */
function findBuzz(state: GameState, buzzId: string) {
  for (const play of state.questions.values()) {
    const buzz = play.buzzes.find((candidate) => candidate.buzzId === buzzId)
    if (buzz) return { buzz, play }
  }
  return undefined
}

function findKeyword(
  state: GameState,
  gameKeywordId: string,
): { questionId: string } | null {
  for (const round of state.content.rounds) {
    for (const question of round.questions) {
      if (question.keywords.some((keyword) => keyword.id === gameKeywordId)) {
        return { questionId: question.id }
      }
    }
  }
  return null
}

/** Methods where a player types or picks something. `BUZZER` and `DO` are answered out loud. */
function acceptsTypedAnswers(question: QuestionContent): boolean {
  return (
    question.answerMethod === 'FREE_TEXT' || question.answerMethod === 'MULTIPLE_CHOICE'
  )
}

/**
 * An option id must belong to this question. The boundary schema cannot check it — it does not know
 * the question — and without this a client could submit any string and land on `AUTO_WRONG`.
 */
function checkOption(
  question: QuestionContent,
  selectedOptionId: string | undefined,
): Decision | null {
  if (selectedOptionId === undefined) return null
  return question.options.some((option) => option.id === selectedOptionId)
    ? null
    : deny('VALIDATION_ERROR', `option ${selectedOptionId} is not on this question`)
}

/**
 * Shared by `SUBMIT_ANSWER` and `SUBMIT_FOR_TEAM`: no text and no selected option is not an
 * answer, it is nothing at all. `LOCK_QUESTION`'s draft commitment already applies exactly this
 * rule to an outstanding draft, so a proxy or player submission has no business being looser —
 * round-2 stress testing found `SUBMIT_FOR_TEAM` doing exactly that, with `text: ''`, which
 * silently creates a `NO_ANSWER` row the master gets no feedback about (stress-testing findings,
 * ISSUE-5). The control desk's own proxy input already disables `[Save it]` on blank text
 * (`ProxyAnswer`), so this is the API-level backstop for the same rule, not a new one.
 *
 * Written once, next to `checkOption`, so the two commands cannot drift the way `SUBMIT_FOR_TEAM`
 * once did by omitting `requireOpen`'s second half.
 */
function checkNotEmpty(
  text: string | undefined,
  selectedOptionId: string | undefined,
): Decision | null {
  if (normaliseAnswer(text ?? '') !== '' || selectedOptionId !== undefined) return null
  return deny('VALIDATION_ERROR', 'a submission needs text or a selected option')
}

/** Same text (after D22 normalisation) and same option ⇒ the retry case, not a conflict. */
function sameAnswer(
  existing: { text: string | null; selectedOptionId: string | null },
  text: string | undefined,
  selectedOptionId: string | undefined,
): boolean {
  const sameText = normaliseAnswer(existing.text ?? '') === normaliseAnswer(text ?? '')
  return sameText && (existing.selectedOptionId ?? null) === (selectedOptionId ?? null)
}

/** The payout the question was authored with (D23). `FULL` is the schema's default. */
function tiePayoutOf(question: QuestionContent): TiePayout {
  const parsed = doConfigSchema.safeParse(question.config)
  return parsed.success ? parsed.data.tiePayout : 'FULL'
}

function otherTeamsFor(state: GameState, exceptId: string, cap: number) {
  return [...state.teams.values()]
    .filter((team) => team.id !== exceptId)
    .sort((a, b) => a.position - b.position)
    .map((team) => ({
      id: team.id,
      name: team.name,
      colour: team.colour,
      full: team.deviceCount >= cap,
    }))
}

/**
 * Whether the finale round still has a question to play — the third end trigger (PRD 3 §10.6).
 *
 * `PENDING` (not reached yet) and `OPEN` (being played right now) count as remaining. Anything the
 * master has closed does not, which makes locking the last finale question the moment the round
 * ends — there is nothing else for it to wait for, since `KEYWORDS_REVEALED` is not a lifecycle
 * transition and would otherwise leave the question open for ever.
 */
function finaleQuestionsRemain(state: GameState): boolean {
  const round = state.content.rounds.find((r) => r.type === 'DSMTW_FINALE')
  if (!round) return false
  return round.questions.some((question) => {
    const play = state.questions.get(question.id)?.state ?? 'PENDING'
    return play === 'PENDING' || play === 'OPEN'
  })
}

/**
 * When a finalist's clock actually reached zero — **recomputed, never taken from the client**
 * (protocol §4.6), so a slow or fast browser cannot alter a team's fate.
 *
 * Two cases, and they are the two the spec calls out:
 *
 * - **On turn:** the clock ran down live, so it crossed at
 *   `turnStartedAt + secondsRemainingWhenTheTurnBegan`.
 * - **Off turn:** only a penalty can take a waiting team to zero, so it crossed at the instant of
 *   the most recent keyword that charged them.
 *
 * Clamped to `now`, because an instant in the future would make `finaleRanking` order eliminations
 * by something that has not happened.
 */
export function eliminationInstant(
  state: GameState,
  teamId: string,
  now: number,
): number {
  const turn = currentFinaleTurn(state)

  if (turn?.teamId === teamId) {
    const atTurnStart = finaleRemainingSeconds(state, teamId, turn.startedAt)
    return Math.min(now, turn.startedAt + atTurnStart * 1000)
  }

  let latestPenalty = 0
  for (const mark of state.keywordMarks.values()) {
    if (mark.revokedAt !== null || mark.teamId === null || mark.teamId === teamId)
      continue
    latestPenalty = Math.max(latestPenalty, mark.markedAt)
  }
  return latestPenalty === 0 ? now : Math.min(now, latestPenalty)
}
