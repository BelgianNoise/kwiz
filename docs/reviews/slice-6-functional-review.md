# Slice 6 — Functional Review

**Companion review to** [`slice-5-functional-review.md`](slice-5-functional-review.md) /
[`slice-5-code-review.md`](slice-5-code-review.md). This document covers the fixes made in
response to that review round, and slice 6 itself — the main screen (PRD 4), the projected
audience-facing surface.

**Reviewer:** independent audit, same method as the previous two rounds — ground truth confirmed
directly (`pnpm check`: 652 tests / 41 files, all green), PRD 4 and the current protocol.md/
conventions.md re-read in full, and a set of parallel deep-dive agents each re-verifying claims
against the actual current code.

## Verdict

**Both critical bugs from the slice 5 review round are genuinely fixed**, structurally rather
than superficially — the `FINISH` confirmation gap and the round-boundary sweep dead-end were
both closed by a shared `advance.ts`/`AdvanceButton` extraction that also resolved the code
review's duplication finding in the same change, exactly as that review's recommended sequencing
suggested. 13 of 15 distinct findings from that round are fixed; the two that remain open were
explicitly low-priority in the original review and are now accompanied by comments documenting
the deferral is deliberate.

**Slice 6 continues the project's now-familiar strength**: the domain-layer extensions
(`Standing.movement`, `provisional`, `MediaPlayback`, `Timer.durationMs`, the round-boundary
fixes, the `joinUrl` fix) are all genuinely correct, well-reasoned, and backed by real,
non-trivial tests — including for exactly the case ("hiding the leaderboard captures nothing")
that a plausible-but-wrong implementation would get wrong silently.

**This audit found one HIGH-severity gap and five further MAJOR-severity gaps**, concentrated in
two places the implementing agent's own admitted blind spots predicted: the **arming/failure
screen** (which sits outside the `StageFrame` the mechanical 4vh floor check can see) and the
**two hooks with no test coverage** (`useEliminationMoment`, `usePenaltyFlash` — vitest can't
resolve the `@/` alias yet, a gap slice 6's own log calls out explicitly). One of the two hooks
does have a real bug; the other doesn't.

**Recommend fixing the HIGH item before any live event, and the six MAJOR items before slice 7**
— several are visible on the very first thing the room sees (arming) or in the finale's most
dramatic, least-recoverable moment (simultaneous elimination).

---

## Priority 1 — Fix before any live use

### 1. [HIGH] A deleted or not-found game freezes the last frame forever instead of showing the neutral failure mark

**Where:** `apps/web/components/screen/main-screen.tsx` (no branch for `status === 'FAILED'`),
`apps/web/lib/client/use-live-view.ts` (`FAILED` status leaves `view` untouched)

PRD 4 §14 is explicit: *"Game not found / deleted → A neutral full-screen `kwiz` mark. No error
text."* PRD 2 §12.1/§13.1 makes this a genuinely reachable scenario, not a hypothetical: deleting
a game is legal **at any status**, including `LIVE` — a master can delete the very game currently
projected on the screen.

`main-screen.tsx` only renders `view ? <Stage .../> : <KwizMark />`, plus a separate
`status === 'RECONNECTING'` pulse. There is no branch for `status === 'FAILED'` at all. When the
game is deleted, `useLiveView`'s stream gets a 404/`GAME_NOT_FOUND`, sets `status: 'FAILED'`, and
**leaves `view` at whatever it last held** rather than clearing it. The result: the projector
keeps showing the last frame — frozen, no pulse (the pulse only renders for `RECONNECTING`), no
kwiz mark, no indication anything happened — forever. Compare with `control-desk.tsx`, which
already has a working `status === 'FAILED'` branch showing a visible message; the screen surface
is simply missing the equivalent.

**Recommend:** render `<KwizMark/>` (or equivalent) whenever `status === 'FAILED'`, regardless of
what `view` last held.

---

## Priority 2 — Major, fix before slice 7

### 2. [MAJOR] A simultaneous finale elimination silently drops every team but the first

**Where:** `apps/web/components/screen/finale-stage.tsx` (`useEliminationMoment`)

The hook's reconnect-safety logic is correct (verified: a fresh mount or reconnect never replays
an old elimination, because `seen.current === null` on the first run suppresses any announcement
until a genuine *new* transition is observed). But the search for what's newly eliminated is:

```js
const fresh = clocks.find(
  (clock) => clock.eliminatedAt !== null && !previous.has(clock.teamId),
)
if (!fresh) return undefined
setMoment(fresh)
```

`.find()` returns only the **first** match. PRD 1 §8.8 and D51 explicitly define a scenario where
more than one finalist crosses zero from the same event — a single keyword's penalty eliminating
every remaining finalist at once, described in the PRD as *"the degenerate case where every
finalist is eliminated by one keyword… a reachable outcome with equal banks and a high penalty."*
When that happens, `seen.current` is updated (in the same effect run) to include **all** of the
newly-eliminated teams' ids — so the second, third, etc. team's elimination moment never fires
now, and can never fire later either, since `previous` will already contain their id on every
subsequent run. The result: one of two (or more) simultaneously eliminated teams gets the
dramatic full-screen `OUT` moment; the rest just silently disappear from the "on turn" strip with
no announcement at all — precisely the failure PRD 4 §12.4 says this moment exists to prevent.

**Recommend:** queue every newly-eliminated team from one update and show each hold in sequence
(or render one combined moment naming all of them), rather than `.find()`'s first-match-only
behaviour.

### 3. [MAJOR] Resolved keyword tiles never show the crediting team's name or colour

**Where:** `apps/web/components/screen/finale-stage.tsx` (`Keyword` component)

PRD 4 §12.1 states, and its mockup literally illustrates: *"On marking, the tile crossfades from
blocks to the text with the crediting team's name and colour beside it"* — the ASCII mock shows
`Thriller` next to `● Quizzly`. The domain view already carries what's needed:
`FinaleKeywordView.teamId` is populated the moment a keyword is marked (`packages/domain/src/
views.ts`, `keywordView`). But the `Keyword` component that renders it never reads `teamId`
anywhere — confirmed by grep, the only `teamId` references in the whole file are for the clock
strip, not the keyword tiles. The marked branch renders bare resolved text with no team dot or
name. There's no i18n string wired for it either. This is a genuine, spec-illustrated missing
feature, not a cosmetic nicety — and it's easy to miss in a demo because the "resolved, no
attribution" case looks almost identical to what's actually specified.

**Recommend:** when `keyword.teamId` is present (not `null` — that's the revealed-unguessed case,
which correctly gets no marker — and not `undefined`, the unmarked case), render a team dot +
name beside the resolved text, matching the pattern the clock rows already use.

### 4. [MAJOR] The arming screen renders below the 4vh absolute legibility floor

**Where:** `apps/web/components/screen/arming.tsx`, `apps/web/components/screen/main-screen.tsx`

`main-screen.tsx` renders `<Arming .../>` **before** the `<StageFrame>` wrapper that gives every
other stage's text its `container-type: size`-relative `cqh` scaling. `arming.tsx`'s two text
elements are plain Tailwind rem-based classes (`text-4xl`, `text-xl`) — 36px and 20px at the
default root size. On an actual 1920×1080 projector output, that's **3.33vh and 1.85vh** — both
below PRD 4 §2.1's explicit floor: *"Absolute floor — any text on this screen — 4vh. Nothing is
exempt, including timings and captions."* This is the very first thing the room sees, on every
game, every time the route opens (§4.1: "shown before the waiting screen, on load, every time").

Worth noting why this slipped through: the smoke-checklist's own mechanical 4vh-floor check
(added in slice 6, and a genuinely good idea) only queries descendants of
`[style*="container-type"]` — i.e., only inside `StageFrame`. The arming screen sits outside it
by construction, so the very check built to catch exactly this class of bug structurally cannot
see this screen.

