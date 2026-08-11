# Slice log

One entry per slice, appended by the agent that completed it. See
[`agent-workflow.md`](agent-workflow.md) §6 for the required shape.

The next agent inherits your code and none of your reasoning. This file is the only channel
between them.

Every entry must answer five things: **what you built**, **where you deviated from the specs
and why**, **what you raised without resolving**, **what you deliberately left out**, and
**what the next agent would otherwise have to rediscover**.

---

## Slice 6 — The main screen

**Status:** complete · `pnpm check` green · **652 tests** · lint silent · every one of the eight stages
driven in a real game at 1920×1080 and again in `nl` · server killed mid-question and restarted

### What was built

PRD 4, end to end: `/screen/:gameId` on `useLiveView`, §4.1's arming click, all eight stages, §7's
depleting-ring timer, §8's two reveal beats including P5's 1.5-second multiple-choice delay, §8.3's
buzz display and deny flip, §9's board, §12's finale with word-shape tiles and the penalty and
elimination moments, §10.2's two tabs, §10.1's banner, §13's two sounds, and §14's calm failure states.

**Everything lives inside one letterboxed 1920×1080 `StageFrame`**, so every size on the surface is
`cqh` and transcribes §2.1's table directly. `vh` inside a scaled frame is wrong in a way that only
shows up on a projector, which is why slice 4 built the frame that way and why nothing here deviates.

### The domain did not carry enough for the surface, in nine places

Same story as slice 5, one layer down: slice 2 built `MainScreenView` faithfully against protocol §5.2,
it was internally consistent, and it could not answer nine questions PRD 4 has to ask. All nine are now
in protocol §5.1/§5.2 as well as in the code:

`quizName` · `soundMuted` · `Timer.durationMs` · `Standing.movement` · `LEADERBOARD.afterRoundNumber` ·
`provisional` · `ROUND_INTRO.questionCount`/`points` · `FinishedRow[]` + `finishedTab` · `MediaPlayback`

Four are worth singling out:

- **`Timer.durationMs`** — §7's timer is *"a depleting ring plus the number"*, and `deadlineAt` gives a
  client the number but never the proportion. It cannot know whether 18 seconds is most of the time or
  the last of it. Pauses deliberately do **not** grow the span: a ring whose total grew mid-question
  would visibly jump *backwards* on every deny loop.
- **`Standing.movement`** is the one addition that needed real reducer state, because a baseline is
  **not derivable from scores** — two teams can swap twice between showings and end where they started.
  So the three events that put a leaderboard in front of the room capture the ranks they displayed, and
  the *previous* capture is what the arrows measure against. Hiding the board captures nothing; there is
  a test for that, because it is the plausible-looking wrong version.
- **`provisional`** resolved a real contradiction rather than picking a winner. protocol §5.2 forbade
  *any* pending-validation information on this view; PRD 4 §10 and PRD 3 §6.2 both require the marker.
  The reasons do not actually conflict — the prohibition is about the master's judging queue, the
  requirement is about not calling a standing final — so it is **scoped**: a standing may say it is
  provisional, a question still says nothing. protocol §5.2.1 now states that in those terms.
- **`MediaPlayback`** is the second field on any pushed view that is passed **into** the filter rather
  than folded from the log (`controlScreens` was the first, and `soundMuted` is now the third). §6.1's
  equaliser is a diagnostic — *"its going still is the no-sound signal"* — and that only works if
  stillness means something. The `<audio>` element is on the master's desk and stays there (PRD 3 §5.1),
  so `media/playback` mirrors the *fact* of playback across. It is the one master action that **appends
  nothing**: there is no game fact in a scrub bar.

### Four real bugs, three of them found only by driving the surface

1. **A closed round showed the room that round's intro again.** `ROUND_CLOSED` leaves `currentRoundId`
   pointing at the closed round on purpose — PRD 3 §2.1's timeline is still about it — so the gap
   between rounds fell through to the intro the room had already watched. PRD 4 §3 puts a leaderboard
   there. `closedRoundIds` is what tells the resolver the difference, and §10's `AFTER ROUND n` versus
   `CURRENT SCORES` falls out of the same fact.
2. **A scored Jeopardy tile never handed the stage back to the board**, so §9's picker line — the only
   instruction the board gives, and the entire reason the stage exists — never appeared, and the next
   team never learned it was their turn. `SCORED` and not `REVEALED`: a revealed tile is still a moment
   the master is presenting, and pulling it off screen mid-sentence is worse than a pause on the board.
3. **Every pushed `joinUrl` was relative.** `service.ts` had its own `joinUrlFor` returning `/play/CODE`
   with a comment saying PRD 2's network picker would make it absolute *in slice 4*. The picker landed,
   `settings.joinUrl` landed, and nothing came back to that line. Invisible until something rendered a
   QR code from a pushed `joinUrl` — and the admin game page used the real builder, so the master saw a
   correct address while the projector would have encoded a path no phone camera can resolve. Exactly
   PRD 1 §14's first stated risk.
4. **Awaiting `requestFullscreen()` hung §4.1's arming screen.** In some embedders that promise never
   settles rather than rejecting, so the screen sat there disabled with the room watching. Arming must
   always reach an answer, because there is no other way out of that screen: fullscreen is now fired and
   not waited on (§4.1 only asks the master to be told about the *sound*, and O4 makes fullscreen silent
   either way), and `armSound` races a deadline.

Jeopardy category names were also below §2.1's absolute `4vh` floor, at `3.6cqh` — caught by measuring
rather than by looking, which is now a smoke-checklist row with the snippet in it.

### Spec deviations

None knowingly. Every addition above is written into protocol §5.1/§5.2/§4.7/§7.2 and conventions §4 in
this change (agent-workflow §3.3), and PRD 4 §3 gained a paragraph on what *"between rounds"* means,
because that was a real bug rather than a hypothetical.

Three judgement calls recorded rather than silently taken:

- **PRD 2 §16's mute already existed server-side** (`data/settings.json`, `/api/settings/sound/mute`,
  slice 4) — I had assumed it was slice 8's and nearly invented a `localStorage` key beside it. It is on
  the pushed view rather than read at page load, which is the difference between the setting working and
  merely existing: §16's justification is that *"hunting for OS volume mid-quiz is not acceptable"*, so
  a mute has to reach a projector nobody is going to reload.
- **§10.1's banner is suppressed by *stage*, not by status.** `WAITING_FOR_PLAYERS` covers `SETUP` *and*
  a `LIVE` game with no round open, and in both cases the room is looking at a join screen where a `+5`
  announces a change to a game nobody has watched. The question worth asking is *"is the room looking at
  something a score announcement makes sense against?"*, and the stage is what answers it.
- **The notice itself is not suppressed**, because control shows the same one and a master correcting a
  score after the game ends (PRD 2 §13) should be told it landed. The two audiences disagree about that
  notice on purpose, and the disagreement lives on the surface that has the rule.

### Raised, not resolved

- **`EventSource` cannot set headers and `/api/live/:gameId/play` requires `X-Kwiz-Device`.** Carried
  over from slice 5 and still unresolved. **Slice 7 hits this on day one** — the player stream is
  unreachable from a browser as specified. It needs a query parameter or a cookie, and it is a protocol
  §2.1/§7.1 decision. Settle it before writing the player surface, not during.
- **`FINALE_PENALTY_FLASH_MS` is presentational and unsynchronised.** The room's `−20s` runs for 1.2 s
  from when *each screen* receives the mark. Two projectors would flash a few milliseconds apart, which
  nobody can perceive; a genuinely synchronised flash would need an instant on the payload, and that is
  a real cost for an imperceptible gain.
- **No component tests.** `vitest` still resolves no `@/` alias (slice 5 raised this), so the parts of
  this surface that are pure presentation are verified by driving the browser and by the domain tests
  underneath them. `useEliminationMoment` and `usePenaltyFlash` are the two I would most want covered —
  both turn on *change* detection, which is exactly the kind of logic a reload can hide.
- **§15's "only one thing animates at a time"** is honoured by construction rather than enforced. The
  stage transition, the penalty flash and the elimination moment cannot overlap in practice because each
  is triggered by a different event, but nothing checks that.

### Deliberately left out

- **PRD 5's player surface**, including anything that would make the player's `FINALE` stage or the
  break countdown on a phone work. Slice 7's.
- **The `DO` answer method has no main-screen stage of its own**, and correctly: `DO` is scored entirely
  on the master's desk (PRD 3 §8), so the room sees an ordinary `QUESTION` and then the leaderboard.
- **Rank movement is not shown above ten teams** — §10's own overflow ladder drops it at the point two
  columns start.

### Not verifiable here (agent-workflow §4.5)

