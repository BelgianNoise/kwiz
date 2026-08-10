# Slice 5 — Code Review

**Companion to** [`slice-5-functional-review.md`](slice-5-functional-review.md), which covers
spec/requirement compliance for the master control desk (PRD 3) and the fixes made in response to
the previous review round. This document covers architecture, maintainability, and test quality.

**Verdict up front:** the fix pass on the slice 0–4 findings was thorough and, in several cases,
better than the originally-suggested fix — e.g. closing the `CLOSE_ROUND`/open-question gap by
preventing the bad state at the source (`CLOSE_ROUND` now refuses while its question is `OPEN`)
rather than patching the guard that would otherwise have needed to detect it after the fact.
Slice 5's own code continues the project's established discipline (pure domain, one dispatch
path, real tests over mocks), and where it introduces duplication, that duplication is exactly
where this review's two critical findings live — a pattern worth internalising for slice 6.

---

## The fixes, structurally

Two of the eight code-review findings from the prior round were fixed with a genuinely better
mechanism than what was originally suggested, worth calling out because the *shape* of the fix
matters for future slices:

- **`duplicateQuiz` no longer hand-lists fields.** It now imports and reuses the exact
  `pickShared`/`*_KEYS` constants `instantiate.ts`'s `copyQuizTree` already established
  (`packages/db/src/authoring.ts:198-277`, importing from `instantiate.ts:17-25`). A column added
  to a shared factory is now protected on **both** copy paths by construction, not just the
  template→game one. This is the right fix — reuse, not a parallel guard — and it's the pattern
  to reach for the next time two functions solve the same "carry every shared column" problem.
- **The post-copy invariant validation (functional review's finding #6, prior round) runs inside
  the same transaction as the copy itself** (`packages/db/src/instantiate.ts:126-160`,
  `assertValidCopy`), not as a separate check a caller could skip. Any future entry point that
  creates a game gets this for free rather than needing to remember to call a validator.

---

## Findings

### 1. [Root cause of Priority 1 finding #2] The "next pending question" selector is duplicated four times, and the duplication is why the round-boundary dead-end wasn't caught

**Where:** `apps/web/components/control/leaderboard.tsx:49`,
`apps/web/components/control/question-desk.tsx:454`,
`apps/web/components/control/finale-desk.tsx:203`, and an inline equivalent check in
`apps/web/components/control/timeline.tsx`

All four independently write `view.timeline.find((entry) => entry.state === 'PENDING')`. This is
the exact logic implicated in the functional review's critical finding #2 — the search is scoped
to the current round's timeline in all four places, so the round-boundary dead-end is really one
bug that had to be (and wasn't) fixed in four places at once.

**Recommend:** extract a single `nextPendingQuestion(view)` helper (or, once the functional fix
lands, a `nextAction(view)` that falls back past the current round) and have all four call sites
use it. This makes the eventual fix a one-line change instead of four synchronised ones, and
removes the risk of the four call sites drifting further apart than they already have (they're
not even textually identical today).

### 2. Dead ternary branch

**Where:** `apps/web/components/control/question-desk.tsx:373`

```tsx
{spotlightable ? (<Button .../>) : revealed ? null : null}
```

Both branches of the inner ternary return `null`. Simplify to `{spotlightable ? (<Button .../>) : null}`.

### 3. `header.tsx`'s skip-question guard doesn't mirror the domain's actual legality window

**Where:** `apps/web/components/control/header.tsx:105-112`

`disabled={!currentQuestionId || !live}` — per the functional review's finding #5, this stays
enabled against `LOCKED`/`REVEALED`/`SCORED` questions, where the domain layer will refuse with
`QUESTION_NOT_OPEN`. Harmless (the refusal is typed and correct) but the UI's disabled-state
doesn't match the rule it's supposedly expressing.

**Recommend:** `disabled={!live || !(view.question?.state === 'PENDING' || view.question?.state === 'OPEN')}`.

### 4. `keys.tsx`'s docstring overclaims completeness

**Where:** `apps/web/components/control/keys.tsx`

The module comment frames the file as *the* place to check "never bind X" against, but `Esc`'s
"close a popover, nothing else" behaviour is actually enforced by Radix's `Popover` component,
not by anything in this file. Not a bug — traced and confirmed `Esc` genuinely does nothing
else — but worth a one-line caveat so a future auditor grepping this file alone for `Escape`
doesn't wrongly conclude it's unbound.

### 5. `views.sentinel.test.ts` wasn't extended for slice 5's eleven new `MasterControlView` fields

**Where:** `packages/domain/src/views.sentinel.test.ts`

None of `timeline`, `adjustments`, `break`, `scoreboardShown`, `controlScreens`, `finaleRanking`,
`spotlit`, `failsPreflight`, `clocks[].eliminatedAt`, or `missedSoFar` appear in the sentinel
table. This isn't a leak — every one of these targets `MASTER_CONTROL` only, and the sentinel
test's actual job (catching a secret reaching `MAIN_SCREEN`/`PLAYER`) is unaffected — but it's
worth a note in the test file itself, since the project's own convention (CLAUDE.md §2.3 /
protocol §6.2) is "add a sentinel when you add a secret," and a reader might otherwise assume this
table is kept in lockstep with every payload change rather than only ones that cross an audience
boundary.

---

## What's strong, worth preserving

- **The critical finale-turn fix is structural, not a patch.** `endOpenFinaleTurn(state)` is
  called from every place a finale question can stop being `OPEN` (`LOCK_QUESTION`,
  `SKIP_QUESTION`), rather than adding a special case only where the bug was first noticed. The
  one caveat: there's no compiler-enforced link between "a transition ends a finale question" and
  "call `endOpenFinaleTurn`" — a future transition that can end a question (there isn't one
  today) would need to remember this by convention. Worth a comment at `FinaleTurn`'s type
  definition pointing future authors at the two current call sites.
- **`decide.ts`'s guard duplication (prior review's finding) was fixed with shared helpers**
  (`requireOpen`, `requireKnownTeams`) rather than a second copy-paste — exactly the kind of fix
  that prevents the underlying pattern (two call sites, one rule, no shared function) from
  recurring, which finding #1 above shows is still possible to miss.
