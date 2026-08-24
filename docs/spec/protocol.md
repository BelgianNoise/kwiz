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
| `GET /api/live/:gameId/play` | `PLAYER(teamId)` | `?device=` query parameter carrying `deviceToken` |

Per PRD 1 §4 there is no authentication: anyone reachable on the network can open
`/control`. The `PLAYER` route needs the device token only to know **which team's** view
to build — it is identity, not authorisation.

> **Why the stream takes the token in the URL while every action takes it in a header.**
>
> `EventSource` cannot set a request header — there is no API for it — so a stream demanding
> `X-Kwiz-Device` is unreachable from a browser. This was raised at the end of slice 5, again at the
> end of slice 6, and settled in slice 7, which is the first slice that needs the route to work.
>
> The alternatives were a mirrored cookie (a second storage mechanism to keep in sync with the
> `localStorage` PRD 5 §2.3 deliberately chose) and reading the stream with `fetch` instead (which
> gives up the automatic reconnect and `Last-Event-ID` replay that D2 names as the reason SSE was
> chosen at all — for the least reliable device in the product).
>
> A query parameter is only acceptable because of what this token is. It is **identity, not a
> credential**: it grants nothing that being on the network does not already grant, and the network is
> a pub's wifi with no authentication anywhere in the product. The usual objections — logs, history,
> `Referer` — are about protecting a secret, and there is no secret here. Had this been authorisation,
> the answer would have been the cookie.
>
> One cost is real and worth stating rather than waving past: a fronting reverse proxy's **default
> access log records the request line**, so every team's token now lands in a log file where a header
> would not have. It does not change the conclusion — the token is identity, the deployment is a
> laptop on a pub's wifi, and PRD 1 §4 already concedes far more to anyone on that network — but it is
> the one thing that would matter if this product ever grew an authorisation model, and it belongs in
> the same paragraph as the decision rather than in a reviewer's notes.
>
> **`POST /api/games/:gameId/*` still uses `X-Kwiz-Device`** (§7.1). Only the stream had the problem,
> so only the stream changed.

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
id: 01920e7c-…-9f31:42
event: state
data: {"stage":{"kind":"QUESTION",...},"teams":[...]}

event: notice
data: {"kind":"SCORE_ADJUSTED","teamId":"...","delta":5,"reason":"best heckle"}

: ping
```

**The `id` is `<gameId>:<seq>`, not a bare number.** §3.2 requires a `Last-Event-ID` from another
game to be *treated as unknown, never compared numerically* — and with `id: 42` that rule cannot be
implemented, because nothing in the value says which game produced it and both games' `seq` sit in
the same range. Qualifying it makes the guarantee structural instead of aspirational, and costs
nothing: `EventSource` echoes the id back without any client parsing it.

| Frame | Meaning |
| --- | --- |
| `state` | The complete audience-filtered view. Idempotent. Carries `id: <gameId>:<seq>`. |
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
parse `<gameId>:<seq>`; a different gameId, or anything unparseable, is unknown
if (seq === currentSeq) → send nothing; the client is already current
else                    → send the current `state` frame
```

**No event replay.** Missed `notice` frames are not resent — by design (§2.3).

Per PRD 1 §6.5, `seq` is **per-game**. A `Last-Event-ID` belonging to a different game
must be treated as unknown, never compared numerically against this game's `seq` — the
numbers are in the same range and would silently match. The qualified `id` (§2.2) is what
makes that check possible rather than a rule to remember.

**`Last-Event-ID` is consulted once, at connect, and never again.** A later push whose `seq` is
unchanged is still a real change: a shared draft (D45, §4.8) moves text between a team's phones
without appending anything to the log. Treating the stored id as "this client is current" would
lose exactly that.

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
| `DEVICE_JOINED` | `{ deviceId, teamId, deviceToken }` | Refused beyond `KWIZ_MAX_DEVICES_PER_TEAM` (D20). **Carries the token** because the projection *creates* the `game_device` row — only `lastSeenAt` is exempt from the log (§4.8), so there is nowhere else it could come from without a second writer into the play half. No new exposure: the log is on the same disk as the table, and the token is continuity rather than authentication (PRD 1 §4) |
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
| `QUESTION_REVEALED` | `{ gameQuestionId }` | The **only** point at which correct answers enter `MAIN_SCREEN` / `PLAYER` views. Against a `DSMTW_FINALE` question, `decide.ts`'s `REVEAL_QUESTION` handler also appends `KEYWORDS_REVEALED` in the same decision, and vice versa (§4.6) — the two facts must never diverge on a finale question, whichever command a client sends |
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
| `BUZZ_ADJUDICATED` | `{ buzzId, accepted }` | **This is also the scoring.** Deny ⇒ lockout + automatic reopen, both derived — and the team gets a `DENIED` outcome with no points. Accept ⇒ the team is *credited* the question's points (PRD 1 §8.4, D35). Nothing was typed, so there is no `ANSWER_SUBMITTED` to validate: for a buzzer question and every Jeopardy tile (D34), this event is the only thing that can award anything. Both halves of the projection must do it, or a whole answer method scores zero |
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
| `DO_WINNERS_SET` | `{ gameQuestionId, teamIds[], tiePayout }` | `teamIds: []` is the explicit "no winner" (D23). Resolves every team in one commit, which **completes the question**: `QUESTION_SCORED` is appended with it, because `DO` has no reveal beat (PRD 3 §8) |
| `DO_SCORES_SET` | `{ gameQuestionId, scores: { teamId, score }[] }` | `PER_TEAM_SCORE`; clamped `0…points` (D24). A partial save is a real state ("1 of 4 scored"); when the payload gives **every** team an outcome, `QUESTION_SCORED` is appended with it and the question completes |

#### The open-question guard

**A break cannot be started while a question is `OPEN`.** Otherwise the question stays
live with a running `deadlineAt` while the room is at the bar: late auto-submits arrive
from whichever phones are still awake, and the teams who walked away lose the question.

The master locks or skips the question first. Control disables `[Start break]` with the
reason rather than failing on click (PRD 3 §10.2).