- **10 m legibility and projector contrast.** What was checked is stronger than a squint but narrower
  than a room: every text node on every stage measured against §2.1's `43.2px` floor, which is that
  clause made mechanical. Contrast, overscan and a washed-out wall are slice 10's.
- **Screenshots.** The browser pane would not composite in this environment, so nothing was judged by
  eye — and that is why a frozen entry animation briefly looked like a layout overflow. The measurement
  approach above exists because of that limitation, and it is the better check regardless.
- **The two sounds were never heard.** `AudioContext` armed and reported `running`, and both call sites
  fire on the right transition, but a tone at projector volume is a rehearsal item.

### What the next agent would otherwise rediscover

- **Turbopack does not reliably reload `messages/*.ts`.** A new key renders as its own path
  (`screen.finale.guessing`) with a `MISSING_MESSAGE` console error, through a hard reload, until the
  **dev server is restarted**. This cost time twice. If copy looks missing, restart before debugging.
- **A change to `packages/domain` does not reach an open screen until the next push.** The server holds
  a live projection and only rebuilds a view when something happens, so after editing a view filter,
  fire any harmless action (`picker`, `scoreboard`) to see it.
- **`components/screen/stage.tsx` is the one place that maps a stage to a component**, and the switch
  ends in `const unhandled: never = stage`. A stage added to the view without a branch is a **compile
  error** rather than a blank projector, which is the one failure this surface cannot recover from.
- **`Teams` (a `ReadonlyMap`) is built once in `main-screen.tsx`** and passed down, because the banner
  needs the same map as the stages. Do not rebuild it per stage.
- **Nothing in `components/screen` imports from `components/control`, deliberately** (CLAUDE.md §7).
  `minuteSeconds` is duplicated rather than shared: the same helper at 0.5 m and at 10 m is two
  components that happen to look alike, and sharing one would be the first thread of a dependency
  between two surfaces whose type scales must stay independent.
- **Three duration formats on one surface, and they are not interchangeable** (conventions §8.2): whole
  seconds for the question timer and every finale clock (D57), `m:ss` for a break and a media position,
  `HH:mm` for an elimination instant on the `FINISHED` screen.
- **Two components turn on *change*, not on state**, and both would be wrong the other way:
  `useEliminationMoment` watches `eliminatedAt` appearing (a boolean cannot tell an elimination that
  just happened from one already announced, so a reconnect would replay it) and `usePenaltyFlash`
  watches the marked-keyword count *growing* (an un-mark returns the penalty, and a `−20s` beside a
  clock that went up says the opposite of what happened).
- **`playback.ts` is ephemeral per-game server state**, cleared when a question opens. A server restart
  mid-song loses the position while the master's browser keeps playing, so the room hears music over a
  still equaliser until they touch the transport. That is the honest cost of not making it an event.
- **The unused-message-key grep has a second blind spot.** Slice 5 documented the first (a bug where
  every clause renders and the control flow is wrong). The second: a key chosen by a ternary —
  `t(up ? 'movementUp' : 'movementDown')` — reads as unused. Check the hits before believing them.
- **A driving fixture is worth keeping.** Reaching all eight stages needs a quiz with a timed free-text
  question, a multiple choice, a buzzer, a board with a deliberately short column, and a finale with
  multi-word keywords. Slice 9's fixtures want the same shape, and three of this slice's four bugs were
  only reachable with it.

## Slice 5 — Master control

**Status:** complete · `pnpm check` green · **624 tests** · lint silent · `pnpm build` clean, no
warnings · the whole desk driven by hand against a real game, including a **server restart
mid-question** · three review passes: a clause-by-clause self-audit, then an independent review
whose two criticals are fixed and tested

### What was built

PRD 3, end to end: the four-region frame, all eight `attention` states, the question desk with inline
validation and master-side media playback, the round-end sweep, buzzer adjudication and the deny
loop, both `DO` modes, the Jeopardy board with its picker override and tie-break, breaks, score
adjustment with revocation, the finale desk, and §13's keyboard map.

Underneath it: `useLiveView` — **the first client-side consumer of slice 3's streams** — and
`control(gameId)` in `lib/client/api.ts`, which is protocol §7.2's master half as one object.

### The domain did not carry enough for the surface, in eleven places

Slice 2 built `MasterControlView` against protocol §5.4 faithfully. That shape turns out not to
express PRD 3's desk, and **none of the gaps would have failed a test** — the view was internally
consistent, it just could not answer questions the surface has to ask. All eleven are now in
protocol §5.4/§5.5 as well as in the code:

`status` · `round.type` · `nextRoundId` · the §2.1 `timeline` · §11's recent `adjustments` ·
`break` · `scoreboardShown` · `controlScreens` · `finaleRanking` · `spotlit` on `ValidationItem` ·
`failsPreflight` on the question detail and every timeline entry.

Two are worth singling out:

- **`controlScreens` is the only field on any pushed view that is not a function of `GameState`.**
  §12's *"2 control screens connected"* is a fact about sockets: not in the log, not replayable. It
  is counted by the transport and passed **into** the filter, and `sse.ts` now re-pushes to the other
  subscribers when one connects or leaves — without that the count only changed when the game did,
  so a second desk could sit there for an hour saying it was alone.
- **`failsPreflight` is re-derived, not remembered.** Nothing records the verdict `[Play anyway]` was
  pressed against, so the `⚠` comes from `questionFindings` — the same function the authoring row's
  `✓`/`⚠` uses, which is what stops the two disagreeing. The one check it cannot repeat is
  `ATTACHMENT_MISSING`: re-hashing is filesystem work and `packages/domain` has no filesystem.

### Five real bugs in `attention()`, four of them stated in a PRD and simply not implemented

`attention` is the whole surface (G4), so a wrong answer here is not a cosmetic bug — it is the
master being told the wrong thing to do.

1. **A break did not suspend it.** PRD 3 §11.2 says `attention` *"stays `NONE`"* during an interval;
   a break with questions left read as `ADVANCE`, a call to action aimed at a room that is at the
   bar. It now outranks `VALIDATE_QUESTION` and `ADVANCE` and nothing above them — those five are
   states where a room is genuinely waiting.
2. **`ADVANCE` could not say `LOCK`.** While a question was open — the most common state in a game —
   the suggestion was `NEXT_QUESTION`, pointing the master *past* the question the room is answering.
3. **The round-end sweep did not exist.** §6.2 and D6 both promise it. `attention` looked only at the
   *current* question, so an answer deferred in question 1 became unreachable the moment question 2
   opened, while `pendingValidationCount` went on counting it with nothing that could clear it.
4. **A live game with no round open had no way to open one** (found in the browser, not by a test).
   `advanceSuggestion` returned `null`, so `attention` was `NONE` — and `NONE` renders as a
   perfectly reasonable leaderboard. Every game was stuck the second it started.
5. **A finale question with no turn running had no way to start one.** `FINALE_TURN` required an
   active turn, so a freshly opened finale question fell through to the *question* desk, which drew a
   proxy-answer control for a round nobody types in. `FINALE_TURN` now also covers the gap between
   turns — §10.5 says clocks stop while nobody is on turn, so it is the same screen with the clock
   not yet running — and `nextTeamId` is then who `[Start <team>]` starts.

**Four of those five were found by driving the surface, not by reading.** The tests were green
throughout; so was the spec.

### The clause-by-clause audit, and the sixteen things it found

Slice 4's log ends with *"go clause by clause through the PRD, not feature by feature"*. Doing that
after the surface was built and green found **sixteen more gaps**, every one of them a sentence in
PRD 3 that the first pass had read, written the copy for, and then not rendered.

The mechanical version is worth stealing: **grep the message catalogue for keys nothing uses.** A
key written from a PRD clause and never rendered is that clause, missing. Sixteen keys, sixteen
gaps, no judgement required:

- **§3.2** — a buzz landing behind the open adjustment popover said nothing. The popover correctly
  stayed open; the master had no way to know why the screen behind it had changed.
- **§4 / PRD 2 §11.2** — **`[+ Add team]` did not exist on this surface at all**, at any status.
- **§5.1** — `Time up` without §5.1's `· 4 of 4 submitted`, which is the number that decides whether
  to wait.
- **§5.3** — no *"showing 'Radiohead' to the room"* line, and no "nothing to spotlight" on a buzzer.
- **§6.1** — **the sweep showed answers with no accepted answers to judge them against.** protocol
  §5.4 declares a `QuestionRef` for exactly this and the implementation had flattened it to an id.
