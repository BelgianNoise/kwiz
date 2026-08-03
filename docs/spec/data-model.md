# Spec — Data Model

**Status:** Draft · **Last updated:** 2026-08-03 · **Normative**

Companion to [PRD 1](../prd/01-main.md). Where a surface PRD disagrees with this
document, **this document wins**. Decision references (`D14`, `D21`, …) point at
PRD 1 §5.

Written schema-first: the Drizzle definitions *are* the specification, with constraints
annotated inline. Prose appears only where a rule cannot be expressed in the schema.

---

## 1. Three groups of tables

The schema has three groups with **different mutability rules**. Mixing them is the
main way this design can go wrong.

```
┌─ TEMPLATE (mutable) ────────┐  ┌─ GAME COPY (write-once) ──────────┐
│ quiz                        │  │ game_round                        │
│  └─ round                   │──┼─▶ game_jeopardy_category          │
│      ├─ jeopardy_category   │  │   game_question                   │
│      └─ question            │  │    ├─ game_question_option        │
│          ├─ question_option │  │    ├─ game_accepted_answer        │
│          ├─ accepted_answer │  │    └─ game_attachment             │
│          └─ attachment      │  │                                   │
│                             │  │ Copied on game creation.          │
│ Edited freely, forever.     │  │ Never edited afterwards.          │
└─────────────────────────────┘  └───────────────────────────────────┘

                    ┌─ PLAY ──────────────────────────────────┐
                    │ game ──┬── game_team                    │
                    │        ├── game_device                  │
                    │        ├── game_event    ← SOURCE OF    │
                    │        │                    TRUTH       │
                    │        ├── game_answer            ┐     │
                    │        ├── game_buzz              │ proj│
                    │        ├── game_score_adjustment  ┘     │
                    │        └── game_answer_draft  (NOT proj) │
                    └─────────────────────────────────────────┘
```

**Template tables** are ordinary mutable rows. A master edits their quiz; rows change.

**Game-copy tables** are a deep copy of the quiz tree taken when a game is created
(§7). They are written exactly once and never updated. This is what delivers PRD 1
§8.1's promise — *"editing a quiz never alters an already-played game"* — which a
revision number alone cannot, because template rows are mutable.

**`game_event` is the only source of truth for play** (D4). Everything that happens
during a game is an appended event; the table is never updated or deleted.

**Projection tables** (`game_answer`, `game_buzz`, `game_score_adjustment`) are derived
caches. They exist so the validation queue and review screens are indexed SQL rather
than a replay. They are written *exclusively* by the reducer, in the same transaction
as the event append, and can be dropped and rebuilt from `game_event` at any time.

> **The rule that keeps this honest:** no code path writes a projection without
> appending the event that caused it, in the same transaction. There is one writer. If
> you want to `UPDATE game_answer` directly, the change you want is an event.
>
> Two tables are exempt, both narrowly and deliberately: `game_device.lastSeenAt`
> (§6.3) and `game_answer_draft` (§6.7). Nothing else in the play half escapes the log.

### 1.1 What is deliberately *not* stored

Live in-flight state lives **only in the in-memory projection**, rebuilt by replaying
`game_event` (PRD 1 §6.4). Persisting it would create a second source of truth for
facts already derivable:

- Current round and current question
- Question lifecycle state, timer deadlines, pause/resume bookkeeping
- Buzzer lockout sets
- Jeopardy current-picker
- Which devices are connected right now

A crash loses none of it — each is a pure function of the event log.

---

## 2. Conventions

Binding for every table.

| Concern | Rule |
| --- | --- |
| **Primary keys** | `text('id').primaryKey()` holding a **UUIDv7**. Globally unique so imports never collide; time-sortable so it indexes well and gives free creation ordering (PRD 1 §8.2). |
| **Names are never keys** | No natural keys. Two teams may share a name; renaming anything changes nothing else. |
| **Ordering** | Explicit `position` integer, 0-based, contiguous within its parent. Never id order, name order, or `createdAt`. |
| **Timestamps** | `integer({ mode: 'timestamp_ms' })` — Unix ms in SQLite, `Date` in TS. Always UTC. |
| **Booleans** | `integer({ mode: 'boolean' })`. SQLite has no boolean type. |
| **Enums** | `text({ enum: [...] })` — no native SQLite enum, but Drizzle infers a TS union. |
| **JSON columns** | `text({ mode: 'json' })`, **always** paired with a zod schema parsed at the boundary. A JSON column without a validator is a bug. |
| **Naming** | `snake_case` in SQL, `camelCase` in TS, mapped explicitly. |
| **Points** | Integers only. No decimals anywhere in scoring (D24). |

### 2.1 Connection setup

Required, not tuning. The second line is a genuine footgun: **SQLite does not enforce
foreign keys unless you enable them, per connection.** Every FK below is inert without
it.

```ts
// packages/db/src/client.ts
const sqlite = new Database(dbPath)
sqlite.pragma('journal_mode = WAL')    // concurrent readers alongside a writer
sqlite.pragma('foreign_keys = ON')     // OFF by default in SQLite
sqlite.pragma('busy_timeout = 5000')   // wait rather than throw SQLITE_BUSY
sqlite.pragma('synchronous = NORMAL')  // safe under WAL
export const db = drizzle(sqlite, { schema })
```

`better-sqlite3` is **synchronous**, which is a feature here: a transaction is a plain
function call and cannot interleave. The append path (§6.4) depends on it.

---

## 3. Shared column definitions