A break started between rounds, or while a question is `LOCKED`/`REVEALED`/`SCORED`, is
fine — nothing is waiting on input.

### 4.6 `DSMTW_FINALE` (D50)

Every clock in this round is **derived from these timestamps** (D52). There is no timer
event, no tick event, and no server timer.

| Type | Payload | Notes |
| --- | --- | --- |
| `FINALE_CONFIGURED` | `{ secondsPerPoint, penaltySeconds }` | Overrides the authored defaults. Legal only while `SETUP` (D54) — editing `game_round.config` would violate I16 |
| `FINALISTS_SET` | `{ teamIds[] }` | Master's selection at round open (D55). Minimum 2. Also fixes each finalist's `startingSeconds`, computed from their score at this instant |
| `TURN_STARTED` | `{ teamId }` | This timestamp starts the team's clock |
| `TURN_ENDED` | `{ teamId, reason }` | `PASSED` / `ELIMINATED` / `QUESTION_CLOSED`. The interval between start and end is the only thing that charges a team for time |
| `KEYWORD_MARKED` | `{ gameKeywordId, teamId }` | Correct guess. Charges every *other* remaining finalist `penaltySeconds` |
| `KEYWORD_UNMARKED` | `{ gameKeywordId }` | Mis-mark correction. Revokes the mark **and the penalties it charged** — the D41 pattern, and here it must reverse time, not just a score |
| `KEYWORDS_REVEALED` | `{ gameQuestionId }` | Master shows the unguessed ones; creates marks with `teamId: null`. This is `[Reveal remaining]` (PRD 3 §10.5), and it also appends `QUESTION_REVEALED` in the same decision — see §4.2's note |
| `TEAM_ELIMINATED` | `{ teamId, at }` | Clock reached zero. `at` is the computed instant, not when the request arrived |
| `FINALE_ENDED` | `{ ranking: teamId[][] }` | One finalist left, all eliminated, or questions exhausted. `ranking` is **an array of rank groups**, best first — not a flat list, because simultaneous elimination shares a rank (D51, PRD 1 §8.8). A single survivor is `[[winner], [runnerUp], …]`; the degenerate all-out case is one group with every finalist in it and no winner |

**Two things deliberately absent:**

- **No turn-order event.** Order is *"fewest remaining seconds among finalists still in and
  not yet passed this question"* — fully derivable, so storing it would be a second source of
  truth for the same fact.
- **No clock event.** See D52's formula.

**`TEAM_ELIMINATED` carries `at`** because a team can cross zero while *not* on turn — a
penalty from someone else's correct guess can do it. The elimination instant is therefore
computed from the log, not taken from when a client noticed.

**Who sends it.** Control detects zero and posts it — the D8 pattern, where the client
notices and the server recomputes. The server **recomputes `at` from the log and ignores any
client-supplied instant**, so a slow or fast browser cannot alter a team's fate.

### 4.7 Jeopardy & scores

| Type | Payload | Notes |
| --- | --- | --- |
| `BREAK_STARTED` | `{ durationMs? }` | The interval (PRD 4 §11). Server computes an absolute `resumesAt = createdAt + durationMs` — same principle as question timers (D7), so a screen connecting mid-break shows the correct remaining time rather than restarting. **`durationMs` is optional**: omitted means an open-ended break, `resumesAt` is null, and the screens show "back shortly" with no clock. **Refused while a question is `OPEN`** — see below |
| `BREAK_ENDED` | `{}` | Master resumes. **Never automatic** — the countdown reaching zero changes nothing on the server (consistent with D8). Re-sending `BREAK_STARTED` during a break is how a break is **extended**: it supersedes `resumesAt` |
| `SCOREBOARD_TOGGLED` | `{ shown }` | Master pushes the leaderboard to the main screen mid-round (O4). Cleared automatically when the next question opens. **On the way up it also captures the ranks it displays**, as the baseline PRD 4 §10's `▲2` arrows are measured against on the *next* showing — hiding it again captures nothing, because a dismissal is not a showing |
| `FINISHED_TAB_SET` | `{ tab: 'RESULT' \| 'POINTS' }` | PRD 4 §10.2's two tabs (D51), switched from control because the projected surface has no controls. An event rather than ephemeral state for the same reason `SCOREBOARD_TOGGLED` is one: it changes the pushed view, so a projector that reconnected — or a second one opened halfway through the applause — has to come back to the tab the master left it on. `RESULT` is the default and needs no event. **Legal only while `FINISHED`**, which makes it the one master action that `GAME_NOT_LIVE` would refuse at exactly the moment it exists for; it has its own `GAME_NOT_FINISHED` (conventions §4). Added in slice 6 |
| `PICKER_ASSIGNED` | `{ teamId, reason: 'RULE' \| 'TIE_BREAK' \| 'MASTER_OVERRIDE' }` | Needed because tie-breaks are master-arbitrated and overrides exist (D30) — those are decisions, not derivations |
| `SCORE_ADJUSTED` | `{ adjustmentId, teamId, delta, reason?, announced }` | Any time, any amount (D15). `announced: false` suppresses the banner only (D25). **Carries its own row id**, minted by the caller — see the rule below |
| `SCORE_ADJUSTMENT_REVOKED` | `{ adjustmentId }` | Undo of a mistaken adjustment (D41). Sets `revokedAt`; the row stays and the total excludes it. Revoking an already-revoked adjustment is a no-op |

`PICKER_ASSIGNED` is appended even when it merely confirms the rule, so the log always
answers "whose pick was it?" without the reader re-deriving the rule.

> **Any projection row id that a later event references must be carried in the event that
> creates the row.** `BUZZ_RECEIVED.buzzId` and `SCORE_ADJUSTED.adjustmentId` both exist for this
> reason, and it is not stylistic: a projection rebuild (data model §11) replays the log into
> empty tables, so an id left to a column default comes back **different**. The revocation would
> then match nothing and silently restore points a master had taken away — a rebuild quietly
> changing a score is exactly what I15 exists to make impossible.
>
> Row ids nothing refers to — `game_answer`, `game_keyword_mark` — may keep the default, and I15
> is therefore equality of *content*, not of surrogate keys.
>
> **The same applies to timestamps.** A projection row's `createdAt` must be written from its
> event's `createdAt`, never from `new Date()` at write time — a column default stamps *now*, so
> a rebuild would silently rewrite when everything happened.