- **§6.1** — and no way *out* of the sweep, though §6.2 explicitly permits deferring.
- **§7.1** — the deny loop was a quiet line. §7.1 asks for **loud**, in colour and words.
- **§8.2** — scores clamped on save rather than on entry, so `99` looked accepted until it wasn't.
- **§9** — *"hover **or focus**"*: a `title` answers hover only, which excludes the keyboard exactly.
- **§10.2** — `out` without §10.2's `21:03`, and `eliminatedAt` was not on the payload to say it.
- **§10.5** — no unguessed count, no `[Next question]`, and **the all-five-found close was missing**:
  a question where everything was found offered only `[Pass]`.
- **§11.2** — the break was disabled over an open question **without the reason**, which is the
  difference between a rule and an app that looks broken.
- **§12** — a media file that will not decode showed nothing on the master's own controls.
- **§2.1** — the timeline's state markers were icons with no accessible name.

Three needed payload work, and are in protocol §5.4/§5.5: `VALIDATE_QUESTION`'s question reference,
`clocks[].eliminatedAt`, and `missed` (`missedSoFar`, five numbers, so `[+ Add team]` can be answered
from the desk as §11.2 requires rather than sending the master back to PRD 2's hub).

**None of these would have failed a test, and the surface demoed fine without them.** They are the
difference between a screen that works and a screen that does what it was specified to do.

### Then an independent review found two criticals the clause audit structurally could not

The clause-by-clause pass greps for **a clause with no rendered copy**. Both of these are *control
flow reaching a dead end* — nothing missing, everything rendered, wired wrong. Worth internalising:
the unused-key trick has a blind spot exactly the shape of a bug where the code is all present.

**1. `Enter` ended the game with no confirmation.** PRD 3 §13 lists ending the game among the acts a
stray keystroke must never reach; §1.1 exempts it from the no-dialogs rule *because* it is one of two
things that cannot be undone. `FINISH` came back from `advanceSuggestion` as just another member of
the same union as `LOCK` and `REVEAL`, so the advance button rendered it through the generic path —
one click ended the game, and `Enter`, the key the master has been pressing all night to advance,
ended it without one. At the moment the game legitimately ends, which is when that reflex is
strongest. The header had the correct pattern the whole time (a `ConfirmDialog` behind a pointer-only
menu) and the advance path bypassed it.

**2. The round-end sweep could dead-end at a round boundary.** `VALIDATE_QUESTION` outranks `ADVANCE`
and correctly sweeps the **whole quiz** (§6.2), but every "way out" read `timeline` — the **current
round**. With a validation deferred in round 1 and round 1's questions all played, there was nothing
to offer and no `ADVANCE` state to fall back to, so the sweep rendered with **no primary action at
all**. §6.2 promises the exact opposite in as many words.

The second one had two halves, and the browser found the half the first fix missed: putting the
suggestion on the view was not enough, because `advanceSuggestion` also answered `NEXT_QUESTION` for
a `SCORED` question **without checking whether a next question existed**. `SCORED` now falls through
to the round logic; only `REVEALED` short-circuits, because awarding points is genuinely an act on
*this* question.

Both are now fixed, both are tested, and the root cause the code review named — *"the next-pending
selector is duplicated four times, and the duplication is why the round-boundary dead-end wasn't
caught"* — is gone: `components/control/advance.ts` is the one place that maps a suggestion to a
call, and the one place that knows which advance is irreversible.

Also from that round: the finale desk now renders a finale question's attachment (PRD 1 §8.8 permits
one), `protocol.md`'s whole `attention` union was corrected to the **flattened** shape the code
actually has (the drift was wider than the review spotted — `SCORE_DO` and `FINALE_TURN` were wrapped
in the spec too), the skip menu item's disabled state now mirrors §9.1's real legality window, and
the sentinel test says in writing why eleven new master-only fields do not belong in its table.

One carried-over finding was already closed: conventions §4's `CHECKSUM_MISMATCH` and
`IMPORT_COLLISION` rows already document, at length, that they are declared and never returned and
why. No change needed.

### Spec deviations

None knowingly. Everything above is an *addition* to protocol §5.4/§5.5, written into the spec in
this change (agent-workflow §3.3) rather than left as a divergence.

One reading recorded rather than silently taken: **§7.1 says that when every team is locked out this
resolves to `ADVANCE / suggestion: 'REVEAL'`.** It cannot — an `OPEN` question has no legal
transition to `REVEALED` (PRD 1 §7.1), so the honest sequence is *"nobody got it"* → `[Close
answers]` → `[Reveal answer]`, which is what the desk does. D35 rule 4's actual requirement — the
master is never left with no live buzzers and no prompt — holds either way. The example in §7.1
predates `LOCK` existing in the suggestion union.

One judgement call worth flagging: **PRD 3 §10.1's example penalty arithmetic does not reproduce.**
*"Penalty per keyword: 20s → up to 320s off a 490s pool"* — with 4 finalists, 5 keywords and a 20s
penalty, the seconds a question can take out of the pool is `20 × 5 × (4−1) = 300`, not 320. The
formula implemented is that one, matching `suggestFinaleQuestions`'s inner term (conventions §8.1) so
the picker and the suggestion cannot disagree. If 320 was arithmetic rather than an illustration, the
PRD needs a correction I could not derive.

### Raised, not resolved

- **`EventSource` cannot set headers, and `/api/live/:gameId/play` requires `X-Kwiz-Device`.** Slice 7
  will hit a wall here: no browser can send that header on a stream. The fix is a query parameter or
  a cookie, and it is a protocol §2.1/§7.1 decision, not an implementation detail — worth settling
  before the player surface starts.
- **The timeline shows a past question's prompt and state, never its answers.** Those are
  O(questions × teams) and belong to PRD 2 §13's review grid over REST (§1.1) — which is slice 8's.
  So §2.1's *"a read-only jump to see what happened"* is currently half-built: you can see *which*
  question and *what* happened to it, not who answered what.
- **`adjustments` is capped at the most recent eight.** Enough for `[Undo]`, which is what §11 asks
  for; the full audit is §13.3's and needs a REST read.
- **Nothing exercises two live games at once from this surface.** Cross-game isolation is covered at
  the transport level (slice 3) and belongs to slice 9's scenario 22 end to end.

### Deliberately left out

- **`/screen/:gameId`** — the link in the header points at PRD 4's route, which slice 6 builds. It is
  a link to a 404 today, deliberately: a stub main screen would be exactly what agent-workflow §3.1
  forbids.
- **Post-game review** stays slice 8's, so §9.2's *"where instead"* column points at a screen that
  does not exist yet.

### What the next agent would otherwise rediscover

- **`useLiveView` is the whole client half of the transport** (`lib/client/use-live-view.ts`).
  Slices 6 and 7 should use it rather than opening their own `EventSource`; the only thing in it that
  is not obvious is the `FAILED` path, which **fetches the same URL once** to read the typed body —
  `EventSource` reports "it broke" and never why, and D14's 503 has to be distinguishable from a 404.
- **`components/admin/live-teams.tsx` still opens its own stream** and narrows with zod. It predates
  the hook and is deliberately different: it merges into server-rendered state and consumes four
  fields, where the desk consumes a whole `MasterControlView` that has no schema to narrow against
  without restating it. Do not "unify" them without deciding which of those two things you want.
- **The keyboard map is one file** (`components/control/keys.tsx`). §13 also lists what must *never*
  be bound — ending, abandoning, skipping, proxy-submitting — and that absence is only checkable if
  there is one list. `digitIndex` reads `event.code`, not `event.key`, because §10.3 binds
  `Shift`+`1`–`5` and with Shift held `key` is `!` on a US layout and something else on a Belgian one.
- **Clocks tick on the client, never on the server** (`lib/client/use-countdown.ts`, D52). Both hooks
  read the *local* clock, which is the same machine for control and a possible skew on a phone — no
  game fact depends on it, since the deadline is advisory (D8).
- **Actions are fire-and-forget through one `run()`** in `control-desk.tsx`. Awaiting one is only ever
  waiting for the refusal; the resulting view arrives on the stream (protocol §7).
- **`ControlKeys` must wrap anything that binds a key**, and a zone returns `true` to say it consumed
  one. The most recently mounted zone is asked first, so the attention zone beats the frame.
- **A `409` in the console during a smoke run is usually correct** — it is a typed refusal
  (`QUESTION_STILL_OPEN` on a break over an open question, most often), not a bug.
- **`minuteSeconds` lives in `break-desk.tsx`** and is used by the media controls too. `m:ss` for
  breaks and media, whole seconds for timers and finale clocks, `HH:mm` for an elimination instant —
  conventions §8.2, and the three are not interchangeable.
- **`AddTeamButton` wraps PRD 2's dialog rather than growing a second one.** A table walking in is
  the same event whichever screen the master is on, and the dialog's numbers (`missedSoFar`) are the
  entire reason it is justified. If you add a third entry point, add it there.
