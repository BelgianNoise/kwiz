# Slice 8 — Code Review

**Companion to** [`slice-8-functional-review.md`](slice-8-functional-review.md), which covers
spec/requirement compliance for post-game review & correction (PRD 2 §13) and the PRD 5 §15 O3
addition. This document covers architecture, maintainability, and test quality.

**Verdict up front:** this slice is architecturally the cleanest of the five reviewed so far —
one well-scoped pure domain module, a REST route that doesn't leak into any pushed audience, and
two genuinely-fixed bugs each with a proportionate regression test. The findings here are minor
polish items and one real test-adequacy gap (a test that can't fail even when it should), not
structural problems.

---

## Findings

### 1. The finale-clock freeze test doesn't test what it claims to

**Where:** `packages/domain/src/review.test.ts`

Covered in the functional review as finding #2 — worth restating here as a code-quality point
specifically: this is a test that reads as coverage but provides none, because the fixture happens
to close the code path the freeze logic would otherwise need. It's a useful reminder for future
tests of derived, time-dependent values: asserting "the same input produces the same output at two
different `now` values" only proves something if the code path under test actually *would* consult
`now` in the absence of the fix — worth a habit of tracing which branch a fixture actually
exercises before trusting a "computed at two different times" test to mean what it looks like it
means.

### 2. `corrections` isn't included in the parity-test comparison type, despite an existing test case that specifically exercises it

**Where:** `packages/db/src/projection-parity.test.ts`

The shared `Row` interface used by every "writer and reducer agree" case in this file omits the
new `corrections` field, even though one of the existing cases ("a master validation reversing an
auto-verdict") is precisely a correction-triggering flip. Adding one field to an existing,
already-passing comparison type would give this new counter real I15 coverage at essentially no
cost — a cheap addition rather than a new test to write.

### 3. `KEYWORD_UNMARKED`'s projection handler is defensively asymmetric with its sibling revoke handler

**Where:** `packages/db/src/projections.ts`

`SCORE_ADJUSTMENT_REVOKED`'s handler explicitly guards against re-revoking an already-revoked row
(`WHERE revokedAt IS NULL`), making a duplicate revocation a safe no-op at the projection layer.
`KEYWORD_UNMARKED`'s handler has no equivalent guard — currently safe only because `decide.ts`
already refuses a second `UNMARK_KEYWORD` against a live mark before the event is ever produced.
Both handlers solve the same "revoke, never delete" pattern in the same file; one defends against
replay ordering at its own layer and the other relies entirely on upstream discipline. Not a bug
today, but worth either a matching guard for consistency, or a one-line comment on the
`KEYWORD_UNMARKED` handler noting the guard lives in `decide.ts` instead, so a future reader
doesn't wonder why the two look different.

### 4. `toGameReview`'s documented audience contract no longer describes all of its callers

**Where:** `packages/domain/src/review.ts`, `apps/web/app/[locale]/play/[code]/page.tsx`

Covered in the functional review as finding #6 — restated here because it's specifically a
documentation/architecture-boundary issue rather than a live bug: the module's own docstring
justifies zero field filtering with "the master authored all of this and is looking at their own
machine," which was true when it had one caller. It now has two, one of them a public,
unauthenticated route. Nothing leaks today because the second caller narrows the result to an
already-public shape immediately — but that safety property lives entirely in the caller's
discipline, which is exactly the fragile pattern CLAUDE.md §2.3 warns against for payload filters
generally. Worth closing either by updating the docstring to acknowledge the second caller
explicitly, or (cleaner) having the player-facing fallback call `standings()` + `state.teams`
directly rather than routing through the CONFIG-only object at all.

### 5. `review-teams.tsx` doesn't gate its inputs during an in-flight write, unlike its sibling review components

**Where:** `apps/web/components/admin/review-teams.tsx`

`ReviewGrid` and `ReviewAdjustments` both receive a `busy` string and disable their controls while
a round trip is outstanding. `ReviewTeams`'s rename/recolour inputs have no equivalent gating, so a
fast double-edit before the first request resolves could fire two writes in quick succession. Low
risk for a single-master, sequential-UI product, but it's an inconsistency with a pattern this
same slice applied correctly two components over.

### 6. A live lint warning, from redundant duplicated test setup

**Where:** `packages/db/src/games.test.ts`

Already covered in the functional review (finding #5) as a process-hygiene regression against the
project's own "zero lint output" bar — restated here as what it actually is in code terms: a
nested `describe` block redeclares an already-in-scope `database` variable with its own
functionally identical `beforeEach`, which is simply dead, duplicated setup rather than a
deliberate test-isolation measure. Deleting the inner declaration and `beforeEach` (letting the
outer binding serve the nested block, as every other `describe` in the file already does) removes
both the warning and the duplication in one change.

---

## What's strong, worth preserving

- **`review.ts`'s "what counts as a correction" logic is a model of getting a subtle rule
  precisely right on the first attempt** (per the slice's own log, the first draft compared verdict
  *labels* and over-counted; the fix — comparing whether the *points outcome* changed — is the kind
  of distinction that's easy to get wrong and expensive to discover in front of a master reviewing
  a real game). The four-scenario test coverage for this rule is exactly the shape CLAUDE.md §6
  asks for.
- **The keyword-mark bug fix is a genuine architectural insight, not a patch.** The bug was framed
  correctly in the log as "a state the log could express and the projection could not, which is
  what I15 forbids" — i.e., the fix isn't just "handle this one case," it's restoring the general
  guarantee that anything `decide.ts` permits, the projection layer must also be able to represent.
  The regression test reconstructs the exact real-world sequence (mark→unmark→remark) rather than a
  minimal synthetic repro, which is what makes it a genuine regression guard rather than a
  box-ticking exercise.
- **The played-round-trip test's comparison method is the right one**: a real rebuild-and-compare
  of the whole review object, not a row count — this is exactly the shape of assertion that would
  have caught the keyword-mark bug had it existed before the fix (confirmed: the fixture's
  unmark-then-reveal sequence re-exercises the same collision path).
- **`review.ts` staying out of `views.ts` and out of the sentinel-tested audience enumeration is
  the right architectural call, correctly executed.** It's a genuinely different kind of view (full
  access, REST-loaded, CONFIG audience) from the three leak-checked pushed views, and keeping it a
  separate module — rather than folding it into `views.ts` "for consistency" — is exactly what
  prevents someone later relaxing the sentinel test to accommodate it.
- **No new `any` or lint suppressions anywhere in this slice's diff** — checked across all 29
  changed files.
- **The typed-client pattern continues to hold**: the new `review()` call in `lib/client/api.ts`
  follows the same shape as its siblings, and the player-facing standings page correctly bypasses
  the client module entirely in favour of calling the pure domain function directly from a server
  component — architecturally consistent with D2, not a violation of it.

---

## Recommended sequencing

1. Fix the functional review's MAJOR finding (the abandoned-game message) first — it's a small,
   isolated branch addition using a message that already exists.
2. Fix the vacuous freeze test alongside it, since both concern the same finale-ending code paths
   and the fix for one makes it easy to verify the other while already in that area.
3. The `corrections`-in-parity-test and `TEAM_ELIMINATED`-parity-test additions are cheap and
   independent — fine to batch together as one small test-coverage PR.
4. The remaining minor items (the lint warning, the `review-teams.tsx` busy-gating inconsistency,
   the `toGameReview` docstring/architecture note, the stale comment, the smoke-checklist
   correction) are all small enough to fold into whichever change touches each file next.