### 4.8 The two event-sourcing exemptions

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
  // The question's full span. PRD 4 §7's timer is "a depleting ring plus the number", and
  // deadlineAt alone gives a client the number but not the proportion — it cannot know
  // whether 18 seconds is most of the time or the last of it. Added in slice 6.
  // Pauses extend deadlineAt and deliberately do NOT grow this: a ring whose total grew
  // mid-question would visibly jump backwards on every deny loop.
  durationMs: number
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
  quizName: string        // PRD 4 §4's title. Added in slice 6
  // PRD 2 §16's `Mute all quiz sounds`, which silences PRD 4 §13's two sounds. On the view rather
  // than read at page load, and that is the difference between the setting working and merely
  // existing: §16's justification is that "hunting for OS volume mid-quiz is not acceptable", so a
  // mute has to reach a projector nobody is going to reload. Passed into the filter. Added slice 6
  soundMuted: boolean
  // PRD 4 §14: "game abandoned → whatever was showing, held. No announcement." stageKind folds
  // ABANDONED into FINISHED, which is right for control (its header says so) and wrong for the
  // room, which would otherwise get a full winner-at-hero-scale announcement for a game the master
  // had just pulled — the view is published before the streams close. The screen holds its last
  // real view instead, and this is the flag that tells it to.
  //
  // Not a leak and not a contradiction of "no announcement": the room is never SHOWN this. It is
  // the client being told to show less, which is the only way a stateless resolver can express a
  // rule about what was on screen a moment ago. Added in slice 6's review round.
  abandoned: boolean
  teams: TeamPublic[]
  stage:
    | { kind: 'WAITING_FOR_PLAYERS'; joinedTeamIds: string[] }
    | {
        kind: 'ROUND_INTRO'
        title: string
        roundNumber: number
        totalRounds: number
        // PRD 4 §5's `10 questions · 100 points`. Added in slice 6 — the clause was there and
        // nothing on the payload could render it.
        //
        // Safe where a *question* number is not (§6): announced before anything can be skipped,
        // so it never has to explain a gap. A later skip (D46) makes the total a small
        // overstatement, which is cheaper than a live count telling the room a question vanished.
        questionCount: number
        points: number
      }
    | {
        kind: 'LEADERBOARD'
        standings: Standing[]
        provisional: Provisional | null    // §5.2.1
        // The round just closed, for PRD 4 §10's `AFTER ROUND 2` heading — null when the
        // master pushed the board mid-round, which reads `CURRENT SCORES` instead. Two
        // different claims about the same numbers, and the heading is all that separates
        // them, so which one is true is decided here rather than in a component.
        afterRoundNumber: number | null
      }
    | { kind: 'BREAK'; resumesAt: number | null; standings: Standing[] }
    | { kind: 'QUESTION'; question: MainScreenQuestion }
    | { kind: 'FINALE'; finale: FinaleView }
    | { kind: 'JEOPARDY_BOARD'; board: BoardView; currentPickerTeamId: string | null }
    | {
        kind: 'FINISHED'
        standings: Standing[]              // the POINTS tab, and the whole screen without a finale
        provisional: Provisional | null
        finale: FinishedRow[] | null       // null selects the one-tab screen
        tab: 'RESULT' | 'POINTS'           // D51, switched from control
      }
}

type Standing = {
  teamId: string
  rank: number
  score: number
  tied: boolean           // D32
  // Places gained since the previous leaderboard (PRD 4 §10) — positive is up, so 2 renders
  // `▲2`. null means there is nothing honest to show: the first leaderboard of a game, or a
  // team that joined after the last one and so was never in it. 0 is `—`, and a different
  // statement from "we don't know".
  //
  // This needs a baseline, and a baseline is NOT derivable from scores — two teams can swap
  // twice between showings and end where they started. So GameState captures the ranks each
  // leaderboard displayed, on the three events that put one in front of the room:
  // ROUND_CLOSED, SCOREBOARD_TOGGLED{shown:true} and GAME_FINISHED.
  movement: number | null
}

// PRD 4 §10.2's FINISHED screen after a DSMTW_FINALE (D51) — one flat list, finalists first,
// then a rule, then the teams that did not play the finale continuing the same numbering.
// `finalist` is where the rule goes, and it is also what stops a non-finalist's position
// reading as an elimination.
type FinishedRow = {
  rank: number            // shared within a tier, as D32 is everywhere else
  teamId: string
  finalist: boolean
  eliminatedAt: number | null  // set for a finalist who went out; null for survivors
  // A surviving finalist's remaining bank — "won with 41 seconds left" is the story. Read at
  // finale.endedAt, not at now, or the winner's clock keeps counting down all evening.
  secondsLeft: number | null
}

type BoardView = {
  categories: { id: string; name: string }[]
  // Values and used-state only. NEVER prompts — data model / PRD 1 §7 invariant 5.
  tiles: { id: string; categoryId: string; points: number; used: boolean }[]
}

// DSMTW_FINALE (D50). Shared by MAIN_SCREEN and PLAYER - neither may see keyword text
// before it is marked (PRD 1 section 7 invariant 8).
type FinaleView = {
  prompt: string
  keywords: FinaleKeyword[]

  clocks: {
    teamId: string
    name: string
    colour: string
    // Seconds at the START of the current turn. Clients count down from turnStartedAt;
    // the server never pushes a tick (D52).
    secondsAtTurnStart: number
    onTurn: boolean
    eliminated: boolean
    // When they went out. PRD 4 §12.4's elimination moment is a *change* in this, so a screen
    // that reconnects mid-round can tell an elimination it already announced from one it has
    // not — a boolean cannot, and would replay the moment on every reconnect. PRD 3 §10.2's
    // `out 21:03` needs it too. Added in slice 5 for MASTER_CONTROL, here in slice 6.
    eliminatedAt: number | null
  }[]

  turnStartedAt: number | null      // null between turns - no clock is running
  currentTeamId: string | null
  nextTeamId: string | null         // derived: fewest seconds among eligible
  penaltySeconds: number
  questionNumber: number
  questionTotal: number
}