- **Grep the message catalogue for unused keys before calling a surface done.** It found sixteen
  missing PRD clauses here in about a minute, and it will keep working for slices 6 and 7 — but it is
  blind to a bug where every clause *is* rendered and the control flow is wrong, which is what the
  independent review's two criticals were. Both kinds of pass are needed.
- **`components/control/advance.ts` is the only place that decides what advancing does**, and the
  only place that knows `FINISH` is irreversible. If you add a surface with a "next" button, call it
  rather than reading `view.timeline` — that read is per-round, and four copies of it hid a dead end.
- **`vitest` still resolves no `@/` alias**, so a test in `apps/web` imports relatively. It cost a
  few minutes here and it is the reason no route handler has a test; worth fixing properly before
  slices 6 and 7 write component tests of their own.

## Slice 4 — Config surface: authoring, pre-flight, setup, transfer

**Status:** complete · `pnpm check` green · **512 tests** · lint silent · every screen driven by
hand against a real quiz, a real LAN address and a real zip

### What was built

PRD 2, end to end: the landing page and dashboard, the quiz editor, the three round editors
(question set, Jeopardy board, DSMTW finale) with the question sheet, pre-flight, game setup, the
game hub, the first-run network picker, settings, and export/import.

Underneath: `packages/domain` gained the team palette and the pure `preflight()` rules;
`packages/db` gained every template writer plus the export/import repositories; `packages/export`
gained the zip format. One new route table (`/api/authoring/*`, 21 routes), one for this machine
(`/api/settings/*`), and `/api/transfer` for the two calls that are not JSON.

### Deviations from the specs — all four recorded in the specs themselves

1. **`game_team` and `game_device` are projections here** (protocol §8.2). They are written by
   `applyProjection` from `TEAM_ADDED` and `DEVICE_JOINED`, so the spec's list of four
   replay-owned tables is incomplete. The export carries them; the import ignores them and lets
   replay rebuild them, or every row inserts twice.
2. **The join code lives in event payloads**, so importing a joinable game rewrites it there rather
   than patching the row afterwards — a projection may only be written by its event.
3. **`drizzle-zod` date handling** (conventions §10.3): revive the ISO strings before validating.
   Per-column refinements built at runtime defeat its typing and TypeScript gives up.
4. **An accepted buzz credits the team** — found in slice 3, but PRD 1 §8.4 and protocol §4.4 were
   only reconciled then; see that entry.

### Raised and not resolved

- **`localGames` in the import collision dialog counts games whose `sourceQuizId` matches.** For an
  imported-as-copy quiz that is right. For a quiz whose games were themselves imported under a
  different id it is right too. It has not been exercised against a *replaced* quiz whose games
  predate the identity, because nothing yet creates that state.
- **The export is built in memory** (`zipSync`). Correct at PRD 1 §2.1's scale and stated in the
  code; a library of gigabyte videos needs a streaming writer. That is a revisit trigger, not a bug.
- **`Reclaim space` reads the referenced set outside a transaction.** Safe in the direction that
  matters — a row inserted mid-sweep points at a file that was already referenced — and the reverse
  race just leaves a file for the next pass. Worth a second look if reconciliation ever runs
  automatically rather than on a button.

### Deliberately left out

- **Post-game review and correction (PRD 2 §13)** — build-order defers it to slice 8, where the
  event log it reads and rewrites actually has content.
- Nothing from §7.1 or §11.2. **O4's preview is built** — see below.
- **`[Copy from last game]` copies names and colours only.** Nothing else on a team survives, and
  nothing else should.

### Found late, by auditing PRD 2 section by section

Two passes found ten things. The first, against build-order's bullets, found three; the second,
against the PRD's own sections one at a time, found seven more — including a menu two-thirds empty
and a delete path that did not exist. **None of them would have failed a test**, and `pnpm check`
was green throughout both.

From the second pass:

- **`Delete game` existed only as message strings.** No repository function, no action, no route.
  Data model §10 describes the cascade and PRD 2 §12.1 offers the menu item; nothing joined them.
- **`Export this game` exported all of them.** §14.1 means quiz + *that* game.
- **Jeopardy columns could not be reordered** — no `moveCategory` anywhere, though §8 lists it.
- The dashboard showed neither `round N of M` nor the winner (§5), the quiz editor had no `[Export]`
  or `[⋯]` (§6), there was no custom colour (§11), the assumed team count was not remembered (§9),
  attachment rows showed no filename or size (§7.1), and deleting an option was not confirmed
  (§15.2 lists option beside round, category and question).

**The lesson is about how to audit, not about these ten.** Reading the build-order bullet — "the
Jeopardy board builder" — and looking at a board builder that exists tells you nothing. Reading
§8's sentence *"[edit ▾] on a category header: rename, reorder, delete"* and then looking for
`moveCategory` finds the gap in seconds. Go clause by clause through the PRD, not feature by
feature.

From the first pass:

- **O4's preview was skipped on a bad reading of its dependency.** "It needs PRD 4's renderer" was
  true and led to the wrong conclusion: the renderer is what the preview *is*.
- **The `⠿` drag handles did nothing.** Rounds and questions reordered by `↑`/`↓` buttons only,
  while the list showed a grab handle — §15.2 asks for both routes and §6.1 for the drop to be
  refused past the pinned finale. Now one hook, sharing the buttons' own predicate so the two
  cannot drift.
- **§11.2 was missing entirely**, and with it two protocol actions: `TEAM_ADDED` and `TEAM_UPDATED`
  existed as events with nothing that could cause them.
- **`verifyPlayable` could hang forever.** A malformed container that fires neither `loadedmetadata`
  nor `error` left the promise unsettled and the upload button permanently disabled with no
  explanation. Bounded at ten seconds, which is far beyond parsing metadata off a local disk.

An affordance that renders is not an affordance that works, and a section that exists is not a
section that is finished.

### Slice 6 inherits three real components, not stubs

O4's `[Preview on main screen]` was first deferred here on the grounds that it needs PRD 4's
renderer. That was the wrong call: the preview *is* a scaled-down projector, so building it means
building the stage — and building the stage twice is exactly what O4 exists to prevent. So
`components/screen/` now holds the beginning of PRD 4, used by PRD 2:

- **`StageFrame`** — a fixed 1920×1080 box, CSS-scaled to fit. This is §2.2's letterbox rule made
  mechanical, and it is what makes the preview honest: overflow is a question about *proportions*,
  and a stage re-laid-out into a small box answers a different question.
- **`FittedText`** — §2.4's fitting, binary-searched in `useLayoutEffect` so no unfitted frame is
  ever painted, clamped at §2.1's 4vh floor.
- **`QuestionStage` + `resolveLayout`** — §6's five named layouts. The resolver is a separate plain
  module and is tested; the renderer is not, per D18.

**Sizes inside the frame are `cqh`, never `vh`.** A `transform: scale()` does not change what `vh`
means — it stays relative to the viewport — so `5vh` would be one size in the preview and another on
the projector, which is the single discrepancy this component cannot have. `container-type: size`
makes `1cqh` exactly 1% of the frame, so every number in PRD 4 §2.1 transcribes directly.

Slice 6 should **import these and add the remaining stages**, and wire the timer's countdown from
`deadlineAt` (D52) — `Timer` already takes the value as a prop for that reason.

### What the next agent would otherwise rediscover

**Next evaluates `lib/server/*` twice** — once in the server-component layer, once in the
route-handler layer. Module-level state is therefore **not** shared between a page and an API
route. This had been quietly opening two SQLite connections, two projection registries and two
transports since slice 3; `[kwiz] database up to date` printed twice at boot and nobody looked. It
first *broke* something here: PRD 2 §4's probe is written by a page and read by a route, so the
phone reached the machine and the setup screen never noticed. Everything process-wide now goes
through `lib/server/singleton.ts`, which also survives HMR. **Put any new server-side singleton
through it.**

- **The dev server's HMR websocket does not reach the in-app browser pane.** Hot updates never
  arrive, so a message-file edit appears to have done nothing. Restart the dev server rather than
  debugging the code. Several apparent bugs this slice were a stale bundle.
- **Radix opens menus on pointerdown**, so a programmatic `.click()` on a `DropdownMenuTrigger`
  does nothing. Drive it with a real click. Likewise the confirm dialogs are `role="alertdialog"`,
  not `role="dialog"` — a probe for the latter finds nothing and looks like a broken dialog.
- **Popover and dialog content is portalled outside `<main>`**, so `get_page_text` (which reads
  `main`) misses it entirely. Query the DOM instead.
