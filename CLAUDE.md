# CLAUDE.md — working on Kwiz

Kwiz is a **self-hosted pub-quiz engine that runs offline on a LAN**. The quiz master's
laptop is the server; a projector shows the audience screen; each team plays on one shared
phone. No accounts, no internet, SQLite on disk.

**The repo is not scaffolded yet.** The design is complete and normative; the code is not
written. If you are implementing, start from §2.

---

## 1. Where the truth lives

Read [`docs/prd/01-main.md`](docs/prd/01-main.md) first — its **decision log (PRD 1 §5)** is the
single most useful page in the repo. 58 decisions, each with rationale and a "revisit if".
Cite them as `D14`, `D35` etc.

| Doc | Answers |
| --- | --- |
| [prd/01-main.md](docs/prd/01-main.md) | Goals, non-goals, trust model, **decision log**, architecture, confidentiality rules, domain model, styling, testing bar |
| [spec/data-model.md](docs/spec/data-model.md) | Drizzle schema, all 24 tables, invariants I1–I22, deletion rules |
| [spec/protocol.md](docs/spec/protocol.md) | SSE contract, event catalogue, **per-audience payload shapes**, export zip format |
| [spec/conventions.md](docs/spec/conventions.md) | **Concrete values**: toolchain, code alphabet, team palette hex, error codes, timing constants, i18n keys, MIME allowlist, definition of done |
| [prd/02-config.md](docs/prd/02-config.md) | Landing, authoring, Jeopardy board builder, pre-flight, export/import, game setup, review |
| [prd/03-master-control.md](docs/prd/03-master-control.md) | Live control desk: attention model, validation, buzzer loop, `DO` scoring, the finale desk |
| [prd/04-main-screen.md](docs/prd/04-main-screen.md) | Projected screen: legibility limits, stage designs, reveal choreography |
| [prd/05-player.md](docs/prd/05-player.md) | Phone: join, answer methods, buzzer, reliability |

**The three specs in `docs/spec/` are normative.** Where a surface PRD disagrees with them,
the spec wins. Where you disagree with a decision, say so — don't silently deviate.

Two working documents, neither normative — they go stale as work lands, the specs don't:

| Doc | Purpose |
| --- | --- |
| [`docs/build-order.md`](docs/build-order.md) | **What** to build, in what order — ten sequential slices |
| [`docs/agent-workflow.md`](docs/agent-workflow.md) | **How** to execute a slice: orient → build → verify → regress → report |

**If you are implementing, read `agent-workflow.md` before starting and re-read its §4–§5
before declaring a slice done.** Regression and handoff are the two phases most often
skipped and the two that matter most in a chained dispatch.

---

## 2. The rules you will otherwise break

Every one of these is easy to violate and expensive to discover late.

### 2.1 `packages/domain` is pure

No `import` of a database, a Next.js type, a `Request`, a socket, or `process.env`. It
contains the question state machine, scoring, answer matching and buzz ordering as **pure
functions over an event list**.

This is not stylistic. It is what makes D3's transport-swap possible, and it is why tests
need no mocks (§6).

```ts
// The shape a domain test should have. No mocks, no setup.
const state = reduce([gameStarted(), questionOpened(q1), answerSubmitted(tA, 'paris')])
expect(state.scores[tA]).toBe(10)
```

### 2.2 Never write a projection without appending its event

`game_answer`, `game_buzz` and `game_score_adjustment` are **derived**. One writer:
`appendAndProject()` (data model §6.4.1), which appends to `game_event` and updates the
projection **in the same transaction**.

If you want to `UPDATE game_answer`, the change you want is an event.

Two narrow exemptions, and nothing else: `game_device.lastSeenAt` and the
`game_answer_draft` table.

### 2.3 Payload filters are allowlists that construct

Per-audience views are built by **constructing a new object containing only permitted
fields** — never by taking internal state and deleting from it.

A filter that strips fields fails silently the day someone adds a field. A filter that
builds up fails visibly, by omitting it.

