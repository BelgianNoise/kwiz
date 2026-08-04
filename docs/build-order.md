# Build order

**Status:** Plan, not a spec · **Last updated:** 2026-08-04

For dispatching implementing agents **sequentially** — one slice finished before the next
starts. Unlike the PRDs and specs, this document becomes obsolete as work completes;
delete or rewrite it freely.

Every slice's gate is `pnpm check` plus the shared criteria in
[conventions §11](spec/conventions.md).

**The per-slice working protocol — how to orient, verify, regress and hand off — is
[`agent-workflow.md`](agent-workflow.md).** This document is only the *what* and the order.

---

## Ordering principle

Two rules produced this order:

1. **The invariant-bearing packages come before anything that consumes them.** `domain` and
   `db` hold every rule that is expensive to retrofit — event sourcing, payload filtering,
   the state machine. Building a surface first means discovering those rules through a UI,
   which is the most expensive place to discover them.
2. **Every slice after 3 is independently demonstrable.** A slice that can't be run and
   looked at can't be reviewed, and a sequential dispatch has no other feedback signal.

---

## Slice 0 — Scaffold

**Delivers:** an empty repo that passes `pnpm check`.

- pnpm workspace, Node 24 pinned (`.nvmrc` + `engines`), TypeScript `strict`
- Next.js App Router app at `apps/web`, empty packages `domain` / `db` / `export` / `config`
- Vitest workspace config, oxlint (**including the §1.4 architectural overrides**), oxfmt
- Tailwind + shadcn/ui initialised with semantic tokens in the globals file
- next-intl wired with `en` + `nl` message files and the `[locale]` segment
- `@kwiz/config`: the env module — a zod schema, types inferred, read once at boot
- `.gitignore` covering `data/`
- The first rows of [`smoke-checklist.md`](smoke-checklist.md) and the first
  [`slice-log.md`](slice-log.md) entry

**Must verify:** a clean `pnpm install` on Node 24 with no C++ toolchain present succeeds
(conventions §1.1). If it fails, resolve it *here* — not three slices later.

**Do not** build any UI in this slice beyond what proves the app boots.

---

## Slice 1 — `packages/db`: schema & migrations

**Delivers:** the full schema, migrations, and the one writer.

- All 24 tables per the [data model](spec/data-model.md), using the **shared column
  factories** (§3) — not hand-duplicated twins
- zod schemas for every JSON column, and the `game_event.payload` discriminated union
  validated on **both append and replay** (conventions §10.1)
- The connection module with all four pragmas (`foreign_keys = ON` especially)
- Drizzle Kit migration generation; the first migration committed
- Boot behaviour: create-and-migrate silently on a fresh DB, **prompt** on an existing one
  with a timestamped backup first (§6.7)
- `appendAndProject()` (§6.4.1) — the sole writer for the play half
- The **column-parity guard test** (§7.2)

**Tests:** column parity, `appendAndProject` transactionality, `unique(gameId, seq)` as a
backstop, migration prompt logic.

---

## Slice 2 — `packages/domain`: the rules

**Delivers:** every game rule as pure functions. No I/O anywhere in this package.

- The question state machine including `SKIPPED` (PRD 1 §7.1, D46)
- `reduce(events) → GameState` over the full protocol §4 event catalogue
- Scoring: all answer methods, both `DO` modes, adjustments and revocations
- `normaliseAnswer` (lowercase + trim, D22) and matching against accepted answers
- Buzz ordering and the **deny → lockout → reopen loop** (D35), including the timer-pause
  derivation
- Jeopardy turn-order rule (D30)
- **`DSMTW_FINALE` (D50):** the derived-clock formula (D52), live turn order, the penalty and
  its reversal on un-mark, elimination including the off-turn case and **simultaneous
  eliminations sharing a rank**, the final ranking (D51), and `suggestFinaleQuestions`
  (conventions §8.1). This is the most arithmetic-dense part of the domain layer and the one most worth
  testing exhaustively — every clock is a pure function of an event list, so every case is a
  literal array
- The three payload filters — `toMainScreenView`, `toPlayerView`, `toMasterControlView` —
  as **allowlists that construct** (CLAUDE.md §2.3)
- `attention` computation with the PRD 3 §3.1 priority order
- `packages/domain/src/constants.ts` from conventions §5

**Tests:** this is the heaviest test slice and the cheapest place to be thorough. State
machine, buzzer loop, scoring, normalisation, and **the protocol §6.2 sentinel leak test
across every (audience × state) pair**. Projection-equals-replay (I15).

**This slice ends with the whole game playable in tests, with no server and no UI.** If it
doesn't, the logic has leaked somewhere it shouldn't be.

---

## Slice 3 — Transport: SSE, actions, attachments

**Delivers:** the server surface. Still no UI.

- Three SSE routes (`/screen`, `/control`, `/play`) with correct framing, `id: <seq>`,
  `: ping` every 15 s, `X-Accel-Buffering: no`