type FinaleKeyword = {
  id: string
  position: number

  // Always present: the blurred shape (D53). "i like cows" -> [1,4,4]
  wordLengths: number[]

  // Present ONLY once marked or revealed. Absent otherwise - not empty, absent.
  text?: string
  teamId?: string | null            // null = revealed unguessed
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

  // PRD 4 §6.1's audio presence. Present only when this question has audio AND the master's
  // transport has touched it; absent means the equaliser is still and the clock reads zero,
  // which is the honest state before anything has been played. Dropped when it names another
  // question's media — a stale mirror would animate an equaliser over silence, the exact
  // failure §6.1's stillness is a signal for.
  playback?: MediaPlayback
}

// PRD 4 §6.1 — whether the master's transport is playing, so the room's equaliser can be
// still when the sound is, and the elapsed clock can count up.
//
// The <audio> element lives on the master's desk (PRD 3 §5.1: "media playback is controlled
// here, never on the main screen"), so this is a fact about a browser rather than a game
// fact: not in the log, not replayable, and not derivable from GameState. It is therefore the
// SECOND field on any pushed view that is passed INTO the filter rather than folded from the
// log — MasterControlView.controlScreens is the first. Held as ephemeral per-game server
// state, keyed by gameId, cleared when a question opens.
//
// Carried as an instant plus an offset rather than a position, so the screen derives elapsed
// time client-side and the server never pushes a tick. That is D52's pattern, for D52's
// reason.
type MediaPlayback = {
  mediaId: string
  playingSince: number | null   // null while paused: the clock holds, the equaliser stops
  positionMs: number
}
```

#### 5.2.1 The one piece of validation state the room may see

```ts
type Provisional = { questions: number }   // only ever > 0; null is the settled case
```

**Never present in `MainScreenView`, in any state:** `masterNotes`, `question_option.isCorrect`
as a flag on options, `game_answer.isDraft`, or any pending-validation information **on a
question**. The room does not need to know the master hasn't finished judging.

**A *standing* is the one exception, added in slice 6.** PRD 4 §10 renders
`scores provisional · 3 answers still being checked` on the leaderboard, and PRD 3 §6.2
references that marker twice. Its reason does not contradict the prohibition above — the room
must not be told a standing is **final** when it isn't — so the two are resolved by scope
rather than by one overruling the other:

- `LEADERBOARD` and `FINISHED` carry `provisional`, because they make a claim about totals.
- `MainScreenQuestion` carries nothing about the master's queue, which is where the
  prohibition was written and what it was written under.

`null` rather than `{ questions: 0 }` when nothing is outstanding: a zero renders as
*"0 answers still being checked"* the first time someone forgets to guard it, ten metres from
a paying audience.

### 5.3 `PLAYER`

```ts
type PlayerView = {
  team: TeamPublic
  otherTeams: { id: string; name: string; colour: string; score: number }[]
  locale: 'en' | 'nl'                  // resolved per D29 / PRD 1 §9.4
  // `stageKind` folds ABANDONED into FINISHED so a screen and a phone can never disagree about
  // what is happening — right for control, whose header says so, and wrong for a phone, which
  // would announce final standings for a game the master had just pulled. PRD 5 §15 O3 wants a
  // bare message. The mirror of MainScreenView.abandoned, and there for the same reason.
  abandoned: boolean
  stage:
    | { kind: 'WAITING'; teamCount: number }
    | { kind: 'BETWEEN_QUESTIONS' }
    | { kind: 'BREAK'; resumesAt: number | null; standings: Standing[] }
    | { kind: 'QUESTION'; question: PlayerQuestion; myAnswer: MyAnswer | null }
    | { kind: 'FINALE'; finale: FinaleView; iAmFinalist: boolean }
    | { kind: 'JEOPARDY_BOARD'; board: BoardView; currentPickerTeamId: string | null }
    | { kind: 'FINISHED'; standings: Standing[] }
}

