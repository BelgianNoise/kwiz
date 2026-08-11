# Spec — Implementation Conventions & Shared Constants

**Status:** Draft · **Last updated:** 2026-08-04 · **Normative**

Everything in here exists because **more than one place needs the same exact value**, or
because an unspecified choice would be invented differently by each person implementing.

If you need a concrete value — a hex colour, an error code, a debounce interval — it is
here, not in a PRD. PRDs explain *why*; this file says *what*.

---

## 1. Toolchain

| Concern | Choice | Notes |
| --- | --- | --- |
| Runtime | **Node 24** | Pinned in `.nvmrc` and `engines`. See §1.1 |
| Package manager | **pnpm** workspaces | `pnpm-workspace.yaml` at root |
| Framework | **Next.js**, App Router, TypeScript `strict` | |
| Tests | **Vitest** | §1.2 |
| Lint | **oxlint** + `oxlint-tsgolint` | §1.3 — configured to *enforce* architectural rules, not just style. The second package is the type-aware backend, without which the promise rules silently do nothing |
| Format | **oxfmt** | §1.3 |
| DB | **Drizzle ORM** + `better-sqlite3` | data model §2.1 |
| Validation | **zod** | Every boundary. No exceptions |
| IDs | **`uuid`** (`v7`) | `import { v7 as uuidv7 } from 'uuid'` |
| i18n | **next-intl** | §6 |
| Components | **shadcn/ui** + Tailwind | PRD 1 §9.1 |
| Screen wake | **`nosleep.js`** | Player devices only (D48) |
| E2E | **Playwright** | Multi-context, mobile emulation, network control, tracing (D49). Built in build-order slice 9 |

### 1.1 The Node 24 + `better-sqlite3` check

`better-sqlite3` is a native addon. On a Node major without a published prebuild it falls
back to compiling, which needs a C++ toolchain — unacceptable on a quiz master's laptop.

**Scaffold slice must verify this explicitly:** a clean `pnpm install` on Node 24 with no
build tools present must succeed. If it doesn't, the documented fallbacks in order are:

1. Pin to the newest Node major that has a prebuild.
2. Swap the driver to **`node:sqlite`** — mature on Node 24, zero native install, and
   Drizzle-supported. Schema unchanged (data model §2.1).

### 1.2 Vitest

- Workspace-level config; each package has its own project entry.
- **No jsdom by default.** Most required tests are pure-function domain tests (CLAUDE.md
  §6) and adding a DOM environment globally slows every one of them. Opt in per-file where
  a component genuinely needs it.
- Coverage tooling may be installed but **no coverage threshold is configured** — D18 says
  coverage is explicitly not a target, and a threshold turns that into a lie.

### 1.3 oxlint + oxfmt

`oxfmt` handles formatting; `oxlint` handles rules. Both are fast enough to run on every
touched file, which is the point — consistent formatting removes a whole class of diff
noise.

```jsonc
// .oxlintrc.json
{
  "$schema": "https://raw.githubusercontent.com/oxc-project/oxc/main/npm/oxlint/configuration_schema.json",
  "categories": {
    "correctness": "error",
    "suspicious": "warn",
    "perf": "warn",
    "style": "off"        // oxfmt owns style; a linter arguing about it is noise
  },
  "plugins": ["typescript", "react", "jsx-a11y", "import"],
  "rules": {
    "no-console": "warn",
    "eqeqeq": "error",
    "typescript/no-explicit-any": "warn",

    // Type-aware — see below. An unawaited write is a lost event or a stalled stream
    "typescript/no-floating-promises": "error",
    "typescript/no-misused-promises": "error",
    "typescript/await-thenable": "error",

    // Next.js uses the automatic JSX runtime, so React is never in scope by design
    "react/react-in-jsx-scope": "off",
    // `import './globals.css'` is how an App Router layout loads styles
    "import/no-unassigned-import": ["warn", { "allow": ["**/*.css"] }]
  },
  "ignorePatterns": [
    "node_modules", ".next", "dist", "coverage", "data",
    "test-results", "playwright-report", "**/*.d.ts"
  ],
  "overrides": [
    {
      // §1.4 — the architectural rules, enforced
      "files": ["packages/domain/**"],
      "rules": {
        "typescript/no-explicit-any": "error",
        "no-restricted-imports": ["error", {
          "patterns": [
            "*drizzle*", "*better-sqlite3*", "next/*", "next", "@kwiz/db",
            "node:fs", "node:http", "fs", "http"
          ]
        }]
      }
    },
    {
      "files": ["packages/db/**"],
      "rules": { "typescript/no-explicit-any": "error" }
    },
    {
      "files": ["scripts/**"],
      "rules": { "no-console": "off" }   // these scripts report to a terminal
    }
  ]
}
```

