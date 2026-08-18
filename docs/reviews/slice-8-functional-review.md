# Slice 8 — Functional Review

**Companion review to** [`slice-7-functional-review.md`](slice-7-functional-review.md) /
[`slice-7-code-review.md`](slice-7-code-review.md). This document covers slice 8 — post-game
review & correction (PRD 2 §13), plus the small player-surface addition PRD 5 §15 O3 (a finished
game's code shows final standings) deferred from slice 7. Build-order's other three slice-8
bullets (settings, orphaned-attachment reconciliation, an export/import round-trip test) had
already shipped in slice 4; this slice correctly recognised that and focused on what was actually
left.

**Reviewer:** independent audit, same method as the previous four rounds — ground truth confirmed
directly (`pnpm check`: 724 tests / 47 files, green), PRD 2 §13 and PRD 5 §15 re-read in full, and
a set of parallel deep-dive agents each re-verifying claims against the actual current code.

## Verdict

**This is a smaller, cleaner slice than the previous four, and it shows.** The one substantial
new domain module (`packages/domain/src/review.ts`) is pure, well-reasoned, and its trickiest rule
— what counts as an auditable "correction" versus an ordinary first judgement — is implemented
exactly as specified and tested against all four scenarios that rule has to get right. Both bugs
the implementing agent's own build-and-drive process found (a revoked keyword mark blocking
re-marking, a team-name field able to show an unsaved value) are genuinely fixed, with a real,
targeted regression test for the trickier one.

**This audit found one MAJOR gap and several smaller ones**, all narrower in scope than prior
rounds' findings — consistent with a smaller slice. The standout is a real regression against PRD
5 §15 O3's own stated three-way distinction: an abandoned game's code currently reads identically
to a code that never existed, even though a purpose-built message for exactly this case already
exists elsewhere in the codebase and simply isn't wired into this path.

---

## Priority 1 — Fix before slice 9

### 1. [MAJOR] An abandoned game's code is indistinguishable from a code that never existed

**Where:** `apps/web/app/[locale]/play/[code]/page.tsx`

PRD 5 §15 O3 explicitly resolves three outcomes for reopening a game's code: `FINISHED` shows the
final standings, `ABANDONED` gets "a bare message," and an unknown code gets the plain
explanation — "**neither** is an error page" language that only makes sense if `FINISHED` and
`ABANDONED` are visibly different from each other, not just both different from an error page.

The current routing only branches on `status === 'FINISHED'`:

```ts
const ended = findEndedGameByCode(runtime.database, code)
const finished = ended?.status === 'FINISHED' ? runtime.registry.get(ended.id) : null
if (ended && finished) { return <FinalStandings ... /> }
return <NoSuchGame code={code} />
```

An `ABANDONED` game falls through to the exact same `<NoSuchGame>` component, with the exact same
copy ("No quiz with that code... it may have finished, or the code may be slightly off") as a code
that was never valid at all. A purpose-built message already exists for precisely this
case — `game.abandoned: 'The quizmaster ended this quiz.'` — and is explicitly commented as being
for O3, but it's currently only wired into the live-SSE-disconnect path (`player-stage.tsx`), not
into this code-revisit path. The slice's own log entry describes testing "a finished code reaches
the standings, and a nonsense code still reaches the plain explanation" but never mentions
checking the abandoned case — this reads as a genuine gap, not a recorded, deliberate omission.

**Recommend:** branch on `ended.status === 'ABANDONED'` separately and render the existing
`game.abandoned` message rather than falling through to `NoSuchGame`.

---

## Priority 2 — Worth fixing soon

### 2. [MEDIUM] The finale-clock "freeze at endedAt" regression test cannot actually catch a regression

**Where:** `packages/domain/src/review.test.ts` ("freezes a survivor's remaining seconds once the
round has ended")

The code itself appears correct by direct inspection: `review.ts` reads a survivor's remaining
seconds using `state.finale.endedAt ?? now`, which is exactly the freeze the review needs (so
reopening a finished game's review doesn't show a different number each time). But the test built
to guard this property constructs a fixture where the surviving team's turn is explicitly closed
by `TURN_ENDED` *before* the game ends. Once a turn has an `endedAt`, `finaleRemainingSeconds`'s
computation stops consulting `now` entirely — so the test's two assertions (computed at
`now = 100_000` and `now = 9_000_000`) would produce identical output whether or not the freeze
logic exists at all. The scenario the freeze actually exists to guard — a survivor whose *final*
turn is still open (no `TURN_ENDED`) when the round ends, which is a real and reachable game state
since `END_FINALE` never synthesizes a closing `TURN_ENDED` for the winner — is never exercised.

**Recommend:** add (or change) a test where the surviving team's last turn has no `TURN_ENDED`
before `FINALE_ENDED` fires, and confirm the two-`now`-values comparison actually diverges without
the freeze and agrees with it.

### 3. [MINOR] Two related I15/parity coverage gaps, neither introduced by this slice but both touched by it

**Where:** `packages/db/src/projection-parity.test.ts`