- **The team palette is a hue wheel, not the array order.** `assignedColour(n)` walks
  `PALETTE_BY_ASSIGNMENT` (Red, Cyan, Amber, Violet, …) so the first four teams are maximally
  distinct; `TEAM_PALETTE` is the display order in the picker. They are different sequences on
  purpose.
- **Crockford Base32 keeps `1` and `8`** and excludes `I`, `L`, `O`, `U`. A join code containing
  `1` is not a bug — that check has been made twice now.
- **`settings.json` lives in the data dir, not the database.** The chosen network address is true
  of one machine on one wifi and must not travel with a copied `kwiz.db`. It is also why
  `chooseAddress` validates against the live interface list rather than a format check.
- **A quiz named like a path is sanitised into the export filename**, and the `content-disposition`
  header is built from the sanitised value. Do not reintroduce the raw name there.

## Slice 3 — Transport: SSE, actions, attachments

**Status:** complete · `pnpm check` green · **440 tests** · lint silent · `pnpm build` clean, no
warnings · the three streams, all 38 actions and the attachment path driven by hand against a real
game

**Built:** `decide()` and the command catalogue in `@kwiz/domain`; the typed error catalogue and
`errors.<CODE>` copy in EN and NL; `loadGameContent`, the drafts repository, device/code resolution
and `createGameFromQuiz` / `resyncGame` in `@kwiz/db`; and in `apps/web/lib/server` the
`RealtimeTransport`, the `Map<gameId, GameState>` registry, the command service, the action
dispatch table and the content-addressed attachment store. Six routes: three SSE, one join, one
catch-all for the other 37 actions, and attachment upload + range serving.

### The shape, and why it is this shape

PRD 1 §6.4 names the flow — *"the domain layer decides: reject, or produce one or more events"* — so
that is literally the code:

```
route → zod → decide(state, command, now) → appendAndProject → registry.catchUp → transport.broadcast
```

**`decide` is pure and lives in `packages/domain`.** Every guard in protocol §7 — submission
finality, the buzz window, the open-question guard on a break, every finale refusal — is a function
of `(GameState, Command, now)`, which is CLAUDE.md §3.2's test answered with a yes. `decide.test.ts`
drives it through a six-line "server" (decide → append → fold) with no mocks, and that is where the
interesting cases live rather than behind HTTP.

Everything a decision cannot invent is passed **in**: ids, device tokens, the device cap, and the
drafts to commit at lock. A decision that minted its own uuid could not be compared against an
expected event list.

**One dispatch module, not 38 route files.** PRD 1 §6.9 constraint 2 names *the action-dispatch
module* as one of three files a transport swap would touch, which only holds if there is one — and
it keeps the catalogue greppable. The SSE routes are deliberately the opposite: one file per
audience, because §2.1 requires the payload filter to be chosen by the route and never by a URL
segment.

### Two real bugs found, both invisible until now

- **An accepted buzz credited nobody.** PRD 1 §8.4 and D35 say the master accepts or denies the
  spoken answer and the team is *credited* — but nothing did it. There is no `ANSWER_SUBMITTED` for
  a buzzer question (nothing was typed), so `BUZZ_ADJUDICATED` is the only event that can award
  anything, and neither half of the projection was doing so. **Every buzzer question and every
  Jeopardy tile scored zero.** Fixed in the reducer and in `applyProjection`, added to protocol §4.4,
  and now covered by a `projection-parity` case.
- **The two halves disagreed about who buzzed first.** `applyProjection` wrote `AWAITING`
  unconditionally with a comment saying the action would decide — but no payload field could carry
  it, so a second buzz during adjudication was `NOT_FIRST` in the reducer and `AWAITING` in the
  table. Both now derive it the same way. Verified with teeth: forcing the old behaviour fails the
  new parity case.

### Spec deviations — all four docs updated in this change

- **The SSE `id` is now `<gameId>:<seq>`, not a bare `seq`.** protocol §3.2 requires a
  `Last-Event-ID` from another game to be treated as unknown *and never compared numerically* — and
  with `id: 42` that is unimplementable, because nothing in the value says which game produced it
  and both games' sequences sit in the same range. Qualifying it costs nothing: `EventSource` echoes
  the id without a client ever reading it.
- **`Last-Event-ID` is consulted once, at connect.** Keeping it on the subscriber and skipping
  "already current" pushes would lose every shared draft (D45), which changes a view without
  changing `seq`. Written into §3.2.
- **conventions §4 was missing four codes**: `GAME_NOT_LIVE` (33 master actions had no status
  guard — only joining did), `DATABASE_MIGRATION_REQUIRED` (D14's declined state is specified but
  had no code), and the two attachment codes. `QUESTION_NOT_OPEN`'s note was widened to cover an
  illegal transition, with idempotent repeats explicitly *not* being an error.
- **"all 25 actions" is 38.** The `DSMTW_FINALE` endpoints arrived after that number was written.
  Corrected in conventions §10.1, and the real list is protocol §7.1–§7.2.
- **Attachment upload had no endpoint anywhere.** PRD 2 §7.1 describes the UI; §7 listed only reads.
  Added as protocol §7.5, including that the type is sniffed from the bytes — a declared
  `Content-Type` is no better than a filename, and data model §4.7 requires the *detected* type.

### Two things that only fail in a build

Both were invisible to `pnpm check` and cost the slice its first green build:

- **`MIGRATIONS_FOLDER` was a module-level `const` using `import.meta.dirname`.** Next bundles
  `@kwiz/db` (it is a `transpilePackages` entry), and in that bundle `import.meta.dirname` is
  **`undefined`** — so the const threw `ERR_INVALID_ARG_TYPE` while Next collected page data, with a
  message naming `join` rather than the reason. Now `migrationsFolder()`: lazy, and it *searches*
  candidates for drizzle-kit's journal instead of assuming one.
- **`./data` meant `apps/web/data`.** Both `pnpm dev` and `pnpm start` run Next with the cwd at
  `apps/web`, so a master's only database landed somewhere neither the docs nor CLAUDE.md §3
  mention. Anchored with `apps/web/.env.development` / `.env.production` — `.env` itself is
  gitignored, which is why it is those two files — and a real environment variable still wins.

Also five Turbopack "dynamic filesystem access" warnings, from paths that are dynamic **by design**
(`KWIZ_DATA_DIR`, and a filename that is a content hash). Opted out with `turbopackIgnore`, because
the alternative is tracing the whole project into the server output and a build that is never clean.

### Raised, not resolved

- **`createGameFromQuiz` is slice 4's, and slice 3 needed it.** `/resync` cannot exist without the
  copy function, and nothing else could create a game to smoke-test against. Written in `@kwiz/db`
  per data model §7 rather than reached for from the app, spreading `SHARED_COLUMN_GROUPS` so the
  §7.2 parity guard passes by construction. Slice 4 inherits it and should add teams and the
  palette on top rather than rewriting it. **This is a build-order gap, not a spec bug.**
- **No REST reads yet** (protocol §7.4). `GET /api/games`, `/review`, `/validation-queue` and the
  quiz tree belong with the surfaces that read them (slices 4 and 8). One consequence lands on
  slice 7: a phone can join a code but there is no endpoint that lists a game's teams, so the team
  picker needs one — probably `GET /api/games/by-code/:code`.
- **No typed client module.** PRD 1 §6.9 constraint 3 wants components to call one, never `fetch`.
  Writing it now would be an untested stub for surfaces that do not exist; it belongs with slice 4's
  first form.
- **The team palette (conventions §3) is still absent.** Slice 0 assigned it to slice 2, slice 2 did
  not add it, and slice 3 does not need it — no action creates a team. Slice 4 must add it to
  `@kwiz/domain` before game setup.

### Three loose ends closed before handing over

- **The D14 prompt is now tested** — slice 1's oldest open row. `askTerminal` takes its streams as a
  parameter, so a test runs the real `readline` over a pipe: it asserts the listing names every
  migration, that the backup path is shown, that `n` refuses and that a bare Enter is a yes.
  Verified with teeth by making it always return `true`. What is left for a human is only whether it
  *looks* right in a terminal, which is now the whole of that checklist row.
- **The SSE route itself is tested** (`sse.test.ts`), not just the modules under it: headers,
  `retry` + first view, the `Last-Event-ID` skip, an id from another game being ignored, subscribe
  and unsubscribe, and all three refusals — 404, 401 and the D14 503.
- **A locked question's drafts are deleted.** They were left behind, and for a team whose draft was
  empty — never committed, because an empty draft is not an answer — the draft would have gone on
  showing as that team's in-progress text on a closed question.

Plus `actions.test.ts`, which transcribes protocol §7.1–§7.2's paths **independently of the route
table** and compares the two. With no client yet, a dropped endpoint would otherwise be invisible.

