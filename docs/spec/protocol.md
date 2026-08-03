# Spec — Realtime Protocol, Payloads & Export

**Status:** Draft · **Last updated:** 2026-08-03 · **Normative**

Companion to [PRD 1](../prd/01-main.md) and the [data model](./data-model.md). Where a
surface PRD disagrees with this document, **this document wins**. Decision references
(`D2`, `D35`, …) point at PRD 1 §5.

Three things live here:

1. **The transport contract** — SSE endpoints, framing, reconnection (§1–§3)
2. **The event catalogue** — every `game_event.type` and its payload (§4)
3. **Per-audience view shapes** — what each surface may receive, per question state,
   and how PRD 1 §7's confidentiality invariants are mechanically enforced (§5–§6)

Plus the export zip format (§8).

---

## 1. The central design decision: push whole views, not patches

The server pushes a **complete, audience-filtered view** on every change. Not deltas,
not patches, not events-for-the-client-to-reduce.

**Why this and not event streaming to the client:** if clients received events and
reduced them locally, the reduction rules would exist twice — once in
`packages/domain` and once in the browser. Two implementations of "what may this
surface see right now" is precisely where a leak or a divergence appears, and the
browser copy would be the one nobody tests. Pushing finished views means **the client
has no game logic at all.** It renders what it is given.

Three consequences, all of them simplifications:

| Consequence | Detail |
| --- | --- |
| **Views are idempotent** | Re-sending the current view is always safe, so reconnection needs no replay — just send the view (§3) |
| **`Last-Event-ID` becomes an optimisation, not a correctness mechanism** | Used only to skip a send when nothing changed. This refines PRD 1 §6.5, which assumed event replay |
| **The client cannot leak what it never received** | Confidentiality is a server-side filtering problem with one implementation (§6) |

### 1.1 The bounded-view rule

> **A pushed view must be O(teams + current question). It must never be
> O(questions × teams).**

This is a hard constraint, not a guideline. Without it, master control's view would
carry the whole end-of-round validation set — 40 questions × 20 teams ≈ 800 answers,
maybe 100 KB — and re-push all of it on every single accept/deny click. Eight hundred
clicks would move 80 MB and make the master's screen crawl at exactly the moment they
are under the most time pressure.

So the pushed view carries the **current** validation item and a pending *count*.
Anything unbounded — full answer lists, past rounds, game history, the review screens —
is fetched over ordinary REST (§7.4). Live push is for *what is happening now*.

---

## 2. Transport

### 2.1 Endpoints

One SSE endpoint per audience. **Separate routes, not an `?audience=` parameter** — the
filter function is selected by the route, so the wrong filter cannot be reached by
manipulating a query string, and every call site is greppable.

| Route | Audience | Identity |
| --- | --- | --- |
| `GET /api/live/:gameId/screen` | `MAIN_SCREEN` | none |
| `GET /api/live/:gameId/control` | `MASTER_CONTROL` | none |
| `GET /api/live/:gameId/play` | `PLAYER(teamId)` | `X-Kwiz-Device` header carrying `deviceToken` |

Per PRD 1 §4 there is no authentication: anyone reachable on the network can open
`/control`. The `PLAYER` route needs the device token only to know **which team's** view
to build — it is identity, not authorisation.

**`CONFIG` is not an SSE audience.** The configuration pages are request/response and
use REST (§7.4). They have no live requirement, and giving them a stream would mean a
fourth filter to keep correct for no benefit.

### 2.2 Response framing

```
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no        ← required; nginx and friends buffer SSE without it
```

Two event names, and only two:

```
id: 42
event: state
data: {"stage":{"kind":"QUESTION",...},"teams":[...]}

event: notice
data: {"kind":"SCORE_ADJUSTED","teamId":"...","delta":5,"reason":"best heckle"}

: ping
```

| Frame | Meaning |
| --- | --- |
| `state` | The complete audience-filtered view. Idempotent. Carries `id: <seq>`. |
| `notice` | A transient one-shot moment: a banner, a sound cue, a celebratory flash. **Never replayed** (§3.2). Carries no `id`. |
| `: ping` | Comment-only keepalive every **15 s**. Keeps intermediaries from timing out an idle stream, and lets the server notice dead sockets. |

`retry: 3000` is sent once on connect, so a dropped stream reconnects in ~3 s rather
than the browser default.

### 2.3 Why `notice` exists separately

State answers *"what is true now"*. Some things are *moments*, not states: the score
adjustment banner (D25), the buzz sound, "Quizzly Bears just joined". Sent as state
they'd be indistinguishable from state that was already there, and would re-fire on
every reconnect.

Notices are **fire-and-forget and explicitly lossy.** Missing one during a disconnect
costs the user a banner, never a fact — because every fact it referred to is also in
the next `state` frame.

---

## 3. Connection lifecycle

### 3.1 Connect

```
client opens EventSource
  → server resolves the game (404 if unknown)
  → resolves the audience by route; for PLAYER, resolves teamId from deviceToken
      (401-equivalent if the token is unknown → client clears storage and rejoins)
  → loads or lazily builds the in-memory projection for that gameId
  → sends retry:, then one `state` frame with the full filtered view
  → registers the subscriber against (gameId, audience)
```

### 3.2 Reconnect

The browser reconnects automatically and sends `Last-Event-ID`. Because views are
whole and idempotent (§1), the handling is trivial:

```
if (lastEventId === currentSeq) → send nothing; the client is already current
else                            → send the current `state` frame
```