- `corrections` (the new counter on `AnswerState`) is architecturally I15-safe by construction (no
  DB column exists for it; it's folded purely in-memory on every replay), but the parity test
  suite's shared `Row` comparison type doesn't include it, so the "writer and reducer agree" test
  suite — which already has a case that's precisely a correction-triggering verdict flip — doesn't
  actually assert on it.
- `TEAM_ELIMINATED`'s projection write (`gameTeam.eliminatedAt`) has no db-vs-domain parity test
  anywhere, despite being exactly the kind of small write CLAUDE.md's parity-guard philosophy
  exists to catch. Pre-existing gap, not a regression, but this slice added the surrounding finale
  parity tests (for the keyword-mark bug) and didn't extend the same treatment here.

### 4. [MINOR] The played round-trip test — genuinely thorough otherwise — never exercises real attachment bytes

**Where:** `packages/export/src/played-round-trip.test.ts`

The new test is a strong addition: two rounds, a correction, a standing and a revoked adjustment,
a finale with a mark/unmark/reveal sequence that specifically re-exercises the keyword-mark bug's
exact collision path, an elimination, and a genuine I15-style rebuild-and-compare rather than a row
count. But `attachments: []` is passed at both export calls — no attachment ever round-trips
through this test, and the pre-existing `round-trip.test.ts` has the same gap (it tests corrupt/
missing-attachment edge cases but never a successful byte-for-byte round trip of a real file). This
is a standing gap in the whole export test suite that this slice's "the thorough version" framing
doesn't quite deliver on.

---

## Priority 3 — Minor

| # | Finding | Where | Note |
| --- | --- | --- | --- |
| 5 | A real lint warning (`no-shadow`) is present in the current codebase, a live violation of the project's own stated "pnpm lint produces zero output, warnings included" bar | `packages/db/src/games.test.ts` | A nested `describe` block redeclares an already-in-scope `database` variable with a functionally redundant `beforeEach` — dead duplicated setup, not a deliberate isolation measure. Cheap to delete |
| 6 | `toGameReview` — documented as "CONFIG audience, deliberately unfiltered, the master looking at their own machine" — is also called from the new anonymous, unauthenticated player route | `packages/domain/src/review.ts`, `apps/web/app/[locale]/play/[code]/page.tsx` | No live leak found (the call site immediately narrows to a small, already-public shape), but the safety of this path now rests on the caller's narrow destructuring rather than a type-level filter — the exact fragile pattern CLAUDE.md §2.3 warns against. Worth a docstring update acknowledging the second caller, or switching the fallback to call `standings()` directly rather than the full unfiltered review object |
| 7 | The smoke-checklist describes the review entry point as reached via "`⋯ → Review & correct`," but it's actually a standalone button next to the overflow menu, not inside it | `apps/web/components/admin/game-detail.tsx`, `docs/smoke-checklist.md` | Cosmetic documentation drift; someone following the checklist literally looks in the wrong place |

---

## What was verified as genuinely correct in slice 8

- **The "what counts as a correction" rule is implemented exactly as specified.** It compares
  whether a verdict change alters the *points outcome* (`verdictAwardsPoints`), not the verdict
  label — confirmed against all four scenarios that distinction has to get right:
  `AUTO_CORRECT → ACCEPTED` (a confirmation, correctly doesn't count),
  `PENDING → anything` (a first judgement, correctly doesn't count),
  `AUTO_CORRECT → DENIED` and `ACCEPTED → DENIED` (genuine reversals, correctly do count) — each
  with an explicit test.
- **Both self-reported bugs are genuinely fixed.** The keyword-mark upsert fix was traced in
  detail: `KEYWORD_MARKED`/`KEYWORDS_REVEALED` now correctly upsert against the unique index
  rather than colliding with a revoked row, `revokedAt: null` is explicitly written to revive the
  row, and a dedicated regression test exercises the exact mark→unmark→remark sequence the bug
  came from — including confirming the rebuilt projection matches a fresh live write (I15). The
  team-name stale-value fix is confirmed present and correctly implemented via a
  server-confirmed-value-only remount key.
- **The finale review's three keyword states are genuinely distinct** — credited to a team,
  revealed-and-unguessed ("nobody"), and never-reached — not folded into two, with a revoked mark
  correctly falling back to "never reached" rather than lingering as a stale credit.
- **`findEndedGameByCode` is correctly ordered relative to the live-game lookup**, with an explicit
  test proving a recycled game code resolves to *tonight's* live game rather than *last night's*
  finished one, and (separately) to the *newest* historical match when multiple ended games share
  a code.
- **The finale review's real-timestamp arithmetic is correct** (verified by hand-tracing the
  starting-bank, turn-charge, and penalty computations against the actual numbers the tests
  assert), independent of the one vacuous sub-test (finding #2).
- **No redirect-loop risk was reintroduced** by the new player-facing code path — the
  finished/abandoned/nonexistent-code branches are all server-rendered with no client-side
  navigation or device-token dependency, and none of the three files implicated in slice 7's
  critical `UNKNOWN_DEVICE` bug were touched by this slice.
- **`GET /api/games/:id/validation-queue`'s removal from the protocol spec is a genuine,
  well-reasoned edit**, not a silent drop — the spec document itself carries the reasoning
  (superseded by the pushed round-end sweep plus this slice's own review grid), and the route
  genuinely doesn't exist in code either.
- **The new decision D59** (a pushed leaderboard legally covers an open question; a break does
  not) is genuinely recorded in PRD 1's decision log with a coherent rationale, closing an item
  the slice-6 review round had left open.
- **`review.ts` remains pure and correctly excluded from the sentinel-tested view enumeration**,
  exactly as documented — confirmed by reading its imports and by confirming
  `views.sentinel.test.ts` doesn't reference it.