Six template tables have a game-scoped twin. Maintaining two parallel definitions by
hand is how a column gets added to `question` and forgotten in `game_question` —
silent data loss in every game created afterwards.

**So the shared columns are defined once and spread into both tables.** Adding a column
to the shared factory adds it to both, and Drizzle Kit generates both migrations.

```ts
// packages/db/src/schema/shared.ts
//
// MUST be a factory, not a plain object: Drizzle column builders are stateful and
// are consumed when a table is constructed. Reusing one builder instance across two
// tables produces subtly wrong schemas. Call the factory once per table.

export const questionColumns = () => ({
  position:     integer('position').notNull(),
  prompt:       text('prompt').notNull(),
  answerMethod: text('answer_method', {
    enum: ['FREE_TEXT', 'MULTIPLE_CHOICE', 'BUZZER', 'DO'],
  }).notNull(),
  points:       integer('points').notNull(),
  timerMs:      integer('timer_ms'),
  masterNotes:  text('master_notes'),
  config:       text('config', { mode: 'json' }).$type<QuestionConfig>().notNull(),
})

export const roundColumns = () => ({
  position:       integer('position').notNull(),
  type:           text('type', { enum: ['QUESTION_SET', 'JEOPARDY'] }).notNull(),
  title:          text('title').notNull(),
  defaultPoints:  integer('default_points').notNull().default(10),
  defaultTimerMs: integer('default_timer_ms'),
  config:         text('config', { mode: 'json' }).$type<RoundConfig>().notNull(),
})

export const attachmentColumns = () => ({
  position:            integer('position').notNull(),
  kind:                text('kind', { enum: ['IMAGE', 'AUDIO', 'VIDEO'] }).notNull(),
  mimeType:            text('mime_type').notNull(),
  originalName:        text('original_name').notNull(),
  ext:                 text('ext').notNull(),
  sizeBytes:           integer('size_bytes').notNull(),
  checksum:            text('checksum').notNull(),   // SHA-256; also the filename (§8)
  showOnPlayerDevices: integer('show_on_player_devices', { mode: 'boolean' }).notNull().default(false),
  durationMs:          integer('duration_ms'),
})

export const optionColumns = () => ({
  position:  integer('position').notNull(),
  text:      text('text').notNull(),
  isCorrect: integer('is_correct', { mode: 'boolean' }).notNull().default(false),
})

export const acceptedAnswerColumns = () => ({
  position: integer('position').notNull(),
  text:     text('text').notNull(),
})

export const categoryColumns = () => ({
  position: integer('position').notNull(),
  name:     text('name').notNull(),
})
```

Only **identity and parentage** differ between a template table and its twin, and that
difference is written out explicitly in each table. Everything else is shared.

---

## 4. Template tables

### 4.1 `quiz`

```ts
export const quiz = sqliteTable('quiz', {
  id:          text('id').primaryKey().$defaultFn(uuidv7),
  name:        text('name').notNull(),
  description: text('description'),

  // Bumped on every save of the quiz OR any descendant. Used by import collision
  // handling (D9) to show the master which side is newer. Enforced in the repository
  // layer — a schema cannot express "a descendant changed".
  revision: integer('revision').notNull().default(1),

  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
})
```

### 4.2 `round`

```ts
export const round = sqliteTable('round', {
  id:     text('id').primaryKey().$defaultFn(uuidv7),
  quizId: text('quiz_id').notNull().references(() => quiz.id, { onDelete: 'cascade' }),
  ...roundColumns(),
}, (t) => ({
  quizPosition: index('round_quiz_position_idx').on(t.quizId, t.position),
}))
```

`config` is the extension point for new round types (PRD 1 §8.3): `QUESTION_SET → {}`,
`JEOPARDY → { valueLadder: number[] }` (an authoring default for new tiles). A new
round type adds a zod schema and a domain reducer, and needs **no migration**.

### 4.3 `jeopardy_category`

Board columns; only for `JEOPARDY` rounds.

```ts
export const jeopardyCategory = sqliteTable('jeopardy_category', {
  id:      text('id').primaryKey().$defaultFn(uuidv7),
  roundId: text('round_id').notNull().references(() => round.id, { onDelete: 'cascade' }),
  ...categoryColumns(),
}, (t) => ({
  roundPosition: index('jeopardy_category_round_position_idx').on(t.roundId, t.position),
}))
```

The board is **not** a stored grid — it is `categories × questions`, laid out by
`(question.categoryId, question.position)`. A category with fewer questions than its
neighbours has a shorter column, which the authoring UI must allow, because masters
build boards incrementally.

### 4.4 `question`

```ts
export const question = sqliteTable('question', {
  id:      text('id').primaryKey().$defaultFn(uuidv7),
  roundId: text('round_id').notNull().references(() => round.id, { onDelete: 'cascade' }),

  // JEOPARDY only — which board column this tile sits in. Null for QUESTION_SET (I1).
  categoryId: text('category_id').references(() => jeopardyCategory.id, { onDelete: 'cascade' }),

  ...questionColumns(),
}, (t) => ({
  roundPosition:    index('question_round_position_idx').on(t.roundId, t.position),
  categoryPosition: index('question_category_position_idx').on(t.categoryId, t.position),
}))
```

Notes on the shared columns:

- **`points`** — for a Jeopardy tile this is its board value; for a `PER_TEAM_SCORE`
  `DO` question it is also the per-team maximum (D24).
- **`timerMs`** — null means *inherit the round default*. Zero is invalid, not
  "no timer" (I13).
