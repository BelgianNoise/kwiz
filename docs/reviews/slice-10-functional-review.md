# Slice 10 — Functional Review

**Companion to** [`slice-10-code-review.md`](slice-10-code-review.md), which covers the new
guard spec's structure, locator quality, and test mechanics. This document covers what slice 10
was supposed to deliver against build-order's own definition of it — the field-rehearsal runbook
and the automatable residue pulled forward into `e2e/specs/legibility.spec.ts` — plus the
determinism hardening this agent shipped alongside (authoring persistence predicates, scenario 9
and 19 timing reworks). Note on predecessors: slice 9's review round ran as PR #12 and filed no
review documents, so where earlier rounds cross-referenced a previous file, this one cites the
slice-log entry instead.

**Reviewer:** independent audit, same method as previous rounds — gate components re-run
individually (732 unit tests / 47 files green; typecheck clean; format and lint findings below),
both new e2e specs executed locally against a production build (2 passed), and the headline guard
**mutation-tested**: a fixed `10px` text planted in `waiting-stage.tsx` failed the spec at exactly
the right checkpoint with the offending node named in the message, then reverted. Build-order's
slice 10 section, agent-workflow §4.5, PRD 4 §2–§3, and the smoke-checklist's physical rows were
re-read in full; every factual anchor in the runbook was spot-checked against messages and PRDs.

## Verdict

**The framing is honest, and that matters most for this particular slice.** Build-order says "not
a coding slice: run a real quiz" — something no agent can do. The split this agent executed,
everything short of the physical evening, is not a dodge: it applies build-order's own rule
("anything the rehearsal finds that *is* automatable gets added to the suite") *in anticipation*,
and turns the remainder into a runnable runbook with watch-fors, triage verdicts, and a findings
sheet rather than prose intentions. The status line "complete-as-executable-by-an-agent"
(slice-log) says plainly what remains open: the room itself.

The guard is real. This audit did not take its green run as proof — a legibility check that also
passes everything is indistinguishable from a vacuous one — so the mutation test above was run,
and the guard caught the plant at the correct stage, in the correct locale, naming the element.
The both-locales-in-one-walk design has already earned its keep once: the agent's own log records
the first draft exempting the language switcher by translated label, which silently went vacuous
on the nl page, caught because one spec measures both baselines.

This audit found **one MAJOR delivery problem** (the gate fails on the working copy as handed
over, for an encoding reason unrelated to any code), **one MEDIUM encoding defect** across both
spec files this slice wrote, and one place where the docs now claim slightly more than the test
asserts. None are design problems; all are cheap to close.

---

## Priority 1 — Fix before anything else

### 1. [MAJOR] The delivered working copy fails the first step of the gate

**Where:** `e2e/specs/authoring.spec.ts`

`pnpm check` on this machine fails at `oxfmt --check .`, the very first step, flagging this one
file. The cause is delivery-state, not committed content: the file was written to disk with CRLF
line endings by whatever tool edited it, and oxfmt refuses them (`.gitattributes` normalises to
LF only at commit/checkout boundaries). The committed blob itself is LF-normalised — a fresh
clone passes — but dispatch happens in this tree, and the next agent's first `pnpm check` will
fail mysteriously on a file they didn't touch. Running the formatter (or `git checkout --` on the
file) renormalises it and the whole gate passes again; verified.

Two smaller hygiene items ride along in the same file and should be closed in the same touch:

- It is the **only tracked file in the repo carrying a UTF-8 BOM** (`EF BB BF` before `import`,
  confirmed by scanning every git-tracked file). Harmless to the toolchain, unusual everywhere
  else, and a hint about which editor setting produced the CRLF problem.
- Its header comment claims scenarios "1, 2 and 4", matching the pre-existing content — fine —
  but every em-dash, section sign, multiplication sign and check mark in the file is mojibake.
  See finding #2.

**Recommend:** renormalise the file now (one `git checkout --` / format pass), strip the BOM, and
identify the tool that wrote CRLF + BOM so it doesn't happen to the next slice's files.

---

## Priority 2 — Worth fixing soon

### 2. [MEDIUM] Double-encoded text (mojibake) throughout both spec files this slice wrote or touched

**Where:** `e2e/specs/legibility.spec.ts` (~40 occurrences), `e2e/specs/authoring.spec.ts`
(~30 occurrences)

