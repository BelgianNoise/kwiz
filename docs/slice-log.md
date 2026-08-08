# Slice log

One entry per slice, appended by the agent that completed it. See
[`agent-workflow.md`](agent-workflow.md) §6 for the required shape.

The next agent inherits your code and none of your reasoning. This file is the only channel
between them.

Every entry must answer five things: **what you built**, **where you deviated from the specs
and why**, **what you raised without resolving**, **what you deliberately left out**, and
**what the next agent would otherwise have to rediscover**.

---

## Slice 4 — Config surface: authoring, pre-flight, setup, transfer

**Status:** complete · `pnpm check` green · **512 tests** · lint silent · every screen driven by
hand against a real quiz, a real LAN address and a real zip

### What was built

PRD 2, end to end: the landing page and dashboard, the quiz editor, the three round editors
(question set, Jeopardy board, DSMTW finale) with the question sheet, pre-flight, game setup, the
game hub, the first-run network picker, settings, and export/import.

Underneath: `packages/domain` gained the team palette and the pure `preflight()` rules;
`packages/db` gained every template writer plus the export/import repositories; `packages/export`
gained the zip format. One new route table (`/api/authoring/*`, 21 routes), one for this machine
(`/api/settings/*`), and `/api/transfer` for the two calls that are not JSON.

### Deviations from the specs — all four recorded in the specs themselves

1. **`game_team` and `game_device` are projections here** (protocol §8.2). They are written by
   `applyProjection` from `TEAM_ADDED` and `DEVICE_JOINED`, so the spec's list of four
   replay-owned tables is incomplete. The export carries them; the import ignores them and lets
   replay rebuild them, or every row inserts twice.
2. **The join code lives in event payloads**, so importing a joinable game rewrites it there rather
   than patching the row afterwards — a projection may only be written by its event.
3. **`drizzle-zod` date handling** (conventions §10.3): revive the ISO strings before validating.
   Per-column refinements built at runtime defeat its typing and TypeScript gives up.
4. **An accepted buzz credits the team** — found in slice 3, but PRD 1 §8.4 and protocol §4.4 were
   only reconciled then; see that entry.

### Raised and not resolved

- **`localGames` in the import collision dialog counts games whose `sourceQuizId` matches.** For an
  imported-as-copy quiz that is right. For a quiz whose games were themselves imported under a
  different id it is right too. It has not been exercised against a *replaced* quiz whose games
  predate the identity, because nothing yet creates that state.
- **The export is built in memory** (`zipSync`). Correct at PRD 1 §2.1's scale and stated in the
  code; a library of gigabyte videos needs a streaming writer. That is a revisit trigger, not a bug.
- **`Reclaim space` reads the referenced set outside a transaction.** Safe in the direction that
  matters — a row inserted mid-sweep points at a file that was already referenced — and the reverse
  race just leaves a file for the next pass. Worth a second look if reconciliation ever runs
  automatically rather than on a button.

### Deliberately left out

- **Post-game review and correction (PRD 2 §13)** — build-order defers it to slice 8, where the
  event log it reads and rewrites actually has content.
- Nothing from §7.1 or §11.2. **O4's preview is built** — see below.
- **`[Copy from last game]` copies names and colours only.** Nothing else on a team survives, and
  nothing else should.

### Found late, while auditing this slice against build-order

Three things were built but not *finished*, and none of them would have failed a test:

- **O4's preview was skipped on a bad reading of its dependency.** "It needs PRD 4's renderer" was
  true and led to the wrong conclusion: the renderer is what the preview *is*.
- **The `⠿` drag handles did nothing.** Rounds and questions reordered by `↑`/`↓` buttons only,
  while the list showed a grab handle — §15.2 asks for both routes and §6.1 for the drop to be
  refused past the pinned finale. Now one hook, sharing the buttons' own predicate so the two
  cannot drift.
- **§11.2 was missing entirely**, and with it two protocol actions: `TEAM_ADDED` and `TEAM_UPDATED`
  existed as events with nothing that could cause them.
- **`verifyPlayable` could hang forever.** A malformed container that fires neither `loadedmetadata`
  nor `error` left the promise unsettled and the upload button permanently disabled with no
  explanation. Bounded at ten seconds, which is far beyond parsing metadata off a local disk.

The lesson worth carrying: `pnpm check` was green through all three. **Re-read your slice's
build-order bullets one at a time against the running app before declaring it done** — an
affordance that renders is not an affordance that works.

### Slice 6 inherits three real components, not stubs

O4's `[Preview on main screen]` was first deferred here on the grounds that it needs PRD 4's
renderer. That was the wrong call: the preview *is* a scaled-down projector, so building it means
building the stage — and building the stage twice is exactly what O4 exists to prevent. So
`components/screen/` now holds the beginning of PRD 4, used by PRD 2:

- **`StageFrame`** — a fixed 1920×1080 box, CSS-scaled to fit. This is §2.2's letterbox rule made
  mechanical, and it is what makes the preview honest: overflow is a question about *proportions*,
  and a stage re-laid-out into a small box answers a different question.
- **`FittedText`** — §2.4's fitting, binary-searched in `useLayoutEffect` so no unfitted frame is
  ever painted, clamped at §2.1's 4vh floor.