**No event replay.** Missed `notice` frames are not resent — by design (§2.3).

Per PRD 1 §6.5, `seq` is **per-game**. A `Last-Event-ID` belonging to a different game
must be treated as unknown, never compared numerically against this game's `seq` — the
numbers are in the same range and would silently match.

### 3.3 Disconnect

A closed stream is unregistered. It updates `game_device.lastSeenAt` for a player
device and nothing else — **disconnection is not a game event** (data model §1.1). A
team whose phone dies has not forfeited anything, and nothing about the game state
changes because a socket closed.

### 3.4 Ending states

| Situation | Behaviour |
| --- | --- |
| Game `FINISHED` | Stream stays open; final `state` has `stage.kind = 'FINISHED'`. The main screen keeps showing the leaderboard. |
| Game `ABANDONED` | Final `state` frame, then the server closes the stream. |
| Game deleted | Server closes the stream. Client shows "this game no longer exists". |
| Unknown `gameId` | `404`. `EventSource` will retry; the client must detect the 404 and stop it. |

---

## 4. Event catalogue

Every `game_event.type`. The reducer in `packages/domain` is a pure function
`(state, event) → state` over exactly these.

**Design rule: if a fact is derivable, it is not an event.** Question verdicts for
`FREE_TEXT` and `MULTIPLE_CHOICE` are computed deterministically from the submission
plus the accepted answers, so there is no `ANSWER_GRADED` event. Buzzer lockout sets are
derived from denied buzzes. Timer pauses are derived from buzz/adjudication timestamps.
Storing a derivable fact creates a second source of truth for it.

### 4.1 Setup & lifecycle

| Type | Payload | Notes |
| --- | --- | --- |
| `GAME_CREATED` | `{ quizName, quizRevision, code }` | Always `seq = 1` |
| `GAME_RESYNCED` | `{ quizRevision }` | Copy subtree replaced (data model §7.1) |
| `CODE_REGENERATED` | `{ code }` | `SETUP` only (data model Q3) |
| `TEAM_ADDED` | `{ teamId, name, colour, position }` | |
| `TEAM_UPDATED` | `{ teamId, name?, colour? }` | Rename/recolour at any time, including after the game ends |
| `DEVICE_JOINED` | `{ deviceId, teamId }` | Refused beyond `KWIZ_MAX_DEVICES_PER_TEAM` (D20) |
| `DEVICE_SWITCHED_TEAM` | `{ deviceId, fromTeamId, toTeamId }` | A player who picked the wrong team |
| `GAME_STARTED` | `{}` | `SETUP → LIVE`. Does **not** stop further joins (PRD 1 flow step 10) |
| `GAME_FINISHED` | `{}` | |
| `GAME_ABANDONED` | `{}` | |

### 4.2 Round & question flow

| Type | Payload | Notes |
| --- | --- | --- |
| `ROUND_OPENED` | `{ gameRoundId }` | |
| `ROUND_CLOSED` | `{ gameRoundId }` | |
| `QUESTION_OPENED` | `{ gameQuestionId, deadlineAt? }` | For Jeopardy this **is** tile selection. `deadlineAt` is absolute and advisory (D7, D8) |
| `QUESTION_LOCKED` | `{ gameQuestionId }` | Master action only — never the timer (D8). Commits outstanding drafts (§4.3) |
| `QUESTION_REVEALED` | `{ gameQuestionId }` | The **only** point at which correct answers enter `MAIN_SCREEN` / `PLAYER` views |
| `QUESTION_SCORED` | `{ gameQuestionId }` | Master is done with it; scores are final unless revalidated |
| `QUESTION_SKIPPED` | `{ gameQuestionId }` | Terminal (D46). Legal from `PENDING` or `OPEN`. **The reducer forces `pointsAwarded = 0` on every answer to this question**, keeping each verdict for the record — a question skipped from `OPEN` may already have auto-graded answers carrying points, and "awards nothing to anyone" has to be enforced rather than assumed (data model I8) |

### 4.3 Answers

**Drafts are not events.** A debounced draft (D8) writes directly to a scratch table and
is never appended to the log. Rationale: a draft is not a game fact, keystroke timing is
not reproducible by replay, and 20 teams typing would flood the log for zero replay
value. See §4.7 for the table and its exemption.

| Type | Payload | Notes |
| --- | --- | --- |
| `ANSWER_SUBMITTED` | `{ gameQuestionId, teamId, text?, selectedOptionId?, fromDraft, enteredByMaster }` | `fromDraft: true` when the server committed a stored draft at lock rather than the device submitting. Sets `game_answer.isDraft` (D26) |
| `ANSWER_VALIDATED` | `{ gameQuestionId, teamId, accepted }` | The master's accept/deny. May be sent from the moment the answer is submitted (D42), not only after reveal |
| `ANSWER_SPOTLIT` | `{ gameQuestionId, teamId, spotlit }` | Toggles whether this answer is shown to the room (D40). An event rather than ephemeral state, because it changes the pushed view and must survive a reconnect or restart |

> **There is no separate `ANSWER_REVALIDATED`.** Revalidation resolves to
> a **repeated `ANSWER_VALIDATED`**, and the later event supersedes the earlier. One
> event type, and the audit trail still shows both decisions in order — which is the
> whole point of appending rather than updating.

**Draft commitment at lock.** When `QUESTION_LOCKED` is processed, any team with a
stored draft but no `ANSWER_SUBMITTED` gets one appended with `fromDraft: true`. This
happens at **lock**, a master action — not at the deadline, which the server does not
enforce (D8).

