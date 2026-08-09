# Slices 0–4 — Code Review

**Companion to** [`slice-0-4-functional-review.md`](slice-0-4-functional-review.md), which
covers spec/requirement compliance. This document covers architecture, maintainability, test
quality, and process hygiene — the things that determine how safely slices 5–9 can build on top
of this code, independent of whether any individual behaviour is currently correct.

**Verdict up front:** the architectural discipline this project's docs demand is genuinely
present, not just asserted. `packages/domain` is pure, event sourcing has exactly one writer,
payload filters are real allowlists, and the mechanical enforcement (`architecture-rules.test.ts`
spawning a real linter subprocess, the `process.env` scanner, the action-catalogue transcription
test) all have real teeth. The gaps found here are normal for four fast-moving slices, not
evidence of the design breaking down: some duplication that should be collapsed before it drifts
twice, a handful of test-coverage holes that line up exactly with the functional review's bugs,
and small process/documentation hygiene items.

---

## Architecture — strengths worth preserving

These aren't findings, but they're worth stating plainly so slice 5 doesn't "simplify" them away:

- **Zero `packages/domain` I/O leakage**, verified directly (no drizzle/next/`@kwiz/db`/
  `process.env` imports, no internal `Date.now()`/`new Date()` calls — every timed function takes
  `now` as a parameter). This is what makes the domain test suite genuinely mock-free.
- **One dispatch module, thin route handlers.** Every `apps/web/app/api/**/route.ts` file is a
  few lines delegating to `apps/web/lib/server/actions.ts`; all validation, id-minting, and
  routing logic lives in exactly one place, matching PRD 1 §6.9's reversibility constraint.
- **The exhaustiveness pattern in `decide.ts`** (`const unhandled: never = command` in the
  default branch of the command switch) is a real discipline that will fail the build the moment
  a new `Command` variant is added without a handler — worth keeping and copying into any future
  similarly-shaped switch (e.g. a hypothetical future round-type dispatcher).
- **Comments cite decision/section numbers** (`D22`, `D35`, `D53`, `I8`) throughout
  `packages/domain` rather than pasting PRD prose — exactly what agent-workflow §8's anti-pattern
  table asks for, and consistently followed.
- **Test quality is generally high**: literal event arrays with no mocks, precise numeric
  assertions (the finale-clock suite in `reduce.test.ts` is a good example), narrowing test
  helpers (`refusal()`/`accepted()` in `decide.test.ts`) instead of loose truthy checks. A
  targeted sweep for shallow assertions (`expect(true).toBe(true)`, bare `.toBeDefined()`,
  `.not.toThrow()`) across all 35 test files found only 4 hits, and each was contextually
  meaningful, not filler.
- **CI and lint enforcement are real, not decorative.** `scripts/architecture-rules.test.ts`
  genuinely spawns `oxlint` as a subprocess against un-gitignored fixture files and asserts
  violations are reported; `scripts/check-no-process-env.mjs` genuinely walks the whole repo; a
  repo-wide grep confirms zero real `process.env` usage outside `packages/config/src`.

---

## Findings, by category

### Duplication that should be collapsed before it drifts

**1. Three independent hand-rolled tree-copy implementations, one of them unguarded**
`packages/db/src/instantiate.ts`'s `copyQuizTree` (template→game-copy), `authoring.ts`'s
`duplicateQuiz` (template→template, `authoring.ts:189-289`), and `export-write.ts`'s
`insertQuizTree`/`insertGame` (import) each independently walk
round→category→question→{answers,options,keywords,attachments} with their own id-remapping.
Only `instantiate.ts` uses the `pickShared(source, sharedKeys())` reflection pattern; `authoring.
ts:212-315`'s `duplicateQuiz` hand-lists every field per row instead. That means a column added
to a shared factory is protected by the column-parity guard on the copy-into-game path, but the
exact same failure mode (a hand-listed field silently dropping a new column) can reappear
unguarded in `duplicateQuiz`. **Recommend:** either extend `parity.test.ts` (or a sibling
reflection-based test) to also assert `duplicateQuiz`'s field lists are complete, or refactor it
to reuse `instantiate.ts`'s `pickShared`/shared-key constants.

**2. Guard-logic duplication in `decide.ts`**
- The "question not yet opened" check (`state === 'PENDING' || state === 'SKIPPED'`) is
  copy-pasted between `SUBMIT_ANSWER` (`:159-161`) and `SUBMIT_FOR_TEAM` (`:570-572`). Extracting
  a shared `hasNotOpened(play)` helper would also have made the functional review's finding #3
  (missing upper bound on `SUBMIT_FOR_TEAM`) visible by forcing the two call sites to state their
  bound symmetrically instead of independently.