**The three promise rules are type-aware, and type-aware rules are off unless asked for.**
They need a TypeScript program, which oxlint builds only under `--type-aware` and only with
the `oxlint-tsgolint` package present. That is why `pnpm lint` is `oxlint --type-aware` rather
than plain `oxlint` — **without the flag these three rules report nothing and say nothing
about why.**

An unawaited promise is the failure this buys, and it is silent by construction: a dropped
`appendAndProject()` loses an event, a dropped SSE write stalls one client, and neither
throws. `no-misused-promises` covers the same defect in disguise — `xs.forEach(async …)`,
or a promise where a `void` return was expected.

> Expect `no-misused-promises` to have something to say about React event handlers from
> slice 4 onwards: `onClick={async () => …}` returns a promise where `void` is expected. The
> fix is `onClick={() => { void handle() }}`, which is better anyway — it makes the
> deliberately-unhandled promise visible at the call site instead of implicit.

**oxlint accepts an unknown rule name silently** — no warning, no error, exit code 0. A typo
in the block above, or a rule renamed in a future oxlint, degrades an architectural
guarantee into a decorative line of JSON with nothing to reveal it. An earlier draft of this
file specified `no-floating-promises` without the plugin prefix or the flag, and it did
nothing for exactly that reason. This is why §1.4's rules have a test rather than only a
config (see below).

### 1.3.1 oxfmt

`.oxfmtrc.json` pins the house style — no semicolons, single quotes, width 90, trailing
commas — which is the style the code samples throughout these documents already use.

Two non-default options are on because they remove a whole class of review comment:
`sortImports` and `sortTailwindcss`. **Markdown is excluded**: oxfmt would reflow the prose
in `docs/`, and these documents are hand-wrapped.

### 1.4 Lint rules that encode architecture

CLAUDE.md §2 lists rules an implementer will otherwise break. Three of them can be
enforced mechanically rather than trusted, and should be:

| Rule | Enforcement |
| --- | --- |
| `packages/domain` is pure (CLAUDE.md §2.1) | `no-restricted-imports` above. A domain file importing Drizzle or Next now **fails lint** |
| No `any` in `domain` or `db` | `no-explicit-any: error` in those overrides only |
| No `process.env` outside the config module | `scripts/check-no-process-env.mjs`, run as part of `pnpm lint` — locally and in CI (§1.6). `process.env` may appear only in `packages/config/src/**`. Cheap, and catches the one thing PRD 1 §6.8 forbids |

If oxlint's `no-restricted-imports` proves insufficient, a ~20-line CI script asserting
the same thing is an acceptable substitute. **Do not downgrade it to a comment.**

**All three are covered by `scripts/architecture-rules.test.ts`**, which writes a file that
violates each rule, runs the real linter over it, and asserts the violation is reported as an
*error*. Given that oxlint ignores unknown rule names in silence (§1.3), reading the config
back proves nothing — only running it does. The fixtures are deliberately **not gitignored**:
oxlint always honours `.gitignore` and its `--no-ignore` flag only disables `.eslintignore`,
so an ignored fixture would never be linted and the test would pass while proving nothing.

### 1.5 Scripts

Defined at the **workspace root**, fanning out to the packages. `dev`/`build`/`start` and
`db:generate` are thin wrappers over the package that owns them (`next dev` lives in
`apps/web`, `drizzle-kit generate` in `packages/db`), so there is one place to run
everything from.

```jsonc
{
  "dev":          "pnpm --filter @kwiz/web dev",
  "build":        "pnpm --filter @kwiz/web build",
  "start":        "pnpm --filter @kwiz/web start",   // prompts for pending migrations (D14)
  "test":         "vitest run",
  "test:watch":   "vitest",
  "typecheck":    "tsc --noEmit && pnpm -r typecheck",
  "lint":         "oxlint --type-aware && pnpm lint:env",   // the flag is load-bearing, §1.3
  "lint:env":     "node scripts/check-no-process-env.mjs",   // §1.4's third rule
  "format":       "oxfmt --write .",
  "format:check": "oxfmt --check .",
  "check":        "pnpm format:check && pnpm lint && pnpm typecheck && pnpm test",
  "db:generate":  "pnpm --filter @kwiz/db db:generate",
  "e2e":          "playwright test",
  "e2e:ui":       "playwright test --ui"
}
```