- **`QuestionStage` + `resolveLayout`** — §6's five named layouts. The resolver is a separate plain
  module and is tested; the renderer is not, per D18.

**Sizes inside the frame are `cqh`, never `vh`.** A `transform: scale()` does not change what `vh`
means — it stays relative to the viewport — so `5vh` would be one size in the preview and another on
the projector, which is the single discrepancy this component cannot have. `container-type: size`
makes `1cqh` exactly 1% of the frame, so every number in PRD 4 §2.1 transcribes directly.

Slice 6 should **import these and add the remaining stages**, and wire the timer's countdown from
`deadlineAt` (D52) — `Timer` already takes the value as a prop for that reason.

### What the next agent would otherwise rediscover

**Next evaluates `lib/server/*` twice** — once in the server-component layer, once in the
route-handler layer. Module-level state is therefore **not** shared between a page and an API
route. This had been quietly opening two SQLite connections, two projection registries and two
transports since slice 3; `[kwiz] database up to date` printed twice at boot and nobody looked. It
first *broke* something here: PRD 2 §4's probe is written by a page and read by a route, so the
phone reached the machine and the setup screen never noticed. Everything process-wide now goes
through `lib/server/singleton.ts`, which also survives HMR. **Put any new server-side singleton
through it.**

- **The dev server's HMR websocket does not reach the in-app browser pane.** Hot updates never
  arrive, so a message-file edit appears to have done nothing. Restart the dev server rather than
  debugging the code. Several apparent bugs this slice were a stale bundle.
- **Radix opens menus on pointerdown**, so a programmatic `.click()` on a `DropdownMenuTrigger`
  does nothing. Drive it with a real click. Likewise the confirm dialogs are `role="alertdialog"`,
  not `role="dialog"` — a probe for the latter finds nothing and looks like a broken dialog.
- **Popover and dialog content is portalled outside `<main>`**, so `get_page_text` (which reads
  `main`) misses it entirely. Query the DOM instead.
- **The team palette is a hue wheel, not the array order.** `assignedColour(n)` walks
  `PALETTE_BY_ASSIGNMENT` (Red, Cyan, Amber, Violet, …) so the first four teams are maximally
  distinct; `TEAM_PALETTE` is the display order in the picker. They are different sequences on
  purpose.
- **Crockford Base32 keeps `1` and `8`** and excludes `I`, `L`, `O`, `U`. A join code containing
  `1` is not a bug — that check has been made twice now.
- **`settings.json` lives in the data dir, not the database.** The chosen network address is true
  of one machine on one wifi and must not travel with a copied `kwiz.db`. It is also why
  `chooseAddress` validates against the live interface list rather than a format check.
- **A quiz named like a path is sanitised into the export filename**, and the `content-disposition`
  header is built from the sanitised value. Do not reintroduce the raw name there.

## Slice 3 — Transport: SSE, actions, attachments

**Status:** complete · `pnpm check` green · **440 tests** · lint silent · `pnpm build` clean, no
warnings · the three streams, all 38 actions and the attachment path driven by hand against a real
game

**Built:** `decide()` and the command catalogue in `@kwiz/domain`; the typed error catalogue and
`errors.<CODE>` copy in EN and NL; `loadGameContent`, the drafts repository, device/code resolution
and `createGameFromQuiz` / `resyncGame` in `@kwiz/db`; and in `apps/web/lib/server` the
`RealtimeTransport`, the `Map<gameId, GameState>` registry, the command service, the action
dispatch table and the content-addressed attachment store. Six routes: three SSE, one join, one
catch-all for the other 37 actions, and attachment upload + range serving.

### The shape, and why it is this shape

PRD 1 §6.4 names the flow — *"the domain layer decides: reject, or produce one or more events"* — so
that is literally the code:

```
route → zod → decide(state, command, now) → appendAndProject → registry.catchUp → transport.broadcast
```

**`decide` is pure and lives in `packages/domain`.** Every guard in protocol §7 — submission
finality, the buzz window, the open-question guard on a break, every finale refusal — is a function
of `(GameState, Command, now)`, which is CLAUDE.md §3.2's test answered with a yes. `decide.test.ts`
drives it through a six-line "server" (decide → append → fold) with no mocks, and that is where the
interesting cases live rather than behind HTTP.

Everything a decision cannot invent is passed **in**: ids, device tokens, the device cap, and the
drafts to commit at lock. A decision that minted its own uuid could not be compared against an
expected event list.

**One dispatch module, not 38 route files.** PRD 1 §6.9 constraint 2 names *the action-dispatch
module* as one of three files a transport swap would touch, which only holds if there is one — and
it keeps the catalogue greppable. The SSE routes are deliberately the opposite: one file per
audience, because §2.1 requires the payload filter to be chosen by the route and never by a URL
segment.

### Two real bugs found, both invisible until now

- **An accepted buzz credited nobody.** PRD 1 §8.4 and D35 say the master accepts or denies the
  spoken answer and the team is *credited* — but nothing did it. There is no `ANSWER_SUBMITTED` for
  a buzzer question (nothing was typed), so `BUZZ_ADJUDICATED` is the only event that can award
  anything, and neither half of the projection was doing so. **Every buzzer question and every
  Jeopardy tile scored zero.** Fixed in the reducer and in `applyProjection`, added to protocol §4.4,
  and now covered by a `projection-parity` case.
