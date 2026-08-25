# Slice 10 — Code Review

**Companion to** [`slice-10-functional-review.md`](slice-10-functional-review.md), which covers
spec/requirement compliance for build-order's slice 10 (the field-rehearsal runbook and the
automatable guards pulled forward) and re-runs the gate. This document covers the new spec's
structure, locator quality, and maintainability, plus the edits this slice made to three
existing specs.

**Verdict up front:** the code footprint is deliberately tiny — one new spec file, surgical
edits to three existing ones, four documents — and that is the right shape for this slice: a
permanent CI guard gained without touching a line of production code or adding a dependency.
The real findings are hygiene (the encoding damage covered in the functional review's findings
#1/#2), two over-broad locators, and small asymmetries in an otherwise well-built measuring
harness. Nothing structural.

---

## Findings

### 1. The harness has two measurement shapes: uniform checkpoints and ad-hoc inline evaluations

**Where:** `e2e/specs/legibility.spec.ts` (`measure`, lines 116–126, vs the arming block at
128–144 and the final `finished` checkpoint)

Mid-game stages all go through `measure(stage)`: both locales, both evaluators, stage named in
each failure message. The arming screen instead gets hand-rolled code — per-locale visibility
and clicks, then a single `collectViolations` against `screens[0]`, no `collectOverflow` — and
its exemption from the helper isn't stated where `measure` is defined. The functional review's
finding #4 is the behavioural consequence; this is the structural cause. A reader asking "was
stage X measured?" currently answers it by reading the whole test body rather than counting
`measure()` calls, which is exactly how the next added stage inherits the gap silently.

**Recommend:** let `measure()` take an options bag (or accept being callable pre-frame) so arming
goes through the same path for both locales and both evaluators; the helper's doc comment should
say every projected pixel goes through it.

### 2. Encoding damage as a maintainability problem, restated where it will actually hurt

**Where:** `e2e/specs/legibility.spec.ts` and `e2e/specs/authoring.spec.ts` throughout

The functional review's finding #2 covers scope and remedy; the code-specific cost deserves its
own sentence: this suite's convention is that comments carry the *reasoning* (which spec section,
which decision, why the fixture is shaped this way). In these two files that layer is unreadable
— `(Ã‚Â§10.5)`, `Ã¢â‚¬â€` mid-sentence, corrupted titles in reporter output. For a suite whose
value is what it teaches the next reader, that's a real loss, not a cosmetic one.

### 3. URL assertions are heuristic twins, duplicated inline

**Where:** `e2e/specs/legibility.spec.ts:310-315` and `320-327`

The hub read and the projector read repeat the same three moves: locate with
`new RegExp(`[^\\s]*/play/${game.code}`)`, assert not starting with `/`, then strip scheme and
trailing slash to compare the two. And "has authority" is tested via `toContain(':')` — a colon
anywhere in a path would satisfy it, so the check leans on the startsWith companion to mean
"host:port". Adequate while `joinUrl` is built by our own `views.ts` builder, but the strength
lives in an implicit pairing rather than either assertion alone.

**Recommend:** extract one small local helper (`readJoinUrl(page)` returning the stripped text)
used twice, and if the authority check should stand alone, parse with `new URL(...)` against a
canary base and assert `host` is non-empty — clearer than a substring colon.

### 4. `screenEnPage()` is declared after use and adds nothing over its body

**Where:** `e2e/specs/legibility.spec.ts:259-266`

Function declarations hoist, so it works, but a named indirection for `screens[0].page`,
defined below the code that uses it and never used again, reads as a leftover refactor step.
Everywhere else in the file indexes `screens[]` directly.

**Recommend:** delete it and use `screens[0]!.page`.

### 5. `collectViolations` doesn't consider visibility

**Where:** `e2e/specs/legibility.spec.ts:44-64`