**Recommend:** move the arming screen's text sizing to `cqh` values inside the same frame (or
compute an equivalent floor for content rendered outside it), and consider extending the smoke
check's selector to also cover anything mounted at the route's top level, not only inside
`StageFrame`.

### 5. [MAJOR] "Numbers count up rather than snapping" (§15) is not implemented anywhere

**Where:** `apps/web/components/screen/parts.tsx` (leaderboard `Row`), and every other score
render on this surface

PRD 4 §15's motion table states plainly: *"Numbers count up rather than snapping — a score
changing from 290 to 340 should be seen changing."* Every score value found (spot-checked the
leaderboard row) is a bare static number with no transition or animation logic, and a
surface-wide grep for a count-up hook or equivalent turns up nothing. A score change today just
snaps to the new value between one leaderboard render and the next.

**Recommend:** add a count-up transition (a small custom hook driving a `requestAnimationFrame`
tween, or a CSS-only approach if `prefers-reduced-motion` handling — see finding #6 — can gate
it correctly) for score value changes.

### 6. [MAJOR] `usePrefersReducedMotion` is built, documented, and never used

**Where:** `apps/web/lib/client/use-screen-chrome.ts`

The hook exists with a doc comment explicitly justifying it: *"two of this surface's motions are
not CSS: §12.3's penalty flash and §15's counting numbers are decided in a component, and a
CSS-only accommodation would quietly skip both."* It has zero call sites anywhere in
`components/screen`. The CSS-only path in `globals.css` does correctly crossfade named keyframe
animations under `prefers-reduced-motion`, but by the hook's own stated rationale, that path
cannot reach the two things §15 explicitly names as needing special handling: **the timer ring
becoming stepwise** (it's a continuously-updated SVG `strokeDashoffset` driven by a 250ms client
tick, not a CSS animation) and **the count-up numbers** (which per finding #5 don't exist at all
yet). The accommodation this hook was written to provide is currently half of nothing — the CSS
half covers animations that don't need special reduced-motion handling as urgently, and the two
cases that do (per the hook's own comment) are unwired.

**Recommend:** wire `usePrefersReducedMotion` into the timer ring's rendering (step rather than
smoothly animate under reduced motion) and into whatever count-up implementation closes finding
#5 (skip the tween, snap immediately, under reduced motion) — or remove the hook if the decision
is to defer both to a later slice, so it doesn't sit as an attractive nuisance implying coverage
that isn't there.

---

## Priority 3 — Also worth fixing soon

### 7. [MAJOR] The sound-arm failure recovery message promises a retry that doesn't exist

**Where:** `apps/web/components/screen/waiting-stage.tsx`, `apps/web/components/screen/
main-screen.tsx`, `apps/web/components/screen/arming.tsx`