`typecheck` runs each package's own `tsc --noEmit` — a single root project cannot serve both
the packages and a Next.js app, which needs `jsx: preserve`, its own `lib` and the `next`
plugin. The root `tsconfig.json` covers the files no package owns (`vitest.config.ts`,
`scripts/`), and **must be named exactly that**: editors and `oxlint --type-aware` both
resolve the nearest `tsconfig.json` per file, so a descriptive name like `tsconfig.tools.json`
leaves them on inferred defaults — which shows up as `process` being undefined in `scripts/`
while `pnpm typecheck` passes.

### 1.6 Continuous integration

`.github/workflows/ci.yml`, on pushes to `main`, on every pull request, and manually.

Node comes from `.nvmrc` and pnpm from `packageManager` via corepack, so **CI has no version
of its own to drift** — the pins live with the repo. Install is `--frozen-lockfile`, which also
fails when the lockfile and the manifests have diverged.

The steps are `pnpm check` plus `pnpm build`, **listed individually rather than as one
`check`**, so a red run names what broke on the summary page instead of making someone open
the log.

**The matrix is `ubuntu-latest` and `windows-latest`, and that is not thoroughness for its own
sake.** Three things in this repo are platform-sensitive:

- `better-sqlite3` resolves a **different prebuild per platform** (§1.1), and the guarantee is
  per-platform or it is nothing.
- `scripts/architecture-rules.test.ts` spawns the linter as a subprocess, which behaves
  differently on Windows.
- Kwiz is hosted on a quiz master's laptop, which is at least as likely to be Windows as not.

`fail-fast: false`, so the second platform still reports when the first fails.

**`.gitattributes` (`* text=auto eol=lf`) is load-bearing here**, not tidiness: `oxfmt --check`
is part of the gate, so a CRLF checkout on a Windows runner would fail CI for a reason
unrelated to the code.

The **Playwright suite gets its own job in build-order slice 9** — it needs a running server
and is much slower, so it must not gate every typecheck.

`pnpm check` is the single command a slice must pass before it is done (§11). It excludes
`e2e` deliberately — the browser suite is slower and needs a running server, so it runs as
its own step rather than blocking every typecheck.

---

## 2. Game codes

Fixes an inconsistency: PRD 1 §8.10 previously described "a 26-character alphabet
excluding `0`/`O`, `1`/`I`/`L`, `U`/`V`", which is not arithmetically possible, and PRD 5
§2.1 then assumed `0` was excluded.

**The alphabet is Crockford Base32.** Chosen because it is an existing, documented standard
designed precisely for humans reading and re-typing codes — so the normalisation rules come
with it rather than being invented.

```
ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"     32 chars
excluded:  I  L  O  U
length:    6                                       32^6 = 1,073,741,824 codes
```

- **`I` and `L` are excluded** (confusable with `1`), **`O`** (with `0`), and **`U`** —
  which Crockford drops specifically to reduce accidental obscenity. Convenient here, since
  codes are projected in front of an audience. Not a complete defence, which is why codes
  are regenerable while `SETUP` (data model Q3).
- **Normalisation on entry**, in this order: strip whitespace and hyphens → uppercase →
  map `O`→`0`, `I`→`1`, `L`→`1` → validate against the alphabet.
- Generated with a **CSPRNG**, not `Math.random()`. Not for secrecy — for uniform
  distribution, so collisions stay as rare as the space implies.
- Uniqueness is enforced by the partial unique index on active games (data model §6.1), and
  generation retries on collision.

---

## 3. Team colour palette

PRD 1 §9.3 requires a curated palette; these are its values. Stored as **resolved hex** on
`game_team.colour` (data model §6.2) so a future palette edit never recolours a played game.

Validated against the **dark main-screen background** (PRD 4 §2.2), which is the hardest
case — a projector crushing contrast at 10 m.

| # | Name | Hex | | # | Name | Hex |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Red | `#EF4444` | | 7 | Blue | `#60A5FA` |
| 2 | Orange | `#F97316` | | 8 | Indigo | `#818CF8` |
| 3 | Amber | `#FBBF24` | | 9 | Violet | `#A78BFA` |
| 4 | Lime | `#A3E635` | | 10 | Fuchsia | `#E879F9` |
| 5 | Emerald | `#34D399` | | 11 | Rose | `#FB7185` |
| 6 | Cyan | `#22D3EE` | | 12 | Slate | `#CBD5E1` |