`getComputedStyle(el).fontSize` resolves from the cascade even when nothing renders, so a node
hidden by a `display: none` ancestor (a closed popover, an inactive tab) would still be measured
if its font size were small — a false-positive direction failure mode the guard currently has no
policy for. Not observed misfiring (the suite is green across 13 stages × 2 locales), and the
false-negative direction (transform-scaled text) is already honestly documented in-file. This
sibling case deserves the same treatment: either filter to rendered text or add it to the
deliberate-cannot-prove list alongside transforms.

### 6. The `nav` exemption exempts all nav content, forever

**Where:** `e2e/specs/legibility.spec.ts:49-52`

Matching structurally instead of by translated label was the right call and the reasoning is
recorded — but `closest('nav')` means any element any future developer puts inside a nav on the
projector surface becomes permanently invisible to the floor check. Today that subtree is exactly
the language switcher, so the exposure is theoretical; worth a one-line note that the exemption
is scoped to "chrome as it exists today", so growth in nav content is a conscious decision.

---

## What's strong, worth preserving

- **The guard earned permanent status the right way: proven able to fail.** This audit
  mutation-tested it before trusting its green run — planted fixed-size text failed at the right
  checkpoint, naming node and size. That property, plus traces-on-failure, is what separates
  this from slice 6's manual snippet that ran only when remembered; it now lives in CI's e2e job
  and cannot be forgotten.
- **In-page evaluators are locale-agnostic by construction** — `collectViolations`/
  `collectOverflow` know nothing about en vs nl, so adding a locale costs nothing, and the log's
  handoff notes state exactly this. Clean factoring for a two-baseline product.
- **Exemptions are documented where they are decided**, with their blind spots named
  (transform-scaled text; nothing today scales that way — extend the guard if one appears).
  This matches the project's culture of stating a trade-off's cost plainly rather than hiding it
  or over-engineering around it.
- **Zero production code changed to gain the guard.** No component edits, no data attributes
  added for testability, no new dependencies — the check observes exactly what the audience's
  browser observes, which is also why it can't drift from reality.
- **Fixture craft shows real debugging converted into setup**: score top-ups sized so no team
  eliminates mid-measure (D56 cited), `announce` unchecked to keep banners out of the DOM under
  measurement, a single-tile jeopardy board reaching the buzz display cheaply, and the
  finalists-set-but-question-pending distinction handled explicitly because the first draft got
  it wrong (narrated honestly in the log).
- **The existing-spec edits are all tightening**: stronger persistence predicates closing a hole
  CI genuinely caught; a visibility gate on a race that ate clicks; timeouts raised with the
  mechanism named; scenario 19 redesigned around an invariant (an expired base persists as
  `0:00` until resumed) instead of racing a delta. None of these loosen an assertion to get
  green — the anti-pattern §5.1 exists for.
- **The docs are executable, not aspirational.** The runbook's watch-for lines cite decisions
  and history (D8, D20, D46, D57, slice 5's dead-leaderboard bug, PRD 3 §9.2) rather than vibes;
  triage routes each finding to exactly one verdict; and build-order's rehearsal-only failure
  list was correctly *reduced* when two of its items became automated — spec and code moved in
  the same change, per agent-workflow §7.

---

## Recommended sequencing

1. Close the functional review's findings #1/#2 first (renormalise `authoring.spec.ts`, strip
   the BOM, repair mojibake in both files) — smallest change in the slice, and everything else
   is cheaper once the gate is trustworthy again.
2. Resolve the build-order/smoke-checklist overstatement (#3 there): either add the spawned-
   server relative-side half or reword the claim to match what's pinned.
3. Fold the arming stage into the uniform measurement path (finding #1 here / #4 there) while
   the file is open anyway from step 1.
4. The remaining minors — locator strength (#3, #4 here), the hidden-text policy (#5), the nav
   note (#6), the stale lint cast and the journey-count nit — are each one-liners; fold them into
   whichever future change touches each file next, per this project's stated tolerance for
   non-architectural polish deferred to the second touch.
