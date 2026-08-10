# Slice 5 — Functional Review

**Companion review to** [`slice-0-4-functional-review.md`](slice-0-4-functional-review.md) /
[`slice-0-4-code-review.md`](slice-0-4-code-review.md). This document covers everything since
those were written: the fixes made in response to them (PR #6, `fix/review-slice-0-4`), and
slice 5 itself — the master control desk (PRD 3).

**Reviewer:** independent audit, same method as before — ground truth confirmed directly
(`pnpm check`: 620 tests / 39 files, all green), every normative spec re-read in full, and a set
of parallel deep-dive agents each re-verifying claims against the actual current code rather than
trusting commit messages or `slice-log.md`.

## Verdict

**Every finding from the previous review round was genuinely fixed**, almost all with new,
on-point test coverage — verified by direct inspection, not by trusting the fix commits' own
messages. Two low-priority items remain open but are functionally benign (see "Carried over,
still open" below).

**Slice 5 itself is, once again, a strong implementation with a self-critical process that caught
real bugs before this review even started** — the implementing agent's own two-pass audit found
and fixed one genuinely critical bug (a dangling finale turn) and sixteen PRD clauses that had
copy written for them and were never rendered. All seventeen of those self-reported fixes were
independently re-verified here and hold up.

**That said, this audit found two further critical-severity gaps the self-audit's method
(grepping for orphaned translation keys) structurally cannot catch**, because both are about
*control flow reaching a dead end*, not *a clause with no rendered copy*:

1. A single `Enter` press (or button click) can **end the game with zero confirmation**, in
   direct violation of PRD 3's own explicit safety rules.
2. The round-end validation sweep's escape route can **run out of button to press** at a
   round/game boundary, leaving the master stuck exactly where PRD 3 §6.2 promises they never
   will be.

**Recommend fixing both before slice 6** — they are UI-reachable today, not theoretical, and the
second one compounds the first: a master boxed in by finding #2 is more likely to reach for
`Enter` out of habit, which is finding #1.

---

## Priority 1 — Fix before slice 6

### 1. [CRITICAL] `Enter` (and a plain click) can end the game with no confirmation

**Where:** `packages/domain/src/views.ts:1414-1456` (`advanceSuggestion`),
`apps/web/components/control/leaderboard.tsx:92-114` (`AdvanceButton`),
`apps/web/components/control/finale-desk.tsx:485-487`,
`apps/web/components/control/control-desk.tsx:265-271` (keyboard wiring)

PRD 3 §13 lists what must never be reachable by a stray keystroke: *"end the game, abandon the
game, skip a question, or submit on a team's behalf."* §1.1 additionally requires a confirmation
dialog for *"genuinely irreversible acts (end game, abandon)"* specifically because those two are
exempt from the surface's otherwise-strict no-dialogs rule.

`advanceSuggestion()` treats `'FINISH'` as just another value of the same union as
`LOCK`/`REVEAL`/`NEXT_QUESTION`/`NEXT_ROUND` — returned the instant `state.finale.ranking` is set,
or once the last round has no questions left. `AdvanceButton` renders every suggestion through
the same generic path, with no dialog and no special case for `FINISH`:

```ts
case 'FINISH':
  return {
    label: t('finishGame'),
    call: () => run(async () => {
      if (questionId && view.question?.state === 'OPEN') {
        const locked = await api.lockQuestion(questionId)
        if (!locked.ok) return locked
      }
      return api.finish()   // fires immediately, no confirm
    }),
  }
```

and `control-desk.tsx:265-271` binds this same `.call` to `Enter` via `usePrimaryAction` — the
exact key the master has been pressing all game to advance. At precisely the moment the game
legitimately ends (the finale's last elimination, or the last round closing), the master's
reflexive advance-key silently finishes the game.

Reachable via two paths: `finale-desk.tsx:485-487` renders this button immediately once
`state.finale.ranking` is set (before the round is even formally closed), and
`leaderboard.tsx`'s `AdvanceButton` renders it for an ordinary last round. Compare with the
**correct** pattern already in the same codebase: `header.tsx:144-169` gates both `FINISH` and
`ABANDON` behind `ConfirmDialog`, reachable only from a pointer-only overflow menu — exactly
what §1.1 asks for. The advance-suggestion path bypasses this entirely, for both keyboard and
mouse.

No test exercises this: `master-control-view.test.ts` never asserts on the `FINISH` suggestion or
on `AdvanceButton`'s click behaviour.

**Recommend:** `FINISH` should not be lumped into `AdvanceButton`'s generic action. It needs the
same `ConfirmDialog` treatment `header.tsx` already has, and `usePrimaryAction` must not bind
`Enter` directly to it — either exclude `FINISH` from the primary-action binding, or have the
dialog intercept before `api.finish()` fires.

---

### 2. [CRITICAL] The round-end validation sweep can dead-end at a round/game boundary

**Where:** `packages/domain/src/views.ts:1335-1349` (attention priority — `VALIDATE_QUESTION`
unconditionally outranks `ADVANCE`), `apps/web/components/control/question-desk.tsx:454,465-471`,
`apps/web/components/control/leaderboard.tsx:49,64-70`

This is a real gap the implementing agent's sixteen-fix pass came close to but didn't fully
close. Both `question-desk.tsx` and `leaderboard.tsx` independently implement the sweep's "way
out" the same way:

```ts
const nextPending = view.timeline.find((entry) => entry.state === 'PENDING')
...
return nextPending ? { label: tv('done'), call: () => run(() => api.openQuestion(nextPending.gameQuestionId)) } : null
```

`view.timeline` is scoped to the **current round only**. `attention()`'s `VALIDATE_QUESTION`
check, correctly, is not — it walks the whole quiz in play order looking for any question with a
still-pending answer (`questionNeedingValidation`, `views.ts:1376-1402`), which is exactly right:
a deferred validation from round 1 must keep demanding attention even while round 3 is being
played, per PRD 3 §6.2.

The two facts combine into a dead end: once the **current round** has no un-opened question left
(`nextPending` is `undefined`) but an **earlier round** still has a deferred validation,
`action` is `null`. `usePrimaryAction(action?.call ?? null)` binds nothing, `Enter` does nothing,
and the sweep screen renders with no primary button at all. The only other route to
`NEXT_ROUND`/`FINISH` is `AdvanceButton`, which only renders when `attention.kind === 'ADVANCE'`
— unreachable while `VALIDATE_QUESTION` outranks it unconditionally, with no bypass. The header's
"End this round" closes the round but does not open the next one (`OPEN_ROUND` is a separate
command, invoked only from `AdvanceButton`'s `NEXT_ROUND` case), so it doesn't unstick the master
either.

**Reproduction:** defer validation on Q1 of round 1, then play round 1's last question (Q2) to
completion without revisiting Q1. The master lands on Q1's sweep screen with no way to reach
round 2 short of manually judging Q1's row by hand.

This directly contradicts PRD 3 §6.2: *"Closing a round with validations outstanding is allowed,
and closing the game with them outstanding is too... Blocking the master from moving on would be
the one thing worse than provisional scores."*

**Recommend:** the "way out" search needs to fall back past the current round — either search
`allQuestions` for the next PENDING question anywhere (mirroring what `attention()` itself does),
or, once no PENDING question remains anywhere, offer the same `NEXT_ROUND`/`FINISH` action
`AdvanceButton` would offer, directly from the sweep screen rather than requiring a transition
through `attention.kind === 'ADVANCE'` that can't happen while validation is outstanding.

---

## Priority 2 — Major, worth fixing soon

### 3. [MAJOR] The finale desk never surfaces a finale question's attachment

**Where:** `apps/web/components/control/finale-desk.tsx` (no `MediaControls` import, no
media/attachment reference anywhere in the file)

PRD 1 §8.5 says attachments are available on every question type, and §8.8 explicitly confirms
this for `DSMTW_FINALE`: *"Attachments work as on any question, though a keyword question rarely
needs one."* The authoring UI agrees — `AttachmentList` renders unconditionally for every
question type, `KEYWORDS` included, so a master **can** attach an image or audio clip to a finale
question today.

`question-desk.tsx` imports and renders `MediaControls` for exactly this reason — master-side
playback, scrub bar, the works (PRD 3 §5.1). `finale-desk.tsx` has no equivalent at all. If a
master does attach media to a finale question — rare, per the PRD's own hedge, but explicitly
permitted — there is currently no way to trigger or control it live from the turn desk.

**Recommend:** reuse `MediaControls` (or a slimmed variant) in the finale turn desk, gated the
same way `question-desk.tsx` gates it.

---

### 4. [MAJOR] `protocol.md` §5.4 documents a `VALIDATE_QUESTION` shape the code no longer has

**Where:** `docs/spec/protocol.md:596,664-669` vs `packages/domain/src/views.ts:861-875`

protocol.md still specifies `VALIDATE_QUESTION` as
`{ kind: 'VALIDATE_QUESTION'; question: QuestionRef; items: ValidationItem[]; remainingQuestions: number }`
with a separate `QuestionRef` type. The actual implementation flattens `prompt`,
`acceptedAnswers`, and `masterNotes` directly onto the `Attention` variant — there is no nested
`question` object and no exported `QuestionRef`. This is acknowledged in a code comment and in
`master-control-view.test.ts`, but the spec document itself was never updated to match — the one
place in this slice where agent-workflow §3.3's "never leave code and spec disagreeing" rule
slipped through, despite slice-log explicitly claiming *"None knowingly [deviated]... written
into the spec in this change."* Anyone building slice 6/7/8 against `protocol.md` as currently
written would target a shape that doesn't exist.

**Recommend:** update protocol.md §5.4's `VALIDATE_QUESTION` type to the flattened shape and drop
the now-unused `QuestionRef` type (or note it's superseded).

---

## Priority 3 — Minor

| # | Finding | Where | Note |
| --- | --- | --- | --- |
| 5 | `[Skip this question]`'s disabled condition (`!currentQuestionId || !live`) doesn't mirror §9.1's actual legality window (`PENDING`/`OPEN` only) — it stays clickable against `LOCKED`/`REVEALED`/`SCORED`, relying on the server's `QUESTION_NOT_OPEN` refusal to silently no-op | `apps/web/components/control/header.tsx:105-112` | Harmless (the resulting 409 is a typed, correct refusal) but the UI implies availability it doesn't have |
| 6 | `DO_SCORES_SET` still has no zero-fill for teams omitted from a save — functionally identical outcome (an absent row contributes 0 to the score sum exactly like an explicit 0 would), but the audit trail can't distinguish "scored 0" from "never scored" for that team/question | `packages/domain/src/decide.ts:600-611`, `reduce.ts:339-352` | Presentational/audit gap only, not a scoring bug (already noted as such in the prior review) |
| 7 | `CHECKSUM_MISMATCH`/`IMPORT_COLLISION` remain declared `ErrorCode` catalogue members never returned by a literal `fail()` call anywhere — the actual mechanisms (per-file `ABSENT`/`CORRUPT` reasons in the import preview; a collision-preview object) are arguably better designs, but the catalogue in conventions §4 overstates what's returned as a typed error | `packages/domain/src/errors.ts:64-67`, `packages/export/src/zip.ts` | Unchanged from the prior review; still worth a one-line correction to conventions §4 rather than a code change |
| 8 | `keys.tsx`'s module docstring frames itself as the complete reviewable list for "never bind X," but `Esc`'s "close a popover only" behaviour is actually delegated to Radix's `Popover`, not enforced by this file | `apps/web/components/control/keys.tsx` | Not a bug — verified `Esc` genuinely does nothing else — but a future auditor grepping this file alone for `Escape` would wrongly conclude it's unbound |
| 9 | `views.sentinel.test.ts` wasn't extended for any of the eleven new `MasterControlView` fields (`timeline`, `adjustments`, `break`, `controlScreens`, `finaleRanking`, etc.) | `packages/domain/src/views.sentinel.test.ts` | Not a leak — none of the new fields target `MAIN_SCREEN`/`PLAYER` — but worth a note so a future reader doesn't assume the sentinel table covers everything this slice added |

---

## Carried over from the prior review — verification results

Every finding from `slice-0-4-functional-review.md` and `slice-0-4-code-review.md` was
independently re-checked against the current code (not the commit messages). **21 of 23
functional findings and all 8 code-review findings are confirmed FIXED**, most with new,
on-point test coverage written specifically to guard the fixed behaviour:

- The **critical finale-turn bug** (locking a question never ended the active turn) is fixed via
  a new `endOpenFinaleTurn(state)` helper called from both `LOCK_QUESTION` and `SKIP_QUESTION`,
  producing `TURN_ENDED{reason:'QUESTION_CLOSED'}` — the schema member that was previously
  declared and never produced. `decide.test.ts` now has a precise test locking a finale question
  mid-turn and asserting the clock only charged the actual elapsed time, plus a sibling test for
  the skip path.
- The `SCORE_DO` attention payload now carries everything PRD 3 §8 needs
  (`scoringMode`/`tiePayout`/`masterNotes`/per-team `score`).
- `SUBMIT_FOR_TEAM` now has the same upper-state bound as ordinary submission;
  `CLOSE_ROUND` now refuses while its question is `OPEN` (a different, equally valid fix from the
  one originally suggested — preventing the bad state rather than patching the guard that would
  have needed to detect it).
- `FINISH_GAME`/`ABANDON_GAME` remain deliberately unguarded against an open question — now
  explicitly documented as PRD 3 §1.1's "emergency stop" behaviour rather than an oversight, with
  a test proving it's intentional (`decide.test.ts`: *"finishes and abandons mid-question, unlike
  every other round/question transition"*).
- Export-without-attachments now always populates the manifest's attachment list regardless of
  the embed toggle, so missing-media reporting works even when bytes weren't included — tested
  against a real attachment row, closing the exact gap the original finding described.
- `Reclaim space`'s race is now closed by a `RECLAIM_GRACE_MS` age check rather than a
  transaction — a different but valid fix, with a test that reclaims against an empty referenced
  set (worst case) and confirms a fresh file survives.
- Game creation and re-sync now run `preflight()` against the freshly-copied rows **inside** the
  same transaction as the copy, rejecting and rolling back a bad copy at creation time — tested
  for both `createGameFromQuiz` and `resyncGame`.
- `Alt+↑/↓` keyboard reordering is now implemented via a shared `keyboardReorder()` function used
  identically for rounds, questions, and finale questions, sharing the exact same refusal
  predicate as drag-and-drop and the button route — tested including the pinned-finale refusal
  case.
- All eight remaining minor items (export dialog sizes, import drop-zone coverage, the collision
  dialog's third radio option, the `withCode` doc/code mismatch, `performImport`'s uncaught
  exception, the keyword-required icon, the missing penalty-adjustment button — now correctly
  renamed `raisePenalty` after a sign-error correction — and the missing Version row) are all
  fixed and, where applicable, tested.
- All three doc-drift items (`data-model.md` §1, `protocol.md` §5.4's old priority list,
  `smoke-checklist.md`'s section ordering) are corrected.
- All eight code-review findings (the three duplicated tree-copy implementations, `decide.ts`'s
  duplicated guards, `views.ts`'s duplicated option-shaping, the `MasterBoardView` sort
  inconsistency, `quiz-tree.ts`'s unscoped queries, and the two test-coverage gaps in
  `attachments.ts`/`games.ts`) are fixed, with real test coverage added for the two coverage gaps.

**No regressions were found in any of the fixes.**

---

## What was verified as genuinely correct in slice 5 (not just claimed)

- **The `attention()` priority order and its break-suspension logic are correct**, verified by
  reading the actual control flow, not just the comment: a break can only start while no question
  is `OPEN` (PRD 3 §11.2's own refusal), which by construction rules out `ADJUDICATE_BUZZ`/
  `FINALE_TURN`/`BREAK_TIE_FOR_PICK`/`PICK_FINALISTS` co-occurring with one. `SCORE_DO` is the one
  state that legitimately can (a `DO` question needs only to be `LOCKED`, not `OPEN`) — and its
  check runs earlier in the function than the break check, so it is correctly *not* suspended.
  This is exactly the reasoning the code's own comment states, and it holds up.
- **The round-end sweep correctly refuses to pull the master backward while the current question
  is still `OPEN` or `LOCKED`** (`questionNeedingValidation`, `views.ts:1392-1393`) — the specific
  behaviour the smoke checklist calls out (§6.2: "not while a question is open").
- **`controlScreens`' live re-push mechanism is correctly implemented**: `notifyOthers()` in
  `apps/web/lib/server/transport.ts` re-pushes the current view to every *other* subscriber of a
  game when one connects or disconnects, scoped per-game and per-`MASTER_CONTROL`-audience only —
  verified never to leak into `MAIN_SCREEN`/`PLAYER` payload construction.
- **The finale desk's remaining PRD 3 §10 mechanics are all correct**, verified independently of
  the sixteen-fix list: the "all five found" and "some passed, keywords remain" closing states are
  genuinely distinct UI branches (not the same `[Pass]`-only screen the original bug produced);
  off-turn elimination is detected by checking **every** finalist's derived clock each tick
  (`useEliminationWatch`), not only the team currently on turn; the server, not the client,
  recomputes and owns the elimination instant (the zod schema for the eliminate action accepts
  only a `teamId`, no client-supplied timestamp); and the two-tab `FINISHED` ranking view (survival
  vs. pre-finale points, per D51) is genuinely implemented.
- **The penalty-arithmetic discrepancy slice-log flagged is real and correctly resolved in code.**
  PRD 3 §10.1's worked example (*"20s → up to 320s off a 490s pool"* for 4 finalists) does not
  reproduce: the actual maximum removable in one question is `20 × 5 × 3 = 300`, not 320. The
  implemented formula matches `suggestFinaleQuestions`'s inner term exactly, so the picker and the
  live-shown suggestion cannot disagree — a deliberate, reasoned choice to prefer internal
  consistency over reproducing what looks like an arithmetic slip in the PRD's illustration.
- **Keyboard safety holds for every binding except the one critical gap above.** Every other
  bound key (`Y`/`N`, `1`-`9`, arrows, `1`-`5` finale mark, `Shift`+`1`-`5` unmark, `Space`) was
  traced to its dispatched action and confirmed to never reach `FINISH_GAME`, `ABANDON_GAME`,
  `QUESTION_SKIPPED`, or `SUBMIT_FOR_TEAM`. Typing inside a form control (the adjustment reason
  field, a DO score input) is correctly ignored by the global key handler.
- **The transport/reconnection layer is solid**: `useLiveView` is genuinely the only SSE consumer
  on the control surface (the one documented exception, `live-teams.tsx`, is exactly that — a
  documented exception, not evidence of a wider pattern); the last-known view is preserved through
  a reconnect rather than blanked; the `FAILED`-path diagnosis (falling back to a one-shot `fetch`
  to read a typed error body, since `EventSource` can't report *why* it broke) is implemented
  correctly; no stale-closure or unmount race was found.
- **A rejected action is genuinely surfaced to the master**, not silently swallowed — `run()`'s
  refusal path sets state that `right-rail.tsx` renders, confirmed by tracing the actual code
  rather than trusting the "fire-and-forget" framing in slice-log at face value.
