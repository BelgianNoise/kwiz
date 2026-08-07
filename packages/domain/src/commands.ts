/**
 * Every client→server action as a **command**, one per endpoint in protocol §7.1–§7.2.
 *
 * Commands are imperative and present tense; events are past tense (conventions §9). That is not
 * decoration: a command is a *request* that may be refused, an event is a fact that happened.
 * `decide()` is the only thing that turns one into the other.
 *
 * **Everything a decision needs is in the command.** Ids, device tokens, the device cap, and the
 * drafts to commit at lock are all passed in rather than reached for, because
 * `packages/domain` has no clock, no database and no `process.env` (CLAUDE.md §2.1) — and because a
 * decision that mints its own ids cannot be compared against an expected event list in a test.
 */

/** A stored draft, as `LOCK_QUESTION` receives it from `game_answer_draft` (protocol §4.3). */
export interface DraftSubmission {
  teamId: string
  text: string | null
  selectedOptionId: string | null
}

export type Command =
  // ─── §7.1 player ───
  /**
   * The device cap is passed in because `KWIZ_MAX_DEVICES_PER_TEAM` is env config (PRD 1 §6.8) and
   * this package may not read it. `deviceId` and `deviceToken` are minted by the caller.
   */
  | {
      type: 'JOIN'
      teamId: string
      deviceId: string
      deviceToken: string
      maxDevicesPerTeam: number
    }
  /** The cap applies here too, or switching would be a way around it (D20). */
  | { type: 'SWITCH_TEAM'; deviceId: string; toTeamId: string; maxDevicesPerTeam: number }
  | {
      type: 'SUBMIT_ANSWER'
      gameQuestionId: string
      teamId: string
      text?: string
      selectedOptionId?: string
    }
  /** `receivedAt` is the server's arrival instant — the ordering authority (D35). */
  | {
      type: 'BUZZ'
      buzzId: string
      gameQuestionId: string
      teamId: string
      receivedAt: number
    }

  // ─── §7.2 master: lifecycle ───
  | { type: 'START_GAME' }
  | { type: 'FINISH_GAME' }
  | { type: 'ABANDON_GAME' }
  | { type: 'OPEN_ROUND'; gameRoundId: string }
  | { type: 'CLOSE_ROUND'; gameRoundId: string }

  // ─── §7.2 master: question flow ───
  | { type: 'OPEN_QUESTION'; gameQuestionId: string }
  /** Commits outstanding drafts (protocol §4.3): teams with a draft and no submission get one. */
  | { type: 'LOCK_QUESTION'; gameQuestionId: string; drafts: readonly DraftSubmission[] }
  | { type: 'REVEAL_QUESTION'; gameQuestionId: string }
  | { type: 'SCORE_QUESTION'; gameQuestionId: string }
  | { type: 'SKIP_QUESTION'; gameQuestionId: string }

  // ─── §7.2 master: buzzer, validation, DO ───
  | { type: 'ADJUDICATE_BUZZ'; buzzId: string; accepted: boolean }
  | { type: 'REOPEN_BUZZERS'; gameQuestionId: string }
  | { type: 'VALIDATE_ANSWER'; gameQuestionId: string; teamId: string; accepted: boolean }
  | { type: 'SPOTLIGHT_ANSWER'; gameQuestionId: string; teamId: string; spotlit: boolean }
  | { type: 'SET_DO_WINNERS'; gameQuestionId: string; teamIds: readonly string[] }
  | {
      type: 'SET_DO_SCORES'
      gameQuestionId: string
      scores: readonly { teamId: string; score: number }[]
    }
  /** D47 — the one legitimate overwrite of a submitted answer. */
  | {
      type: 'SUBMIT_FOR_TEAM'
      gameQuestionId: string
      teamId: string
      text?: string
      selectedOptionId?: string
    }

  // ─── §7.2 master: pacing ───
  | { type: 'TOGGLE_SCOREBOARD'; shown: boolean }
  | { type: 'START_BREAK'; durationMs?: number }
  | { type: 'END_BREAK' }
  | {
      type: 'ASSIGN_PICKER'
      teamId: string
      reason: 'RULE' | 'TIE_BREAK' | 'MASTER_OVERRIDE'
    }

  // ─── §7.2 master: DSMTW_FINALE (D50) ───
  | { type: 'CONFIGURE_FINALE'; secondsPerPoint: number; penaltySeconds: number }
  | { type: 'SET_FINALISTS'; teamIds: readonly string[] }
  | { type: 'START_TURN'; teamId: string }
  | { type: 'PASS_TURN' }
  | { type: 'MARK_KEYWORD'; gameKeywordId: string }
  | { type: 'UNMARK_KEYWORD'; gameKeywordId: string }
  | { type: 'REVEAL_KEYWORDS'; gameQuestionId: string }
  | { type: 'ELIMINATE_TEAM'; teamId: string }
  /**
   * **Server-initiated, and the only command with no endpoint.** `FINALE_ENDED` has no entry in
   * protocol §7.2 because no client decides it: the round is over when one finalist is left, when
   * every finalist is out, or when the questions run out. The service runs this after any finale
   * command and it produces nothing until one of those holds.
   */
  | { type: 'END_FINALE' }

  // ─── §7.2 master: scores & setup ───
  | {
      type: 'ADJUST_SCORE'
      adjustmentId: string
      teamId: string
      delta: number
      reason?: string
      announced: boolean
    }
  | { type: 'REVOKE_ADJUSTMENT'; adjustmentId: string }
  | { type: 'REGENERATE_CODE'; code: string }

/*
 * **`resync` is deliberately not a command** (protocol §7.2, data model §7.1). Both halves of it are
 * outside this layer: the precondition it really turns on is whether `game_answer` or `game_buzz`
 * rows exist and whether `sourceQuizId` still points anywhere, and the operation itself replaces the
 * game-copy subtree. `@kwiz/db`'s `resyncGame` owns it end to end, in one transaction with its
 * `GAME_RESYNCED` event — a decision function here could only restate its guards, and two statements
 * of one rule is the drift this design exists to avoid.
 */

export type CommandType = Command['type']