**Submission is final; first write wins (D43).** At most one `ANSWER_SUBMITTED` is
appended per `(question, team)`. A later submission attempt is **rejected**, not applied —
see §7.3 for the exact semantics and why this matters for multi-device teams.

Because nothing changes after submission, **a validated verdict can never go stale**, so
validating early (D42) is always safe.

**Submitting deletes the team's draft** for that question, so a stale draft can never
resurface at lock. Draft commitment (above) therefore only ever applies to teams that
never submitted at all.

**The one legitimate overwrite** is the master submitting on a team's behalf (D47), via
its own endpoint rather than `submit`. That is an explicit master act, carries its own flag, and *does* reset `verdict`
to `PENDING` and clear `validatedAt` — because the answer genuinely changed.

### 4.4 Buzzer (D35)

| Type | Payload | Notes |
| --- | --- | --- |
| `BUZZ_RECEIVED` | `{ buzzId, gameQuestionId, teamId, receivedAt, offsetMs }` | Recorded even when it arrives after the lock (`outcome = NOT_FIRST`) |
| `BUZZ_ADJUDICATED` | `{ buzzId, accepted }` | Deny ⇒ lockout + automatic reopen, both derived |
| `BUZZERS_FORCE_REOPENED` | `{ gameQuestionId }` | Master clears **all** lockouts because they misheard (D35 rule 5) |

Not events, because they are derived:

- **The lockout set** = teams with a denied buzz on this question.
- **Buzzers reopening after a denial** — implied by the denial itself.
- **Timer pause during adjudication** — the paused interval is
  `BUZZ_RECEIVED.receivedAt → BUZZ_ADJUDICATED.createdAt`, so the effective deadline is
  recomputed from the log. There is no `TIMER_PAUSED` event.

### 4.5 `DO` scoring

| Type | Payload | Notes |
| --- | --- | --- |
| `DO_WINNERS_SET` | `{ gameQuestionId, teamIds[], tiePayout }` | `teamIds: []` is the explicit "no winner" (D23) |
| `DO_SCORES_SET` | `{ gameQuestionId, scores: { teamId, score }[] }` | `PER_TEAM_SCORE`; clamped `0…points` (D24) |

#### The open-question guard

**A break cannot be started while a question is `OPEN`.** Otherwise the question stays
live with a running `deadlineAt` while the room is at the bar: late auto-submits arrive
from whichever phones are still awake, and the teams who walked away lose the question.

The master locks or skips the question first. Control disables `[Start break]` with the
reason rather than failing on click (PRD 3 §10.2).

A break started between rounds, or while a question is `LOCKED`/`REVEALED`/`SCORED`, is
fine — nothing is waiting on input.

### 4.6 Jeopardy & scores

| Type | Payload | Notes |
| --- | --- | --- |
| `BREAK_STARTED` | `{ durationMs? }` | The interval (PRD 4 §11). Server computes an absolute `resumesAt = createdAt + durationMs` — same principle as question timers (D7), so a screen connecting mid-break shows the correct remaining time rather than restarting. **`durationMs` is optional**: omitted means an open-ended break, `resumesAt` is null, and the screens show "back shortly" with no clock. **Refused while a question is `OPEN`** — see below |
| `BREAK_ENDED` | `{}` | Master resumes. **Never automatic** — the countdown reaching zero changes nothing on the server (consistent with D8). Re-sending `BREAK_STARTED` during a break is how a break is **extended**: it supersedes `resumesAt` |
| `SCOREBOARD_TOGGLED` | `{ shown }` | Master pushes the leaderboard to the main screen mid-round (O4). Cleared automatically when the next question opens |
| `PICKER_ASSIGNED` | `{ teamId, reason: 'RULE' \| 'TIE_BREAK' \| 'MASTER_OVERRIDE' }` | Needed because tie-breaks are master-arbitrated and overrides exist (D30) — those are decisions, not derivations |
| `SCORE_ADJUSTED` | `{ teamId, delta, reason?, announced }` | Any time, any amount (D15). `announced: false` suppresses the banner only (D25) |
| `SCORE_ADJUSTMENT_REVOKED` | `{ adjustmentId }` | Undo of a mistaken adjustment (D41). Sets `revokedAt`; the row stays and the total excludes it. Revoking an already-revoked adjustment is a no-op |

`PICKER_ASSIGNED` is appended even when it merely confirms the rule, so the log always
answers "whose pick was it?" without the reader re-deriving the rule.

### 4.7 The two event-sourcing exemptions

Both are explicit, narrow, and justified. Nothing else in the play half escapes the log.

| Exemption | Why |
| --- | --- |
| `game_device.lastSeenAt` | A heartbeat is not a game fact. One event per device per few seconds would bloat the log for zero replay value. Nothing in `packages/domain` may read it. |
| `game_answer_draft` | A draft is not a game fact and keystroke timing is not reproducible. Kept in its **own table**, not in `game_answer`, so `game_answer` stays a pure projection and data model invariant I15 (`projection == replay`) holds without a carve-out. |

Defined in [data model §6.7](./data-model.md). Composite primary key
`(gameQuestionId, teamId)`, upserted directly, cascade-deleted with the game.

A draft survives a server restart because it is a real table — which is the entire point
of D8's safety net.

---

## 5. View shapes

One TypeScript type per audience. These types are the contract; a field's **absence** is
how confidentiality is enforced (§6).