- **The two halves disagreed about who buzzed first.** `applyProjection` wrote `AWAITING`
  unconditionally with a comment saying the action would decide — but no payload field could carry
  it, so a second buzz during adjudication was `NOT_FIRST` in the reducer and `AWAITING` in the
  table. Both now derive it the same way. Verified with teeth: forcing the old behaviour fails the
  new parity case.

### Spec deviations — all four docs updated in this change

- **The SSE `id` is now `<gameId>:<seq>`, not a bare `seq`.** protocol §3.2 requires a
  `Last-Event-ID` from another game to be treated as unknown *and never compared numerically* — and
  with `id: 42` that is unimplementable, because nothing in the value says which game produced it
  and both games' sequences sit in the same range. Qualifying it costs nothing: `EventSource` echoes
  the id without a client ever reading it.
- **`Last-Event-ID` is consulted once, at connect.** Keeping it on the subscriber and skipping
  "already current" pushes would lose every shared draft (D45), which changes a view without
  changing `seq`. Written into §3.2.
- **conventions §4 was missing four codes**: `GAME_NOT_LIVE` (33 master actions had no status
  guard — only joining did), `DATABASE_MIGRATION_REQUIRED` (D14's declined state is specified but
  had no code), and the two attachment codes. `QUESTION_NOT_OPEN`'s note was widened to cover an
  illegal transition, with idempotent repeats explicitly *not* being an error.
- **"all 25 actions" is 38.** The `DSMTW_FINALE` endpoints arrived after that number was written.
  Corrected in conventions §10.1, and the real list is protocol §7.1–§7.2.
- **Attachment upload had no endpoint anywhere.** PRD 2 §7.1 describes the UI; §7 listed only reads.
  Added as protocol §7.5, including that the type is sniffed from the bytes — a declared
  `Content-Type` is no better than a filename, and data model §4.7 requires the *detected* type.

### Two things that only fail in a build

Both were invisible to `pnpm check` and cost the slice its first green build:

- **`MIGRATIONS_FOLDER` was a module-level `const` using `import.meta.dirname`.** Next bundles
  `@kwiz/db` (it is a `transpilePackages` entry), and in that bundle `import.meta.dirname` is
  **`undefined`** — so the const threw `ERR_INVALID_ARG_TYPE` while Next collected page data, with a
  message naming `join` rather than the reason. Now `migrationsFolder()`: lazy, and it *searches*
  candidates for drizzle-kit's journal instead of assuming one.
- **`./data` meant `apps/web/data`.** Both `pnpm dev` and `pnpm start` run Next with the cwd at
  `apps/web`, so a master's only database landed somewhere neither the docs nor CLAUDE.md §3
  mention. Anchored with `apps/web/.env.development` / `.env.production` — `.env` itself is
  gitignored, which is why it is those two files — and a real environment variable still wins.

Also five Turbopack "dynamic filesystem access" warnings, from paths that are dynamic **by design**
(`KWIZ_DATA_DIR`, and a filename that is a content hash). Opted out with `turbopackIgnore`, because
the alternative is tracing the whole project into the server output and a build that is never clean.

### Raised, not resolved

- **`createGameFromQuiz` is slice 4's, and slice 3 needed it.** `/resync` cannot exist without the
  copy function, and nothing else could create a game to smoke-test against. Written in `@kwiz/db`
  per data model §7 rather than reached for from the app, spreading `SHARED_COLUMN_GROUPS` so the
  §7.2 parity guard passes by construction. Slice 4 inherits it and should add teams and the
  palette on top rather than rewriting it. **This is a build-order gap, not a spec bug.**
- **No REST reads yet** (protocol §7.4). `GET /api/games`, `/review`, `/validation-queue` and the
  quiz tree belong with the surfaces that read them (slices 4 and 8). One consequence lands on
  slice 7: a phone can join a code but there is no endpoint that lists a game's teams, so the team
  picker needs one — probably `GET /api/games/by-code/:code`.
- **No typed client module.** PRD 1 §6.9 constraint 3 wants components to call one, never `fetch`.
  Writing it now would be an untested stub for surfaces that do not exist; it belongs with slice 4's
  first form.
- **The team palette (conventions §3) is still absent.** Slice 0 assigned it to slice 2, slice 2 did
  not add it, and slice 3 does not need it — no action creates a team. Slice 4 must add it to
  `@kwiz/domain` before game setup.

### Three loose ends closed before handing over

- **The D14 prompt is now tested** — slice 1's oldest open row. `askTerminal` takes its streams as a
  parameter, so a test runs the real `readline` over a pipe: it asserts the listing names every
  migration, that the backup path is shown, that `n` refuses and that a bare Enter is a yes.
  Verified with teeth by making it always return `true`. What is left for a human is only whether it
  *looks* right in a terminal, which is now the whole of that checklist row.
- **The SSE route itself is tested** (`sse.test.ts`), not just the modules under it: headers,
  `retry` + first view, the `Last-Event-ID` skip, an id from another game being ignored, subscribe
  and unsubscribe, and all three refusals — 404, 401 and the D14 503.
- **A locked question's drafts are deleted.** They were left behind, and for a team whose draft was
  empty — never committed, because an empty draft is not an answer — the draft would have gone on
  showing as that team's in-progress text on a closed question.

