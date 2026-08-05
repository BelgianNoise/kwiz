# Slice log

One entry per slice, appended by the agent that completed it. See
[`agent-workflow.md`](agent-workflow.md) §6 for the required shape.

The next agent inherits your code and none of your reasoning. This file is the only channel
between them.

Every entry must answer five things: **what you built**, **where you deviated from the specs
and why**, **what you raised without resolving**, **what you deliberately left out**, and
**what the next agent would otherwise have to rediscover**.

---

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