- **`masterNotes`** — never leaves `MASTER_CONTROL` or `CONFIG` (PRD 1 §7 invariant 7).
- **`config`** — `DO → { scoringMode, tiePayout? }`; every other method `{}`.
- **`answerMethod`** — always `BUZZER` for Jeopardy tiles, and the authoring UI offers
  no choice there (D34, I2).

### 4.5 `accepted_answer`

An array from day one, even where v1's UI shows one field: retrofitting one-to-many
later touches the schema, the export format, the matcher, the validation queue, and
the authoring form (D33).

```ts
export const acceptedAnswer = sqliteTable('accepted_answer', {
  id:         text('id').primaryKey().$defaultFn(uuidv7),
  questionId: text('question_id').notNull().references(() => question.id, { onDelete: 'cascade' }),
  ...acceptedAnswerColumns(),
}, (t) => ({
  question: index('accepted_answer_question_idx').on(t.questionId, t.position),
}))
```

- **`FREE_TEXT`** — auto-matched lowercase+trim against *any* row (D22).
- **`BUZZER`** — **reference only.** Shown to the master for adjudication and at
  reveal. Never auto-matched: nothing was typed.
- **`MULTIPLE_CHOICE` / `DO`** — unused.

`position = 0` is the canonical answer shown at reveal; the rest are alternatives.

### 4.6 `question_option`

`MULTIPLE_CHOICE` only, 2–4 rows.

```ts
export const questionOption = sqliteTable('question_option', {
  id:         text('id').primaryKey().$defaultFn(uuidv7),
  questionId: text('question_id').notNull().references(() => question.id, { onDelete: 'cascade' }),
  ...optionColumns(),
}, (t) => ({
  question: index('question_option_question_idx').on(t.questionId, t.position),
}))
```

> **`isCorrect` is the most dangerous column in this schema.** It must never reach a
> `PLAYER` or `MAIN_SCREEN` payload before `REVEALED` (PRD 1 §7 invariant 2). Options
> are sent as `{ id, text }` while a question is open — the flag is not merely false,
> it is **absent from the projection**. This is why option identity is a UUID and not
> an index: a client can submit a choice without the server ever having sent anything
> that ranks the options.

### 4.7 `attachment`

Metadata only; bytes are content-addressed on disk (§8).

```ts
export const attachment = sqliteTable('attachment', {
  id:         text('id').primaryKey().$defaultFn(uuidv7),
  questionId: text('question_id').notNull().references(() => question.id, { onDelete: 'cascade' }),
  ...attachmentColumns(),
  createdAt:  integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, (t) => ({
  question: index('attachment_question_idx').on(t.questionId, t.position),
  checksum: index('attachment_checksum_idx').on(t.checksum),   // drives file GC (§8)
}))
```

`originalName` is **display metadata only** and never used to build a path.
User-supplied filenames bring path traversal, case collisions, unicode normalisation
differences across OSes, and length limits.

`showOnPlayerDevices` applies to `IMAGE` only; audio and video are main-screen-only and
not configurable (D27, I3).

---

## 5. Game-copy tables

A deep copy of the quiz tree, taken once when a game is created (§7) and **never
updated afterwards**. Structurally identical to their template twins via §3, differing
only in identity and parentage.

Every game-copy table carries **`gameId` directly**, not only a path up through
`game_round`. This is a deliberate denormalisation: it makes "all questions in this
game" a single indexed query, and it makes deletion a direct cascade from `game`
instead of a multi-level walk.

Every game-copy table also carries a nullable **`sourceId`** pointing at the template
row it was copied from, with `onDelete: 'set null'`. This is what lets the master jump
from *"this question was ambiguous when we played it"* straight to the template
question to fix it — and it goes null harmlessly if the template is later deleted.