### 5.1 Shared

```ts
type Timer = {
  deadlineAt: number      // absolute epoch ms — clients render a countdown against it
  pausedAt: number | null // set during buzzer adjudication (§4.4)
}

type TeamPublic = { id: string; name: string; colour: string; score: number }

// Mirrors game_answer.verdict (data model §6.5). FREE_TEXT never auto-resolves to
// AUTO_WRONG — a non-match becomes PENDING and goes to the master (D22).
type AnswerVerdict =
  | 'PENDING' | 'AUTO_CORRECT' | 'AUTO_WRONG' | 'ACCEPTED' | 'DENIED' | 'NO_ANSWER'

// Mirrors game_buzz.outcome (data model §6.6).
type BuzzOutcome = 'AWAITING' | 'ACCEPTED' | 'DENIED' | 'NOT_FIRST'

type MediaRef = {
  id: string
  kind: 'IMAGE' | 'AUDIO' | 'VIDEO'
  url: string             // /api/attachment/:gameAttachmentId
  durationMs: number | null
}
```

### 5.2 `MAIN_SCREEN`

```ts
type MainScreenView = {
  code: string
  joinUrl: string
  teams: TeamPublic[]
  stage:
    | { kind: 'WAITING_FOR_PLAYERS'; joinedTeamIds: string[] }
    | { kind: 'ROUND_INTRO'; title: string; roundNumber: number; totalRounds: number }
    | { kind: 'LEADERBOARD'; standings: Standing[] }
    | { kind: 'BREAK'; resumesAt: number | null; standings: Standing[] }
    | { kind: 'QUESTION'; question: MainScreenQuestion }
    | { kind: 'JEOPARDY_BOARD'; board: BoardView; currentPickerTeamId: string | null }
    | { kind: 'FINISHED'; standings: Standing[] }
}

type Standing = { teamId: string; rank: number; score: number; tied: boolean }  // D32

type BoardView = {
  categories: { id: string; name: string }[]
  // Values and used-state only. NEVER prompts — data model / PRD 1 §7 invariant 5.
  tiles: { id: string; categoryId: string; points: number; used: boolean }[]
}

type MainScreenQuestion = {
  id: string
  prompt: string
  points: number
  media: MediaRef[]                    // main-screen-visible only (D27)
  timer: Timer | null
  state: 'OPEN' | 'LOCKED' | 'REVEALED' | 'SCORED'

  // MULTIPLE_CHOICE. No correctness marker before REVEALED.
  options?: { id: string; text: string }[]

  // NOTE: submission progress is deliberately absent. Nothing on the main screen
  // renders it (PRD 4 §6), and an unused field on the audience payload is what gets
  // rendered by accident later. Progress lives on MASTER_CONTROL only.

  // BUZZER: who buzzed and when. Safe at any state — a buzz is not an answer.
  buzzes?: { teamId: string; offsetMs: number; outcome: BuzzOutcome }[]
  lockedOutTeamIds?: string[]

  // ─── REVEALED and later only. Absent before that (D40). ───
  correctAnswer?: string
  correctOptionId?: string

  // FREE_TEXT / BUZZER: ONLY answers the master has spotlighted (D40). Never the
  // full set — a 20-row answer table is illegible at projector scale, and each team
  // already has its own verdict on its phone. Usually 0–2 entries.
  spotlitAnswers?: { teamId: string; text: string; correct: boolean | null }[]

  // MULTIPLE_CHOICE: which teams picked which option. Compact at any team count and
  // the visual highlight of an MC reveal. Always present at REVEALED — not gated on
  // spotlight, because 4 buckets of colour dots fit where 20 rows of text do not.
  // The main screen holds it back ~1.5s after marking the correct option (P5) so the
  // room registers the answer before hunting for its own team. Presentation only.
  optionDistribution?: { optionId: string; teamIds: string[] }[]

  // ─── SCORED only. ───
  awarded?: { teamId: string; points: number }[]
}
```

**Never present in `MainScreenView`, in any state:** `masterNotes`, `question_option.isCorrect`
as a flag on options, `game_answer.isDraft`, or any pending-validation information. The
room does not need to know the master hasn't finished judging.

### 5.3 `PLAYER`

```ts
type PlayerView = {
  team: TeamPublic
  otherTeams: { id: string; name: string; colour: string; score: number }[]
  locale: 'en' | 'nl'                  // resolved per D29 / PRD 1 §9.4
  stage:
    | { kind: 'WAITING'; teamCount: number }
    | { kind: 'BETWEEN_QUESTIONS' }
    | { kind: 'BREAK'; resumesAt: number | null; standings: Standing[] }
    | { kind: 'QUESTION'; question: PlayerQuestion; myAnswer: MyAnswer | null }
    | { kind: 'JEOPARDY_BOARD'; board: BoardView; currentPickerTeamId: string | null }
    | { kind: 'FINISHED'; standings: Standing[] }
}

type PlayerQuestion = {
  id: string
  prompt: string
  answerMethod: 'FREE_TEXT' | 'MULTIPLE_CHOICE' | 'BUZZER' | 'DO'
  media: MediaRef[]                    // images with showOnPlayerDevices only (D27)
  timer: Timer | null
  state: 'OPEN' | 'LOCKED' | 'REVEALED' | 'SCORED'
  points: number

  options?: { id: string; text: string }[]

  // BUZZER only.
  buzzersLive?: boolean
  iAmLockedOut?: boolean               // drives the disabled-with-a-reason state (D35)
  firstBuzzTeamId?: string | null      // who beat us — public, and part of the fun

  // ─── REVEALED and later only. ───
  correctAnswer?: string
  correctOptionId?: string
  myVerdict?: 'CORRECT' | 'INCORRECT' | 'PENDING'
  myPoints?: number
}

// Shared across ALL of the team's devices (D45) — including the in-progress draft, so
// two devices cannot diverge. `submitted` locks the input on every device at once (D43).
type MyAnswer = {
  text: string | null
  optionId: string | null
  submitted: boolean
  submittedAt: number | null
}
```