type PlayerQuestion = {
  id: string
  prompt: string
  // No 'KEYWORDS' here by design: a DSMTW_FINALE question is delivered through the
  // FINALE stage, never through QUESTION (PRD 1 §8.8). Adding it would imply a
  // finale keyword question can render as an ordinary answerable question.
  answerMethod: 'FREE_TEXT' | 'MULTIPLE_CHOICE' | 'BUZZER' | 'DO'
  media: MediaRef[]                    // images with showOnPlayerDevices only (D27)
  timer: Timer | null
  state: 'OPEN' | 'LOCKED' | 'REVEALED' | 'SCORED'
  points: number

  options?: { id: string; text: string }[]

  // BUZZER only.
  buzzersLive?: boolean
  iAmLockedOut?: boolean               // drives the disabled-with-a-reason state (D35)
  // Who has the buzz **right now** — awaiting adjudication, or accepted. `null` while the
  // buzzers are live, and that null is what re-arms every other team's button.
  //
  // Deliberately not "who buzzed first". D35's loop is buzz → deny → everyone else buzzes, and a
  // denial does not clear the buzz log — so a first-buzz reading stayed pinned to one team for
  // the rest of the question and every other phone read it as *someone already has this*.
  buzzHolderTeamId?: string | null     // who beat us — public, and part of the fun

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
  status: GameStatus                      // PRD 3 §4 exists only in SETUP, §10.6 only in FINISHED
  teams: (TeamPublic & { deviceCount: number })[]
  // `type` because the desk differs per round type, and the client must not infer it from
  // whether `board` happens to be present. `closed`: the master has ended this round — pacing
  // suggestions never point into it, its timeline loses the open link, and opening one of its
  // questions is refused with ROUND_CLOSED (PRD 3 §9.1; slice 9's review).
  round: { id: string; title: string; type: RoundType; number: number; total: number;
           closed: boolean } | null

  // What ADVANCE / NEXT_ROUND opens: the round after the current one, or the FIRST round when
  // none is open. Top-level rather than inside `round`, because the case that needs it most is
  // the one where `round` is null — a game that has just started. `advanceSuggestion` returns
  // NEXT_ROUND there too; before slice 5 it returned null, so a freshly started game showed a
  // leaderboard and offered no way to open its first round at all.
  nextRoundId: string | null

  // What advancing would do, whatever currently has the master's attention. `attention: ADVANCE`
  // carries the same value from the same function, so the two cannot disagree — but only one
  // attention state is ever active, and a desk that can only see the suggestion when nothing else
  // needs it has no way forward from the states that outrank it. That dead-ended the round-end
  // sweep: VALIDATE_QUESTION outranks ADVANCE and sweeps the whole quiz (§6.2), while `timeline` is
  // the current round, so a validation deferred in round 1 and revisited after round 1 ran out of
  // unplayed questions left the master on a screen with no primary action at all.
  advance: AdvanceSuggestion | null

  // What needs the master's attention RIGHT NOW. This is the whole point of the
  // surface (PRD 1 G4): one thing at a time, chosen by the server.
  // **The detail types below are spread onto their variant, not nested under a key.** This block
  // originally wrapped them (`buzz: BuzzDetail`, `question: DoScoringDetail`,
  // `detail: FinaleTurnDetail`, `question: QuestionRef`); the implementation flattens all four, and
  // this is the shape that exists. Narrowing on `kind` then reaches the fields directly, which is
  // what a client actually wants — `attention.prompt`, not `attention.question.prompt`.
  attention:
    | { kind: 'NONE' }                                  // → show the leaderboard big
    | { kind: 'ADJUDICATE_BUZZ'; buzz: BuzzDetail; referenceAnswer: string }
    | { kind: 'VALIDATE_QUESTION'
        gameQuestionId: string
        // Was `QuestionRef`. The sweep can be about a question from an EARLIER round (§6.2), so
        // neither `question` (the current one) nor `timeline` (the current round) can supply these
        // — and §6.1's screen without them asks for a verdict with the evidence on another page.
        prompt: string; acceptedAnswers: string[]; masterNotes: string | null
        items: ValidationItem[]; remainingQuestions: number }
    | ({ kind: 'SCORE_DO' } & DoScoringDetail)
    | { kind: 'BREAK_TIE_FOR_PICK'; tiedTeamIds: string[] }
    // Plus `penaltySeconds` and `secondsPerPoint` — see the note on `FinalistCandidate`.
    | { kind: 'PICK_FINALISTS'; candidates: FinalistCandidate[]
        penaltySeconds: number; secondsPerPoint: number }
    | ({ kind: 'FINALE_TURN' } & FinaleTurnDetail)
    // `LOCK` is `[Close answers]`. It was missing until slice 5, which meant the most common
    // state in a game — a question the room is answering — suggested `NEXT_QUESTION`, pointing
    // the master past the live question (PRD 3 §5.1: nothing but this closes a question, D8).
    | { kind: 'ADVANCE'; suggestion: AdvanceSuggestion }

  // Full detail incl. masterNotes, plus every team's answer with its verdict and a
  // needsValidation flag — so the master can judge inline while the question is still
  // open (D42). Bounded by team count, so D39 holds.
  question: MasterQuestionDetail | null
  board?: MasterBoardView                 // Jeopardy: prompts included, master-only

  // PRD 3 §2.1's timeline — the CURRENT ROUND's questions, so O(questions in a round). That is
  // the bound MasterBoardView's tiles already carry, and nowhere near D39's O(questions × teams).
  timeline: TimelineEntry[]

  // PRD 3 §11's "recent adjustments … with [Undo]". Capped and newest first; the full audit is
  // PRD 2 §13.3's REST read, because an evening's worth of them is unbounded (§1.1).
  adjustments: MasterAdjustment[]

  // PRD 3 §11.2. `attention` is NONE during a break, so without this the master has no way to
  // see they are on one, extend it, or resume.
  break: { startedAt: number; resumesAt: number | null } | null

  scoreboardShown: boolean                // §11.1's toggle has to render its own state (O4)

  // PRD 3 §12's "2 control screens connected". A TRANSPORT fact, not a game fact: it is not in
  // the log and cannot be replayed, so it is passed into the filter rather than derived inside it.
  controlScreens: number

  // PRD 3 §10.6's survival ranking, rank groups best first (D51). Null until the finale ends.
  // The second tab — pre-finale points — is `teams`, unchanged: a finale scores in seconds.
  finaleRanking: string[][] | null

  // Which of PRD 4 §10.2's two tabs the ROOM is on (D51). Added in slice 6.
  //
  // PRD 3 §10.6's ranking has the same two tabs "mirroring PRD 4's FINISHED stage", and mirroring
  // only means something if they agree — so the desk's tabs are driven by this rather than by local
  // state, and switching one switches the other. It also settles the two-control-screen case (§12)
  // for free: a second desk shows the tab the room is on, not the one it happened to open with.
  finishedTab: 'RESULT' | 'POINTS'

  // What a team joining now would have missed (PRD 2 §11.2, O5). `[+ Add team]` is required at
  // every status from master control as well as config, and the dialog's whole justification is
  // that these five numbers are computed rather than worked out in a noisy room. Null in SETUP.
  missed: MissedSoFar | null

  // COUNTS ONLY — never the list (§1.1).
  pendingValidationCount: number
}

// `LOCK` is [Close answers] — the only thing that ends a question, since the timer never does (D8).
type AdvanceSuggestion = 'LOCK' | 'REVEAL' | 'NEXT_QUESTION' | 'NEXT_ROUND' | 'FINISH'