### Not verifiable here

- **Nobody has watched the migration prompt render in a real terminal.** Its logic is covered; its
  appearance is not, and cannot be from here.
- Everything else in this slice was driven by hand against a running server: the three streams,
  ping cadence, the qualified id, join, submission finality, a **server restart mid-question**, and
  the attachment upload/range/dedup path.

### Next agent should know

- **`runCommand` in `lib/server/service.ts` is the one way to change a game.** It decides, appends,
  folds and pushes, in that order. The append is the commit point (PRD 1 §6.4): nothing is broadcast
  that is not already durable.
- **`FINALE_ENDED` has no endpoint and no client decides it.** The service settles it after every
  command, deriving the ranking with `finaleRanking` — the same function the views use, so the event
  and the deriver cannot disagree.
- **A draft push is a state frame with an unchanged `seq`**, sent only to that team's devices
  (`publishToTeam`). If you find yourself suppressing pushes by comparing `seq`, that is the case
  you will break.
- **`decide` returning `{ ok: true, events: [] }` is a real answer**, not a failure: an idempotent
  retry, a second click, or a stale observation the server declines to act on (a finale elimination
  for a team still above zero is the clearest one). Collapsing it into an error makes every D8 retry
  look broken.
- **`@kwiz/db/test-support` is now an exported subpath**, so `apps/web` tests get a real migrated
  in-memory database. `createTestRuntime()` in `lib/server/test-runtime.ts` assembles a whole server
  minus HTTP — use it rather than mocking anything.
- **Seeding for a manual smoke:** a throwaway `*.test.ts` under `packages/db/src` that calls
  `createGameFromQuiz` against `./data`, run with vitest and then deleted. Slice 1's finding still
  holds — you cannot run package source with plain `node`.
- **`PICKER_ASSIGNED` is appended even when it only confirms the rule** (slice 2's open item, now
  closed): the `picker` action always appends, so the log answers "whose pick was it?" without
  re-deriving D30.

## Slice 2 — `packages/domain`: the rules

**Status:** complete · `pnpm check` green · 323 tests · lint silent · **the whole game is playable in tests, with
no server and no UI**

**Built:** `constants.ts`, `answers.ts` (D22), `question-state.ts` (PRD 1 §7.1), `state.ts`,
`reduce.ts` over all 40 event types, `derive.ts` (everything deliberately not stored), `views.ts`
(the three filters + `attention`), and the protocol §6.2 sentinel leak test.

### The layering bug slice 1 left, fixed first

`packages/domain` may not import `@kwiz/db` — oxlint enforces it — but the **event catalogue, the
enum vocabulary and the content-config schemas were all in db**, and every domain function is
defined over exactly those events. Keeping them there would have forced a duplicate union in
domain, which is the drift the single-writer design exists to prevent. Moved to `@kwiz/domain`; db
imports them and no longer re-exports them. All 97 db tests passed unaltered, so the move was
behaviour-neutral.

**`@kwiz/domain` now owns the vocabulary; `@kwiz/db` owns persistence.** Do not move it back.

### The design that matters most

**`reduce(content, events)`** — `content` is the game-copy subtree, which is *not* in the log and
never could be: a question's prompt is not something that happened. Separating it is what keeps the
reducer a pure function of two inputs. There is **no clock inside it**: every timestamp comes from
the event that carried it, so a replay is byte-identical and every test is a literal array.

**`derive.ts` holds what is not stored** (§1.1) — lockout set, timer pause, standings, Jeopardy turn
order, every finale clock. If you find yourself adding a field to `GameState` for one of these,
that is a second source of truth for the same fact.

### Spec deviations

- **PRD 1 §7.1 draws `BUZZED` as a state box.** The canonical type has six states and no such
  member: a buzzed question stays `OPEN`. Noted inline, because modelling it as a state would turn
  D35's deny → reopen loop into a cycle in the state machine rather than what it is — repeated
  buzzes against one unchanged question.
- **`FinaleTurnDetail` carried no keywords in my first pass**, which left the master with no way to
  read the text they are supposed to mark. The sentinel test caught it. Added per protocol §5.5;
  it is the one place keyword text is transmitted before marking.

### A real bug found while closing the gaps

**A skipped question was still being presented as an open one.** `QUESTION_SKIPPED` leaves
`currentQuestionId` set — the master went around it — so the stage resolver kept yielding
`QUESTION`, and since `SKIPPED` has no visible state of its own it rendered as **`OPEN`**: a dead
question that looked like it was still taking answers, on both the projector and every phone.

Fixed in `stageKind`, and it is now two tests: the stage falls back to the round intro, and the
skipped prompt appears in neither audience's payload. I had flagged the `PENDING`/`SKIPPED` → `OPEN`
fallback as "a smell" in the first pass; it was not a smell, it was a bug.

### The drift slice 1 predicted, found and closed

Slice 1 left auto-grading out of `applyProjection` because `normaliseAnswer` did not exist yet, and
recorded it as "incomplete in one specific way, not wrong". Once slice 2 added the matcher, that note
became a **live drift**: `packages/domain`'s reducer graded a `FREE_TEXT` match to `AUTO_CORRECT`
with points, while `packages/db`'s projection still wrote `PENDING` with zero.

The symptom would have been nasty and confusing rather than loud — **master control calling a team
correct and scoring while the review grid still called the answer pending**, from the same log.

`applyProjection` now calls `@kwiz/domain`'s `gradeFreeText` / `gradeMultipleChoice`, never a local
copy, and `projection-parity.test.ts` runs one identical event list through **both** halves and
compares verdicts, points and scores across seven scenarios — auto-correct, near-miss, master
reversal, skip, adjustment and revocation, two teams graded differently, and a D47 proxy re-answer.

**Verified the guard has teeth**: making the writer always return `PENDING` fails 5 of its 7 cases.

Its fixture drives **everything** through the log — hence `seedGame(db, { withTeams: false })` plus
`TEAM_ADDED` events. Seeding rows directly is fine elsewhere, but two halves comparing different
histories would agree about nothing and pass.

### Raised, not resolved

- **`suggestedPicker` returns a suggestion; nothing appends `PICKER_ASSIGNED`.** That is an action's
  job (slice 3). The log is supposed to answer "whose pick was it?" without re-deriving the rule, so
  **the action must append it even when it merely confirms the suggestion.**

Everything else raised in the first pass is now closed:

- **Drafts** are a parameter of `toPlayerView` (`DraftLookup`, keyed by `gameQuestionId`) rather than
  a note for slice 3 to remember. Domain stays pure — it receives a plain map — but D45 is now
  impossible to forget, because a caller that ignores drafts is visibly ignoring an argument. A
  submission supersedes a draft, since submission is final (D43).
- **Lint is silent**, warnings included. The two casts that genuinely cannot be avoided —
  `Object.keys` narrowing in `payload.ts`, and re-pairing a validated payload with its variant in
  `parse.ts` — carry a one-line disable stating why. `describe()` now uses `instanceof z.ZodError`
  rather than asserting a shape, and the tests assign from `JSON.parse` instead of asserting.
- **The `no-misused-spread` suppression is gone.** `Array.from(w).length` iterates code points
  exactly as `[...w].length` did, so the stored `wordLengths` are unchanged and conventions §8 was
  updated to match. Code points are still not graphemes — an emoji counts as several — which remains
  a documented limitation rather than a suppressed warning.

### Next agent should know

- **`toMainScreenView` / `toPlayerView` / `toMasterControlView` take `now`**, because a running timer
  and a finale clock are functions of it. Pass the request instant; never read a clock inside domain.
- **The sentinel test is the enforcement, and it has a complement.** It asserts each secret does
  appear *once permitted* — without that, a filter returning nothing would satisfy the forbidden
  table trivially. **Add a sentinel when you add a secret.**
- **`toPlayerView` takes a `DraftLookup`.** Pass the team's drafts from `game_answer_draft` or two
  devices on one team will not see each other typing (D45). Omitting it means *no drafts*, never
  "do not share them" — there is a test asserting exactly that distinction.
- **`visibleState`'s `PENDING`/`SKIPPED` fallback is unreachable by design.** `stageKind` only yields
  `QUESTION` for the current question, which cannot be `PENDING`, and it now explicitly excludes
  `SKIPPED`. If you make a non-current question renderable, revisit both — invariant 6 depends on it.
- `FINALE_ENDED.ranking` is **stored as given**, while `finaleRanking(state)` derives the same thing.
  The action should append what the deriver produced; they must not disagree.

## Slice 1 — `packages/db`: schema & migrations

**Status:** complete · `pnpm check` green · 87 tests