Plus `actions.test.ts`, which transcribes protocol §7.1–§7.2's paths **independently of the route
table** and compares the two. With no client yet, a dropped endpoint would otherwise be invisible.

### Not verifiable here

- **Nobody has watched the migration prompt render in a real terminal.** Its logic is covered; its
  appearance is not, and cannot be from here.
- Everything else in this slice was driven by hand against a running server: the three streams,
  ping cadence, the qualified id, join, submission finality, a **server restart mid-question**, and
  the attachment upload/range/dedup path.

### Next agent should know

- **`runCommand` in `lib/server/service.ts` is the one way to change a game.** It decides, appends,
  folds and pushes, in that order. The append is the commit point (PRD 1 §6.4): nothing is broadcast
  that is not already durable.
- **`FINALE_ENDED` has no endpoint and no client decides it.** The service settles it after every
  command, deriving the ranking with `finaleRanking` — the same function the views use, so the event
  and the deriver cannot disagree.
- **A draft push is a state frame with an unchanged `seq`**, sent only to that team's devices
  (`publishToTeam`). If you find yourself suppressing pushes by comparing `seq`, that is the case
  you will break.
- **`decide` returning `{ ok: true, events: [] }` is a real answer**, not a failure: an idempotent
  retry, a second click, or a stale observation the server declines to act on (a finale elimination
  for a team still above zero is the clearest one). Collapsing it into an error makes every D8 retry
  look broken.
- **`@kwiz/db/test-support` is now an exported subpath**, so `apps/web` tests get a real migrated
  in-memory database. `createTestRuntime()` in `lib/server/test-runtime.ts` assembles a whole server
  minus HTTP — use it rather than mocking anything.
- **Seeding for a manual smoke:** a throwaway `*.test.ts` under `packages/db/src` that calls
  `createGameFromQuiz` against `./data`, run with vitest and then deleted. Slice 1's finding still
  holds — you cannot run package source with plain `node`.
- **`PICKER_ASSIGNED` is appended even when it only confirms the rule** (slice 2's open item, now
  closed): the `picker` action always appends, so the log answers "whose pick was it?" without
  re-deriving D30.

## Slice 2 — `packages/domain`: the rules

**Status:** complete · `pnpm check` green · 323 tests · lint silent · **the whole game is playable in tests, with
no server and no UI**

**Built:** `constants.ts`, `answers.ts` (D22), `question-state.ts` (PRD 1 §7.1), `state.ts`,
`reduce.ts` over all 40 event types, `derive.ts` (everything deliberately not stored), `views.ts`
(the three filters + `attention`), and the protocol §6.2 sentinel leak test.

### The layering bug slice 1 left, fixed first

`packages/domain` may not import `@kwiz/db` — oxlint enforces it — but the **event catalogue, the
enum vocabulary and the content-config schemas were all in db**, and every domain function is
defined over exactly those events. Keeping them there would have forced a duplicate union in
domain, which is the drift the single-writer design exists to prevent. Moved to `@kwiz/domain`; db
imports them and no longer re-exports them. All 97 db tests passed unaltered, so the move was
behaviour-neutral.

**`@kwiz/domain` now owns the vocabulary; `@kwiz/db` owns persistence.** Do not move it back.

### The design that matters most

**`reduce(content, events)`** — `content` is the game-copy subtree, which is *not* in the log and
never could be: a question's prompt is not something that happened. Separating it is what keeps the
reducer a pure function of two inputs. There is **no clock inside it**: every timestamp comes from
the event that carried it, so a replay is byte-identical and every test is a literal array.

**`derive.ts` holds what is not stored** (§1.1) — lockout set, timer pause, standings, Jeopardy turn
order, every finale clock. If you find yourself adding a field to `GameState` for one of these,
that is a second source of truth for the same fact.

### Spec deviations

- **PRD 1 §7.1 draws `BUZZED` as a state box.** The canonical type has six states and no such
  member: a buzzed question stays `OPEN`. Noted inline, because modelling it as a state would turn
  D35's deny → reopen loop into a cycle in the state machine rather than what it is — repeated
  buzzes against one unchanged question.
- **`FinaleTurnDetail` carried no keywords in my first pass**, which left the master with no way to
  read the text they are supposed to mark. The sentinel test caught it. Added per protocol §5.5;
  it is the one place keyword text is transmitted before marking.

### A real bug found while closing the gaps

**A skipped question was still being presented as an open one.** `QUESTION_SKIPPED` leaves
`currentQuestionId` set — the master went around it — so the stage resolver kept yielding
`QUESTION`, and since `SKIPPED` has no visible state of its own it rendered as **`OPEN`**: a dead
question that looked like it was still taking answers, on both the projector and every phone.

Fixed in `stageKind`, and it is now two tests: the stage falls back to the round intro, and the
skipped prompt appears in neither audience's payload. I had flagged the `PENDING`/`SKIPPED` → `OPEN`
fallback as "a smell" in the first pass; it was not a smell, it was a bug.

### The drift slice 1 predicted, found and closed

Slice 1 left auto-grading out of `applyProjection` because `normaliseAnswer` did not exist yet, and
recorded it as "incomplete in one specific way, not wrong". Once slice 2 added the matcher, that note
became a **live drift**: `packages/domain`'s reducer graded a `FREE_TEXT` match to `AUTO_CORRECT`
with points, while `packages/db`'s projection still wrote `PENDING` with zero.