**Never present in `PlayerView`, in any state:** another team's answer text or option
choice, `masterNotes`, or `correctAnswer`/`correctOptionId` before `REVEALED`.

`otherTeams` carries names, colours and **scores** — the leaderboard is public — but
never a single character of another team's answer (PRD 1 §7 invariant 3).

### 5.4 `MASTER_CONTROL`

Everything, subject to §1.1's bounded-view rule.

```ts
type MasterControlView = {
  code: string
  joinUrl: string
  teams: (TeamPublic & { deviceCount: number })[]
  round: { id: string; title: string; number: number; total: number } | null

  // What needs the master's attention RIGHT NOW. This is the whole point of the
  // surface (PRD 1 G4): one thing at a time, chosen by the server.
  attention:
    | { kind: 'NONE' }                                  // → show the leaderboard big
    | { kind: 'ADJUDICATE_BUZZ'; buzz: BuzzDetail; referenceAnswer: string }
    | { kind: 'VALIDATE_QUESTION'; question: QuestionRef; items: ValidationItem[]; remainingQuestions: number }
    | { kind: 'SCORE_DO'; question: DoScoringDetail }
    | { kind: 'BREAK_TIE_FOR_PICK'; tiedTeamIds: string[] }
    | { kind: 'ADVANCE'; suggestion: 'REVEAL' | 'NEXT_QUESTION' | 'NEXT_ROUND' | 'FINISH' }

  // Full detail incl. masterNotes, plus every team's answer with its verdict and a
  // needsValidation flag — so the master can judge inline while the question is still
  // open (D42). Bounded by team count, so D39 holds.
  question: MasterQuestionDetail | null
  board?: MasterBoardView                 // Jeopardy: prompts included, master-only

  // COUNTS ONLY — never the list (§1.1).
  pendingValidationCount: number
}

// One question's worth of validation, all teams together (PRD 3 §6.1). Bounded by team
// count, so D39 holds. Grouping is what makes inconsistency visible: judging
// "Radio Head" in isolation, the master cannot see they just accepted "radiohead".
type QuestionRef = {
  gameQuestionId: string
  prompt: string
  acceptedAnswers: string[]
  masterNotes: string | null
}

type ValidationItem = {
  teamId: string
  teamName: string
  teamColour: string
  answerText: string | null
  verdict: AnswerVerdict            // decided rows included as context, not hidden
  isDraft: boolean                  // "not confirmed by team" marker (D26)
  enteredByMaster: boolean          // proxy submission (D47)

  // True when another item in this group has the same normalised text. A soft aid only:
  // the master still decides each team separately, but identical text is visually linked
  // so an inconsistent pair is hard to miss. Never auto-applies a verdict.
  hasIdenticalSibling: boolean
}
```

`attention` is computed **server-side**, not by the client inspecting state and guessing.
The rule for what deserves the master's attention is game logic and belongs in
`packages/domain` next to everything else — and it keeps PRD 3 from re-implementing it.

Priority when several conditions hold, highest first (PRD 3 §3.1):
`ADJUDICATE_BUZZ` › `SCORE_DO` › `BREAK_TIE_FOR_PICK` › `VALIDATE_QUESTION` › `ADVANCE` ›
`NONE`. Exactly one is active; anything lower-priority appears only as a count.

### 5.5 `MASTER_CONTROL` detail types

Referenced by `MasterControlView`. All are O(teams), so D39 holds.

```ts
// The open/locked/revealed question in full — this is what makes inline validation
// possible (D42, PRD 3 §5.1) rather than needing a separate queue screen.
type MasterQuestionDetail = {
  gameQuestionId: string
  prompt: string
  answerMethod: 'FREE_TEXT' | 'MULTIPLE_CHOICE' | 'BUZZER' | 'DO'
  points: number
  state: 'PENDING' | 'OPEN' | 'LOCKED' | 'REVEALED' | 'SCORED' | 'SKIPPED'
  timer: Timer | null

  masterNotes: string | null          // MASTER_CONTROL / CONFIG only (PRD 1 §7 inv. 7)
  acceptedAnswers: string[]           // reference for adjudication; all methods
  options?: { id: string; text: string; isCorrect: boolean }[]   // isCorrect IS sent here
  media: MediaRef[]                   // all attachments, incl. audio/video for playback

  // Every team's answer, judgeable in place.
  teamAnswers: ValidationItem[]

  buzzes?: BuzzSummary[]
  lockedOutTeamIds?: string[]
  failsPreflight?: string             // PRD 2 §9 "play anyway" marker, if any
}

type BuzzSummary = {
  buzzId: string; teamId: string; offsetMs: number; outcome: BuzzOutcome
}

// attention: ADJUDICATE_BUZZ — deliberately minimal (PRD 3 §7: two buttons, nothing else).
type BuzzDetail = {
  buzzId: string
  teamId: string; teamName: string; teamColour: string
  offsetMs: number
  otherBuzzes: BuzzSummary[]
  lockedOutTeamIds: string[]
  timerPaused: boolean                // D35 — stated explicitly to the master
}

// attention: SCORE_DO
type DoScoringDetail = {
  gameQuestionId: string
  prompt: string
  points: number                      // also the per-team maximum for PER_TEAM_SCORE (D24)
  scoringMode: 'WINNER_TAKES_ALL' | 'PER_TEAM_SCORE'
  tiePayout: 'SPLIT' | 'FULL'         // WINNER_TAKES_ALL only (D23)
  masterNotes: string | null
  teams: { teamId: string; name: string; colour: string; score: number | null }[]
}

// The Jeopardy board WITH prompts — master-only. The MAIN_SCREEN/PLAYER BoardView
// carries values and used-state only (PRD 1 §7 invariant 5).
type MasterBoardView = {
  categories: { id: string; name: string }[]
  tiles: {
    id: string; categoryId: string; points: number
    used: boolean
    prompt: string                    // never in a BoardView
  }[]
  currentPickerTeamId: string | null
  tiedForPickTeamIds: string[]        // non-empty when BREAK_TIE_FOR_PICK applies (D30)
}
```

