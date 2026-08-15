# Slice 6 — Code Review

**Companion to** [`slice-6-functional-review.md`](slice-6-functional-review.md), which covers
spec/requirement compliance for the main screen (PRD 4) and the fixes made in response to the
slice 5 review round. This document covers architecture, maintainability, and test quality.

**Verdict up front:** the fix pass on the slice 5 findings was, once again, structural rather than
patchy — the two critical bugs and the duplicated-selector code-quality finding were closed by the
same extraction, in the sequence that review recommended. Slice 6's own domain-layer work
continues the project's established rigor (real snapshot state for rank movement, careful
allowlist construction, honest documentation of an ephemeral-state trade-off). The gaps this round
are concentrated in exactly the two places the implementing agent's own log predicted they would
be: the untested finale-stage hooks, and presentation logic that sits outside the mechanically-
checked `StageFrame`.

---

## Findings

### 1. Two of the finale stage's three hooks have zero test coverage, and it's exactly where the one real bug in this slice lives

**Where:** `apps/web/components/screen/finale-stage.tsx` (`useEliminationMoment`,
`usePenaltyFlash`)

Slice 6's own log admits this directly: *"`vitest` still resolves no `@/` alias... `useElimination
Moment` and `usePenaltyFlash` are the two I would most want covered — both turn on change
detection, which is exactly the kind of logic a reload can hide."* This review's finale-stage
deep-dive found precisely that: `usePenaltyFlash`'s change-detection is correct, but
`useEliminationMoment`'s is subtly wrong for a documented, reachable multi-team scenario (a
`.find()` call that silently drops every elimination but the first when several happen at once —
see the functional review's finding #2). Both hooks look nearly identical in shape (compare
"newly true" vs. "count increased" logic), which is exactly the kind of pairing where one being
subtly wrong and the other being right is easy to miss without a test forcing the distinction.

**Recommend:** resolving the `@/` alias issue in vitest (flagged as a standing gap since slice 5)
should be prioritised specifically because of this finding — not as general hygiene, but because
it's the concrete case where the gap already produced a real, shipped bug.

### 2. The arming screen's presentation logic sits outside the one place legibility is mechanically checked

**Where:** `apps/web/components/screen/arming.tsx`, `apps/web/components/screen/main-screen.tsx`

This is the root cause of the functional review's finding #4 (arming text below 4vh), and it's
worth calling out as a structural gap rather than just a sizing mistake: the smoke-checklist's own
4vh-floor script — a genuinely good idea, added in this slice — only queries
`[style*="container-type"]` descendants, i.e. only what's inside `StageFrame`. The arming screen
is deliberately rendered before that frame mounts (§4.1 requires it to appear before the waiting
screen), so it's invisible to the one automated check built to catch this exact class of bug.

**Recommend:** either bring the arming screen inside a frame with the same `cqh` scaling
(preferred, since it also protects future edits to this screen), or extend the smoke check's
selector to include the route's top-level content regardless of frame membership, so a future
addition outside `StageFrame` doesn't reintroduce the same blind spot.

### 3. `minuteSeconds` duplication: the stated justification is stronger than the actual risk

**Where:** `apps/web/components/screen/break-stage.tsx`, `apps/web/components/control/
break-desk.tsx`

The slice log defends this duplication as necessary to avoid "the first thread of a dependency
between two surfaces whose type scales must stay independent" — a good argument against sharing
*presentational components* (which carry `cqh` sizing, Tailwind classes, and JSX specific to one
surface's scale). But `minuteSeconds` itself is four lines of pure `number → string` arithmetic
with no rendering concern at all — floor seconds, format `m:ss`. Importing a pure function with
zero dependency on either surface's layout doesn't create the coupling the stated reasoning
guards against; it's a different class of import than sharing a component would be.

**Recommend:** this is minor and low-cost (two call sites, four lines, pinned by conventions
§8.2's format spec so unlikely to drift) — not worth a special trip, but worth extracting to a
neutral location (`apps/web/lib/format.ts`, or `packages/domain` if pure formatting helpers are
welcome there) the next time either file is touched for an unrelated reason.

### 4. The "is this round closed" fact is computed twice, independently, in `views.ts`

**Where:** `packages/domain/src/views.ts` (`stageKind` and `leaderboardStage`)

`stageKind()` re-derives whether the current round is closed (to decide whether to route to
`LEADERBOARD` at all) via one lookup; `leaderboardStage()` re-derives the same fact again (to
compute `afterRoundNumber`) via a different lookup. Both read `state.closedRoundIds` correctly
today, so there's no live bug — but it's the same fact computed twice for two call sites that
could silently drift if one is edited without the other.

**Recommend:** compute the closed-round fact once (in `stageKind` or a shared helper) and thread
it through to `leaderboardStage`, rather than re-deriving it.

### 5. Two of the nine new `MainScreenView` fields are untested

**Where:** `packages/domain/src/main-screen-view.test.ts`

`ROUND_INTRO.questionCount`/`points` and the `soundMuted` passthrough are both implemented simply
and look correct by inspection, but neither has a direct assertion anywhere in the new 641-line
test file — a gap worth closing cheaply given how much of the rest of this file is genuinely
thorough (see below).

### 6. The leaderboard's overflow ladder collapses PRD 4 §10's three described states into two

**Where:** `apps/web/components/screen/parts.tsx`

PRD 4 §10 describes three states as team count grows: two columns, then drop the movement
indicator, then compress to rank/name/score only. The code couples the "drop movement" decision
directly to the "two columns" boolean (`showMovement = movement && !twoColumns`), so there are
only two effective states, not three. Harmless at the documented ≤20-team scale envelope, and the
kind of simplification this project's own conventions explicitly permit ("compromise freely on…
optimising beyond the scale envelope") — worth only a one-line comment recording the
simplification was deliberate, the way similar ones elsewhere in this codebase already are.

---

## What's strong, worth preserving

- **The slice-5 fix pass, again, chose the structurally better fix over the literal one
  suggested.** `view.advance`'s independence from `attention` (rather than teaching the sweep's
  "next pending" search to reach across rounds) is a cleaner mental model: the sweep and the
  ordinary advance path can never disagree about what the next action is, because they're not two
  separate implementations of "what comes next" — they're the same field, always present,
  consulted from two different UI contexts.
- **`Standing.movement`'s test suite is a model of testing the *wrong* implementation, not just
  the right one.** `main-screen-view.test.ts`'s "does not take a baseline from hiding the board"
  case explicitly asserts the value a plausible-but-wrong implementation would produce, with a
  comment explaining what that wrong value would be and why. This is a stronger test than "asserts
  the correct behaviour" alone — it's specifically shaped to catch the mistake a future editor is
  most likely to make.
- **`playback.ts`'s ephemeral, non-event-sourced design is honestly documented**, including its
  one real cost (a server restart loses media position while the room hears a stale equaliser).
  Stating a trade-off's cost plainly, rather than either hiding it or over-engineering around it,
  is exactly the "relatively clean, compromises allowed" bar this project's own CLAUDE.md sets.
- **`stage.tsx`'s exhaustive switch** (`const unhandled: never = stage`) is confirmed real and is
  the right pattern for a resolver whose failure mode — a blank projector — is the one thing this
  surface cannot recover from gracefully.
- **The `screen-preview.tsx` / `QuestionStage` sharing arrangement is well-designed**: PRD 2's
  authoring preview consumes the exact same `MainScreenQuestion` shape the live surface does (with
  a stable, memoized empty-teams default for its one caller), so a future protocol change to that
  shape breaks the preview at compile time instead of drifting silently.
- **i18n parity is enforced by the type system, not just convention** — `nl.ts`'s `const nl:
  Messages = {...}` typing (where `Messages = typeof en`) makes a missing or mistyped key a
  compile error, and this was verified by hand against the trickier interpolated keys, not just
  assumed from the type declaration existing.
- **No unexplained `any` or lint suppressions were found anywhere in this slice's diff** — the
  three `oxlint-disable` comments present are all narrow, justified, and unrelated to the
  architectural rules CLAUDE.md holds the line on.

---

## Recommended sequencing

1. Fix the HIGH functional finding (`FAILED` status never rendering the neutral mark) first — it's
   a small, isolated change (one new branch in `main-screen.tsx`).
2. Fix the simultaneous-elimination bug and add the finale desk's missing team-attribution
   rendering together, since both live in `finale-stage.tsx` and both are reachable in the same
   kind of dramatic, hard-to-rehearse moment.
3. Move the arming screen inside frame-scaled sizing (or extend the smoke check), then implement
   count-up numbers and wire `usePrefersReducedMotion` into both the ring and the new count-up
   logic together — these three are related (motion + legibility on the surfaces the mechanical
   checks currently can't see).
4. Prioritise the `@/` alias fix for vitest specifically because of finding #1 above, then add
   tests for both finale hooks — the elimination-swallow bug should become a regression test the
   moment coverage is possible.
5. The remaining minor items are cheap, independent cleanup — fine to fold into whichever future
   change happens to touch each file, per this project's own stated tolerance for compromise on
   non-architectural polish.