The symptom would have been nasty and confusing rather than loud — **master control calling a team
correct and scoring while the review grid still called the answer pending**, from the same log.

`applyProjection` now calls `@kwiz/domain`'s `gradeFreeText` / `gradeMultipleChoice`, never a local
copy, and `projection-parity.test.ts` runs one identical event list through **both** halves and
compares verdicts, points and scores across seven scenarios — auto-correct, near-miss, master
reversal, skip, adjustment and revocation, two teams graded differently, and a D47 proxy re-answer.

**Verified the guard has teeth**: making the writer always return `PENDING` fails 5 of its 7 cases.

Its fixture drives **everything** through the log — hence `seedGame(db, { withTeams: false })` plus
`TEAM_ADDED` events. Seeding rows directly is fine elsewhere, but two halves comparing different
histories would agree about nothing and pass.

### Raised, not resolved

- **`suggestedPicker` returns a suggestion; nothing appends `PICKER_ASSIGNED`.** That is an action's
  job (slice 3). The log is supposed to answer "whose pick was it?" without re-deriving the rule, so
  **the action must append it even when it merely confirms the suggestion.**

Everything else raised in the first pass is now closed:

- **Drafts** are a parameter of `toPlayerView` (`DraftLookup`, keyed by `gameQuestionId`) rather than
  a note for slice 3 to remember. Domain stays pure — it receives a plain map — but D45 is now
  impossible to forget, because a caller that ignores drafts is visibly ignoring an argument. A
  submission supersedes a draft, since submission is final (D43).
- **Lint is silent**, warnings included. The two casts that genuinely cannot be avoided —
  `Object.keys` narrowing in `payload.ts`, and re-pairing a validated payload with its variant in
  `parse.ts` — carry a one-line disable stating why. `describe()` now uses `instanceof z.ZodError`
  rather than asserting a shape, and the tests assign from `JSON.parse` instead of asserting.
- **The `no-misused-spread` suppression is gone.** `Array.from(w).length` iterates code points
  exactly as `[...w].length` did, so the stored `wordLengths` are unchanged and conventions §8 was
  updated to match. Code points are still not graphemes — an emoji counts as several — which remains
  a documented limitation rather than a suppressed warning.

### Next agent should know

- **`toMainScreenView` / `toPlayerView` / `toMasterControlView` take `now`**, because a running timer
  and a finale clock are functions of it. Pass the request instant; never read a clock inside domain.
- **The sentinel test is the enforcement, and it has a complement.** It asserts each secret does
  appear *once permitted* — without that, a filter returning nothing would satisfy the forbidden
  table trivially. **Add a sentinel when you add a secret.**
- **`toPlayerView` takes a `DraftLookup`.** Pass the team's drafts from `game_answer_draft` or two
  devices on one team will not see each other typing (D45). Omitting it means *no drafts*, never
  "do not share them" — there is a test asserting exactly that distinction.
- **`visibleState`'s `PENDING`/`SKIPPED` fallback is unreachable by design.** `stageKind` only yields
  `QUESTION` for the current question, which cannot be `PENDING`, and it now explicitly excludes
  `SKIPPED`. If you make a non-current question renderable, revisit both — invariant 6 depends on it.
- `FINALE_ENDED.ranking` is **stored as given**, while `finaleRanking(state)` derives the same thing.
  The action should append what the deriver produced; they must not disagree.

## Slice 1 — `packages/db`: schema & migrations

**Status:** complete · `pnpm check` green · 87 tests

**Built:** all **24 tables** (drizzle-kit confirms the count) via the §3 shared factories; zod
validators for every JSON column; the 40-type `game_event` payload union validated on append
*and* replay; the connection module with all four pragmas; the first migration; D14's boot
prompt; `appendAndProject`; and the §7.2 column-parity guard.

### Spec deviations — all fixed in the same change

Four, and three were found only by writing the code that had to obey them:

- **Drizzle's object-form index callback is `@deprecated.**` All 23 table definitions in the data
  model used it. Since §0 says the Drizzle definitions *are* the specification, following it
  faithfully would have written the whole schema against a dead API. Converted to the array form.
- **`SCORE_ADJUSTMENT_REVOKED` referenced an id that `SCORE_ADJUSTED` never recorded.** A
  projection rebuild (§11) replays into empty tables, so the adjustment came back with a fresh
  uuid and **every revocation silently stopped matching — restoring points a master had taken
  away.** `SCORE_ADJUSTED` now carries its own row id, as `BUZZ_RECEIVED` already did.
- **Projection timestamps came from the write clock.** `game_score_adjustment.createdAt` and
  `game_team.createdAt` used the column default, so a rebuild stamped *now* and rewrote when
  things happened. Both generalised into a rule in protocol §4.7 and I15.
- **`DEVICE_JOINED` could not project the row it creates**: the payload had no `deviceToken`, and
  only `lastSeenAt` is exempt from the log, so `game_device` could never be written by the sole
  writer. Added to the payload — no new exposure, since the log is on the same disk as the table.
- **`FINALE_ENDED { ranking }` was a flat list**, which cannot express the shared rank PRD 1 §8.8
  requires for simultaneous elimination. Now `teamId[][]`, rank groups best first.