### 3.1 Assignment order

Auto-assignment **walks the hue wheel rather than the list**, so the first few teams get
maximally distinct colours:

```
1 Red · 2 Cyan · 3 Amber · 4 Violet · 5 Emerald · 6 Fuchsia
7 Blue · 8 Orange · 9 Lime · 10 Indigo · 11 Rose · 12 Slate
```

A 4-team game therefore gets red / cyan / amber / violet — unmistakable from across a room
— rather than red / orange / amber / lime, which is what walking the list in order would
produce.

### 3.2 The honest limitation

**Twelve mutually distinguishable colours is close to the practical ceiling**, and PRD 1
§2.1 allows up to 20 teams. Above 12, colours repeat.

This is acceptable only because of an existing rule: **colour is never the sole identifier**
(PRD 1 §9.5) — it is always paired with the team name, on every surface. Two teams sharing
a colour is a legibility annoyance, not an ambiguity. PRD 2's picker marks taken colours,
and PRD 4's leaderboard drops to name-and-score above ~10 teams anyway.

Custom colours are permitted (PRD 1 §9.3) and are the master's responsibility; the picker
warns on low contrast against the main-screen background but does not block.

---

## 4. Typed error codes

Protocol §7.3 requires typed errors because clients branch on them — a generic failure is
how a client ends up retrying forever. This is the complete catalogue.

```ts
type ErrorCode =
  // ─── resolution ───
  | 'GAME_NOT_FOUND'          // unknown gameId or code
  | 'GAME_NOT_JOINABLE'       // FINISHED or ABANDONED (PRD 5 §14 O3)
  | 'GAME_NOT_LIVE'           // a play action against a game that is not LIVE.
                              //   Joining has its own code above; the other 33 master
                              //   actions had no status guard until slice 3 added this
  | 'TEAM_NOT_FOUND'
  | 'UNKNOWN_DEVICE'          // deviceToken not recognised → clear storage, rejoin
  // ─── joining ───
  | 'TEAM_FULL'               // KWIZ_MAX_DEVICES_PER_TEAM reached (D20).
                              //   payload carries the other teams
  // ─── answering ───
  | 'QUESTION_NOT_OPEN'       // not the current question, or in a state this action is
                              //   illegal from — reveal before lock, skip after reveal.
                              //   Repeating an action that already happened is NOT this:
                              //   a lifecycle transition into the state a question is
                              //   already in is an idempotent { ok: true } with no event
  | 'QUESTION_LOCKED'         // master locked it → stop retrying (D8)
  | 'ALREADY_SUBMITTED'       // different value after submission (D43).
                              //   payload carries the canonical answer
  | 'BUZZERS_NOT_LIVE'        // no buzz window open
  | 'TEAM_LOCKED_OUT'         // denied on this question already (D35)
  // ─── master actions ───
  | 'NOT_IN_SETUP'            // regenerate-code / re-sync outside SETUP
  | 'GAME_NOT_FINISHED'       // NOT_IN_SETUP's mirror at the other end of a game's life.
                              //   Only PRD 4 §10.2's FINISHED tabs need it: they exist once the
                              //   game has ended, so GAME_NOT_LIVE would be the wrong refusal —
                              //   LIVE is exactly the status this one rejects
  | 'RESYNC_BLOCKED'          // answers or buzzes exist (data model §7.1)
  | 'SOURCE_QUIZ_DELETED'     // nothing to re-sync from
  | 'COPY_INVALID'            // the freshly-copied rows failed preflight() (data model §7's
                              //   last bullet). A copy bug, never a normal refusal — should
                              //   not be reachable, and rolls the whole transaction back
  | 'QUESTION_STILL_OPEN'     // break refused over a live question (PRD 4 §11)
  | 'SCORE_OUT_OF_RANGE'      // PER_TEAM_SCORE outside 0…points (D24)
  // ─── DSMTW_FINALE (D50) ───
  | 'NOT_A_FINALE_ROUND'      // finale action against a non-finale round
  | 'TOO_FEW_FINALISTS'       // fewer than 2 selected (D55)
  | 'FINALISTS_ALREADY_SET'   // selection is fixed once the round opens
  | 'TEAM_NOT_A_FINALIST'
  | 'TEAM_ELIMINATED'         // no turn, no marks, no further penalty (I22)
  | 'NOT_TEAMS_TURN'          // marking against a team that isn't on turn.
                              //   **Unreachable as built, deliberately:** the mark endpoint takes
                              //   no teamId and credits whoever is on turn, so there is no request
                              //   that can name the wrong team. Kept because PRD 3 §10.2's desk
                              //   could grow a "credit another team" affordance, and the code
                              //   should exist before the path does rather than after
  | 'NO_TURN_ACTIVE'          // pass/mark between turns
  | 'KEYWORD_ALREADY_MARKED'  // idempotent for the same team; error for a different one
  // ─── import ───
  | 'SCHEMA_VERSION_UNSUPPORTED'
  | 'CHECKSUM_MISMATCH'       // Declared, never returned (P2 #10) — a corrupt/missing attachment
                              //   is reported per file in ParsedExport.missingAttachments instead
                              //   (protocol §8.1), because PRD 2 §14.2's design previews the whole
                              //   import before anything is written rather than failing partway
                              //   through and forcing a retry. Kept in the catalogue: the shape it
                              //   names is real, just carried on a different channel than an error.
  | 'IMPORT_COLLISION'        // Declared, never returned, for the same reason — the collision
                              //   PRD 2 §14.2 needs a Replace/Copy choice for (D9) is surfaced in
                              //   ImportPreview.collision, decided by the master before import
                              //   runs, rather than discovered as a failure during it.
  | 'MANIFEST_INVALID'
  // ─── attachments ───
  | 'ATTACHMENT_REJECTED'     // outside §7's allowlist, or over KWIZ_MAX_UPLOAD_MB.
                              //   payload lists the accepted MIME types
  | 'ATTACHMENT_NOT_FOUND'    // the row exists and the file does not (data model §8)
  // ─── boundary ───
  | 'VALIDATION_ERROR'        // zod rejected the request shape.
                              //   Distinct from every domain error above
  | 'DATABASE_MIGRATION_REQUIRED'
                              // the master declined the pending migrations (D14).
                              //   Every action refuses until they are applied; the server
                              //   is running, so this is temporary rather than fatal
```