---

## 6. Enforcing confidentiality

PRD 1 §7 states seven invariants. This section is how they are made true mechanically
rather than by care.

### 6.1 One filter per audience, no shared mutable state

```ts
// packages/domain — pure. Cannot reach a database, a request, or a socket.
export function toMainScreenView(s: GameState): MainScreenView
export function toPlayerView(s: GameState, teamId: string): PlayerView
export function toMasterControlView(s: GameState): MasterControlView
```

Each **constructs a new object** containing only permitted fields. None of them takes
the internal state and deletes from it — a filter that removes fields fails silently the
day a new field is added, whereas a filter that builds up fails visibly by omitting it.

> **The rule, stated for implementers:** a filter is an **allowlist that constructs**,
> never a denylist that strips. If you catch yourself writing `delete view.correctAnswer`
> or `{ ...state, correctAnswer: undefined }`, the code is wrong even when the output
> looks right.

### 6.2 The sentinel leak test

Field-by-field assertions only check the fields someone thought to check. A leak arrives
through a field nobody remembered — a nested object, a debug addition, a spread that
picked up too much.

So the primary defence is a **table-driven sentinel test**: build a game whose secrets
are distinctive strings, then assert those strings do not appear anywhere in the
serialised payload.

```ts
const SENTINELS = {
  correctAnswer: 'ZZ_SECRET_CORRECT_ANSWER_ZZ',
  masterNotes:   'ZZ_SECRET_MASTER_NOTES_ZZ',
  teamBAnswer:   'ZZ_SECRET_TEAM_B_ANSWER_ZZ',
  unopenedTile:  'ZZ_SECRET_UNOPENED_TILE_PROMPT_ZZ',
}

// Every (audience × question state) combination, exhaustively.
for (const state of ['PENDING','OPEN','LOCKED','REVEALED','SCORED'] as const) {
  for (const audience of ['MAIN_SCREEN','PLAYER_A','PLAYER_B'] as const) {
    const json = JSON.stringify(buildView(audience, gameAt(state)))
    for (const [name, sentinel] of forbiddenIn(audience, state)) {
      expect(json).not.toContain(sentinel)   // catches ANY path, however nested
    }
  }
}
```

`forbiddenIn(audience, state)` is the machine-readable form of PRD 1 §7:

| Secret | `MAIN_SCREEN` | `PLAYER(A)` | `MASTER_CONTROL` |
| --- | --- | --- | --- |
| `correctAnswer` | forbidden before `REVEALED` | forbidden before `REVEALED` | always allowed |
| `masterNotes` | **always forbidden** | **always forbidden** | always allowed |
| Team B's answer | forbidden before `REVEALED` | **always forbidden** | always allowed |
| Team A's own answer | forbidden before `REVEALED` | always allowed | always allowed |
| Unopened Jeopardy tile prompt | **always forbidden** | **always forbidden** | always allowed |
| Question prompt | forbidden while `PENDING` | forbidden while `PENDING` | always allowed |
| `isCorrect` on an option | forbidden before `REVEALED` | forbidden before `REVEALED` | always allowed |

The complement matters too: a test asserting each secret **does** appear once permitted,
so the table can't be satisfied by a filter that returns nothing.

### 6.3 Why option ids are UUIDs

`MULTIPLE_CHOICE` options are sent as `{ id, text }` while a question is open. Option ids
are UUIDs rather than indexes or positions specifically so that **nothing in the payload
ranks the options** — a client can submit a choice without ever having received a value
that could be correlated with correctness. Sorting options by id would leak nothing;
sorting by a sequential key could.

---

## 7. Client → server actions

All are `POST` to route handlers, all zod-validated at the boundary, all returning
`{ ok: true }` or a typed error. **No action returns game state** — the resulting state
arrives on the SSE stream, so there is exactly one path by which a client learns
anything.

### 7.1 Player actions

`X-Kwiz-Device: <deviceToken>` required on every one.