```ts
export const gameRound = sqliteTable('game_round', {
  id:       text('id').primaryKey().$defaultFn(uuidv7),
  gameId:   text('game_id').notNull().references(() => game.id, { onDelete: 'cascade' }),
  sourceId: text('source_id').references(() => round.id, { onDelete: 'set null' }),
  ...roundColumns(),
}, (t) => ({
  gamePosition: index('game_round_game_position_idx').on(t.gameId, t.position),
}))

export const gameJeopardyCategory = sqliteTable('game_jeopardy_category', {
  id:          text('id').primaryKey().$defaultFn(uuidv7),
  gameId:      text('game_id').notNull().references(() => game.id, { onDelete: 'cascade' }),
  gameRoundId: text('game_round_id').notNull().references(() => gameRound.id, { onDelete: 'cascade' }),
  sourceId:    text('source_id').references(() => jeopardyCategory.id, { onDelete: 'set null' }),
  ...categoryColumns(),
}, (t) => ({
  roundPosition: index('game_jeopardy_category_round_position_idx').on(t.gameRoundId, t.position),
}))

export const gameQuestion = sqliteTable('game_question', {
  id:              text('id').primaryKey().$defaultFn(uuidv7),
  gameId:          text('game_id').notNull().references(() => game.id, { onDelete: 'cascade' }),
  gameRoundId:     text('game_round_id').notNull().references(() => gameRound.id, { onDelete: 'cascade' }),
  gameCategoryId:  text('game_category_id').references(() => gameJeopardyCategory.id, { onDelete: 'cascade' }),
  sourceId:        text('source_id').references(() => question.id, { onDelete: 'set null' }),
  ...questionColumns(),
}, (t) => ({
  roundPosition:    index('game_question_round_position_idx').on(t.gameRoundId, t.position),
  categoryPosition: index('game_question_category_position_idx').on(t.gameCategoryId, t.position),
  byGame:           index('game_question_game_idx').on(t.gameId),
}))

export const gameAcceptedAnswer = sqliteTable('game_accepted_answer', {
  id:             text('id').primaryKey().$defaultFn(uuidv7),
  gameId:         text('game_id').notNull().references(() => game.id, { onDelete: 'cascade' }),
  gameQuestionId: text('game_question_id').notNull().references(() => gameQuestion.id, { onDelete: 'cascade' }),
  ...acceptedAnswerColumns(),
}, (t) => ({
  question: index('game_accepted_answer_question_idx').on(t.gameQuestionId, t.position),
}))

export const gameQuestionOption = sqliteTable('game_question_option', {
  id:             text('id').primaryKey().$defaultFn(uuidv7),
  gameId:         text('game_id').notNull().references(() => game.id, { onDelete: 'cascade' }),
  gameQuestionId: text('game_question_id').notNull().references(() => gameQuestion.id, { onDelete: 'cascade' }),
  ...optionColumns(),
}, (t) => ({
  question: index('game_question_option_question_idx').on(t.gameQuestionId, t.position),
}))

export const gameAttachment = sqliteTable('game_attachment', {
  id:             text('id').primaryKey().$defaultFn(uuidv7),
  gameId:         text('game_id').notNull().references(() => game.id, { onDelete: 'cascade' }),
  gameQuestionId: text('game_question_id').notNull().references(() => gameQuestion.id, { onDelete: 'cascade' }),
  ...attachmentColumns(),
}, (t) => ({
  question: index('game_attachment_question_idx').on(t.gameQuestionId, t.position),
  checksum: index('game_attachment_checksum_idx').on(t.checksum),   // file GC (§8)
}))
```

> **No `sourceId` on `game_accepted_answer`, `game_question_option`, or
> `game_attachment`.** Navigating back to the template is only useful at question
> granularity — a master fixes *a question*, not *an option* — and three more nullable
> FKs would be maintenance for no user-visible capability.

---

## 6. Play tables

### 6.1 `game`

```ts
export const game = sqliteTable('game', {
  id: text('id').primaryKey().$defaultFn(uuidv7),

  // The template this was instantiated from. Nullable and SET NULL: a game is fully
  // self-contained in the game-copy tables, so deleting a template does not and must
  // not destroy played history.
  sourceQuizId: text('source_quiz_id').references(() => quiz.id, { onDelete: 'set null' }),

  // Denormalised at creation so a game still displays correctly after its template is
  // renamed or deleted.
  quizName:     text('quiz_name').notNull(),
  quizRevision: integer('quiz_revision').notNull(),

  // Human-readable join handle, NOT an identifier (PRD 1 §8.2, §8.10).
  // Regenerable while status = 'SETUP' (Q3).
  code: text('code').notNull(),

  // Projected from events. Duplicated here so the dashboard lists games without
  // replaying any of them.
  status: text('status', { enum: ['SETUP', 'LIVE', 'FINISHED', 'ABANDONED'] })
    .notNull().default('SETUP'),

  // Overrides the `en` default for devices joining this game; never overrides a
  // player's explicit choice (D29).
  defaultPlayerLocale: text('default_player_locale', { enum: ['en', 'nl'] })
    .notNull().default('en'),

  createdAt:  integer('created_at',  { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  startedAt:  integer('started_at',  { mode: 'timestamp_ms' }),
  finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
}, (t) => ({
  // Codes are unique only among joinable games (PRD 1 §8.10) so finished codes recycle.
  // A partial unique index expresses this exactly; a plain unique constraint would
  // exhaust the code space over time.
  activeCode: uniqueIndex('game_active_code_idx').on(t.code)
    .where(sql`status IN ('SETUP','LIVE')`),
  quizStatus: index('game_quiz_status_idx').on(t.sourceQuizId, t.status),
}))
```

### 6.2 `game_team`

```ts
export const gameTeam = sqliteTable('game_team', {
  id:       text('id').primaryKey().$defaultFn(uuidv7),
  gameId:   text('game_id').notNull().references(() => game.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  name:     text('name').notNull(),

  // Resolved hex, e.g. '#E11D48' — NOT a palette index. Storing the index would let a
  // future palette edit retroactively recolour teams in games already played.
  colour: text('colour').notNull(),

  // Projected: sum(answers) + sum(non-revoked adjustments). May be negative (D15).
  score: integer('score').notNull().default(0),

  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, (t) => ({
  gamePosition: index('game_team_game_position_idx').on(t.gameId, t.position),
}))
```

Team names are **not** unique within a game (PRD 1 §8.2) — two teams may genuinely pick
the same name, and the id disambiguates.

### 6.3 `game_device`

One row per browser playing for a team. Backs the `KWIZ_MAX_DEVICES_PER_TEAM` cap (D20)
and lets a device resume after a refresh, a sleep, or a server restart.

```ts
export const gameDevice = sqliteTable('game_device', {
  id:     text('id').primaryKey().$defaultFn(uuidv7),
  gameId: text('game_id').notNull().references(() => game.id, { onDelete: 'cascade' }),
  teamId: text('team_id').notNull().references(() => gameTeam.id, { onDelete: 'cascade' }),

  // Opaque high-entropy secret held in localStorage and presented on every request.
  // This is device CONTINUITY, not authentication (PRD 1 §4).
  deviceToken: text('device_token').notNull(),

  firstSeenAt: integer('first_seen_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  lastSeenAt:  integer('last_seen_at',  { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, (t) => ({
  token: uniqueIndex('game_device_token_idx').on(t.deviceToken),
  team:  index('game_device_team_idx').on(t.gameId, t.teamId),
}))
```