**Response shape**, uniformly:

```ts
type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: ErrorCode; message: string; detail?: unknown }
```

- `message` is **English, for developers and logs**. User-facing copy comes from
  `errors.<CODE>` in the messages module (§6) — never from the server.
- **A client must never branch on `message`.** Only on `error`.
- `VALIDATION_ERROR` is deliberately separate from the domain codes: a malformed request is
  a bug, whereas `QUESTION_LOCKED` is normal life.

---

## 5. Timing constants

Scattered across four PRDs; collected here as the single source. Define them once in
`packages/domain/src/constants.ts` and import — do not re-type a number.

| Constant | Value | Where it matters |
| --- | --- | --- |
| `DRAFT_DEBOUNCE_MS` | `500` | Player draft push (D8, D45) |
| `SUBMIT_RETRY_BASE_MS` | `500` | Backoff start; caps at 5 s, retries while the question is open (PRD 5 §5.4) |
| `SSE_PING_MS` | `15_000` | Keepalive comment frame (protocol §2.2) |
| `SSE_RETRY_HINT_MS` | `3_000` | `retry:` sent on connect |
| `DISCONNECT_GRACE_MS` | `3_000` | Main screen shows nothing before this (PRD 4 §13) |
| `CURSOR_HIDE_MS` | `2_000` | Main screen cursor hide (PRD 4 §2.3) |
| `MC_DISTRIBUTION_DELAY_MS` | `1_500` | Reveal beat 2 for multiple choice (P5) |
| `SCORE_BANNER_MS` | `6_000` | Adjustment announcement (D25) |
| `STAGE_TRANSITION_MS` | `250`–`400` | Main-screen stage changes (PRD 4 §14) |
| `TIMER_WARN_SCREEN_S` | `5` | Main screen colour shift + pulse |
| `TIMER_WARN_PLAYER_S` | `10` | Player device colour shift + pulse |
| `FINALE_PENALTY_S_DEFAULT` | `20` | Authored default, overridable at `SETUP` (D54) |
| `FINALE_CLOCK_WARN_S` | `15` | A finale clock pulses below this (PRD 4 §12.2) |
| `FINALE_PENALTY_FLASH_MS` | `1_200` | How long `−20s` shows beside a clock (PRD 4 §12.3) |
| `FINALE_ELIMINATION_HOLD_MS` | `2_500` | The `OUT` moment on the main screen (PRD 4 §12.4) |