type TimelineEntry = {
  gameQuestionId: string
  position: number
  prompt: string                    // master-only, like a tile's; answers "what did I skip?"
  state: 'PENDING' | 'OPEN' | 'LOCKED' | 'REVEALED' | 'SCORED' | 'SKIPPED'
  failsPreflight?: PreflightCode    // PRD 2 §10's ⚠, re-derived from the game copy
}

type MasterAdjustment = {
  id: string
  teamId: string
  delta: number
  reason: string | null
  announced: boolean
  revoked: boolean                  // stays listed when revoked, greyed (D41)
  createdAt: number
}

// One question's worth of validation, all teams together (PRD 3 §6.1). Bounded by team
// count, so D39 holds. Grouping is what makes inconsistency visible: judging
// "Radio Head" in isolation, the master cannot see they just accepted "radiohead".
//
// **`QuestionRef` is superseded**: its three fields are spread onto the `VALIDATE_QUESTION`
// variant above rather than nested under a `question` key, so there is no such exported type.
// Kept here only to name what those three fields are and why they travel together.

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

  spotlit: boolean                  // PRD 3 §5.3's [● On screen] is a toggle (D40)
}
```

> **The eight fields above `pendingValidationCount` were added in slice 5**, building PRD 3 against
> this shape. Each is something the desk cannot be built without and none of them was expressible
> before: a timeline with no question list, a `[Undo]` with no adjustment to undo, a break the master
> cannot see they are in, a `SETUP` screen with no status to key on. They are recorded here rather
> than left as a divergence, per agent-workflow §3.3.
>
> **`attention` gained three behaviours** in the same slice, each a rule a PRD states and nothing
> implemented:
>
> - **A break suspends it.** PRD 3 §11.2 says it *"stays `NONE`"* during an interval; a break with
>   unplayed questions left read as `ADVANCE`, a call to action pointed at a room that is at the bar.
>   The break now outranks `VALIDATE_QUESTION` and `ADVANCE` and nothing above them, since those five
>   are the states where a room is genuinely waiting. Only `SCORE_DO` can co-occur at all: a break is
>   refused while a question is `OPEN`.
> - **`ADVANCE` gained `LOCK`**, above.
> - **`VALIDATE_QUESTION` sweeps past questions**, which is PRD 3 §6.2 and D6's original promise. It
>   previously looked only at the *current* question, so an answer deferred in question 1 became
>   unreachable from the desk the moment question 2 opened — while `pendingValidationCount` went on
>   counting it with nothing that could ever clear it. It now prefers the current question (D42's
>   inline path) and otherwise walks the quiz in play order for the earliest one still owed a verdict
>   — but never while the current question is `OPEN` or `LOCKED`, because pulling a master back to
>   round 1 mid-question is worse than the deferral.

`attention` is computed **server-side**, not by the client inspecting state and guessing.
The rule for what deserves the master's attention is game logic and belongs in
`packages/domain` next to everything else — and it keeps PRD 3 from re-implementing it.

Priority when several conditions hold, highest first (PRD 3 §3.1):
`ADJUDICATE_BUZZ` › `FINALE_TURN` › `SCORE_DO` › `BREAK_TIE_FOR_PICK` › `PICK_FINALISTS` ›
`VALIDATE_QUESTION` › `ADVANCE` › `NONE`. Exactly one is active; anything lower-priority
appears only as a count. (This prose previously omitted `FINALE_TURN` and
`PICK_FINALISTS`, contradicting the type union three lines above; `attention()`'s actual
implementation — and `attention.test.ts`, which requires `FINALE_TURN` to outrank
`PICK_FINALISTS` — were always correct.)

### 5.5 `MASTER_CONTROL` detail types

Referenced by `MasterControlView`. All are O(teams), so D39 holds.

```ts
// The open/locked/revealed question in full — this is what makes inline validation
// possible (D42, PRD 3 §5.1) rather than needing a separate queue screen.
type MasterQuestionDetail = {
  gameQuestionId: string
  prompt: string
  // See the note on PlayerQuestion: finale questions arrive as FinaleTurnDetail, not here.
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

  // PRD 2 §10's "play anyway" marker, if any. A `PreflightCode`, never a sentence — copy lives in
  // the messages module (D11). Re-derived from the game copy through the same `questionFindings`
  // the authoring row's ✓/⚠ uses, so the two can never disagree; the one check it does not repeat
  // is ATTACHMENT_MISSING, which is filesystem work `packages/domain` cannot do.
  failsPreflight?: PreflightCode
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

// attention: PICK_FINALISTS - shown in DESCENDING score order so deselecting the bottom
// few is a two-second job (D55). `seconds` makes a 0s row visible while choosing (D56).
//
// The state also carries `penaltySeconds` and `secondsPerPoint` alongside `candidates[]`, added
// in slice 5: PRD 3 §10.1 restates the penalty arithmetic live against the finalist count, and
// that is the one number deciding whether the round lasts five questions or one. Without them
// the desk would reverse-engineer the rate from a candidate's score-to-seconds ratio.
type FinalistCandidate = {
  teamId: string; name: string; colour: string
  score: number
  seconds: number
}

// attention: FINALE_TURN - the most time-pressured screen in the product (PRD 3 section 11).
// Carries keyword TEXT, which no other audience gets before marking.
type FinaleTurnDetail = {
  gameQuestionId: string
  prompt: string
  masterNotes: string | null
  // PRD 1 §8.5/§8.8 — attachments work on every question type, a finale included ("though a
  // keyword question rarely needs one"). The authoring surface lets a master attach one, so the
  // desk has to be able to trigger it: rare is not never.
  media: MediaRef[]
  questionNumber: number
  questionTotal: number

  keywords: {
    id: string; position: number; text: string        // master always sees the text
    markedByTeamId: string | null
    revealed: boolean
  }[]

  // Null BETWEEN turns — a finale question that has just opened, and the gap after a pass before
  // the next team is started. §10.5 stops the clocks while nobody is on turn, so this is the same
  // desk with the clock not yet running rather than a screen of its own; `nextTeamId` is then who
  // `[Start <team>]` starts, by the fewest-seconds rule (PRD 1 §8.8). Before slice 5 this state
  // was unrepresentable, so a freshly opened finale question fell through to the *question* desk.
  currentTeamId: string | null
  nextTeamId: string | null
  turnStartedAt: number | null
  penaltySeconds: number

  clocks: {
    teamId: string; name: string; colour: string
    secondsAtTurnStart: number
    onTurn: boolean; eliminated: boolean
    eliminatedAt: number | null    // §10.2's "out 21:03" — HH:mm, a wall-clock instant (§8.2)
    passedThisQuestion: boolean
  }[]

  allRemainingPassed: boolean        // -> offer [Reveal remaining]
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
  finaleKeyword: 'ZZ_SECRET_UNMARKED_KEYWORD_ZZ',
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
| Unmarked finale keyword text | forbidden until marked/revealed | forbidden until marked/revealed | always allowed |
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
| `POST /api/games/:gameId/draft` | `{ gameQuestionId, text?, selectedOptionId? }` | Debounced ≈500 ms. Upserts `game_answer_draft`, then pushes to the team's other devices (D45). **No event** (§4.8). Rejected once the team has submitted |
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
| `POST /api/games/:gameId/questions/:qId/open` | `{}` — server computes `deadlineAt` from the question's timer. Refused with `ROUND_CLOSED` when the question's round has been ended: a closed round's gameplay does not reopen (PRD 3 §9.1) |
| `POST /api/games/:gameId/questions/:qId/lock` · `/reveal` · `/score` | `{}` — `score` is how a `DO` question completes when the master closes it out manually; normally the verdict commands append it themselves (§4) |
| `POST /api/games/:gameId/buzzes/:buzzId/adjudicate` | `{ accepted: boolean }` |
| `POST /api/games/:gameId/questions/:qId/reopen-buzzers` | `{}` — clears all lockouts (D35) |
| `POST /api/games/:gameId/answers/validate` | `{ gameQuestionId, teamId, accepted }` — also the revalidation path; allowed from submission onwards (D42) |
| `POST /api/games/:gameId/answers/spotlight` | `{ gameQuestionId, teamId, spotlit }` — show/hide one answer to the room (D40) |
| `POST /api/games/:gameId/questions/:qId/do-winners` | `{ teamIds: string[] }` — `[]` means no winner |
| `POST /api/games/:gameId/questions/:qId/do-scores` | `{ scores: { teamId, score }[] }` |
| `POST /api/games/:gameId/questions/:qId/skip` | `{}` — legal from `PENDING` or `OPEN` (D46) |
| `POST /api/games/:gameId/answers/submit-for-team` | `{ gameQuestionId, teamId, text?, selectedOptionId? }` — proxy submission; overwrites and resets the verdict (D47) |
| `POST /api/games/:gameId/scoreboard` | `{ shown }` — leaderboard on the main screen |
| `POST /api/games/:gameId/media/playback` | `{ mediaId, playing, positionMs }` — PRD 4 §6.1's audio presence. **The one master action that appends nothing**: the `<audio>` element is on the master's desk (PRD 3 §5.1) and where a track has got to is not a game fact, so there is no command in `packages/domain` and no event. It writes ephemeral per-game state and pushes the view; `seq` does not move. Sent on play, pause and scrub — **never on `timeupdate`**, since the room derives elapsed time from an absolute instant (D52) and needs telling when playback *changes*, not where it is. Added in slice 6 |
| `POST /api/games/:gameId/finished-tab` | `{ tab: 'RESULT' \| 'POINTS' }` — PRD 4 §10.2's two tabs (D51). Legal **only** while `FINISHED`; refuses with `GAME_NOT_FINISHED`. Added in slice 6 |
| `POST /api/games/:gameId/break` | `{ durationMs? }` — start or extend the interval. `409` while a question is `OPEN` |
| `POST /api/games/:gameId/break/end` | `{}` — resume; master-driven only |
| `POST /api/games/:gameId/picker` | `{ teamId }` — tie-break or override (D30) |
| `POST /api/games/:gameId/finale/config` | `{ secondsPerPoint, penaltySeconds }` — `SETUP` only |
| `POST /api/games/:gameId/finale/finalists` | `{ teamIds }` — at round open; minimum 2 |
| `POST /api/games/:gameId/finale/turn/start` | `{ teamId }` |
| `POST /api/games/:gameId/finale/turn/pass` | `{}` — ends the current turn |
| `POST /api/games/:gameId/finale/keywords/:id/mark` | `{}` — idempotent |
| `POST /api/games/:gameId/finale/keywords/:id/unmark` | `{}` — reverses the mark *and its penalties* |
| `POST /api/games/:gameId/finale/reveal` | `{ gameQuestionId }` |
| `POST /api/games/:gameId/finale/eliminate` | `{ teamId }` — server recomputes the instant |
| `POST /api/games/:gameId/adjust-score` | `{ teamId, delta, reason?, announced }` |
| `POST /api/games/:gameId/adjustments/:id/revoke` | `{}` — idempotent |
| `POST /api/games/:gameId/regenerate-code` | `{}` — `SETUP` only. The server mints the code (conventions §2); a client-supplied one would let two games collide |
| `POST /api/games/:gameId/resync` | `{}` — `SETUP` only (data model §7.1) |
| `POST /api/games/:gameId/teams` | `{ name, colour, startingScore?, reason? }` — **legal at every status** (PRD 2 §11.2). A non-zero `startingScore` also writes a `SCORE_ADJUSTED`, so a late team's opening balance is an ordinary adjustment and stays revocable (D41). The server mints both ids |
| `POST /api/games/:gameId/teams/:teamId` | `{ name?, colour? }` — rename or recolour, legal at every status **including `FINISHED`** (PRD 2 §13.4) |
| `POST /api/games/:gameId/delete` | `{}` — cascades to the copy subtree, teams, devices, events, drafts and all four projections (data model §10). The quiz is untouched. **Per game only**; there is no bulk prune (Q5) |

> **These two were missing from this catalogue.** `TEAM_ADDED` and `TEAM_UPDATED` were in the event
> catalogue (§4.1) with no action that could cause them, so a team could only ever be created by
> game instantiation — while PRD 2 §11.2 requires `[+ Add team]` at every status from both the
> config surface and master control, and §13.4 requires renaming after the game ends. Added in
> slice 4. **Deleting a game** was absent for the same reason — data model §10 describes the cascade
> and PRD 2 §12.1 offers the menu item, but no action reached it. The count below moves 38 → 41.

**That is 43 endpoints**, not the 25 conventions §10.1 originally counted — the `DSMTW_FINALE`
actions (D50) arrived after that number was written, the two team actions plus the game delete above
arrived in slice 4, and slice 6 added `media/playback` and `finished-tab` for the two things PRD 4's
screen needs a master to drive. Counted here because "every action is zod-validated" is only
checkable against a correct total.

`resync` and `media/playback` are the two actions with **no domain command**, for opposite reasons.
Both halves of `resync` are outside `packages/domain`: the precondition that matters is whether
`game_answer` or `game_buzz` rows exist and whether `sourceQuizId` still points anywhere, and the
operation replaces the game-copy subtree. `media/playback` has no command because it has **nothing
to decide and nothing to append** — there is no game fact in a scrub bar. `@kwiz/db` owns `resync`
end to end, in one transaction with its `GAME_RESYNCED` event.

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
| `GET /api/games/:id/review` | Full played game: every question, every team's answer, every verdict, the finale record and the adjustment audit (PRD 2 §13) |
| `GET /api/attachment/:gameAttachmentId` | The file, with **HTTP range support** (D5) so audio and video can seek. The id is the *row's*, template or game copy — the same file on disk backs both (data model §8) |

> **There is deliberately no `validation-queue` endpoint.** This table listed one — *"the full pending
> list, paginated"* — while the round-end sweep was still designed as one answer at a time. PRD 3 §6.2
> then settled it the other way: the sweep presents **one question's answers together**, which is
> O(teams) and therefore pushed as `attention.VALIDATE_QUESTION` (§5.4) rather than fetched. The other
> thing a queue would have served — *"what is still pending across the whole game?"* — is the review
> grid, which shows every cell of every round at once (PRD 2 §13.1) and is the read above.
>
> Removed in slice 8 rather than implemented, because a third read with no caller is exactly the
> speculative surface PRD 1 §11 warns against — and a promised endpoint that does not exist is worse
> than no endpoint, since the next agent builds a screen expecting it.

### 7.5 Attachment upload

`POST /api/attachments`, `multipart/form-data` with a `file` part and a `questionId` field. Added
here because §7 listed the reads and the play-half actions but no upload route, while PRD 2 §7.1
describes the UI that needs one.

```
1. stream to ${KWIZ_DATA_DIR}/tmp/<random>, hashing on the way past
2. sniff the type from the leading bytes; reject anything outside conventions §7's allowlist
3. rename atomically to attachments/<sha256>.<ext>, or discard if that file already exists
4. insert the `attachment` row, and return { id, kind, mimeType, sizeBytes, checksum, stored, url }
```

- **The type comes from the bytes, never from the filename or the declared `Content-Type`** (data
  model §4.7). Both of those are the client's word for it; magic bytes are not. What sniffing
  cannot see is a **codec**, which is why upload-time playability verification still exists.
- `stored: false` means the checksum was already on disk — the same song in three quizzes is one
  file.
- **The row is written after the file.** Content addressing makes that ordering safe: a file with no
  row is an orphan the reconciliation pass sweeps, while a row with no file is a question that
  cannot be played (data model §8).
- Rejections are `ATTACHMENT_REJECTED` and carry the accepted MIME list, because PRD 2 §7.1 requires
  the message to name what does work.

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

**Projections and drafts are not exported.** `game_answer`, `game_buzz`,
`game_score_adjustment` and `game_keyword_mark` are rebuilt by replaying `events` on import. `game_answer_draft`
is dropped: an uncommitted draft is meaningless on a machine the phone that typed it will
never reach, and it is not derivable from the log by design (§4.8).

Rebuilding on import makes **every import a live test of data model invariant I15**
(`projection == replay`), and keeps the zip smaller.

`game_device` rows are exported so a device's team binding survives a machine move. The
tokens are meaningless on a machine those phones will never reach again, but exporting
them costs nothing and keeps replay faithful.

> **`teams` and `devices` are exported but not *imported* — they are rebuilt by replay.**
> Both are written by `applyProjection` from `TEAM_ADDED` and `DEVICE_JOINED`, so in this
> implementation they are as derived as `game_answer` is; the four tables named above are
> not the complete list of what replay owns. Inserting the exported rows *and* replaying
> the log inserts each row twice. They stay in the file because a zip should be readable
> without replaying anything, and because the spec above promises them. Found by the
> round-trip test: `UNIQUE constraint failed: game_team.id`.

> **The join code is rewritten in event payloads when a game is imported.** A code must be
> unique among joinable games (data model §6.1), so importing a `SETUP` or `LIVE` game
> generates a new one — but `CODE_REGENERATED` carries a code and `GAME_CREATED` does too,
> so replaying them unchanged puts the source's code straight back and fails the unique
> index. This is not optional prettiness: "import as a separate copy" (PRD 2 §14.2) exists
> precisely to place a copy beside its original on one machine. The payload is rewritten
> rather than the row patched afterwards, because a projection may only be written by its
> event.

> **Under `COPY`, only uuid-shaped strings in a payload are remapped.** Walking the payload
> structurally is what keeps a new event type from being forgotten, but remapping *every*
> string renames a team called `Aardappel` to a uuid. Every id in this system is a uuidv7
> and no prompt, answer or team name is uuid-shaped, so shape is the discriminator.

### 8.3 Import

```
1. read + validate manifest (schemaVersion, counts)
2. verify every attachment checksum; collect per-file failures
3. resolve collision on quiz.id → Replace / Import as copy / Cancel  (D9)
4. ONE transaction:
     insert quiz tree
     insert each game + its copy subtree
     replay each game's events to rebuild the four projections
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