`lastSeenAt` is the **only** column in the play half updated in place rather than
projected from an event: a heartbeat is not a game fact, and one event per device per
few seconds would bloat the log for zero replay value. It is explicitly exempt, and
nothing in `packages/domain` may read it.

### 6.4 `game_event` — the source of truth

```ts
export const gameEvent = sqliteTable('game_event', {
  id:     text('id').primaryKey().$defaultFn(uuidv7),
  gameId: text('game_id').notNull().references(() => game.id, { onDelete: 'cascade' }),

  // Monotonic from 1, scoped to gameId — NOT global (PRD 1 §6.5).
  // Doubles as the SSE event id for Last-Event-ID replay.
  seq: integer('seq').notNull(),

  // Catalogue lives in ./protocol.md. Deliberately NOT an enum here, so adding an
  // event type needs no migration.
  type:    text('type').notNull(),
  payload: text('payload', { mode: 'json' }).$type<GameEventPayload>().notNull(),

  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, (t) => ({
  gameSeq: uniqueIndex('game_event_game_seq_idx').on(t.gameId, t.seq),
}))
```

**Append-only.** No code may `UPDATE` or `DELETE` here. Correcting a misjudged answer or
a wrong score is a *new* event — a repeated `ANSWER_VALIDATED`, which supersedes the
earlier one, or a `SCORE_ADJUSTED` — never an edit. (There is deliberately no separate
`ANSWER_REVALIDATED` type; see protocol §4.3.)
This is what makes the config pages' "change whether an answer was correct" feature
auditable rather than destructive.

#### 6.4.1 The append transaction

Every write in the play half has exactly this shape, and nothing else writes these
tables:

```ts
export function appendAndProject(gameId: string, events: DomainEvent[]) {
  return db.transaction((tx) => {
    const last = tx.select({ seq: max(gameEvent.seq) }).from(gameEvent)
      .where(eq(gameEvent.gameId, gameId)).get()?.seq ?? 0

    let seq = last
    for (const e of events) {
      tx.insert(gameEvent).values({ gameId, seq: ++seq, type: e.type, payload: e.payload }).run()
      applyProjection(tx, gameId, e)     // same transaction — cannot drift
    }
    return seq
  })
}
```

Three properties this relies on, each a silent bug if broken:

1. **`better-sqlite3` is synchronous**, so `max(seq)+1` cannot interleave with another
   append inside the transaction.
2. **`unique(gameId, seq)`** is the backstop if property 1 is ever violated (a second
   process, a future async driver). The insert fails loudly rather than duplicating a
   sequence number.
3. **The projection write is inside the transaction.** An event committing without its
   projection, or vice versa, is drift — the exact failure mode this design exists to
   avoid.

Broadcast happens **after commit** (PRD 1 §6.4): nothing reaches a client that isn't
already durable.

### 6.5 `game_answer` (projection)

One row per `(game, question, team)`. Serves the validation queue and every review
screen. Because the game owns its own question rows, `gameQuestionId` is a **real
foreign key**.

```ts
export const gameAnswer = sqliteTable('game_answer', {
  id:             text('id').primaryKey().$defaultFn(uuidv7),
  gameId:         text('game_id').notNull().references(() => game.id, { onDelete: 'cascade' }),
  gameQuestionId: text('game_question_id').notNull().references(() => gameQuestion.id, { onDelete: 'cascade' }),
  teamId:         text('team_id').notNull().references(() => gameTeam.id, { onDelete: 'cascade' }),

  // FREE_TEXT: the typed answer. MULTIPLE_CHOICE: null (see selectedOptionId).
  // BUZZER and DO: null — nothing is typed.
  text: text('text'),

  selectedOptionId: text('selected_option_id')
    .references(() => gameQuestionOption.id, { onDelete: 'set null' }),

  // True while only debounced drafts have arrived and no final submission has
  // (D26, PRD 1 §5.1). Presentation only — never affects scoring.
  isDraft:     integer('is_draft', { mode: 'boolean' }).notNull().default(true),
  submittedAt: integer('submitted_at', { mode: 'timestamp_ms' }),

  // True when the master entered this on the team's behalf because their device could
  // not reach the server (D47). Shown in review so the record stays honest about who
  // typed it.
  enteredByMaster: integer('entered_by_master', { mode: 'boolean' }).notNull().default(false),

  verdict: text('verdict', {
    enum: [
      'PENDING',       // awaiting master validation
      'AUTO_CORRECT',  // exact normalised match, or the correct option
      'AUTO_WRONG',    // wrong option chosen — MULTIPLE_CHOICE only
      'ACCEPTED',      // master said yes
      'DENIED',        // master said no
      'NO_ANSWER',     // nothing arrived at all
    ],
  }).notNull().default('PENDING'),

  pointsAwarded: integer('points_awarded').notNull().default(0),
  validatedAt:   integer('validated_at', { mode: 'timestamp_ms' }),
}, (t) => ({
  oneAnswerPerTeam: uniqueIndex('game_answer_unique_idx').on(t.gameId, t.gameQuestionId, t.teamId),
  byQuestion:       index('game_answer_question_idx').on(t.gameQuestionId),
  // Drives the validation queue: "everything in this game still needing me".
  pending:          index('game_answer_pending_idx').on(t.gameId, t.verdict),
}))
```