**The two timer thresholds differ deliberately**, and it is not an oversight: the player
device is where someone is still typing and needs a chance to finish, so it warns at 10 s.
The main screen warns at 5 s, where an earlier warning would just be a longer stretch of
flashing at an audience.

---

## 6. i18n conventions

`next-intl`, locales `en` and `nl`, default always `en` (D17).

### 6.1 Key structure

```
<surface>.<section>.<key>
```

Surfaces: `common`, `landing`, `admin`, `control`, `screen`, `player`, `errors`.

```ts
// messages/en.ts
export default {
  common: { cancel: 'Cancel', save: 'Save', teams: 'Teams' },
  player: {
    waiting:  { title: "You're in.", subtitle: 'Keep an eye on the big screen.' },
    question: { submit: 'Submit', locked: 'Locked in', buzz: 'BUZZ' },
  },
  screen:  { break: { backIn: 'BACK IN', soon: 'STARTING SOON' } },
  errors:  { TEAM_FULL: 'That team already has the maximum number of phones.' },
}
```

- **`errors.<CODE>` mirrors §4's `ErrorCode` exactly.** That is what connects a typed
  server error to user-facing copy, and it means a new error code has an obvious home
  rather than producing an inline string.
- **Never interpolate quiz content into a translated string** — question text is not
  translated (PRD 1 §9.4). Compose instead: `{t('screen.question.points', {n})}` is fine;
  embedding the prompt is not.
- Locale files are **flat within a section** — no deeper than three levels, so a key is
  greppable.
- Dutch runs 20–30% longer (PRD 1 §9.2); the main screen's layouts are verified against
  `nl`, not `en`.

---

## 7. Attachment MIME allowlist

Rejected at upload with a message naming what works (PRD 2 §7.1). Playability is *also*
verified in the browser (O6) — this list is the cheap first gate, not the guarantee.

| Kind | Accepted | Extensions |
| --- | --- | --- |
| `IMAGE` | `image/jpeg`, `image/png`, `image/webp`, `image/gif` | jpg jpeg png webp gif |
| `AUDIO` | `audio/mpeg`, `audio/mp4`, `audio/aac`, `audio/ogg`, `audio/wav` | mp3 m4a aac ogg wav |
| `VIDEO` | `video/mp4`, `video/webm` | mp4 webm |

- **Codec matters more than container** for video: MP4 must be H.264, WebM VP8/VP9. The
  MIME check cannot see this, which is exactly why upload-time playability verification
  exists (PRD 2 §7.1).
- `KWIZ_MAX_UPLOAD_MB` (default 50) caps size (PRD 1 §6.8).
- `ext` is derived from the **detected type**, never from the uploaded filename (data model
  §4.7).

---

## 8. Finale keyword shapes (D53)

`wordLengths` is what the room sees instead of an unguessed keyword, so it must be computed
identically everywhere or the tiles will not match the answer they resolve to.

```ts
// packages/domain — the single implementation. Stored on write (data model §4.3.1),
// never recomputed in a payload filter.
export const wordLengths = (keyword: string): number[] =>
  keyword.trim().split(/\s+/).filter(Boolean).map((w) => Array.from(w).length)
```

**`Array.from(w)`, not `[...w]`** — identical semantics (both iterate code points), but spreading a
string trips `no-misused-spread`, and a suppression next to the one function that must stay
byte-identical everywhere is a poor trade for two saved characters.

| Keyword | Shape | Renders as |
| --- | --- | --- |
| `Thriller` | `[8]` | one 8-wide block |
| `i like cows` | `[1,4,4]` | three blocks with word gaps |
| `Billie Jean` | `[6,4]` | two blocks |
| `324 metres` | `[3,6]` | two blocks |

Three rules that matter:

- **Count characters, not UTF-16 code units.** `[...w].length`, not `w.length` — `"café"` is 4
  and an emoji or accented character must not widen a tile misleadingly.
- **Punctuation counts as part of its word.** `"Bad!"` is `[4]`. Stripping it would make the
  tile narrower than the revealed text, and the mismatch is visible on a projector.
- **Whitespace is collapsed before splitting**, so a stray double space in authoring doesn't
  produce a phantom zero-width word.

### 8.1 Suggested finale question count (D58)

Computed in **one place** and used by both the round editor and game setup, or the two will
disagree and the master will trust neither.