- Also: `text({ enum })` generates **no** `CHECK` constraint (so widening one needs no migration,
  and the database will not reject a bad value); the invariant table was reordered into I1–I22;
  and §11.1 now records how D14's prompt is assembled.

### Raised, not resolved

- **Auto-grading is absent, and that is a build-order boundary rather than an oversight.** A
  `FREE_TEXT` or `MULTIPLE_CHOICE` verdict is computed from the submission plus the accepted
  answers (protocol §4), which needs `normaliseAnswer` and the matcher — build-order **slice 2**.
  Until then a submission projects as `PENDING`, which is `game_answer`'s documented default
  (§6.5) and the correct pre-grading state. **Incomplete in one specific way, not wrong**, and
  the I15 rebuild test will catch it the moment slice 2's grading and the projection disagree.
- **`@types/better-sqlite3` is at 9.6.0 against our v13.** Diffed the surfaces: the only gap is
  `Database.explain`, a debug helper. Fine, but a v13-aware types release is worth taking.
- **No `createGame` / `resyncGame` yet** (§7, §7.1). build-order does not put them in slice 1 and
  nothing needs them until slice 4, but the column-parity guard exists to protect the copy
  function they will contain — so whoever writes it should spread `SHARED_COLUMN_GROUPS` rather
  than hand-listing fields, which makes the guard pass by construction.

### Next agent should know

- **`bootDatabase()` in `src/boot.ts` is the entry slice 3 calls** — it opens the configured
  database and settles migrations before anything serves a request, returning the outcome rather
  than deciding. `DECLINED` is not a crash: the server boots and every surface must render the
  "database needs migrating" screen (§6.7).
- **Do not add a CLI that runs package source directly with `node`.** I tried, and it fails:
  Node's ESM resolver wants full filenames, so every extensionless relative import across the
  workspace is an `ERR_MODULE_NOT_FOUND`. Fixing it means either `.ts` extensions repo-wide or a
  loader dependency, and neither is worth it — the bundler resolves these fine, which is how the
  real entry point reaches this code. `boot.test.ts` covers the behaviour against a real
  directory instead.
- **`appendAndProject` is the only way to write the play half.** It validates, appends and
  projects in one transaction and returns `seqs`; broadcast happens *after* commit, which is why
  it pushes nothing itself.
- **`freshTestDatabase()` in `src/test-support.ts`** gives an in-memory database with the real
  migrations applied, and `seedGame()` the minimum tree (game → round → question → two teams).
  Use them; there is no reason to fake a database when one costs a function call.
  `MIGRATIONS_FOLDER` is absolute on purpose — a relative path resolves against the *process*
  cwd, which is the workspace root when vitest runs from there.
- **`seedGame` generates a unique code per game.** A hardcoded one cannot seed two `SETUP` games:
  the partial unique index rejects the second, correctly. That caught me, and it is now its own
  test in `schema/game.test.ts`.
- **`replay.test.ts` is I15, the keystone.** It wipes the projections and replays through the
  *same* `applyProjection`. If you add a projection effect, that test is what proves a rebuild
  still matches — and it is where both id/timestamp bugs above surfaced.
- **`oxfmt` ignores `packages/db/migrations/**`.** Those are drizzle-kit's own artifacts; the
  first `db:generate` had it rewriting the snapshot and journal.
- Migrations are **forward-only and committed**. Never hand-edit an applied one; add a new one. A
  column added to a shared factory generates changes to **two** tables, which is expected.

## Slice 0 — Scaffold

**Status:** complete · `pnpm check` green · `pnpm build` clean, no warnings

**Built:** pnpm workspace (Node 24.19.0, TypeScript `strict`); `@kwiz/config` with the PRD 1
§6.8 env schema and 20 tests; empty `@kwiz/domain` / `@kwiz/db` / `@kwiz/export`; oxlint with
the §1.4 architectural overrides plus `scripts/check-no-process-env.mjs`; oxfmt with the house
style pinned; Vitest workspace with a project per package; Next 16 App Router app with
Tailwind v4 + shadcn/ui tokens; next-intl `en`/`nl` implementing all three steps of PRD 1
§9.4's resolution order.

### Spec deviations — all four docs updated in this change

- **conventions §1 cited "PRD 1 §10" for shadcn/Tailwind.** Styling is PRD 1 **§9.1**; §10 is
  Export & import. Corrected. (The two `PRD 1 §10` references in protocol §8 are right — they
  really do mean Export & import.)
- **conventions §1.3 specified `no-floating-promises: error`, which was doing nothing.** It was
  named without its `typescript/` prefix and without `--type-aware`, and oxlint ignores an
  unknown rule name in silence. Now correctly configured and enforced — see "Floating promises
  are enforced after all" below for what it took.
- **conventions §1.3's config block was incomplete as written.** It now also carries
  `ignorePatterns`, a `scripts/**` override for `no-console`, `react/react-in-jsx-scope: off`
  (Next uses the automatic JSX runtime) and `import/no-unassigned-import` allowing `*.css`
  (how an App Router layout loads styles). Without the last two, a clean scaffold emits 11
  warnings.
- **conventions §1.5's scripts assumed a single-package repo.** `typecheck` fans out with
  `pnpm -r typecheck` because one root project cannot serve both the packages and a Next app;
  the root `tsconfig.json` covers the files no package owns. `lint` now also runs the
  `process.env` guard, and `format:check` was added so `check` can compose them.