**Built:** all **24 tables** (drizzle-kit confirms the count) via the §3 shared factories; zod
validators for every JSON column; the 40-type `game_event` payload union validated on append
*and* replay; the connection module with all four pragmas; the first migration; D14's boot
prompt; `appendAndProject`; and the §7.2 column-parity guard.

### Spec deviations — all fixed in the same change

Four, and three were found only by writing the code that had to obey them:

- **Drizzle's object-form index callback is `@deprecated.**` All 23 table definitions in the data
  model used it. Since §0 says the Drizzle definitions *are* the specification, following it
  faithfully would have written the whole schema against a dead API. Converted to the array form.
- **`SCORE_ADJUSTMENT_REVOKED` referenced an id that `SCORE_ADJUSTED` never recorded.** A
  projection rebuild (§11) replays into empty tables, so the adjustment came back with a fresh
  uuid and **every revocation silently stopped matching — restoring points a master had taken
  away.** `SCORE_ADJUSTED` now carries its own row id, as `BUZZ_RECEIVED` already did.
- **Projection timestamps came from the write clock.** `game_score_adjustment.createdAt` and
  `game_team.createdAt` used the column default, so a rebuild stamped *now* and rewrote when
  things happened. Both generalised into a rule in protocol §4.7 and I15.
- **`DEVICE_JOINED` could not project the row it creates**: the payload had no `deviceToken`, and
  only `lastSeenAt` is exempt from the log, so `game_device` could never be written by the sole
  writer. Added to the payload — no new exposure, since the log is on the same disk as the table.
- **`FINALE_ENDED { ranking }` was a flat list**, which cannot express the shared rank PRD 1 §8.8
  requires for simultaneous elimination. Now `teamId[][]`, rank groups best first.
- Also: `text({ enum })` generates **no** `CHECK` constraint (so widening one needs no migration,
  and the database will not reject a bad value); the invariant table was reordered into I1–I22;
  and §11.1 now records how D14's prompt is assembled.

### Raised, not resolved

- **Auto-grading is absent, and that is a build-order boundary rather than an oversight.** A
  `FREE_TEXT` or `MULTIPLE_CHOICE` verdict is computed from the submission plus the accepted
  answers (protocol §4), which needs `normaliseAnswer` and the matcher — build-order **slice 2**.
  Until then a submission projects as `PENDING`, which is `game_answer`'s documented default
  (§6.5) and the correct pre-grading state. **Incomplete in one specific way, not wrong**, and
  the I15 rebuild test will catch it the moment slice 2's grading and the projection disagree.
- **`@types/better-sqlite3` is at 9.6.0 against our v13.** Diffed the surfaces: the only gap is
  `Database.explain`, a debug helper. Fine, but a v13-aware types release is worth taking.
- **No `createGame` / `resyncGame` yet** (§7, §7.1). build-order does not put them in slice 1 and
  nothing needs them until slice 4, but the column-parity guard exists to protect the copy
  function they will contain — so whoever writes it should spread `SHARED_COLUMN_GROUPS` rather
  than hand-listing fields, which makes the guard pass by construction.

### Next agent should know

- **`bootDatabase()` in `src/boot.ts` is the entry slice 3 calls** — it opens the configured
  database and settles migrations before anything serves a request, returning the outcome rather
  than deciding. `DECLINED` is not a crash: the server boots and every surface must render the
  "database needs migrating" screen (§6.7).
- **Do not add a CLI that runs package source directly with `node`.** I tried, and it fails:
  Node's ESM resolver wants full filenames, so every extensionless relative import across the
  workspace is an `ERR_MODULE_NOT_FOUND`. Fixing it means either `.ts` extensions repo-wide or a
  loader dependency, and neither is worth it — the bundler resolves these fine, which is how the
  real entry point reaches this code. `boot.test.ts` covers the behaviour against a real
  directory instead.
- **`appendAndProject` is the only way to write the play half.** It validates, appends and
  projects in one transaction and returns `seqs`; broadcast happens *after* commit, which is why
  it pushes nothing itself.
- **`freshTestDatabase()` in `src/test-support.ts`** gives an in-memory database with the real
  migrations applied, and `seedGame()` the minimum tree (game → round → question → two teams).
  Use them; there is no reason to fake a database when one costs a function call.
  `MIGRATIONS_FOLDER` is absolute on purpose — a relative path resolves against the *process*
  cwd, which is the workspace root when vitest runs from there.
- **`seedGame` generates a unique code per game.** A hardcoded one cannot seed two `SETUP` games:
  the partial unique index rejects the second, correctly. That caught me, and it is now its own
  test in `schema/game.test.ts`.
- **`replay.test.ts` is I15, the keystone.** It wipes the projections and replays through the
  *same* `applyProjection`. If you add a projection effect, that test is what proves a rebuild
  still matches — and it is where both id/timestamp bugs above surfaced.
- **`oxfmt` ignores `packages/db/migrations/**`.** Those are drizzle-kit's own artifacts; the
  first `db:generate` had it rewriting the snapshot and journal.
- Migrations are **forward-only and committed**. Never hand-edit an applied one; add a new one. A
  column added to a shared factory generates changes to **two** tables, which is expected.

## Slice 0 — Scaffold

**Status:** complete · `pnpm check` green · `pnpm build` clean, no warnings

**Built:** pnpm workspace (Node 24.19.0, TypeScript `strict`); `@kwiz/config` with the PRD 1
§6.8 env schema and 20 tests; empty `@kwiz/domain` / `@kwiz/db` / `@kwiz/export`; oxlint with
the §1.4 architectural overrides plus `scripts/check-no-process-env.mjs`; oxfmt with the house
style pinned; Vitest workspace with a project per package; Next 16 App Router app with
Tailwind v4 + shadcn/ui tokens; next-intl `en`/`nl` implementing all three steps of PRD 1
§9.4's resolution order.

### Spec deviations — all four docs updated in this change

- **conventions §1 cited "PRD 1 §10" for shadcn/Tailwind.** Styling is PRD 1 **§9.1**; §10 is
  Export & import. Corrected. (The two `PRD 1 §10` references in protocol §8 are right — they
  really do mean Export & import.)
- **conventions §1.3 specified `no-floating-promises: error`, which was doing nothing.** It was
  named without its `typescript/` prefix and without `--type-aware`, and oxlint ignores an
  unknown rule name in silence. Now correctly configured and enforced — see "Floating promises
  are enforced after all" below for what it took.
- **conventions §1.3's config block was incomplete as written.** It now also carries
  `ignorePatterns`, a `scripts/**` override for `no-console`, `react/react-in-jsx-scope: off`
  (Next uses the automatic JSX runtime) and `import/no-unassigned-import` allowing `*.css`
  (how an App Router layout loads styles). Without the last two, a clean scaffold emits 11
  warnings.
- **conventions §1.5's scripts assumed a single-package repo.** `typecheck` fans out with
  `pnpm -r typecheck` because one root project cannot serve both the packages and a Next app;
  the root `tsconfig.json` covers the files no package owns. `lint` now also runs the
  `process.env` guard, and `format:check` was added so `check` can compose them.
- **Added conventions §1.3.1** documenting `.oxfmtrc.json`, and a note in §1.4 that the three
  architectural rules are covered by a test.

### CI (added after the initial slice-0 report, conventions §1.6)

`.github/workflows/ci.yml` runs format, lint (including the `process.env` guard), typecheck,
test and build on a **`ubuntu-latest` + `windows-latest` matrix**. Node comes from `.nvmrc`
and pnpm from `packageManager`, so CI has no versions of its own to drift from the repo's.

Two things came with it that are easy to mistake for decoration:

- **`.gitattributes` with `* text=auto eol=lf`.** `oxfmt --check` gates CI, so a CRLF checkout
  on the Windows runner would fail for a reason unrelated to any code.
- **`scripts/native-sqlite.test.ts`**, which asserts a prebuild exists for the current
  platform, that `better-sqlite3/build/` does **not** (so node-gyp never ran), and that the
  binary actually loads and enforces a foreign key. This is what makes conventions §1.1 a
  standing guarantee instead of something verified once by hand. **If it ever fails, apply
  §1.1's fallback — pin the Node major, or move to `node:sqlite` — do not set
  `allowBuilds.better-sqlite3: true` to make it pass.** It is also the reason the matrix has
  two operating systems: the prebuild is per-platform, so a Linux-only pipeline proves nothing
  about the laptop the quiz runs on.

Verified by wiping every `node_modules`, reinstalling with `--frozen-lockfile`, and running all
five steps in order — not just by trusting the YAML. The workflow is also schema-validated.

### Floating promises are enforced after all (conventions §1.3)