Every non-ASCII character is double-encoded — the classic UTF-8-read-as-Windows-1252 artifact:
`§` → `Ã‚Â§`, `—` → `Ã¢â‚¬â€`, `–` → `Ã¢â‚¬â€œ`, `×` → `Ãƒâ€”`, `✓` → `Ã¢Å“â€œ`. This is not
merely cosmetic:

- Test titles are corrupted (`'1 Ã¢â‚¬â€ a whole quiz authored through the UI'`), making reporter
  output and grep hostile.
- Assertion failure messages are corrupted — this audit's mutation run produced
  `"text below the ?'2.1 floor"` in the failure context, i.e. the encoding damage surfaces at
  exactly the moment a human most reads these strings.
- Comments citing specs (`§2.1`, `§7.2`) — the project's primary cross-reference habit — are
  unreadable in these two files.

Nothing in the toolchain catches it: oxfmt and oxlint accept the bytes happily. The same tool
mishap that produced finding #1 produced this, on both files written in this slice while leaving
the two other edited specs clean.

**Recommend:** a one-time repair pass restoring proper characters in both files, and consider a
tiny `scripts/` guard in the spirit of `lint:env` (a handful of common mojibake sequences across
tracked files costs nothing to check and would have flagged this before commit).

### 3. [MEDIUM] Build-order and the smoke-checklist claim more than the URL spec asserts