| Endpoint | Body | Notes |
| --- | --- | --- |
| `POST /api/games/join` | `{ code, teamId }` | Returns a fresh `deviceToken`. `409` when the team is at `KWIZ_MAX_DEVICES_PER_TEAM` — the response lists the other teams so the UI can offer them (D20) |
| `POST /api/games/:gameId/switch-team` | `{ toTeamId }` | Player picked wrong |
| `POST /api/games/:gameId/draft` | `{ gameQuestionId, text?, selectedOptionId? }` | Debounced ≈500 ms. Upserts `game_answer_draft`, then pushes to the team's other devices (D45). **No event** (§4.7). Rejected once the team has submitted |
| `POST /api/games/:gameId/submit` | `{ gameQuestionId, text?, selectedOptionId? }` | **Idempotent** — must be safe to retry (§7.3) |
| `POST /api/games/:gameId/buzz` | `{ gameQuestionId }` | Server timestamps arrival; that is the ordering authority (D35) |

**`submit` is accepted after the deadline** and rejected only once the question is
`LOCKED` (D8) — or once that team has already submitted (D43). Late submission is a
feature, not an error; a *second* submission is neither.

### 7.2 Master actions

| Endpoint | Body |
| --- | --- |
| `POST /api/games/:gameId/start` · `/finish` · `/abandon` | `{}` |
| `POST /api/games/:gameId/rounds/:roundId/open` · `/close` | `{}` |
| `POST /api/games/:gameId/questions/:qId/open` | `{}` — server computes `deadlineAt` from the question's timer |
| `POST /api/games/:gameId/questions/:qId/lock` · `/reveal` · `/score` | `{}` |
| `POST /api/games/:gameId/buzzes/:buzzId/adjudicate` | `{ accepted: boolean }` |
| `POST /api/games/:gameId/questions/:qId/reopen-buzzers` | `{}` — clears all lockouts (D35) |
| `POST /api/games/:gameId/answers/validate` | `{ gameQuestionId, teamId, accepted }` — also the revalidation path; allowed from submission onwards (D42) |
| `POST /api/games/:gameId/answers/spotlight` | `{ gameQuestionId, teamId, spotlit }` — show/hide one answer to the room (D40) |
| `POST /api/games/:gameId/questions/:qId/do-winners` | `{ teamIds: string[] }` — `[]` means no winner |
| `POST /api/games/:gameId/questions/:qId/do-scores` | `{ scores: { teamId, score }[] }` |
| `POST /api/games/:gameId/questions/:qId/skip` | `{}` — legal from `PENDING` or `OPEN` (D46) |
| `POST /api/games/:gameId/answers/submit-for-team` | `{ gameQuestionId, teamId, text?, selectedOptionId? }` — proxy submission; overwrites and resets the verdict (D47) |
| `POST /api/games/:gameId/scoreboard` | `{ shown }` — leaderboard on the main screen |
| `POST /api/games/:gameId/break` | `{ durationMs? }` — start or extend the interval. `409` while a question is `OPEN` |
| `POST /api/games/:gameId/break/end` | `{}` — resume; master-driven only |
| `POST /api/games/:gameId/picker` | `{ teamId }` — tie-break or override (D30) |
| `POST /api/games/:gameId/adjust-score` | `{ teamId, delta, reason?, announced }` |
| `POST /api/games/:gameId/adjustments/:id/revoke` | `{}` — idempotent |
| `POST /api/games/:gameId/regenerate-code` | `{}` — `SETUP` only |
| `POST /api/games/:gameId/resync` | `{}` — `SETUP` only (data model §7.1) |

### 7.3 `submit` — finality, idempotency and the multi-device case

Three requirements meet here and the resolution is not obvious, so it is spelled out.

| Requirement | Source |
| --- | --- |
| A retry after a lost response must not count as a second submission | D8 — the client retries with backoff |
| A team's submission is final | D43 |
| Two devices on one team may both press Submit | D20 |

**Rule, evaluated server-side on `(gameQuestionId, teamId)`:**

```
no submission yet          → accept, append ANSWER_SUBMITTED, delete the draft
already submitted, SAME    → { ok: true }              ← the retry case; a no-op
already submitted, DIFFERENT → { ok: false,
                                error: 'ALREADY_SUBMITTED',
                                answer: <the canonical submitted answer> }
question is LOCKED         → { ok: false, error: 'QUESTION_LOCKED' }
```

**Why reject rather than overwrite.** Device A submits *"Radiohead"*; device B, which was
mid-typing, submits *"Radio Head"*. Last-write-wins would let B's stale draft silently
replace A's deliberate submission — the team is then marked wrong for an answer they had
already got right. Rejecting keeps the first deliberate act.

**The rejection must not silently discard B's text.** The response carries the canonical
answer so B's UI can switch to *"Your team answered: Radiohead"*. A player who typed
something and saw it vanish with no explanation will assume the app lost it.

**Both error codes are typed and distinguishable**, because the client reacts differently:
`ALREADY_SUBMITTED` means stop retrying and show the team's answer; `QUESTION_LOCKED`
means stop retrying and show the locked state; a network failure means keep retrying.
Collapsing these into one generic failure is how a client ends up looping forever.

**D45 makes this path rare.** Because a team's draft is pushed to all of its devices,
two devices normally hold the same text and B's submit is the *same-value* no-op rather
than a conflict. The reject path is the safety net, not the everyday case.

### 7.4 REST reads — everything unbounded

Per §1.1, anything O(questions × teams) is fetched, never pushed. All of these serve
`CONFIG` and the review screens.

| Endpoint | Returns |
| --- | --- |
| `GET /api/quizzes` · `/api/quizzes/:id` | Template tree for authoring |
| `GET /api/games` | Game list for the dashboard — includes `quizRevision` vs template `revision` so the staleness indicator works (data model §7.1) |
| `GET /api/games/:id/review` | Full played game: every question, every team's answer, every verdict |
| `GET /api/games/:id/validation-queue` | The full pending list, paginated |
| `GET /api/attachment/:gameAttachmentId` | The file, with **HTTP range support** (D5) so audio and video can seek |