**A `FREE_TEXT` answer never auto-resolves to `AUTO_WRONG`.** A non-match becomes
`PENDING` and goes to the master (D22). The machine is only ever allowed to be *right*,
never to reject. `AUTO_WRONG` exists solely for multiple choice, where correctness is
unambiguous.

**`DO` questions reuse this table.** Nothing is typed, but a team's *outcome* is still
per-question-per-team: `WINNER_TAKES_ALL` writes `pointsAwarded = points` for each
winner and `0` for the rest; `PER_TEAM_SCORE` writes the master's entered score. A
parallel `game_do_score` table would duplicate scoring logic and every review query.

### 6.6 `game_buzz` (projection)

Every buzz, including those arriving after the lock — they are the record behind
"Team A by 0.04s" and behind any dispute (D35).

```ts
export const gameBuzz = sqliteTable('game_buzz', {
  id:             text('id').primaryKey().$defaultFn(uuidv7),
  gameId:         text('game_id').notNull().references(() => game.id, { onDelete: 'cascade' }),
  gameQuestionId: text('game_question_id').notNull().references(() => gameQuestion.id, { onDelete: 'cascade' }),
  teamId:         text('team_id').notNull().references(() => gameTeam.id, { onDelete: 'cascade' }),

  // Server arrival time — the ordering authority (D35, PRD 1 §4).
  receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull(),

  // Ms from question open to this buzz. Denormalised because it is what both screens
  // display, and recomputing needs the question's open time.
  offsetMs: integer('offset_ms').notNull(),

  outcome: text('outcome', {
    enum: [
      'AWAITING',   // currently being adjudicated
      'ACCEPTED',   // credited; question resolves
      'DENIED',     // wrong — team locked out, buzzers reopen (D35)
      'NOT_FIRST',  // arrived after the lock; recorded, never adjudicated
    ],
  }).notNull(),
}, (t) => ({
  byQuestion: index('game_buzz_question_idx').on(t.gameQuestionId, t.receivedAt),
}))
```

The **lockout set is not stored** — it is derived (`teams with a DENIED buzz on this
question`) and held in memory per §1.1. Storing it would be a second source of truth
for the same fact.

### 6.7 `game_answer_draft` — **not** a projection

Debounced in-progress answers (D8). Deliberately its own table rather than columns on
`game_answer`, so that `game_answer` remains a pure projection and **I15
(`projection == replay`) holds with no carve-out**.

```ts
export const gameAnswerDraft = sqliteTable('game_answer_draft', {
  gameId:         text('game_id').notNull().references(() => game.id, { onDelete: 'cascade' }),
  gameQuestionId: text('game_question_id').notNull().references(() => gameQuestion.id, { onDelete: 'cascade' }),
  teamId:         text('team_id').notNull().references(() => gameTeam.id, { onDelete: 'cascade' }),

  text:             text('text'),
  selectedOptionId: text('selected_option_id')
    .references(() => gameQuestionOption.id, { onDelete: 'set null' }),

  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.gameQuestionId, t.teamId] }),
}))
```

**Upserted directly, never event-sourced.** A draft is not a game fact: keystroke
timing is not reproducible by replay, and 20 teams typing would flood the log for zero
replay value (protocol §4.7). This is the **second and final** exemption from event
sourcing, alongside `game_device.lastSeenAt`.

It is a real table rather than memory because that is the entire point of D8's safety
net — a draft must survive a server restart. On `QUESTION_LOCKED`, any team with a draft
but no submission gets an `ANSWER_SUBMITTED { fromDraft: true }` event appended, which is
what surfaces the D26 "not confirmed by team" marker.

The composite primary key `(gameQuestionId, teamId)` makes the upsert natural and
enforces one draft per team per question without a separate constraint.

### 6.8 `game_score_adjustment` (projection)

```ts
export const gameScoreAdjustment = sqliteTable('game_score_adjustment', {
  id:     text('id').primaryKey().$defaultFn(uuidv7),
  gameId: text('game_id').notNull().references(() => game.id, { onDelete: 'cascade' }),
  teamId: text('team_id').notNull().references(() => gameTeam.id, { onDelete: 'cascade' }),

  delta:  integer('delta').notNull(),   // may be negative (D15)
  reason: text('reason'),               // optional by design

  // False when the master ticked "don't announce" (D25). Suppresses the main-screen
  // banner only — the row exists regardless, so the audit trail stays complete.
  announced: integer('announced', { mode: 'boolean' }).notNull().default(true),

  // Set by SCORE_ADJUSTMENT_REVOKED (D41). A revoked adjustment is excluded from score
  // totals but never deleted — the log keeps both facts, so the audit trail reads as
  // "one adjustment, later revoked" rather than as two deliberate decisions.
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),

  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, (t) => ({
  byTeam: index('game_score_adjustment_team_idx').on(t.gameId, t.teamId),
}))
```

Adjustments are a **separate line** from question points, never folded into
`game_answer.pointsAwarded` (PRD 1 §8.8), so a team's total always reconciles as
`sum(answers) + sum(non-revoked adjustments)`.

---

## 7. Instantiation — creating a game from a template

```
createGame(quizId, teams[]) →
  ONE transaction:
    1. insert game            (quizName, quizRevision, code, status='SETUP')
    2. copy round             → game_round             (sourceId = round.id)
    3. copy jeopardy_category → game_jeopardy_category
    4. copy question          → game_question          (remap roundId, categoryId)
    5. copy accepted_answer   → game_accepted_answer   (remap questionId)
    6. copy question_option   → game_question_option   (remap questionId)
    7. copy attachment        → game_attachment        (same checksum — no file copy)
    8. insert game_team rows
```

