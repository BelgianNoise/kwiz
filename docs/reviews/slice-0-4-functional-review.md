# Slices 0–4 — Functional Review

**Reviewer:** independent audit (5 parallel deep-dive agents, one per package/surface, each
re-reading the normative specs directly and verifying every slice-log claim against the actual
code rather than trusting it)
**Scope:** everything on `main` through commit `bdfe87b` (Slice 4 — the config surface, PR #5) —
i.e. `packages/config`, `packages/domain`, `packages/db`, `packages/export`, `apps/web`'s
transport layer, and the full PRD 2 config/authoring surface.
**Ground truth confirmed independently:** `pnpm check` passes clean — 535 tests across 35 files,
`oxlint --type-aware` silent, `oxfmt --check` clean, `tsc --noEmit` clean across all 5 packages.

## Verdict

**This is a strong, faithful implementation.** The architectural discipline the CLAUDE.md/spec
set demands — domain purity, event sourcing with a single writer, constructive payload
allowlists, zod at every boundary — holds up under direct inspection, not just under the
self-reported slice-log. The two historical bugs the slice log claims to have found and fixed
(buzz crediting nobody, the two buzz-outcome halves disagreeing) are genuinely fixed and now
guarded by tests. Slice 4's self-audit (two passes finding 10 gaps) is real work, and every one
of those ten fixes was independently re-verified here and holds.

That said, this audit found **one critical bug and several major gaps** that the four slices'
own gates (`pnpm check`, manual smoke-testing) did not and could not catch, because in every
case the missing behaviour is exactly the untested corner. None of them are "the code disagrees
with the spec and nobody noticed" in the CLAUDE.md §10 sense — they read as implementation gaps
in code that otherwise tracks the spec closely, concentrated in the places test coverage is
thinnest. **Recommend fixing the critical and major items before slice 5 builds control-desk UI
on top of them** — several are latent until a live master-control screen makes the missing state
reachable.

---

## Priority 1 — Fix before slice 5

### 1. [CRITICAL] Locking a `DSMTW_FINALE` question never ends the active turn

**Where:** `packages/domain/src/decide.ts` (`LOCK_QUESTION`, `MARK_KEYWORD`), `reduce.ts`
(`QUESTION_LOCKED` handler), `derive.ts:303-306` (`currentFinaleTurn`)

`TURN_ENDED.reason` declares a `'QUESTION_CLOSED'` member (`state.ts:182`,
`events/payload.ts:154`) that is **never produced anywhere in the codebase** — confirmed by
grep across all of `packages/domain/src`. `decide.ts`'s `LOCK_QUESTION` has no finale-awareness
at all, and `MARK_KEYWORD` never ends the marking team's turn even when the 5th keyword is
found. Per PRD 3 §10.2, marking is not supposed to pause the clock — only a handover is — but
*locking the question* is a handover the code doesn't recognise as one.

**Consequence:** because `currentFinaleTurn` finds "the last turn with no `endedAt`" globally
(not scoped to the current question), a team mid-turn when the master locks the question — the
common case, since being mid-turn usually means they just found the deciding keyword — leaves a
dangling open turn. If that team is due to go first on the next question (plausible — being
mid-turn correlates with having few seconds left), `START_TURN`'s no-op guard
(`decide.ts:699`, `open?.teamId === command.teamId`) treats the new start as a repeat, and the
**stale `turnStartedAt` from the previous question keeps draining their clock with no new
`TURN_STARTED` event**. If a different team starts next, the dangling turn is silently closed
but mislabelled `PASSED` in the audit trail rather than `QUESTION_CLOSED`.

This directly breaks D52 ("a restart mid-turn recovers every clock exactly") and PRD 3 §10.5
("clocks stop while nobody is on turn"). Untested: no case in `decide.test.ts` or
`reduce.test.ts` locks a finale question with a turn still open.

**Recommend:** `LOCK_QUESTION` (and any other finale-question-ending transition) should append
`TURN_ENDED { reason: 'QUESTION_CLOSED' }` for whichever team is currently on turn, before or
alongside the lock event, if `currentFinaleTurn` is open at that moment.

---

### 2. [MAJOR] `Attention.SCORE_DO` omits everything the master needs to actually score

**Where:** `packages/domain/src/views.ts:746` (type), `:1005-1007` (builder)

Protocol §5.5 specifies `DoScoringDetail` — `scoringMode`, `tiePayout`, `masterNotes`, and each
team's current score — as the payload for the `SCORE_DO` attention state. The implemented type
carries only `gameQuestionId`. `masterQuestionDetail()` never reads `question.config`
(`doConfigSchema` is imported nowhere in `views.ts`), so **a master-control client cannot tell
`WINNER_TAKES_ALL` from `PER_TEAM_SCORE`, or the `SPLIT`/`FULL` payout, from the pushed view at
all.** PRD 3 §8 requires two visually distinct desks driven by exactly this distinction. This
will block slice 5's `DO` scoring UI from being built correctly against the documented payload
shape — worth fixing now rather than discovering it mid-slice-5.

---

### 3. [MAJOR] Three missing/incomplete lifecycle guards in `decide.ts`

All three are real gaps in `packages/domain/src/decide.ts`, none flagged in slice-log, none
covered by a test:

- **`FINISH_GAME`/`ABANDON_GAME` (`:252-262`) have no open-question guard**, and
  `SUBMIT_ANSWER`/`BUZZ` never call `requireLive` at all. A game can be finished or abandoned
  mid-question, and players can go on submitting and buzzing indefinitely afterwards — with
  `LOCK_QUESTION`/`ADJUDICATE_BUZZ`/`SCORE_QUESTION` now blocked by `GAME_NOT_LIVE`, the
  question becomes permanently un-closeable.
- **`SUBMIT_FOR_TEAM` (D47, `:562-594`) has no upper-state bound**, unlike ordinary `submit`
  (`:164-166`, which denies anything not `OPEN`). The master's proxy-submit action is legal
  against `LOCKED`/`REVEALED`/even `SCORED` questions, silently changing a team's score with no
  new `QUESTION_SCORED` event to signal the change happened.
- **`CLOSE_ROUND` (`reduce.ts:143-150`) clears `currentQuestionId` but not `play.state`**, and
  `OPEN_QUESTION`'s single-open-question guard reads through `currentQuestionId` — so a question
  left open when its round closes becomes invisible to the guard, and a second question in a
  later round can open while it's still technically live.

**Recommend:** add `requireLive`/open-question checks symmetric with the guards that already
exist on the equivalent actions, and add the three missing test cases (locking a finale
mid-turn, finishing a game mid-question, `SUBMIT_FOR_TEAM` past `OPEN`, closing a round with an
open question) — these are exactly the corners `decide.test.ts` doesn't yet reach.

---

### 4. [MAJOR] Export-without-attachments silently drops the missing-media report it exists to provide

**Where:** `packages/db/src/export-read.ts:126-146` (`collectQuizExport`)

PRD 2 §14.1 states plainly: unticking "include attachments" should still produce a zip that
**imports with clearly-marked missing media**, per protocol §8.1's per-file checksum reporting.
The manifest's `attachments[]` list — the thing that reporting depends on — is only populated
`if (options.includeAttachments)`. When the box is unticked, `manifest.attachments = []` and
`manifest.counts.attachments = 0`, so on import the missing-attachment loop
(`packages/export/src/zip.ts:189-209`) iterates an empty list and produces **zero**
`missingAttachments` entries — not because nothing is missing, but because the manifest never
said anything was expected. The master gets no signal at all, which is precisely the failure
this feature exists to prevent. No test exercises `includeAttachments: false` against a quiz
that actually has attachment rows (`round-trip.test.ts`'s false-includeAttachments cases all use
`seedQuiz()`, which never creates one).

**Recommend:** `collectQuizExport` should always populate the manifest's attachment list from
the referenced rows regardless of the toggle; only the byte-embedding step should be
conditional.

---

### 5. [MAJOR, low-probability, self-healing] `Reclaim space`'s stated safety reasoning is wrong for a fresh, non-duplicate upload

**Where:** `apps/web/lib/server/settings-actions.ts`

The code comment's safety argument only actually holds for the *duplicate-reuse* case (a second
upload of an already-stored checksum). For a genuinely new upload, a reclaim pass whose
referenced-checksum snapshot was taken *before* the new row's insert can delete that upload's
just-written file — a snapshot-staleness bug, not the request-interleaving race the comment
argues against (that angle was checked and ruled out; Node's microtask semantics rule it out).
Recoverable — pre-flight's `ATTACHMENT_MISSING` check would catch the resulting dangling
reference — so this is not urgent, but the comment's justification for "this is fine" is
incorrect and should either be fixed in code (snapshot inside the same transaction the insert
uses) or corrected in the comment so a future reader doesn't rely on reasoning that doesn't
hold.

---

### 6. [MAJOR] `packages/db`: no post-copy invariant validation

**Where:** `packages/db/src/instantiate.ts` (`createGameFromQuiz`, `resyncGame`)

Data model §7's last bullet is explicit: *"Copies are validated after writing, not trusted: the
same zod/invariant checks that guard authoring run against the copy… a copy bug… should fail at
creation, in front of the master, not mid-round in front of a room."* Neither
`createGameFromQuiz` nor `resyncGame` calls `preflight()` (which already exists in
`@kwiz/domain`) or any other invariant check against the freshly-copied rows.
`POST /api/games` calls `createGameFromQuiz` directly with no server-side pre-flight gate — the
only check today is the UI-level pre-flight screen the master can look at before clicking
"create game," which a hand-crafted request bypasses entirely. This is the one clear normative
gap in an otherwise very well-covered package.

---

### 7. [MAJOR] Missing `Alt+↑/↓` keyboard reorder binding (PRD 2 §15.2, §6.1)

**Where:** `apps/web/components/admin/{quiz-editor,question-set-editor,finale-editor}.tsx`

§15.2 requires reordering via drag **and** `Alt+↑/↓` on a focused row; §6.1's finale-pin
acceptance test names `Alt+↓` explicitly, requiring the keyboard route to refuse identically to
the drag route "or the keyboard becomes a way around the rule." What's built is mouse-clickable
`↑`/`↓` buttons sharing the same refusal predicate as drag-and-drop (so the *refusal logic*
can't drift) — but there is no `keydown` listener anywhere binding the literal `Alt+ArrowUp`/
`Alt+ArrowDown` chord for rounds, questions, or finale questions. (`question-sheet.tsx` does
bind `Alt+↑/↓`, but for a different feature — §7.1's question-navigation shortcut, not
reordering.) A master relying on the documented shortcut gets nothing. Not recorded as a
deliberate deviation anywhere in slice-log.

---

## Priority 2 — Minor, worth cleaning up

| # | Finding | Where | Note |
| --- | --- | --- | --- |
| 8 | Attachment-serving route (`GET /api/attachment/:id`) skips the D14 `DATABASE_MIGRATION_REQUIRED` guard every other route has | `apps/web/app/api/attachment/[gameAttachmentId]/route.ts:19-22` | Read-only, low blast radius, but inconsistent with the rest of the app |
| 9 | `VALIDATE_ANSWER`/`SPOTLIGHT_ANSWER`/`END_BREAK` have no `requireLive`/status guard and no comment explaining why (unlike the four deliberately-unguarded actions, which each carry one) | `packages/domain/src/decide.ts` | Plausibly intentional (PRD 2 §13 post-game correction needs `VALIDATE_ANSWER` to work on a `FINISHED` game), but undocumented |
| 10 | `CHECKSUM_MISMATCH` and `IMPORT_COLLISION` are declared in the `ErrorCode` catalogue and i18n table but never returned by any code path — import uses a preview-first pattern instead | `packages/domain/src/errors.ts`, `apps/web/lib/server/transfer.ts` | Spec/implementation drift; the built design is arguably better (shows both sides before a destructive choice), but conventions §4's catalogue should say so |
| 11 | `SWITCH_TEAM` has no game-status guard, unlike `JOIN` | `decide.ts:66-68` vs `:98-121` | A player can switch teams on a `FINISHED`/`ABANDONED` game |
| 12 | `REVEAL_KEYWORDS` and `REVEAL_QUESTION` are decoupled for `DSMTW_FINALE` — a finale question can reach `REVEALED` without keywords ever being revealed | `decide.ts:369-383,766-777` | Possibly intentional; worth a decision either way |
| 13 | `Attention.FINALE_TURN` omits `questionNumber`/`questionTotal` from protocol §5.5's `FinaleTurnDetail` | `views.ts:719-745,967-1001` | Master desk can't render "Q3 of 6" from the pushed payload directly |
| 14 | `DO_SCORES_SET` has no completeness guarantee — omitted teams are never zero-filled by `decide`/`reduce`, unlike `DO_WINNERS_SET` | `reduce.ts:323-336`, `decide.ts:528-559` | D24's "blank scores 0" currently depends entirely on the UI always sending every team |
| 15 | `preflight.ts` reuses one code (`FINALE_KEYWORD_COUNT`) for two distinct problems: wrong row count vs. a blank keyword's text | `preflight.ts:206-219` | Master sees "found 4, need 5" for both; can't tell which |
| 16 | Export dialog never shows a computed size next to either of the two scope radio options, only beside the attachments checkbox | `apps/web/components/admin/export-dialog.tsx:96-144` | PRD 2 §14.1's mockup shows a size on both rows so a master can compare before choosing |
| 17 | Import drop zone wraps only the quiz list, not the whole dashboard, despite a code comment claiming it wraps the page | `apps/web/app/[locale]/admin/page.tsx:93-96` | PRD 2 §14.2 says "drop a `.zip` anywhere on the dashboard" |
| 18 | Import collision dialog implements "Cancel" as a footer button rather than the spec mockup's third radio option | `apps/web/components/admin/import-dialog.tsx:136-164` | Functionally equivalent, safe default preserved; literal deviation, not recorded in slice-log |
| 19 | `withCode`'s doc comment claims it rewrites a `code` field "at any depth," but the implementation only inspects the top level | `packages/db/src/export-write.ts:302-311` | Harmless today (both event types carry `code` at the top level); would silently fail to protect a future nested case |
| 20 | `performImport` doesn't catch a replay-time `EventPayloadError`, so a corrupted-but-shape-valid `games.json` surfaces as an uncaught exception rather than a typed `ActionResult` | `apps/web/lib/server/transfer.ts:186-223` | DB integrity is preserved (transaction rolls back); only the error shape is inconsistent with the rest of the import pipeline |
| 21 | The finale keyword sheet's empty-slot marker renders "Required" in red text with no warning icon, unlike every other readiness marker in the app (which pair icon + colour) | `apps/web/components/admin/question-sections/keyword-section.tsx:80-89` | Cosmetic inconsistency, not excused by any documented deviation |
| 22 | `[Lower the penalty]` button from §11.1 is missing — its i18n key (`lowerPenalty`) exists but is referenced nowhere | `apps/web/components/admin/game-setup.tsx` | Orphaned translation key confirms a dropped affordance |
| 23 | Settings → About shows schema version and migration status but no app "Version" string; no version is plumbed anywhere in the app | `apps/web/components/admin/settings-screen.tsx` | Minor completeness gap |

---

## Priority 3 — Documentation drift (spec-vs-spec, not code-vs-spec)

These aren't code bugs, but they're exactly the "leave code and spec disagreeing" failure mode
CLAUDE.md and agent-workflow §3.3 warn about — just between two spec documents instead of
between code and a spec.

- **`docs/spec/data-model.md` §1 is stale.** It still lists `game_answer`, `game_buzz`,
  `game_score_adjustment`, `game_keyword_mark` as the complete set of projection tables (in both
  prose at lines 56-57 and the ASCII diagram at lines 33-43, where `game_team`/`game_device` sit
  unmarked). `docs/spec/protocol.md` §8.2 already corrects this explicitly — *"the four tables
  named above are not the complete list of what replay owns"* — but the fix was never propagated
  back to data-model.md's own canonical list, which is the section a slice-5+ agent reading the
  schema doc in isolation would rely on.
- **`docs/spec/protocol.md` §5.4's prose priority list omits `FINALE_TURN`/`PICK_FINALISTS`**,
  contradicting its own type union three lines above and PRD 3 §3.1's fuller list. The actual
  `attention()` implementation is correct (verified against `attention.test.ts`, which requires
  `FINALE_TURN` to outrank `PICK_FINALISTS`) — only the spec prose is wrong, and per conventions
  §11 this should have been raised and fixed in the same change that discovered it.
- **`docs/smoke-checklist.md`'s "After slice 1" section is out of order** — it appears after
  slices 0, 2, 3, and 4 instead of between 0 and 2, which risks a future reader assuming the file
  is chronological and skipping it.

---

## What was verified as genuinely correct (not just claimed)

To keep this review honest about where the implementation is strong, not only where it's
weak — each of these was independently traced through the code, not taken from slice-log:

- **Domain purity is real.** Zero imports of drizzle/better-sqlite3/next/`@kwiz/db`/
  `process.env` anywhere under `packages/domain`; zero internal clock reads (`Date.now()`/
  `new Date()`) — every timed computation takes `now` as a parameter.
- **The three payload filters are genuine constructive allowlists**, verified by reading the
  code (no `delete`, no `{...state, x: undefined}` outside a comment quoting the anti-pattern),
  and PRD 1 §7's eight invariants hold **by construction** — e.g. the finale-keyword-text
  short-circuit never evaluates `keyword.text` at all for an unmarked keyword.
- **The sentinel leak test is exhaustive** across every documented (audience × state)
  combination and has the required complement (each secret must appear once permitted).
- **`appendAndProject` is genuinely the sole writer** of the play half — grepped for any bypass
  across `packages/db`; found none beyond the two documented exemptions
  (`game_device.lastSeenAt`, `game_answer_draft`).
- **I15 (projection == replay) and the projection/reducer-parity tests are both real and
  non-trivial** — they replay meaningfully complex event sequences and compare field-by-field,
  and "verified with teeth" (deliberately breaking the invariant and confirming the test catches
  it) checks out for both.
- **D14's migration boot behaviour is fully implemented and tested** against a real filesystem,
  including the terminal prompt via injected `readline` streams.
- **SSE framing, reconnection semantics, and cross-game isolation are all correct**, including
  the specific trap the spec calls out (a draft push with unchanged `seq` must not be
  suppressed) and the qualified `<gameId>:<seq>` id.
- **HTTP range serving for attachments has correct inclusive/exclusive bounds** — the common
  off-by-one class of bug was checked for and not found.
- **The two historical bugs slice-log claims to have fixed** (an accepted buzz crediting
  nobody; the reducer and projection disagreeing about who buzzed first) **are genuinely fixed**
  and now guarded by `projection-parity.test.ts`.
- **Slice 4's self-audit holds up.** All ten gaps its own two-pass PRD reading found (delete
  game, export-this-game scoping, `moveCategory`, dashboard round-N-of-M/winner, quiz editor
  export/⋯ menu, custom team colour, remembered team count, attachment filename/size, option
  delete confirmation, drag handles) were independently re-verified as correctly fixed.
- **Pre-flight never blocks.** Traced the "Play anyway" button through every layer
  (`preflight-report.tsx` → `play-flow.tsx` → the game-creation route) and confirmed no code
  path — component prop, server action, or route guard — can prevent progression when pre-flight
  reports errors. This was flagged as the single most safety-critical property to double-check,
  and it holds.