- The `Map<gameId, GameState>` projection with lazy load-by-replay and eviction
- Reconnect: `Last-Event-ID` handling, and **rejecting a `seq` from another game**
- All 25 POST actions, zod-validated, returning the conventions §4 `ActionResult`
- `submit` idempotency and the first-write-wins rejection (D43, protocol §7.3)
- Attachment upload (hash-while-streaming, content-addressed, atomic rename) and serving
  **with HTTP range support**
- The `RealtimeTransport` interface, so D2 stays reversible (PRD 1 §6.9)

**Tests:** reconnect replay, **cross-game isolation with two live games**, submit
idempotency, range requests.

---

## Slice 4 — PRD 2: config & authoring

First slice with a UI, and the one that makes everything else demonstrable — you cannot
test a game without authoring a quiz.

- Landing page, first-run network picker with reachability test
- Dashboard, quiz editor, `QUESTION_SET` round editor with the question sheet
- The Jeopardy board builder
- Attachment upload with **in-browser playability verification** (O6)
- The `DSMTW_FINALE` round editor and keyword sheet, with the live word-shape echo (§9), and
  the **pinned-last enforcement** in the round list — type picker, insert-before, refused
  drags and refused `Alt+↓` (§6.1)
- Pre-flight check (§9)
- Game setup with teams, the palette from conventions §3, launch links
- Export and import including the collision dialog

**Deliberately deferred to slice 8:** post-game review and correction (§12). It needs a
played game to be meaningful, and blocking here on it delays every other surface.

---

## Slice 5 — PRD 3: master control

- The four-region layout that never reflows
- All six `attention` states rendered
- Inline validation on the open question (D42), and the round-end sweep
- Buzzer adjudication with the deny loop
- `DO` scoring, both modes
- Jeopardy board with prompts, picker, tie-break
- Score adjustment with revocation; break start/extend; proxy answer entry
- The finale desk: finalist picker, turn desk, `1`–`5` marking, un-mark, reveal, elimination
  (§10). Build this **last within the slice** — it is the most time-critical UI in the product
  and benefits from the rest of the surface being settled
- The keyboard map — and nothing irreversible bound to a key

---

## Slice 6 — PRD 4: main screen

- Arming click (fullscreen + audio + the `♪ sound ready` confirmation)
- All seven stages
- The five question layouts and the resolver
- Reveal choreography: spotlighting, and the 1.5 s MC distribution beat
- Buzz display with 2-decimal timings
- Timer, break countdown, leaderboard with rank movement, score banner
- The `FINALE` stage: word-shape tiles, clock strip, penalty flash, elimination moment, and
  the two-tab `FINISHED` screen (§12, §10.2)
- The two sounds (buzz, timer expiry) honouring the global mute

**Verify against the §2.1 legibility floor and in `nl`, not `en`.** Both are trivially
skipped and are the whole point of the surface.

---

## Slice 7 — PRD 5: player device

- Join by QR and by code, team picker, device token resume
- All six stages; the four answer methods
- Select-then-submit (D44), submission finality (D43), shared drafts (D45) with the
  focused-field echo rule
- The near-fullscreen buzzer with local-immediate feedback that never claims "first"
- `nosleep.js` with the conventions-scoped enable/disable lifecycle
- Autocorrect disabled on answer inputs — **the single highest-value line in this slice**
- Reliability: offline typing, retry, reconnect without clearing input
- The watch-only `FINALE` stage, with the team's own clock as the dominant element (§10.1)
- Full EN/NL parity

---

## Slice 8 — Review, correction & polish

Everything that needs a played game to be meaningful.

- PRD 2 §13: the round review grid, verdict correction, adjustment audit, team renaming
- Settings: network, language, storage, `Reclaim space`, sound mute
- The orphaned-attachment reconciliation pass
- Export → import round-trip test with a played game
- The **author → export → import → play → score** integration smoke test

---

## Slice 9 — End-to-end browser suite

**Delivers:** a Playwright suite covering the journeys the PRDs document (D49). Runs green
before anyone stands in front of a room.

**Journey-based, not exhaustive.** Scenarios come from documented flows, not from
enumerating controls. Roughly 27 specs, grouped:

### Authoring & portability
1. Author a quiz with all four answer methods, an image and an audio attachment, and a
   5×5 Jeopardy round
2. Pre-flight catches a deliberately broken question; fixing it clears the error
3. Export with history → wipe the data dir → import → quiz and game are identical
4. Import collision offers Replace / Import-as-copy, and each does what it says

### Joining
5. Join by code and by the QR's URL; both land on the team picker
6. Team at `KWIZ_MAX_DEVICES_PER_TEAM` shows full and offers the other teams
7. Device token resume: reload the tab mid-game and land back in the same state

### `QUESTION_SET`
8. Free text: two teams submit, master validates inline, reveals, spotlights one answer,
   scores, advances