Rules:

- **One transaction.** A half-copied game is unplayable and hard to detect; failure
  must leave nothing behind.
- **All new ids.** Copies never reuse a template id, so a template row and its copy can
  coexist and be told apart.
- **Parent references are remapped** through an in-memory `oldId → newId` map built as
  each level is copied. Copy order must be parents-before-children (as listed).
- **No attachment bytes are copied** — the copy shares the file by checksum (§8).
- **Copies are validated after writing**, not trusted: the same zod/invariant checks
  that guard authoring run against the copy. A copy bug that produces an invalid game
  should fail at creation, in front of the master, not mid-round in front of a room.

### 7.1 Re-syncing a `SETUP` game from its template (Q4)

A master who has already typed eight team names and shown the QR code should not lose
all of that to fix one typo. So a game may be **re-synced**: its copy subtree is
discarded and re-copied from the current template, while the game itself survives.

```
resyncGame(gameId) →
  ONE transaction:
    1. assert preconditions (below)
    2. DELETE the copy subtree   (cascades from game_round / game_question)
    3. re-run §7 steps 2–7 against the current template
    4. update game.quizRevision and game.quizName to current template values
    5. append a GAME_RESYNCED event
  PRESERVED: game.id, game.code, game_team rows, game_device rows
```

**Preconditions — all checked, all refused loudly rather than silently skipped:**

| Check | Why |
| --- | --- |
| `game.status = 'SETUP'` | Once `LIVE`, answers reference copy rows that would be deleted |
| No `game_answer` rows | A concrete check, not a status inference — the status could be wrong |
| No `game_buzz` rows | Same |
| `game.sourceQuizId IS NOT NULL` | The template may have been deleted; there is nothing to re-sync from |

The two row-count checks are deliberately redundant with the status check. Status is a
projected column (§6.1); the row counts are the actual thing that makes re-sync unsafe,
and asserting on the real condition costs one query.

**Teams and devices survive because they reference neither questions nor rounds** — a
team is bound to the game, and a device to a team. Players who joined during setup stay
joined and never notice.

**The config page should surface staleness**: when a `SETUP` game's `quizRevision` is
behind its template's `revision`, show it with a refresh action rather than making the
master remember they edited the template after creating the game.

### 7.2 The column-parity guard

The one real failure mode of this design: someone adds a column to `questionColumns()`
but the copy function doesn't carry it, and every game created afterwards silently
loses that field.

§3's shared factories make this unlikely — both tables get the column automatically —
but the *copy function* still has to move the value. So:

**A required test reflects over each pair of tables and fails if any shared column is
absent from either side or unhandled by the copy.** Writing the copy as a
`pick(sharedColumnNames)` spread rather than an explicit field list makes it pass by
construction; the test exists to catch someone hand-rolling it later.

This test is cheap and it is the only thing standing between a routine schema change
and silent data loss in games. It is listed in PRD 1 §11.1's must-test set.

---

## 8. Attachments & content addressing

Files live at:

```
${KWIZ_DATA_DIR}/attachments/<sha256>.<ext>
```

**Addressed by content hash, not by row id.** This is what makes per-game attachment
rows free:

| Property | Consequence |
| --- | --- |
| A template row and its game copies share one file | Copying a game with 2 GB of video costs 0 bytes |
| Identical uploads collapse | The same song used in three quizzes is stored once |
| GC is one query | Delete files whose checksum appears in neither `attachment` nor `game_attachment` |
| Deleting a template attachment is always safe | The game's own row keeps the checksum referenced, so the file stays |

**Writing a new attachment:**

```
1. stream the upload to data/tmp/<random>
2. hash while streaming
3. if attachments/<hash>.<ext> exists → discard the temp file (already stored)
   else                              → atomic rename into place
4. insert the attachment row
```

Hash-while-streaming avoids reading a 50 MB file twice. The rename is atomic on both
NTFS and POSIX when source and destination share a volume — which is why `tmp/` lives
**inside** `KWIZ_DATA_DIR` rather than in the OS temp directory (§PRD 1 §6.6).

**Deletion is never inline.** Removing a row does not remove the file; a reconciliation
pass sweeps unreferenced files. Deleting a row and a file non-atomically in either
order can strand one of them, and reconciliation makes the recoverable direction — an
orphaned file, not a missing one — the direction that happens.

> **Consequence to be aware of:** because files are shared, a corrupt or wrong file
> replaced by re-uploading produces a *new* checksum and a new row. The old file
> lingers until the next reconciliation pass. That is correct but means "replace this
> image" is really "add and repoint", which the authoring UI should present as an
> ordinary replace.

---

## 9. Invariants not expressible in the schema

Each needs a test (PRD 1 §11.1). Template invariants are enforced at authoring time;
game-copy invariants hold by construction and are verified by the §7 post-copy
validation.