```ts
// packages/domain — the single implementation.
export function suggestFinaleQuestions(
  banks: number[],              // each finalist's starting seconds
  penaltySeconds: number,
  keywordsAssumedFound = 3,     // of 5 — see the assumptions below
): number {
  let alive = [...banks]
  let questions = 0
  while (alive.length > 1 && questions < 60) {
    questions++
    const T = alive.length
    // A team is not charged for its own finds, so each loses penalty*k*(T-1)/T.
    // The term shrinks as teams drop out, which is why this is simulated, not solved.
    const loss = penaltySeconds * keywordsAssumedFound * (T - 1) / T
    alive = alive.map((b) => b - loss).filter((b) => b > 0)
  }
  return questions + 1          // one question of headroom
}
```

**Two assumptions, both deliberately biased toward suggesting more:**

- **3 of 5 keywords found per question.** A generous room finds more and finishes sooner; a
  hard question finds fewer. Three is the conservative middle.
- **Turn time is ignored entirely.** A guessing team's clock also drains, so real games consume
  banks *faster* than this model. Excluding it means the suggestion is never too low.

Both are safe in the same direction because **over-supplying questions costs nothing** — the
round ends at one survivor regardless of what's left.

**How sensitive this is, and why it must be shown rather than guessed:**

| Finalists | Banks | Penalty | Suggested |
| --- | --- | --- | --- |
| 4 | 170/155/145/20 | 20 s | **5** |
| 4 | 170/155/145/20 | 5 s | **17** |
| 2 | 170/155 | 20 s | **7** |
| 8 | 120 each | 20 s | **4** |
| 8 | 120 each | 5 s | **11** |
| 6 | 200…80 | 10 s | **10** |

A fourfold change in the penalty swings the answer from 5 questions to 17. No master is going
to intuit that.

### 8.2 Duration formatting

Two formats, and the choice is not stylistic:

| Context | Format | Why |
| --- | --- | --- |
| **Finale clocks** (D57) | Whole seconds: `120`, `84`, `0` | The round is arithmetic against a penalty in seconds. `84 − 20` is instant; `1:24 − 0:20` is a base-60 conversion under time pressure |
| **Question timers** | Whole seconds: `18` | Always under a minute in practice; a colon would add glyphs to the largest text on the projector for nothing |
| **Break countdown** | `m:ss`: `4:37` | Minutes long, and nobody subtracts from it |
| **Media duration** | `m:ss`: `2:14` | Conventional for audio and video, and matches every other player the master has used |
| **Buzz timings** | Seconds, 2 decimals: `4.21` | The margin *is* the drama (D35); whole seconds would flatten a photo finish into a tie |
| **Wall-clock times** | `HH:mm`: `21:14` | Adjustment log, elimination instants, autosave indicator |

**Configured amounts carry a unit; running clocks do not.** `penalty 20s` and `41s left` read
as quantities; a ticking `84` reads as a clock. Mixing them — a clock that says `84s` — makes
the number look like a setting rather than something counting down.

---

## 9. Naming conventions

| Thing | Convention | Example |
| --- | --- | --- |
| SQL columns | `snake_case` | `game_question_id` |
| TS properties | `camelCase` | `gameQuestionId` |
| Event types | `SCREAMING_SNAKE`, past tense | `ANSWER_SUBMITTED`, `KEYWORD_MARKED` |
| Error codes | `SCREAMING_SNAKE` | `QUESTION_LOCKED` |
| Enum values | `SCREAMING_SNAKE` | `AUTO_CORRECT` |
| Domain functions | verb-first, pure | `reduce`, `toPlayerView`, `normaliseAnswer` |
| Packages | `@kwiz/domain`, `@kwiz/db`, `@kwiz/export`, `@kwiz/config` | |
| Route params | `gameId`, `code`, `quizId`, `roundId` | never bare `id` |
| Test files | `*.test.ts` beside the source | `scoring.test.ts` |

**Events are past tense** because they record what happened, not what to do. `OPEN_QUESTION`
would be a command; `QUESTION_OPENED` is the fact. Getting this backwards is how an event
log starts being treated as a queue.

---

## 10. Validation with zod

zod is the single validation tool. The rule that matters most is not *where* to use it but
**how**:

> **Define the zod schema; infer the TypeScript type from it.** Never hand-write both.

```ts
export const doConfigSchema = z.object({
  scoringMode: z.enum(['WINNER_TAKES_ALL', 'PER_TEAM_SCORE']),
  tiePayout:   z.enum(['SPLIT', 'FULL']).default('FULL'),
})
export type DoConfig = z.infer<typeof doConfigSchema>   // ← inferred, never declared
```