When sound arming fails, the waiting screen shows *"Sound could not start. Click the screen once
more"* — but the only click listener installed after arming (`main-screen.tsx`) calls only
`requestFullscreen()`, never `armSound()` again. `armSound` is invoked exactly once, from
`Arming`'s own click handler, and `Arming` unmounts permanently once `sound` state resolves either
way. A master following the on-screen instruction and clicking again gets no retry of sound at
all — the only actual fix is reloading the whole route. This is exactly §4.1's stated concern
("a master who is going to discover a muted projector should discover it while the room is still
filling") undermined by its own recovery instruction not working.

**Recommend:** either make the post-arming click listener retry `armSound()` when sound
previously failed, or change the copy to say what actually works (reload the page).

### 8. [MAJOR, inherited from slice 2 but live and visible here] `ABANDONED` renders identically to `FINISHED`

**Where:** `packages/domain/src/views.ts` (shared `stageKind` logic, used by both
`toMainScreenView` and `toPlayerView`)

PRD 4 §14's table is explicit: *"Game abandoned → Whatever was showing, held. No announcement —
the master handles the room."* The actual code collapses `FINISHED` and `ABANDONED` into the same
`'FINISHED'` stage kind, so an abandoned game gets the full winner-at-hero-scale, final-standings
treatment — indistinguishable from a real ending. This line predates slice 6 (traced to slice 2),
but it is live, current, and directly contradicts the spec for the exact surface under review, and
neither slice 5's nor slice 6's self-audit caught it. Flagging now since it wasn't raised before.

**Recommend:** give `ABANDONED` its own stage-kind branch that holds the last non-terminal view
rather than routing through `FINISHED`.

---

## Priority 4 — Minor

| # | Finding | Where | Note |
| --- | --- | --- | --- |
| 9 | Jeopardy category names can still be silently clipped (`overflow-hidden`, not "fit") | `apps/web/components/screen/board-stage.tsx` | §9 says "must fit without truncation." Defensible by analogy to §2.4's "over-long content is an authoring problem, pre-flight catches it," but that reasoning isn't recorded anywhere, and truncation ≠ the deterministic fitting §2.4 actually describes |
| 10 | The waiting-stage team list introduces an undocumented 3-column tier past 12 teams | `apps/web/components/screen/waiting-stage.tsx` | PRD 4 §4 says "beyond ~12 teams it becomes a two-column grid, then names only without dots" — the code has a `>12 → 3 columns` rule instead. Reasonable at the 20-team scale envelope, just not what's written |
| 11 | `SCOREBOARD_TOGGLED` isn't guarded against an open question, so a master can push the leaderboard over a live question | `packages/domain/src/decide.ts` (pre-existing, slice 5), `views.ts`'s `stageKind` | PRD 3 §11.1's wording ("clears automatically when the *next* question opens") is ambiguous about whether covering the *current* open question is intended. Flagging as worth a decision-log entry, not asserting it's a bug |
| 12 | Two of the nine new `MainScreenView` fields have no test coverage: `ROUND_INTRO.questionCount`/`points`, and `soundMuted`'s passthrough | `packages/domain/src/main-screen-view.test.ts` | Both implementations look correct by inspection (simple `.length`/`.reduce()` and a one-line passthrough), but neither is asserted anywhere |
| 13 | The penalty-flash label text renders at ~3.0cqh, below the 4vh floor | `apps/web/components/screen/finale-stage.tsx` | Same class of bug the slice-6 self-audit already caught once on this surface (Jeopardy category names at 3.6cqh) |
| 14 | `DisconnectedPulse` and `AdjustmentBanner` anchor at the identical screen corner | `apps/web/components/screen/arming.tsx`, `adjustment-banner.tsx` | A reconnect during a still-visible 6-second score banner would render one on top of/beside the other |

---

## Carried over from the prior review — verification results

Every finding from `slice-5-functional-review.md` and `slice-5-code-review.md` was independently
re-checked. **13 of 15 findings are confirmed FIXED**, with real, on-point test coverage added for
both critical items:

- **Both critical bugs are fixed structurally, not superficially.** `FINISH`'s irreversibility is
  now a typed property (`AdvanceAction.irreversible`) threaded through a shared `advance.ts`/
  `AdvanceButton` module; `Enter` is never bound when an action is irreversible, and the click path
  goes through a confirm dialog instead. The round-boundary dead-end is fixed by computing
  `view.advance` independently of the `VALIDATE_QUESTION` attention state (bound to the live
  current round, not to whichever question the sweep happens to be showing), so the sweep screen
  always has a working advance action even while an earlier round's validation is deferred. New
  tests (`advance.test.ts`) target both scenarios precisely, including the exact repro
  ("offers the next round when the current one has no unplayed question left").
- The code-review's duplicated "next pending question" selector (four call sites) was
  consolidated into the same shared module as part of the same fix — exactly the sequencing that
  review recommended.
- The finale desk now renders media controls for a finale question's attachment; protocol.md's
  `VALIDATE_QUESTION` documentation now matches the flattened shape the code actually uses.
- All five remaining minor items (the skip-question guard, the `keys.tsx` docstring, the sentinel
  test note) are fixed as recommended.
- **Two items remain open, both explicitly low-priority in the original review and both now
  accompanied by a comment documenting the deferral is deliberate**: `DO_SCORES_SET` still has no
  zero-fill for omitted teams (functionally benign — the score sum is unaffected either way), and
  `CHECKSUM_MISMATCH`/`IMPORT_COLLISION` remain declared but unused `ErrorCode` values (the actual
  mechanisms — per-file reasons, a collision preview — are arguably better designs; this is a
  catalogue-accuracy nitpick, not a behavioural gap).

One caveat worth carrying forward: the round-boundary fix is verified via a synthetic-view unit
test and static reasoning, not a full `reduce()`-driven end-to-end scenario reproducing the exact
multi-round repro steps from the original finding. The mechanism is sound, but no test exercises
that literal scenario through the complete state machine.

---

## What was verified as genuinely correct in slice 6

- **The finale keyword confidentiality invariant holds.** Unmarked keyword text is genuinely
  absent from the `MAIN_SCREEN` payload — verified by reading the allowlist-construction code
  directly (not just trusting a test), and backed by a real sentinel test asserting the secret
  string never appears while unmarked and does appear once marked or revealed.
- **`usePenaltyFlash` correctly distinguishes a mark from an un-mark.** It fires only on the
  marked-keyword count strictly *increasing*; an un-mark (which returns the penalty and would
  otherwise look like "seconds went up") correctly produces no flash. This is exactly the subtle
  distinction the slice's own log flagged as the highest-value thing to get right, and it's right.
- **`Standing.movement`'s baseline-capture mechanism is correct and well-tested**, including the
  specific "hiding the leaderboard captures nothing" case and the "two teams swap twice, net
  movement is what was actually shown, not a naive score diff" case — both asserted directly
  against a real reduced `GameState`, not mocked.
- **The `provisional` field's scoping genuinely resolves the tension** between the old spec (no
  pending-validation info on `MAIN_SCREEN` at all) and PRD 4/PRD 3's requirement for a "scores
  provisional" marker: it appears only on a `Standing`, never on a question, and this is a real
  resolution rather than a leak — confirmed the `QUESTION` stage payload contains neither
  `"provisional"` nor `"pending"` anywhere.