The first slice-0 report said nothing mechanically caught a floating promise, and that oxlint
had no type-aware rules. **That was wrong**, and worth correcting because it would have led
someone to bolt typescript-eslint on beside oxlint for no reason.

oxlint 1.77 does have type-aware rules — they are simply **off unless you ask**, needing both
the `--type-aware` flag and the `oxlint-tsgolint` package. Now enabled as errors:

| Rule | Catches |
| --- | --- |
| `typescript/no-floating-promises` | a dropped `appendAndProject()` or SSE write |
| `typescript/no-misused-promises` | `xs.forEach(async …)`, a promise where `void` was expected |
| `typescript/await-thenable` | `await` on a non-promise |

**`pnpm lint` is `oxlint --type-aware`, and the flag is load-bearing** — without it these three
report nothing *and say nothing about why*. `scripts/architecture-rules.test.ts` therefore
asserts both that they fire with the flag and that they are silent without it, so nobody
"simplifies" the script back to plain `oxlint`.

**New dependency, flagged per agent-workflow §3.4:** `oxlint-tsgolint` (dev only, root). It is
the type-aware backend and nothing already present can do this. It ships platform binaries as
optional dependencies for all six mainstream targets — including both CI matrix platforms — so
it needs no compilation, consistent with conventions §1.1.

**Expect noise from `no-misused-promises` in slices 4–7**: `onClick={async () => …}` returns a
promise where `void` is expected. The fix is `onClick={() => { void handle() }}`, which is
better regardless — it makes a deliberately unhandled promise visible at the call site. Do not
switch the rule off to avoid typing that.

### Raised, not resolved

- **No zip library is chosen for `@kwiz/export`.** conventions §1's dependency table names
  none, and slice 0 had no reason to pick. Whoever implements protocol §8 flags the addition
  per agent-workflow §3.4.
- **No README, deliberately deferred.** `CLAUDE.md` covers everything an agent needs. A human
  README waits until the surfaces exist so it can carry screenshots — so it belongs with
  build-order slice 8 or 10, not here. It still needs to say that the repo wants Node 24 and
  corepack, since `engineStrict` reports that only after someone has already tried.
- **pnpm 11 has a supply-chain release-age gate** and auto-wrote a `minimumReleaseAgeExclude`
  entry for `better-sqlite3@13.0.3`. Left as generated; a future version bump will need the
  same acknowledgement.

### Deliberately absent

- **Any UI beyond the boot proof** (build-order's "do not" line). The scaffold page is not a
  draft of the landing page — PRD 2's is slice 4's, and its switcher has placement rules
  (PRD 1 §9.4) this page deliberately ignores.
- **No shadcn components installed.** Only the tokens, `components.json` and `cn()`, so
  `pnpm dlx shadcn@latest add <component>` works out of the box.
- **The four per-surface type scales** (PRD 1 §9.2). Tokens only. A scale invented without a
  surface to hold it against is a guess; each arrives with its surface.
- `domain`, `db` and `export` are `export {}` — slices 2, 1 and 4.
- **The team palette** (conventions §3) — belongs in `@kwiz/domain`, slice 2.
- **`errors.<CODE>` messages** — must mirror conventions §4's catalogue exactly, so it belongs
  with the actions in slice 3, not to a guess now.
- **The D14 migration prompt** (slice 1) and **Playwright** (slice 9; the `e2e` scripts exist
  but the dependency and config do not).

**Not verifiable here:** nothing this slice claims. No secure-context or device behaviour is
in play yet (agent-workflow §4.5).

### Next agent should know

**Toolchain**
- Node **24.19.0** was installed via the nvm-windows already on this machine, and
  `.nvmrc` pins it. pnpm **11.20.0** comes from corepack via `packageManager`.
- **conventions §1.1 is resolved, and the answer is good:** `better-sqlite3` **13** ships
  N-API prebuilds for eight platforms *inside the npm tarball*, so it installs with **zero
  compilation**. Neither §1.1 fallback was needed. `allowBuilds` in `pnpm-workspace.yaml`
  therefore pins `better-sqlite3: false` **on purpose** — flipping it to `true` silently
  reintroduces the toolchain dependency §1.1 exists to prevent. `@swc/core` and
  `@parcel/watcher` are false for the same reason. Verified at runtime: it loads, and
  `PRAGMA foreign_keys = ON` genuinely rejects a bad FK (`SQLITE_CONSTRAINT_FOREIGNKEY`),
  which is CLAUDE.md §4's requirement.

**Gotchas that will cost you an hour each**
- **Internal packages are consumed as TypeScript source** (`main: ./src/index.ts`) with
  `transpilePackages` in `next.config.ts`, so there is no build step. **A new package must be
  added to that array**, or Next will fail to parse it. `serverExternalPackages:
  ['better-sqlite3']` is already set for slice 1.
- **Every package needs its own `@types/node` devDependency.** pnpm's strict `node_modules`
  means a root devDep is not visible to a workspace package, and the failure is a confusing
  `TS2688: Cannot find type definition file for 'node'`.
- **oxlint accepts an unknown rule name silently** — no warning, exit 0. That is how
  `no-floating-promises` sat in the config doing nothing. `scripts/architecture-rules.test.ts`
  runs the real linter over real violations for this reason; if you add an architectural rule,
  add a case there. Its fixtures are **not gitignored on purpose** — oxlint always honours
  `.gitignore` and `--no-ignore` only disables `.eslintignore`, so an ignored fixture is never
  linted and the test would pass while proving nothing. Do not "tidy" them into `.gitignore`.
- **oxfmt has `sortImports` and `sortTailwindcss` on**, so it will reorder your imports and
  class lists. Run `pnpm format` before `pnpm check` rather than fighting the diff. It ignores
  `**/*.md`, because it would otherwise reflow the hand-wrapped prose in `docs/`.
- **`middleware.ts` is `proxy.ts` in Next 16.** The old name still works but warns.
- **`engineStrict: true` lives in `pnpm-workspace.yaml`, not `.npmrc`.** Under pnpm 11,
  `engine-strict=true` in `.npmrc` downgrades to a *warning*, which is worse than absent
  because it reads like enforcement. From the workspace file it hard-fails with the wanted
  and actual versions. Verified by temporarily demanding Node `>=99`.
- **Every `shadcn add` needs a `pnpm format` afterwards.** The generator emits
  prettier-default style — semicolons, double quotes — which fails `oxfmt --check` and so
  fails `pnpm check`. Nothing is broken; run `pnpm format`. Verified end to end in this slice
  by generating a Button, formatting, and passing the full gate, then reverting it (an unused
  component and an unflagged `radix-ui` dependency would have been a stub for slice 4). The
  CLI needs `pnpm dlx`, not `pnpm exec`, and must run from `apps/web`.
- **`noUncheckedIndexedAccess` is on.** Array access yields `T | undefined`. This is deliberate
  and most valuable in slice 2's finale arithmetic; do not switch it off to save a few
  non-null assertions.

**i18n — the one that is genuinely surprising**
- `localeDetection: false` in next-intl disables **the cookie as well as `Accept-Language`**,
  and there is no setting for one without the other. D17 wants the header ignored but PRD 1
  §9.4 step 2 wants the cookie honoured, so **the cookie read is hand-implemented in
  `proxy.ts`**. next-intl still *writes* `NEXT_LOCALE`, so only the read side is ours.
  **If you touch `proxy.ts`, re-run the resolution-order probe** — all three steps are rows in
  the slice-0 smoke checklist.
- **The locale reaches next-intl through `next/root-params`, not `setRequestLocale`.** Next 16
  generates a typed `locale()` accessor from the `app/[locale]` segment, and next-intl
  deprecated the older `requestLocale` + `setRequestLocale` pair in favour of it. `i18n/request.ts`
  reads the segment itself, so **a layout never has to prime anything** — if you add a surface,
  do not reintroduce a `setRequestLocale` call. Switching also made the routes properly
  prerendered (`● /en`, `● /nl`) where `setRequestLocale` had left them dynamic.
- **`next/root-params` is untyped until the first build.** Its real types are generated into
  `.next/types/root-params.d.ts`; before that Next ships a shorthand ambient declaration, so
  `locale()` is `any` rather than a compile error. On a fresh clone, run `pnpm build` once
  before trusting editor types there.
- `messages/nl.ts` is typed `: Messages` from `en.ts`, so **a key present in English and
  missing in Dutch is a compile error**. `global.d.ts` registers `AppConfig`, so `t()` keys are
  checked too — a typo is a build failure, not a raw key on a projector.
- Use `Link`/`useRouter` from `@/i18n/navigation`, never `next/link`, or a language switch
  will not preserve the path.

**Handy:** `.claude/launch.json` defines `kwiz-dev`, so `preview_start` opens the app directly.