- **Test quality remains high.** Spot-read `master-control-view.test.ts`, `use-reorder.test.ts`,
  and `transfer.test.ts`: all assert on specific, non-trivial behaviour (validation carrying full
  question context, `missed` being `null` pre-game vs. computed post-game, the pinned-finale
  keyboard-reorder refusal, a genuine corrupted-export fixture rather than a happy-path-only
  case). `decide.test.ts`'s new finale-lock test is a good example of a *precise* regression test:
  it starts a turn, locks the question, and asserts the exact events, the exact remaining
  seconds, and that a fresh turn-start afterward is real rather than a no-op — not just "doesn't
  throw."
- **No `any` introduced**, no unexplained `oxlint-disable` added in this slice's diff.
- **`controlScreens` is handled with real architectural care**: it's the one field on any pushed
  view that isn't a pure function of `GameState`, and the implementation makes that explicit both
  in a comment and in how it's threaded through (`notifyOthers` in `transport.ts`, passed into
  the view builder as a parameter rather than stored). This is exactly the discipline CLAUDE.md
  §2.4 and protocol §5's "views are idempotent, no game logic in the client" principle ask for,
  applied to a genuinely awkward exception.
- **`useLiveView` centralising the client-side transport** (rather than each surface re-deriving
  SSE handling) is a good call ahead of slices 6 and 7, which will consume the same pattern for
  the main screen and player device. The one documented exception (`live-teams.tsx`) is real and
  narrow, not a crack in the pattern.

---

## Recommended sequencing

1. Fix the two critical functional findings (the `FINISH` confirmation gap and the round-boundary
   sweep dead-end) together — they're related in root cause (both live in the advance/timeline
   logic) and in symptom (a master with no safe primary action reaches for `Enter`).
2. While in that code, extract the shared `nextPendingQuestion`/`nextAction` helper (finding #1
   above) so the fix is one change, not four.
3. Add the finale desk's missing media controls (functional review #3) and the protocol.md
   `VALIDATE_QUESTION` shape correction (functional review #4) — both small, independent, and
   cheap to close before slice 6 inherits either gap.
4. The minor items (5-9 in the functional review, 2-5 here) are cheap cleanup, worth doing in the
   same pass rather than carrying them into a third review round.
