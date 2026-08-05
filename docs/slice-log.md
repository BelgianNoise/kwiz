# Slice log

One entry per slice, appended by the agent that completed it. See
[`agent-workflow.md`](agent-workflow.md) §6 for the required shape.

The next agent inherits your code and none of your reasoning. This file is the only channel
between them.

Every entry must answer five things: **what you built**, **where you deviated from the specs
and why**, **what you raised without resolving**, **what you deliberately left out**, and
**what the next agent would otherwise have to rediscover**.

---

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
- **conventions §1.3 specified `no-floating-promises: error`, which was doing nothing.**
  oxlint builds no TypeScript program and implements no type-aware rules under any name.
  Removed from the config and the doc. See "Raised" below — this leaves a real gap.
- **conventions §1.3's config block was incomplete as written.** It now also carries
  `ignorePatterns`, a `scripts/**` override for `no-console`, `react/react-in-jsx-scope: off`
  (Next uses the automatic JSX runtime) and `import/no-unassigned-import` allowing `*.css`
  (how an App Router layout loads styles). Without the last two, a clean scaffold emits 11
  warnings.
- **conventions §1.5's scripts assumed a single-package repo.** `typecheck` fans out with
  `pnpm -r typecheck` because one root project cannot serve both the packages and a Next app;
  `tsconfig.tools.json` covers the root files no package owns. `lint` now also runs the
  `process.env` guard, and `format:check` was added so `check` can compose them.
- **Added conventions §1.3.1** documenting `.oxfmtrc.json`, and a note in §1.4 that the three
  architectural rules are covered by a test.

### Raised, not resolved

- **Nothing mechanically catches a floating promise.** This is the price of oxlint over
  typescript-eslint, and it lands exactly where it hurts: `appendAndProject()` (slice 1) and
  the SSE writers (slice 3), where an unawaited write is a lost event or a stalled stream.
  Options are to accept it and review by hand, or add typescript-eslint solely for that rule.
  **Not decided — worth a decision before slice 3.**
- **No zip library is chosen for `@kwiz/export`.** conventions §1's dependency table names
  none, and slice 0 had no reason to pick. Whoever implements protocol §8 flags the addition
  per agent-workflow §3.4.
- **`/[locale]` renders dynamically despite `generateStaticParams`.** Irrelevant for a LAN app
  that is dynamic throughout, so it was not chased; noted in case someone later expects
  prerendering.
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
- `messages/nl.ts` is typed `: Messages` from `en.ts`, so **a key present in English and
  missing in Dutch is a compile error**. `global.d.ts` registers `AppConfig`, so `t()` keys are
  checked too — a typo is a build failure, not a raw key on a projector.
- Use `Link`/`useRouter` from `@/i18n/navigation`, never `next/link`, or a language switch
  will not preserve the path.

**Handy:** `.claude/launch.json` defines `kwiz-dev`, so `preview_start` opens the app directly.