- **Added conventions §1.3.1** documenting `.oxfmtrc.json`, and a note in §1.4 that the three
  architectural rules are covered by a test.

### CI (added after the initial slice-0 report, conventions §1.6)

`.github/workflows/ci.yml` runs format, lint (including the `process.env` guard), typecheck,
test and build on a **`ubuntu-latest` + `windows-latest` matrix**. Node comes from `.nvmrc`
and pnpm from `packageManager`, so CI has no versions of its own to drift from the repo's.

Two things came with it that are easy to mistake for decoration:

- **`.gitattributes` with `* text=auto eol=lf`.** `oxfmt --check` gates CI, so a CRLF checkout
  on the Windows runner would fail for a reason unrelated to any code.
- **`scripts/native-sqlite.test.ts`**, which asserts a prebuild exists for the current
  platform, that `better-sqlite3/build/` does **not** (so node-gyp never ran), and that the
  binary actually loads and enforces a foreign key. This is what makes conventions §1.1 a
  standing guarantee instead of something verified once by hand. **If it ever fails, apply
  §1.1's fallback — pin the Node major, or move to `node:sqlite` — do not set
  `allowBuilds.better-sqlite3: true` to make it pass.** It is also the reason the matrix has
  two operating systems: the prebuild is per-platform, so a Linux-only pipeline proves nothing
  about the laptop the quiz runs on.

Verified by wiping every `node_modules`, reinstalling with `--frozen-lockfile`, and running all
five steps in order — not just by trusting the YAML. The workflow is also schema-validated.

### Floating promises are enforced after all (conventions §1.3)

The first slice-0 report said nothing mechanically caught a floating promise, and that oxlint
had no type-aware rules. **That was wrong**, and worth correcting because it would have led
someone to bolt typescript-eslint on beside oxlint for no reason.

oxlint 1.77 does have type-aware rules — they are simply **off unless you ask**, needing both
the `--type-aware` flag and the `oxlint-tsgolint` package. Now enabled as errors:

| Rule | Catches |
| --- | --- |
| `typescript/no-floating-promises` | a dropped `appendAndProject()` or SSE write |
| `typescript/no-misused-promises` | `xs.forEach(async …)`, a promise where `void` was expected |
| `typescript/await-thenable` | `await` on a non-promise |

**`pnpm lint` is `oxlint --type-aware`, and the flag is load-bearing** — without it these three
report nothing *and say nothing about why*. `scripts/architecture-rules.test.ts` therefore
asserts both that they fire with the flag and that they are silent without it, so nobody
"simplifies" the script back to plain `oxlint`.

**New dependency, flagged per agent-workflow §3.4:** `oxlint-tsgolint` (dev only, root). It is
the type-aware backend and nothing already present can do this. It ships platform binaries as
optional dependencies for all six mainstream targets — including both CI matrix platforms — so
it needs no compilation, consistent with conventions §1.1.

**Expect noise from `no-misused-promises` in slices 4–7**: `onClick={async () => …}` returns a
promise where `void` is expected. The fix is `onClick={() => { void handle() }}`, which is
better regardless — it makes a deliberately unhandled promise visible at the call site. Do not
switch the rule off to avoid typing that.

### Raised, not resolved

- **No zip library is chosen for `@kwiz/export`.** conventions §1's dependency table names
  none, and slice 0 had no reason to pick. Whoever implements protocol §8 flags the addition
  per agent-workflow §3.4.
- **No README, deliberately deferred.** `CLAUDE.md` covers everything an agent needs. A human
  README waits until the surfaces exist so it can carry screenshots — so it belongs with
  build-order slice 8 or 10, not here. It still needs to say that the repo wants Node 24 and
  corepack, since `engineStrict` reports that only after someone has already tried.
- **pnpm 11 has a supply-chain release-age gate** and auto-wrote a `minimumReleaseAgeExclude`
  entry for `better-sqlite3@13.0.3`. Left as generated; a future version bump will need the
  same acknowledgement.

### Deliberately absent