9. Multiple choice: distribution appears **~1.5 s after** the correct option is marked
10. Timer expiry auto-submits the entered value; a **late submit is still accepted** and the
    server does not lock the question (D8)
11. **Submission finality:** two devices on one team, second submits a different value →
    rejected, canonical answer shown (D43)
12. **Shared drafts:** type on device A, text appears on device B (D45)

### Buzzer & `DO`
13. Both teams buzz; first is adjudicated; **denied → locked out → buzzers reopen**; second
    buzzes and is accepted (D35)
14. Timer is **paused during adjudication** and resumes on reopen
15. `DO` winner-takes-all including a multi-winner tie, and "nobody got it"
16. `DO` per-team scores, clamped to `0…points`

### Jeopardy
17. Turn order: lowest score picks first; correct answerer picks next; nobody correct falls
    back to lowest (D30). Used tiles show as spent

### Scores, breaks, skips
18. Adjust a score → banner announces with reason → revoke → totals reconcile
19. Break: countdown on the screen **and on player devices**, extend, resume; zero does not
    auto-resume
20. Skip a question: awards nothing to anyone, even one already auto-graded (D46, I8)

### `DSMTW_FINALE`
23. Full finale: pick finalists, fewest-seconds team starts, mark keywords, confirm **every
    other team loses the penalty**, pass, and confirm turn order **recomputes** from the new
    seconds
24. Un-mark a keyword and confirm the penalty is **returned** to every team it was taken from
25. Eliminate a team **off-turn** — a penalty takes a waiting team to zero — and confirm the
    round continues correctly with one fewer finalist
26. Run the finale to a single survivor and check the `FINISHED` screen's two tabs: survival
    ranking, and pre-finale points
26b. **Finale position is unbreakable:** with a finale present, the type picker no longer
    offers one, a new round lands *before* it, and both the drag and `Alt+↓` routes refuse to
    move anything past it
27. **No keyword text reaches the room before marking** — the finale case of scenario 21

### The two that only exist at this level
21. **Network-level sentinel assertion.** Seed the quiz with distinctive secrets, then assert
    across every question state that **no player or main-screen response body, and no
    rendered DOM, contains them.** The unit test (protocol §6.2) proves the filter is
    correct; this proves the filter is the thing being used.
22. **Cross-game isolation with two live games** running simultaneously, plus **kill and
    restart the server mid-game** and confirm all four surfaces resume with correct state
    (D4, D38)

### Determinism rules

A flaky suite gets ignored, which is worse than no suite. Four rules:

- **Fresh data dir per run**, `KWIZ_AUTO_MIGRATE=1`, server started and stopped by the
  harness.
- **Fixtures build quizzes directly through `@kwiz/db`**, not through the authoring UI —
  except in scenarios 1–4, where the UI *is* what's under test. UI-driven setup for all 20
  would be slow and would make every test depend on the authoring surface.
- **Never sleep.** Wait on observable state — an element, a value, an SSE frame. Arbitrary
  waits are how a suite becomes flaky.
- **Finale fixtures use tiny time banks** — 5–10 seconds per team, penalty 2 s. The mechanic
  under test is the arithmetic, not the waiting, and a real 170-second bank would make one
  test longer than the whole rest of the suite.
- **Use short real timers** (2–3 s) rather than mocking the clock. The timer behaviour under
  test is real elapsed time, and clock mocking across a server and five browser contexts is
  more fragile than waiting three seconds.

**Also add:** a CI step running `pnpm e2e`, and traces retained on failure — a failing
browser test with no trace costs more to diagnose than it saved.

---

## Slice 10 — Field rehearsal

Not a coding slice. Run a real quiz end to end and write down what broke.

Slice 9's suite proves the software works. This proves the *system* works — hardware,
network, room, and the things §4.5 of [`agent-workflow.md`](agent-workflow.md) says no
browser can check.

The failures this design most expects, and which only a rehearsal finds:

- The QR code resolving to an unreachable address
- A projector clipping the safe area, or crushing the team palette
- Audio arming silently failing, discovered mid-music-round
- A phone locking despite `nosleep.js`
- Dutch overflowing a main-screen layout
- Twenty devices on one hotspot behaving differently from four on wifi

**Anything the rehearsal finds that *is* automatable gets added to slice 9's suite.** That is
how a one-off embarrassment becomes a permanent guard.

---

## Notes for whoever dispatches this

- **Give each agent the slice, plus `CLAUDE.md`.** It points at everything else. Don't
  paste PRD contents into the prompt — the docs are the contract, and a paraphrase in a
  prompt is a second source of truth.
- **A slice that finds the spec wrong should say so and update the doc**, in the same
  change (conventions §10). Divergence left in code is worse than a spec edit.
- **Slices 1–3 have no UI and no visible progress.** That is expected and correct; resist
  the urge to reorder for the sake of seeing something on screen. The whole game is
  demonstrable in tests at the end of slice 2.