- **`MediaPlayback` is genuinely ephemeral, per-game, and not event-sourced** — no event type
  exists for it anywhere in `packages/domain`, it's cleared on question-open, and the "server
  restart loses position, room hears music over a stationary equaliser" cost the log describes is
  an accurate, honest description of current behaviour rather than something worse.
- **`Timer.durationMs` correctly keeps the ring's total span fixed** across a buzz-adjudication
  pause — verified the deny-loop pause only moves the countdown deadline forward, never the
  denominator the ring's proportion is computed against, so the ring cannot visibly jump
  backwards.
- **All three round-boundary/Jeopardy-handoff bugs the slice-6 self-audit found are genuinely
  fixed**, each backed by a real test: the closed-round leaderboard gap, the scored-Jeopardy-tile
  returning to the board (checking `SCORED` specifically, not `REVEALED`), and the relative-
  `joinUrl` bug (now delegating to the single real address-builder both the admin page and this
  surface share).
- **Arming never hangs.** `requestFullscreen()` is fired-and-not-awaited, and sound arming races a
  bounded 1-second deadline — the screen always reaches an answer.
- **Sound gating, reconnect/disconnect UX, and payload-filter discipline are all correct**: only
  two sounds exist and both correctly no-op when unarmed or muted; the 3-second disconnect grace
  period matches the documented constant; the indicator is a small, calm, wordless pulse that
  never replaces the last good view; and all nine new `MainScreenView` fields are built as
  constructive allowlists with no leak found (including `FinishedRow[]`, which correctly nulls out
  finalist-only fields for every non-finalist row).
- **`stage.tsx`'s exhaustiveness check is real** (`const unhandled: never = stage`), and
  `components/screen` genuinely never imports from `components/control` — the one deliberate
  duplication (`minuteSeconds`) is low-cost and narrow, though this review's code-quality
  companion has an opinion on whether the stated justification fully applies.