- **Any UI beyond the boot proof** (build-order's "do not" line). The scaffold page is not a
  draft of the landing page — PRD 2's is slice 4's, and its switcher has placement rules
  (PRD 1 §9.4) this page deliberately ignores.
- **No shadcn components installed.** Only the tokens, `components.json` and `cn()`, so
  `pnpm dlx shadcn@latest add <component>` works out of the box.
- **The four per-surface type scales** (PRD 1 §9.2). Tokens only. A scale invented without a
  surface to hold it against is a guess; each arrives with its surface.
- `domain`, `db` and `export` are `export {}` — slices 2, 1 and 4.
- **The team palette** (conventions §3) — belongs in `@kwiz/domain`, slice 2.
- **`errors.<CODE>` messages** — must mirror conventions §4's catalogue exactly, so it belongs
  with the actions in slice 3, not to a guess now.
- **The D14 migration prompt** (slice 1) and **Playwright** (slice 9; the `e2e` scripts exist
  but the dependency and config do not).

**Not verifiable here:** nothing this slice claims. No secure-context or device behaviour is
in play yet (agent-workflow §4.5).

### Next agent should know

**Toolchain**
- Node **24.19.0** was installed via the nvm-windows already on this machine, and
  `.nvmrc` pins it. pnpm **11.20.0** comes from corepack via `packageManager`.
- **conventions §1.1 is resolved, and the answer is good:** `better-sqlite3` **13** ships
  N-API prebuilds for eight platforms *inside the npm tarball*, so it installs with **zero
  compilation**. Neither §1.1 fallback was needed. `allowBuilds` in `pnpm-workspace.yaml`
  therefore pins `better-sqlite3: false` **on purpose** — flipping it to `true` silently
  reintroduces the toolchain dependency §1.1 exists to prevent. `@swc/core` and
  `@parcel/watcher` are false for the same reason. Verified at runtime: it loads, and
  `PRAGMA foreign_keys = ON` genuinely rejects a bad FK (`SQLITE_CONSTRAINT_FOREIGNKEY`),
  which is CLAUDE.md §4's requirement.

**Gotchas that will cost you an hour each**
- **Internal packages are consumed as TypeScript source** (`main: ./src/index.ts`) with
  `transpilePackages` in `next.config.ts`, so there is no build step. **A new package must be
  added to that array**, or Next will fail to parse it. `serverExternalPackages:
  ['better-sqlite3']` is already set for slice 1.
- **Every package needs its own `@types/node` devDependency.** pnpm's strict `node_modules`
  means a root devDep is not visible to a workspace package, and the failure is a confusing
  `TS2688: Cannot find type definition file for 'node'`.
- **oxlint accepts an unknown rule name silently** — no warning, exit 0. That is how
  `no-floating-promises` sat in the config doing nothing. `scripts/architecture-rules.test.ts`
  runs the real linter over real violations for this reason; if you add an architectural rule,
  add a case there. Its fixtures are **not gitignored on purpose** — oxlint always honours
  `.gitignore` and `--no-ignore` only disables `.eslintignore`, so an ignored fixture is never
  linted and the test would pass while proving nothing. Do not "tidy" them into `.gitignore`.
- **oxfmt has `sortImports` and `sortTailwindcss` on**, so it will reorder your imports and
  class lists. Run `pnpm format` before `pnpm check` rather than fighting the diff. It ignores
  `**/*.md`, because it would otherwise reflow the hand-wrapped prose in `docs/`.
- **`middleware.ts` is `proxy.ts` in Next 16.** The old name still works but warns.
- **`engineStrict: true` lives in `pnpm-workspace.yaml`, not `.npmrc`.** Under pnpm 11,
  `engine-strict=true` in `.npmrc` downgrades to a *warning*, which is worse than absent
  because it reads like enforcement. From the workspace file it hard-fails with the wanted
  and actual versions. Verified by temporarily demanding Node `>=99`.
- **Every `shadcn add` needs a `pnpm format` afterwards.** The generator emits
  prettier-default style — semicolons, double quotes — which fails `oxfmt --check` and so
  fails `pnpm check`. Nothing is broken; run `pnpm format`. Verified end to end in this slice
  by generating a Button, formatting, and passing the full gate, then reverting it (an unused
  component and an unflagged `radix-ui` dependency would have been a stub for slice 4). The
  CLI needs `pnpm dlx`, not `pnpm exec`, and must run from `apps/web`.
- **`noUncheckedIndexedAccess` is on.** Array access yields `T | undefined`. This is deliberate
  and most valuable in slice 2's finale arithmetic; do not switch it off to save a few
  non-null assertions.

**i18n — the one that is genuinely surprising**
- `localeDetection: false` in next-intl disables **the cookie as well as `Accept-Language`**,
  and there is no setting for one without the other. D17 wants the header ignored but PRD 1
  §9.4 step 2 wants the cookie honoured, so **the cookie read is hand-implemented in
  `proxy.ts`**. next-intl still *writes* `NEXT_LOCALE`, so only the read side is ours.
  **If you touch `proxy.ts`, re-run the resolution-order probe** — all three steps are rows in
  the slice-0 smoke checklist.
- **The locale reaches next-intl through `next/root-params`, not `setRequestLocale`.** Next 16
  generates a typed `locale()` accessor from the `app/[locale]` segment, and next-intl
  deprecated the older `requestLocale` + `setRequestLocale` pair in favour of it. `i18n/request.ts`
  reads the segment itself, so **a layout never has to prime anything** — if you add a surface,
  do not reintroduce a `setRequestLocale` call. Switching also made the routes properly
  prerendered (`● /en`, `● /nl`) where `setRequestLocale` had left them dynamic.
- **`next/root-params` is untyped until the first build.** Its real types are generated into
  `.next/types/root-params.d.ts`; before that Next ships a shorthand ambient declaration, so
  `locale()` is `any` rather than a compile error. On a fresh clone, run `pnpm build` once
  before trusting editor types there.
- `messages/nl.ts` is typed `: Messages` from `en.ts`, so **a key present in English and
  missing in Dutch is a compile error**. `global.d.ts` registers `AppConfig`, so `t()` keys are
  checked too — a typo is a build failure, not a raw key on a projector.
- Use `Link`/`useRouter` from `@/i18n/navigation`, never `next/link`, or a language switch
  will not preserve the path.

**Handy:** `.claude/launch.json` defines `kwiz-dev`, so `preview_start` opens the app directly.