A hand-written interface beside a schema is two sources of truth that drift silently: the
type says one thing, the runtime enforces another, and the compiler is satisfied by both.

### 10.1 Where zod is required

| Place | Why |
| --- | --- |
| **POST bodies** — all 41 actions (protocol §7.1–§7.2) | Untrusted input. Rejects as `VALIDATION_ERROR` (§4) |
| **JSON columns** — `question.config`, `round.config`, `game_event.payload` | A JSON column without a validator is a bug (data model §2) |
| **`game_event.payload` on append** | Per-type schemas in a discriminated union on `type`. Catches a malformed event *before* it becomes permanent in an append-only table |
| **`game_event.payload` on replay** | Read back from disk as `unknown`. Validating on replay catches corruption and, more usefully, a log written by an older build |
| **Env config** (`@kwiz/config`) | Fails fast at boot with a clear message rather than `undefined` surfacing three layers deep (PRD 1 §6.8) |
| **Import manifest and zip contents** | Wholly untrusted, and the whole point of `SCHEMA_VERSION_UNSUPPORTED` / `MANIFEST_INVALID` (protocol §8) |
| **Attachment upload metadata** | MIME, size and extension against §7's allowlist |
| **`localStorage` reads** on the player device | Client-controlled storage; a malformed `deviceToken` should route to the team picker, not throw |

Two of these deserve emphasis because they are easy to skip:

- **Validating event payloads on *replay*, not only on append.** The event log is the one
  thing in this system that outlives every deployment. A schema change that makes an old
  payload unparseable must fail loudly at replay, not corrupt a projection quietly.
- **Env config.** `KWIZ_MAX_DEVICES_PER_TEAM=abc` should stop the server at boot with a
  one-line message, not become `NaN` and silently admit unlimited devices.

### 10.2 Where zod is *not* wanted

Stated explicitly, because "use zod where applicable" otherwise expands until every
function validates its own arguments.

| Place | Why not |
| --- | --- |
| **Internal `packages/domain` function arguments** | Already statically typed, and the caller is our own code. Runtime re-validation is pure overhead and clutters the layer whose readability matters most |
| **Outbound SSE payloads** | The sentinel leak test (protocol §6.2) already covers the risk that matters. Validating every push costs CPU on the hot path to check our own serialiser |
| **Drizzle query results** | Trust the schema. If rows can violate it, the fix is a constraint or an invariant test, not a parse on every read |
| **Values already parsed once** | Parse at the boundary, then pass the typed value inward. Re-parsing is a sign the boundary is in the wrong place |

### 10.3 Deriving schemas from Drizzle

`drizzle-zod` can generate insert/select schemas from table definitions. Use it for
**CRUD-shaped boundaries** where the schema really is "this table's columns" — it keeps
the two in step automatically.

Do **not** use it for action bodies. An action's input is rarely a table row: `submit`
takes `{ gameQuestionId, text? }`, not a `game_answer` row, and generating from the table
would expose fields no client may set.

**The export payload is the case this was written for** (protocol §8): `quiz.json` and
`games.json` are exactly fifteen tables' columns, so they are generated. Two details that
only surface once you try it:

- **Dates are revived before validation, not refined per column.** `timestamp_ms` columns
  cross the wire as ISO strings, and passing `createSelectSchema` a runtime-built
  refinement map defeats its per-column typing — TypeScript gives up with *"type
  instantiation is excessively deep"* on a table with a dozen columns. Converting the
  strings first keeps the generated schema exactly as generated. Which columns to convert
  is read from the table's own metadata, so a date column added later needs no edit.
- **Do not revive with a `JSON.parse` reviver.** It cannot tell a timestamp column from a
  question whose accepted answer happens to be `2026-08-08T18:22:04.000Z`. Structure is
  knowable; string contents are not.

---

## 11. Definition of done

A slice is done when **`pnpm check` passes** (format, lint, typecheck, tests) *and*:

- Every new boundary has a zod schema.
- Every new event type appears in protocol §4's catalogue, with an endpoint in §7.
- Every new secret in a payload has a sentinel in the protocol §6.2 leak test.
- Anything contradicting a PRD or spec has been raised, not silently resolved.
- No `any` in `domain` or `db`. No `process.env` outside `@kwiz/config`.

**Discovering that a spec is wrong is a valid outcome of a slice.** Say so, propose the
change, and update the doc in the same PR — the specs are normative, so a divergence left
in code is worse than a spec edit.