**Where:** `docs/build-order.md` ("absolute after the network picker, honestly relative before
it"), `docs/smoke-checklist.md` (slice-10 rows), `e2e/specs/legibility.spec.ts:331-349`

The absolute half of the join-URL rule is genuinely pinned: hub URL and projector URL must be
non-relative, must agree with each other, and the QR must render. The "honestly relative before
it" half is **not asserted anywhere**. The spawned-server side of the test boots a server whose
settings have no address, but never creates a game in *that* server's database — it visits the
shared database's game id there, lands in §14's calm-failure state, and asserts only that nothing
scannable-looking renders for an *unknown* game. That is a legitimate pin in its own right, and
the spec's comment admits exactly this ("covered by `views.ts`'s joinUrl builder upstream") — but
the two documents don't. Someone reading build-order believes both halves are guarded
mechanically; only one is.

**Recommend:** either add the missing half — create a game in the spawned server's own data dir
through `@kwiz/db` and assert the rendered URL is path-only — which would fully earn the doc
claim; or reword both documents to describe what is actually pinned (absoluteness after the
picker; calm failure without a scannable link when the address is unset).

### 4. [MINOR] The arming stage is floor-measured in `en` only, and overflow is never measured there

**Where:** `e2e/specs/legibility.spec.ts:128-144`

Both projector contexts assert their arming button and click through it, but
`collectViolations` runs once, against `screens[0]` (en), and `collectOverflow` doesn't run at
all before the frame mounts. Every later checkpoint measures both locales plus overflow via the
uniform `measure()` helper. The asymmetry matters here of all places: Dutch copy runs 20–30%
longer (PRD 1 §9.2), the arming screen sits outside `StageFrame` — the exact structural blind
spot the slice-6 review flagged — and slice-6's original manual snippet caught a real violation
on precisely this screen.

**Recommend:** measure inside the per-locale arming loop (both evaluators, both locales), or fold
arming into `measure()` once the stage name can describe it.

---

## Priority 3 — Minor

| # | Finding | Where | Note |
| --- | --- | --- | --- |
| 5 | `/^Apply \+40$/` hardcodes UI copy instead of going through the messages module | `e2e/specs/legibility.spec.ts:237` | The key exists and interpolates: `control.scores.apply = 'Apply {delta}'` (messages/en.ts:764). Every other label in this spec comes from `en.*`; `flows.ts`'s header explains why the suite holds this line — a copy change silently breaks this spec |
| 6 | `/^Start (?!the finale)/` matches any future button beginning "Start …" present at finale-picking time | `e2e/specs/legibility.spec.ts:247` | Commented and debugged honestly (the log narrates the picker-button collision), but a negative lookahead excludes exactly one known colliding label; asserting the expected set, or scoping to the turn-start region, survives future labels |
| 7 | The log's "lint silent" claim is inaccurate on current HEAD: oxlint reports one warning | `docs/slice-log.md:18`, `scripts/architecture-rules.test.ts:98` | `no-unnecessary-type-assertion` — introduced by slice 9's tooling commit (6c14782), not this slice, and warnings don't fail the gate; still, the project's stated bar is zero-output lint. Fix the cast |
| 8 | `field-rehearsal.md` opens with "30 browser journeys"; the count moved to 32 later in the same slice | `docs/field-rehearsal.md:5` | Accurate when written (slice-9-review ended at 30); stale by the time the slice merged. Refresh next time the file is touched |

---

## What was verified as genuinely correct in slice 10

- **Gate claims, itemised:** 732 unit tests / 47 files green ✓; typecheck clean ✓; e2e "32 specs"
  matches reality (32 `test()` blocks across 11 spec files = slice-9-review's 30 + these 2) ✓;
  format/lint caveats are findings #1/#2/#7 and nothing deeper. Both new specs were executed
  locally here and pass against a production build.
- **The floor check implements §2.1 as written.** Projector contexts are 1920×1080
  (`surfaces.openScreen`), so `innerHeight × 0.04` = the 43.2px floor; direct-text-nodes-only is
  the right granularity (containers inherit their children's sizes); "nothing is exempt,
  including timings and captions" is honoured — no role-based carve-outs beyond the documented
  language-switcher chrome. Both the framed stages *and* the arming screen (outside
  `StageFrame`) are reachable, closing the structural gap the slice-6 review identified.
- **Guard non-vacuity is mutation-proven**, not assumed: planted 10px text failed at
  `waiting [en]` with `"10px \"Scan, or go to\""`, then reverted. Traces-on-failure make any real
  future hit diagnosable.
- **The nl lesson is institutionalised, not just survived**: measuring both locales in one walk
  is what exposed the translated-label exemption leak during development; the switcher exemption
  is now matched structurally (`closest('nav')`) with the reason recorded where the code is.
- **Overflow guard aligns with PRD 4's letterbox rule** (§2.2/§2.3): page scroll dimensions may
  never exceed the viewport at any stage, ±1px rounding tolerance.
- **Every factual anchor in the runbook checks out**: `[Test with my phone]` → *"Your phone
  reached this machine."* (messages/en.ts:819–821); `♪ sound ready` / *"Sound could not start…"*
  (en.ts:949–950); D57's whole-seconds rule quoted correctly; `Shift+1–5` un-mark and `Space`
  pass match PRD 3's keyboard maps; closed-round refusals and the desk handing back after a
  scored tile reflect the slice-9-review fixes (a16e258) they cite; auto-submit-with-late-accept
  (D8), skip-pays-nothing (D46), full-team-still-listed (D20), and undo-announces-nothing all
  match implemented behaviour from earlier slices.
- **Triage closes the loop properly**: each finding gets exactly one verdict, verdict 1 routes
  back into `e2e/specs/` citing the finding in the spec comment, and the final step appends to
  the slice-log — build-order's "one-off embarrassment becomes a permanent guard" made
  procedural.
- **The smoke-checklist edit replaces, not deletes**: physical rows move to the runbook with a
  pointer left behind, and the automatable residue is named where it lives.
- **Determinism rules respected throughout the new spec**: fixtures through `@kwiz/db`; no
  sleeps anywhere (waits are on elements, SSE-driven views, or polled values); tiny finale banks
  (`secondsPerPoint: 0.5`, `penaltySeconds: 5`) with score top-ups sized so nobody eliminates
  mid-measure (D56 noted in-comment); the spawned server gets its own port and data dir with
  `waitReady`/`stop` in a `finally`.
- **The edits to existing specs are tightening, not loosening**: scenario 1's persistence
  predicates now include the prompt — closing a real hole CI actually caught (Escape cancels a
  save inside the debounce window, and an incomplete row can never read Ready); the sheet
  visibility gate kills the detached-node click race; scenario 9's longer timeouts name the
  mechanism (two extra 1080p contexts loading the shared server); scenario 19's redesign asserts
  a jump-to-large-total because an expired base legitimately persists as `Back in 0:00` until
  resumed — immune to the race the old small-delta assertion had, at the honest cost of ~30 s of
  wall clock, spent waiting on observable state per the suite's own rules.
- **Workflow compliance**: spec edits landed in the same commits as the code they justify
  (build-order, smoke-checklist); deviations section says "none" and the record supports that;
  raised-not-resolved names the autosave flake with a concrete next-suspect; the five report
  questions are all answered in the log entry.