| # | Invariant |
| --- | --- |
| **I1** | `question.categoryId` is non-null **iff** its round's `type = 'JEOPARDY'`. Same for `game_question.gameCategoryId`. |
| **I2** | A question in a `JEOPARDY` round has `answerMethod = 'BUZZER'` (D34). |
| **I3** | `showOnPlayerDevices` is `false` whenever `kind != 'IMAGE'` (D27). |
| **I4** | `question_option` rows exist (2–4, exactly one `isCorrect`) **iff** `answerMethod = 'MULTIPLE_CHOICE'`. |
| **I5** | `accepted_answer` has ≥1 row when `answerMethod ∈ {FREE_TEXT, BUZZER}`. |
| **I6** | `config` validates against the zod schema for its `answerMethod` / `type`. |
| **I7** | `position` is contiguous from 0 within each parent after any insert, delete, or reorder. |
| **I8** | `game_answer.pointsAwarded` is `0` unless `verdict ∈ {AUTO_CORRECT, ACCEPTED}` — except `DO` questions, where the master's score stands alone. **And always `0` when the question is `SKIPPED`** (D46): a question skipped from `OPEN` may already hold auto-graded answers carrying points, so "awards nothing to anyone" must be enforced, not assumed. Verdicts are retained for the record. |
| **I9** | `gameTeam.score = sum(game_answer.pointsAwarded) + sum(game_score_adjustment.delta WHERE revoked_at IS NULL)`, always. |
| **I10** | At most one `game_buzz` per `(game, question)` has `outcome = 'AWAITING'`. |
| **I11** | `game_device` count per `(gameId, teamId)` ≤ `KWIZ_MAX_DEVICES_PER_TEAM` (D20). |
| **I12** | `question.timerMs` is null or > 0. Zero is not "no timer"; null is. |
| **I13** | A game-copy subtree is structurally identical to its source at copy time — same counts, positions, and shared-column values at every level (§7.2). |
| **I14** | `game_answer.selectedOptionId`, when set, belongs to that answer's `gameQuestionId`. A real FK guarantees existence but not *which question* it belongs to. |
| **I15** | Every projection table's contents equal a replay of `game_event` for that game — verified by rebuild-and-compare. |
| **I16** | No row in any game-copy table is ever `UPDATE`d. Copy rows are written by the creation transaction and may only be **replaced wholesale** by a §7.1 re-sync, which is refused unless `status = 'SETUP'` and no answers or buzzes exist. |

**I15 is the keystone.** It is what makes projections safe to treat as derived, and the
one test that catches a reducer and a writer drifting apart.

---

## 10. Deletion

Per-game copies make deletion far simpler than a shared-content design would.

| Deleting | Behaviour |
| --- | --- |
| `quiz` | Cascades through the template subtree. **Always allowed, even with games** — every game owns its own copy, so no history is lost. Affected games' `sourceQuizId` and `sourceId`s go null; `game.quizName` preserves the display title. |
| `game` | Cascades to its copy subtree, teams, devices, events, drafts and all three projections. Offered per game from PRD 2 §11.1; there is no bulk prune (Q5). |
| `round` / `question` / etc. (template) | Cascades downward. Never touches game copies. |
| `attachment` (template) | Row deleted; **file survives** if any `game_attachment` still references its checksum (§8). |
| `game_team` mid-game | Not offered. Removing a team would orphan answers and rewrite scores. Config pages allow **renaming and recolouring**, never deletion. |
| `game_event` | Never. Append-only. |
| Game-copy rows individually | Never. Only via deleting the game. |

**The `RESTRICT` rule from the JSON-snapshot design is gone.** Deleting a quiz that has
been played is now an ordinary, non-destructive operation — a direct benefit of copying
into game-scoped tables.

---

## 11. Migrations

Per D14 and PRD 1 §6.7: Drizzle Kit generated, plain SQL, committed, forward-only,
prompted on boot with a pre-migration backup.

Specific to this schema:

- **Never hand-edit an applied migration.** Add a new one.
- **A column added to a §3 shared factory generates changes to two tables.** Both
  appear in one migration — expected, not a mistake. Review that both are present.
- **Adding an event type needs no migration** — `game_event.type` is a plain string by
  design (§6.4).
- **Adding a round type or answer method needs no migration** — settings live in
  zod-validated `config` JSON. Adding a *value* to a `text({enum})` column does mean a
  check-constraint change if one was generated; prefer widening in a dedicated
  migration.
- **A migration changing projection shape must be paired with a rebuild**, since
  existing rows were written by the old reducer:
  `DELETE FROM <projection> WHERE game_id = ?` then replay. Safe precisely because
  these tables are derived.
- **Migrations must never rewrite game-copy rows** (I16). A schema change that would
  need to backfill a game copy should backfill with a documented default and say so in
  the migration file.

---

## 12. Open questions

| # | Question | Recommendation |
| --- | --- | --- |
| ~~Q4~~ | ~~Re-sync a `SETUP` game from its template~~ | **Resolved: allowed.** Copy subtree replaced, game/code/teams/devices preserved, refused once answers or buzzes exist (§7.1). |
| ~~Q5~~ | ~~Prunable games~~ | **Resolved: per-game delete only, no bulk pruning.** Deleting one game belongs on the game detail page (PRD 2 §11.1) — it's the master's own data. Bulk pruning would solve a storage problem that doesn't exist: a game copy is ~100–200 rows, and attachment files are shared by checksum so they never duplicate. |
| ~~Q6~~ | ~~`game_attachment` dedup within a game~~ | **Resolved: one row per `(question, attachment)`.** `position` and `showOnPlayerDevices` are legitimately per-question — the same image may be projector-only on one question and pushed to phones on another. The *file* is already deduplicated by checksum (§8). |

---

## 13. Next

The [protocol spec](./protocol.md): the `game_event` type catalogue, the per-audience
payload shapes enforcing PRD 1 §7, and the export zip format.