- `command.teamIds.find((id) => !state.teams.has(id))` is duplicated between `SET_DO_WINNERS`
  (`:510`) and `SET_FINALISTS` (`:679`) — worth a shared `findUnknownTeam` helper.

**3. Duplicated option-shaping in `views.ts`**
The public multiple-choice options mapping (`{id, text}`, stripped of `isCorrect`) is written
out twice — once for the main-screen view, once for the player view (`:374-377`, `:592-595`).
A shared `publicOptions()` helper would remove the one place a future edit could add `isCorrect`
back in at only one of the two call sites, silently reopening the exact leak invariant 2 exists
to prevent.

**4. Inconsistent sort discipline between sibling board views**
`boardView()` sorts Jeopardy categories by `position` (`views.ts:172-178`); the master-only
`MasterBoardView` branch (`:818-832`) does not. It's currently masked because `packages/db`
happens to query pre-sorted rows, but `packages/domain` is documented to not depend on that —
worth making both branches sort explicitly so the guarantee doesn't rely on an incidental
property of the caller.

**5. `quiz-tree.ts` loads whole tables instead of scoping by parent id**
`loadQuizTree` (`packages/db/src/quiz-tree.ts:34-166`) selects every row of `jeopardy_category`,
`question`, `accepted_answer`, `question_option`, `question_keyword`, and `attachment` **across
the entire database** with no `WHERE` clause, then filters in memory by id-set membership. Its
sibling `export-read.ts`'s `collectQuizExport` solves the identical problem correctly, scoping
with `inArray(table.roundId, roundIds)`. Harmless at the documented scale (PRD 1 §2.1), but it's
an inconsistency between two near-identical loaders in the same package, and it scales with the
*total* number of quizzes ever authored rather than the one being loaded — the wrong axis as the
number of authored quizzes grows over a venue's lifetime. Recommend mirroring `export-read.ts`'s
pattern.

### Test coverage gaps (these are where the functional review's bugs live)

It's worth stating explicitly: every bug in the functional review's "Priority 1" section sits in
a code path with **zero** existing test coverage. This isn't a coincidence — it's the reliable
signal to prioritise future test-writing effort against, and it argues for treating "add the
missing test" as part of the fix for each finding rather than a follow-up:

- `decide.test.ts` has no case locking a `DSMTW_FINALE` question with an open turn, no case
  finishing/abandoning a game mid-question, no case calling `SUBMIT_FOR_TEAM` past `OPEN`, and no
  case closing a round with a question still open.
- `packages/db/src/attachments.ts` has **no test file at all**. None of
  `insertTemplateAttachment`, `findAttachmentFile` (the game-copy-then-template fallback), or
  `referencedChecksums` (the GC set union) are exercised anywhere. `authoring.ts`'s
  `setAttachmentVisibility` — which enforces invariant I3 ("only an image can be shown on player
  devices") — and `deleteAttachment` are likewise untested. This is precisely the class of thing
  CLAUDE.md §6 calls "invisible until it's embarrassing" (twenty phones playing an unintended
  audio clip is the literal failure I3 prevents).
- `packages/db/src/games.ts`'s dashboard/deletion helpers (`listGames`, `gameWinners`, `isStale`,
  `gameLoss`, `deleteGame`) have no direct unit test — `deleteGame`'s cascade is only indirectly
  proven via a schema-level FK test, and `gameWinners`'s tie-handling and `isStale`'s three
  branches are exercised nowhere.