---

## 8. Export format

A `.zip` reproducing a quiz **and optionally its played history** on another machine
(PRD 1 §10).

```
kwiz-export-<quizName>-<timestamp>.zip
├─ manifest.json
├─ quiz.json                  the template tree
├─ games.json                 optional — omitted by "export without history"
└─ attachments/
   └─ <sha256>.<ext>          content-addressed, matching on-disk layout (data model §8)
```

### 8.1 `manifest.json`

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-08-03T18:22:04.000Z",
  "quiz":  { "id": "01920e…", "name": "Pub Quiz #4", "revision": 9 },
  "includesGames": true,
  "counts": { "rounds": 5, "questions": 84, "attachments": 12, "games": 2 },
  "attachments": [
    { "checksum": "3f8a2c…e1", "ext": "mp3", "sizeBytes": 4211233 }
  ]
}
```

- **`schemaVersion` is checked first.** A newer version than this build understands is
  **refused with a clear message**, never partially imported.
- **`counts` are verified** against the parsed content. A mismatch means truncation and
  fails the import.
- **`attachments[]` lists checksums**, each verified by re-hashing the file on import.
  A corrupt or missing file is reported **per file**, so a master learns "the audio for
  question 12 is damaged" rather than "import failed".

### 8.2 `games.json`

Each game carries its **own copy subtree** (data model §5) plus its full event log. This
is what makes an imported game reviewable and re-derivable on the new machine:

```json
{
  "games": [{
    "game": { "id": "…", "quizName": "Pub Quiz #4", "quizRevision": 7, "status": "FINISHED", "…": "…" },
    "teams": [ … ], "devices": [ … ],
    "copy": { "rounds": [ … ], "categories": [ … ], "questions": [ … ],
              "acceptedAnswers": [ … ], "options": [ … ], "attachments": [ … ] },
    "events": [ { "seq": 1, "type": "GAME_CREATED", "payload": { … } }, … ]
  }]
}
```

**Projections and drafts are not exported.** `game_answer`, `game_buzz` and
`game_score_adjustment` are rebuilt by replaying `events` on import. `game_answer_draft`
is dropped: an uncommitted draft is meaningless on a machine the phone that typed it will
never reach, and it is not derivable from the log by design (§4.7).

Rebuilding on import makes **every import a live test of data model invariant I15**
(`projection == replay`), and keeps the zip smaller.

`game_device` rows are exported so a device's team binding survives a machine move. The
tokens are meaningless on a machine those phones will never reach again, but exporting
them costs nothing and keeps replay faithful.

### 8.3 Import

```
1. read + validate manifest (schemaVersion, counts)
2. verify every attachment checksum; collect per-file failures
3. resolve collision on quiz.id → Replace / Import as copy / Cancel  (D9)
4. ONE transaction:
     insert quiz tree
     insert each game + its copy subtree
     replay each game's events to rebuild the three projections
5. move attachment files into place (skip any whose checksum already exists)
```

- **Transactional.** Either the whole import lands or the database is untouched
  (PRD 1 §10).
- **Attachment files are written after the transaction commits**, and content addressing
  makes that safe: a file already present is skipped, and a file written for a
  transaction that then failed is an orphan the reconciliation pass sweeps (data model
  §8). The failure mode is a stray file, never a missing one.
- **"Import as copy"** assigns new ids throughout — quiz, rounds, questions, games, copy
  subtrees, events — because the point is to coexist with the original. Attachment
  *checksums* are unchanged, so no file is duplicated.
- **"Replace"** deletes the local quiz and its games, then imports. Requires the
  confirmation described in D9, which shows both sides' revision and game counts.

---

## 9. Open questions

| # | Question | Recommendation |
| --- | --- | --- |
| ~~P1~~ | ~~Main screen: teams' answers at `LOCKED` or `REVEALED`?~~ | **Resolved → D40, then superseded by it.** `REVEALED` only — and D40 went further: free-text answers are never broadcast wholesale, only **spotlighted** one at a time by the master. Multiple choice shows a per-option distribution instead. PRD 1 §7 invariant 4 narrowed accordingly. |
| ~~P2~~ | ~~Live scores in `PlayerView.otherTeams`~~ | **Resolved: always included.** Public information already on the projector; hiding it on phones would make the two surfaces disagree, which reads as a bug rather than as suspense. |
| ~~P3~~ | ~~Buzz sound `notice`~~ | **Resolved: `MAIN_SCREEN` only.** Twenty phones buzzing a fraction of a second apart is the same failure as twenty phones playing the same song (D27). The room's sound comes from the room's speakers. |
| ~~P4~~ | ~~Draft on `DEVICE_SWITCHED_TEAM`~~ | **Resolved: discarded.** A draft belongs to `(question, team)`; carrying one team's in-progress answer to another team is worse than losing it. |
| ~~P5~~ | ~~Timing of the reveal's second beat~~ | **Resolved.** D40's spotlighting made this narrow: for free text, beat 2 *is* the master pressing `[Show on screen]`, so there is no timing to decide. For multiple choice, the `optionDistribution` animates in **~1.5s after** the correct option is marked — the room registers the answer before seeing the consequences. Purely presentational; both fields are already in the `REVEALED` payload. |