```ts
// WRONG — both of these are bugs even when the output looks right
delete view.correctAnswer
return { ...state, correctAnswer: undefined }
```

Protocol §6.2's **sentinel test** is the enforcement: secrets are distinctive strings, and
the test asserts they appear nowhere in `JSON.stringify(view)` across every
(audience × question state) pair. Add a sentinel when you add a secret.

### 2.4 There is no "the current game"

Multiple games can be live (D21). Every route carries a `gameId`; the projection is a
`Map<gameId, GameState>`. **No endpoint, query or component resolves a game implicitly** —
not "the most recent", not "the only active one".

`seq` is per-game, so a `Last-Event-ID` from another game must be treated as unknown, never
compared numerically.

### 2.5 The server never enforces a question deadline

`deadlineAt` is **advisory** (D8). The client submits at zero; the server accepts late
answers. Only the master locking the question stops submissions.

A phone that was asleep at zero submits when it wakes, and it counts.

### 2.6 Submission is final, first write wins

At most one `ANSWER_SUBMITTED` per `(question, team)` (D43). A second submission with the
same value is a no-op (that's the D8 retry); with a **different** value it is **rejected**,
returning the canonical answer — never overwritten. Two devices on one team is why.

The sole exception is the master submitting on a team's behalf (D47).

### 2.7 Names are never identifiers

UUIDv7 primary keys everywhere. Two teams may share a name. Ordering is an explicit
`position` column — never id order, insertion order, or `createdAt`.

### 2.8 A finale keyword's text is absent, not blurred

`DSMTW_FINALE` (PRD 1 §8.8) shows unguessed keywords as blurred word shapes. **Blurring
transmitted text is a leak** — devtools reads it. The payload carries `wordLengths` only
(`"i like cows"` → `[1,4,4]`); `text` appears once the keyword is marked or revealed (D53,
§7 invariant 8).

`wordLengths` is **stored on write**, so a payload filter never loads `text` at all for an
unmarked keyword — the difference between a rule and a guarantee.

### 2.9 Every finale clock is derived, never ticked

`remaining = startingSeconds − Σ turn durations − penalties − (now − currentTurnStart)`.

No server timer, no tick event (D52). Clients count down from `turnStartedAt`. A restart
mid-turn recovers every clock exactly, which is the same property D4 buys everywhere else.

### 2.10 Check secure-context before using a browser API on a player surface

The LAN deployment is **plain HTTP**, so `navigator.wakeLock`, `getUserMedia`, Clipboard
`writeText` and Service Workers are `undefined` there (PRD 1 §6.10). `localhost` — the
master's own surfaces — is fine.

---

## 3. Repo layout

```
kwiz/
├─ apps/web/                     Next.js app, all four surfaces
│  ├─ app/[locale]/
│  │  ├─ (landing)/              /            host or join
│  │  ├─ admin/                  PRD 2
│  │  ├─ control/[gameId]/       PRD 3
│  │  ├─ screen/[gameId]/        PRD 4
│  │  └─ play/[code]/            PRD 5
│  └─ app/api/                   SSE stream, actions, attachment serving
├─ packages/
│  ├─ domain/                    pure game logic — see §2.1
│  ├─ db/                        Drizzle schema, migrations, repositories
│  └─ export/                    zip read/write, manifest, validation
├─ data/                         created at runtime; gitignored
│  ├─ kwiz.db
│  ├─ attachments/<sha256>.<ext>
│  └─ backups/
└─ docs/
```

---

## 4. Database

Drizzle ORM + `better-sqlite3`. Full schema in [data model](docs/spec/data-model.md).

- **`PRAGMA foreign_keys = ON` is required per connection.** SQLite does not enforce
  foreign keys without it — every FK in the schema is inert. Also `journal_mode = WAL`,
  `busy_timeout`, `synchronous = NORMAL` (data model §2.1).
- **Three groups of tables, different mutability:** template (mutable), game-copy
  (write-once), play (event-sourced + projections). Don't mix them.
- **Shared columns are defined once** in `schema/shared.ts` as **factory functions** and
  spread into both a template table and its game twin. They must be factories — Drizzle
  column builders are stateful and consumed on table construction, so reusing one instance
  across two tables produces subtly wrong schemas.
- **Types:** timestamps `integer({mode:'timestamp_ms'})`, booleans
  `integer({mode:'boolean'})`, enums `text({enum:[...]})`, JSON `text({mode:'json'})`
  **always** with a zod schema.
- **Attachments are content-addressed** by SHA-256 (`attachments/<sha256>.<ext>`), so
  copies share files and GC is one query. The on-disk name never derives from a
  user-supplied filename.

### Migrations

- Drizzle Kit generated, plain SQL, committed, **forward-only**.
- **Never hand-edit an applied migration.** Add a new one.
- **Not applied silently on boot** (D14): a fresh database is created and migrated
  automatically, but an existing one **prompts**, after writing a timestamped backup.
  `KWIZ_AUTO_MIGRATE=1` skips the prompt; with no TTY and no flag, the server refuses to
  start.
- A column added to a shared factory generates changes to **two** tables. That's expected.
- Adding an **event type** or a **round type / answer method** needs no migration —
  `game_event.type` is a plain string and type-specific settings live in zod-validated
  `config` JSON.

---

## 5. Realtime

- **SSE for server→client, POST for client→server** (D2). No WebSockets. Migration path in
  PRD 1 §6.9 — the constraints there exist to keep it open.
- **Push complete audience-filtered views, not deltas or events** (D38). The client holds
  no game logic. Views are idempotent, so reconnection is "send the current view" — there
  is no replay machinery.
- **A pushed view is O(teams + current question), never O(questions × teams)** (D39).
  Anything unbounded goes over REST.
- Two SSE frame types only: `state` (whole view, carries `id: <seq>`) and `notice`
  (transient, never replayed). Plus a `: ping` keepalive every 15 s.
- `X-Accel-Buffering: no` on the stream response, or proxies buffer it.
- All input zod-validated at the boundary. Actions return `{ok}` or a **typed** error —
  never a generic failure, because clients branch on it (protocol §7.3).

### zod

- **Define the schema, infer the type** — `z.infer<typeof schema>`. Never hand-write an
  interface beside a schema: they drift silently, and the compiler is satisfied by both.
- Required at every boundary, and at two places that are easy to miss: **`game_event.payload`
  on replay** (not only on append — the log outlives every deployment, so a payload an
  older build wrote must fail loudly rather than corrupt a projection), and **env config**
  (`KWIZ_MAX_DEVICES_PER_TEAM=abc` must stop the server at boot, not become `NaN`).
- **Not** on internal `domain` function arguments, outbound SSE payloads, or Drizzle query
  results — parse once at the boundary and pass the typed value inward. Full list of where
  it is and isn't wanted: [conventions §10](docs/spec/conventions.md).

---

## 6. Testing

**Required, but coverage is explicitly not the goal.** Test critical paths and the unusual
paths features introduce. Do not report a coverage percentage as a target.

Must be tested — each is invisible until it's embarrassing, or destroys data:

- Question state machine, and the buzz → deny → reopen loop (D35)
- Payload filtering invariants 1–7 + the sentinel test (§2.3)
- Answer normalisation and matching (lowercase + trim only, D22)
- Scoring: `DO` modes, manual adjustments, revocations (D41)
- Export → import round-trip
- Reconnect and cross-game isolation with two live games
- The game-copy **column-parity guard** (data model §7.2)
- Projection == replay (invariant I15)

Not worth testing: presentational components, layout, styling.

**A journey-based E2E suite is built after the surfaces exist** (D49, build-order slice 9) —
22 scenarios from the documented flows, including a **network-level sentinel assertion** that
no secret crosses the wire to a player. That is not a contradiction of "coverage is not the
goal": D18 is about unit coverage, E2E is about whether the wiring works.

**A large mock is a design signal, not a testing problem.** If a test needs an elaborate
mock of a database, request or stream, the logic belongs in `packages/domain` as a pure
function where the fixture is a literal array.

---

## 7. UI conventions

### i18n

- **No hardcoded user-facing strings, ever.** Everything through the messages module.
- `next-intl`, `en` + `nl`. **Default is always `en`** — `Accept-Language` is deliberately
  not consulted (D17). A game may set a default player locale (D29).
- **Quiz content is never translated** — question text is whatever the master typed.
- Player and main screen are full EN/NL parity; config and control are English-first if
  effort needs trimming (D28).
- **Dutch runs 20–30% longer than English.** It is the layout baseline for the main
  screen.

### Styling

- Tailwind, **semantic tokens only** — `--primary`, `--muted-foreground`. Never a literal
  colour. shadcn/ui components.
- **Four surfaces, four type scales** from the same tokens. Do not reuse one surface's
  sizing on another:

| Surface | Distance | Constraint |
| --- | --- | --- |
| Main screen | 3–10 m projected | **Nothing below `4vh`.** 7:1 contrast, no thin weights, dark bg, 5% safe area, never scrolls |
| Master control | 0.5 m | Dense, scannable, fixed layout that never reflows between states |
| Player | 0.3 m in hand | 44 px targets, thumb reach, works one-handed |
| Config | 0.5 m | Standard app density |

- **Team colours come from a curated palette**, stored as resolved hex, and are **always
  paired with the team name** — never the sole identifier.
- **Answer inputs must disable autocorrect**:
  `autocapitalize="off" autocorrect="off" spellcheck="false"`. Matching is exact after
  lowercase+trim, and iOS autocorrect will rewrite `Radiohead` into `Radio head` — a
  stream of wrong verdicts with no visible cause.

---

## 8. Commands

Not yet scaffolded. Intended:

```bash
pnpm install
pnpm dev                  # Next.js dev server
pnpm build && pnpm start  # production; prompts for pending migrations
pnpm db:generate          # Drizzle Kit — generate a migration from schema changes
pnpm test                 # Vitest
pnpm lint                 # oxlint
pnpm format               # oxfmt --write .
pnpm typecheck            # tsc --noEmit
pnpm check                # all of the above — the gate a slice must pass
```

Node 24, pnpm workspaces, Vitest, oxlint + oxfmt. Full toolchain and the reasoning in
[conventions §1](docs/spec/conventions.md).

**oxlint enforces two of §2's rules mechanically**, not by convention: a
`packages/domain` file importing Drizzle or Next **fails lint**, and `any` is an error in
`domain` and `db`. Don't weaken those overrides.

Config via env, read once at boot through one typed module (PRD 1 §6.8): `PORT`,
`KWIZ_DATA_DIR`, `KWIZ_MAX_DEVICES_PER_TEAM`, `KWIZ_AUTO_MIGRATE`, `KWIZ_MAX_UPLOAD_MB`.
**No `process.env` access anywhere else**, and never in `packages/domain`.

---

## 9. Where compromise is fine

The stated bar is "relatively clean, compromises allowed". Specifically:

**Hold the line on:** domain purity, the payload invariants, zod at every boundary, typed
events, no `any` in `domain` or `db`.

**Compromise freely on:** UI component decomposition (inline until it hurts), optimising
beyond the scale envelope in PRD 1 §2.1 (5 concurrent games, 20 teams, 40 questions/round),
abstracting before the second use case.

---

## 10. If you're unsure

1. Check the decision log (PRD 1 §5) — it probably answered this, with reasoning.
2. Check the relevant spec — they're normative.
3. If the docs genuinely don't cover it, **say so and ask.** These documents were built by
   asking questions rather than assuming, and a wrong assumption baked into code is far
   more expensive than one baked into a paragraph.