- Every `includeAttachments: false` export test uses a quiz fixture with no attachments,
  which is exactly why the missing-media-reporting bug (functional review #4) went unnoticed.
- The column-parity guard (`parity.test.ts`) verifies schema-level parity between template and
  game-copy tables, but not that the *copy function itself* carries every value — a narrower
  guarantee than data model §7.2 describes, and the gap that lets `duplicateQuiz` (finding #1
  above) go unguarded.

### Process / documentation hygiene

- **A stray ESLint-flavoured comment in an oxlint-only codebase**:
  `apps/web/lib/server/singleton.ts:18-19` has both `/* eslint-disable-next-line no-var */` and
  `// oxlint-disable-next-line no-var` stacked on the same line, in a repo with no ESLint config
  at all. Trivial, but it's copy-paste residue worth deleting.
- **`withCode`'s doc comment overstates its own behaviour** (`packages/db/src/
  export-write.ts:302-311`): it claims to rewrite a `code` field "wherever one appears… at any
  depth," but the implementation only inspects the top level. Harmless today (both event types
  that carry `code` do so at the top level) but a latent trap for a future event type that
  nests one, with no test that would catch the resulting `UNIQUE constraint failed: game.code`
  regression.
- **`docs/spec/data-model.md` §1 disagrees with `docs/spec/protocol.md` §8.2** on which tables
  are projections (see functional review, Priority 3) — a normative-doc-vs-normative-doc
  disagreement that agent-workflow explicitly says should never be left standing.
- **`docs/smoke-checklist.md`'s slice-1 section is out of chronological order** in the file,
  appended after slices 0/2/3/4 instead of between 0 and 2 — a minor trap for a reader assuming
  the file reads top-to-bottom in slice order.
- **Two `ErrorCode` catalogue entries are dead** (`CHECKSUM_MISMATCH`, `IMPORT_COLLISION`) —
  the import flow uses a preview-first design instead of returning them as errors. Not
  necessarily wrong, but conventions §4 currently documents a contract the code doesn't
  implement.

### Minor code smells, no action required urgently

- `decide.ts` (1108 lines) and `views.ts` (1088 lines) are large single files, but both are
  internally well-decomposed (named helpers, section comments matching spec ordering) — flagged
  only because CLAUDE.md §9 explicitly permits compromising on decomposition, and these are the
  files closest to needing it if they grow further. Splitting `decide.ts` further would need care
  to preserve the compiler's discriminated-union exhaustiveness check.
- `MIN_TEAM_CONTRAST = 4.5` in `packages/domain/src/palette.ts:115` is a reasonable but invented
  threshold with no corresponding number in any spec document — worth a one-line note on where
  the number came from, per CLAUDE.md's general preference for sourcing constants rather than
  guessing them.
- `preflight.ts` reuses one `PreflightCode` for two distinct failure shapes (see functional
  review #15) — a maintainability smell as much as a UX gap, since a future consumer of the code
  can't distinguish the cases either.

---

## `any` / unsafe-cast audit

Zero real `any` usage found anywhere in `packages/domain` or `packages/db` (the oxlint override
that makes this an error is doing its job). The handful of `oxlint-disable-next-line
typescript/no-unsafe-type-assertion` comments found (`packages/domain/src/events/parse.ts:41`,
`events/payload.ts:213`, `packages/db/src/export-schema.ts:95`, `instantiate.ts:71`, one test
fixture in `append.test.ts:24`) each carry a substantive one-line justification tied to a real
TypeScript narrowing limitation — none read as lazy suppressions.

---

## Test suite health summary

| Package | Assessment |
| --- | --- |
| `packages/config` | Small, focused, tests the one thing that matters (fail-fast on bad env) |
| `packages/domain` | Excellent test discipline where it exists; gaps concentrated exactly where the functional review found bugs (finale lock/turn interaction, three lifecycle guards) |
| `packages/db` | Very thorough for schema/migration/append/replay/parity; `attachments.ts` and several `games.ts` helpers have zero coverage |
| `packages/export` | Round-trip test is genuinely cross-database and exercises collision/corruption/schema-version paths; the `includeAttachments: false` + real-attachments combination is untested, which is exactly where the missing-media bug lives |
| `apps/web/lib/server` | Real in-memory migrated DBs throughout, no mocked fetch/streams — matches the project's stated no-large-mocks philosophy |
| `apps/web` config surface | No unit tests expected/required for presentational components per CLAUDE.md §6; the domain logic it added (`preflight.ts`, `palette.ts`) is well-tested, including the hue-wheel order and the never-blocks guarantee |

---

## Recommended sequencing

1. Fix the critical finale-lock bug and add the four missing `decide.ts` guard tests in the same
   change — cheapest to fix now, before slice 5's control desk makes the missing states reachable
   from a live UI.
2. Add `attachments.ts` and `games.ts` test coverage before slice 8 needs to trust `deleteGame`
   and the reconciliation pass for real venue data.
3. Collapse the three tree-copy implementations (or at least extend the parity guard to cover
   `duplicateQuiz`) before a fourth copy path gets added in a later slice.
4. Reconcile `data-model.md` §1 and `protocol.md` §5.4's priority list against their own
   corrected/actual behaviour — cheap, and exactly the kind of drift that compounds if left for
   another slice to rediscover independently.
