# Smoke checklist

A manual pass, run **in full** at the end of every slice — not just the rows your slice
added. See [`agent-workflow.md`](agent-workflow.md) §5.3.

It takes a few minutes and it is the only mechanism that catches "slice 6 broke slice 4".
The automated suite catches logic regressions; this catches the ones that only appear when a
human drives four surfaces at once.

**Each slice appends its own rows and does not remove anyone else's.**
[`build-order.md`](build-order.md) lists what each slice is expected to add.

---

## Setup for any slice from 5 onwards

```
tab 1  /admin              author, then start a game
tab 2  /control/<gameId>   master
tab 3  /screen/<gameId>    projected, 1920×1080
tab 4  /play/<code>        team A, mobile viewport
tab 5  /play/<code>        team B, mobile viewport   ← the tab that finds real bugs
```

---

## Checks

<!-- Format:

### After slice N
- [ ] a specific, observable thing
-->

### After slice 0 — scaffold

- [ ] `pnpm install` on a clean clone succeeds with **no compilation step** and no C++
      toolchain present (conventions §1.1). `node_modules/.pnpm/better-sqlite3@*/…/build`
      must not exist — only `prebuilds/`.
- [ ] `pnpm check` is green: format, lint, `process.env` guard, typecheck, tests.
- [ ] `pnpm lint` produces **zero output**, warnings included. A tolerated warning is a
      warning nobody will read later.
- [ ] `pnpm lint` still carries `--type-aware`, without which the three promise rules
      silently do nothing (conventions §1.3).
- [ ] `pnpm build` completes with **no warnings**.
- [ ] `pnpm dev` serves, and `/` redirects to `/en`.
- [ ] `/en` and `/nl` both render, each with a matching `<html lang>`.
- [ ] Dutch copy is actually Dutch on `/nl` — not an English fallback.
- [ ] **Browser console is clean** on both locales (React DevTools notices and HMR logs
      excepted).
- [ ] Tailwind is *applied*, not merely present: `text-muted-foreground` computes to the
      same colour as the `--muted-foreground` token.
- [ ] Body font resolves to the system stack — **no network request for a font file**, since
      the app must build and run offline.
- [ ] **D17:** a request to `/` with `Accept-Language: nl` still lands on `/en`.
- [ ] **PRD 1 §9.4 step 2:** a request to `/` carrying `NEXT_LOCALE=nl` lands on `/nl`, and
      an unrecognised cookie value falls back to `/en`.
- [ ] An explicit segment beats the cookie: `/en` with `NEXT_LOCALE=nl` renders English.
- [ ] `pnpm typecheck` passes on a tree with **no `.next/`** — i.e. before anything is built.
- [ ] Installing with a deliberately impossible `engines.node` is **refused**, not warned
      about (`engineStrict`).
- [ ] CI is green on **both** matrix platforms, not just Linux (conventions §1.6) — the
      `better-sqlite3` prebuild is per-platform, so a Linux-only pass proves nothing about the
      laptop the quiz runs on.

### After slice 2 — the domain rules

- [ ] *(no UI — covered by the test suite, per build-order.)* The rows worth keeping as human
      checks are the two the suite cannot judge:
- [ ] `pnpm test` runs the sentinel leak test across **every** (audience × question state) pair,
      and the count of pairs grew if you added a state or an audience.
- [ ] `projection-parity.test.ts` still passes. It is the only thing comparing `@kwiz/db`'s
      projection against `@kwiz/domain`'s reducer — two readings of one log — so if you change how
      either grades an answer, that test is the one that notices.
- [ ] A new secret added to any payload has a **sentinel** in `views.sentinel.test.ts`. Grep for
      `ZZ_SECRET` — if your field is not represented, the table is silently incomplete.

### After slice 1 — schema & migrations

- [ ] `pnpm db:generate` reports **24 tables** and produces no unexpected diff on a clean tree.
- [ ] The generated SQL still carries `CREATE UNIQUE INDEX game_active_code_idx … WHERE status IN
      ('SETUP','LIVE')`. Losing the `WHERE` would silently exhaust the code space.
- [ ] All of D14's boot paths — silent on fresh, backup-then-prompt on existing, declined leaves
      the data intact, `KWIZ_AUTO_MIGRATE` skips the question but still backs up, no-TTY refuses
      — are covered by `boot.test.ts` against a **real directory and a real backup file**, so
      `pnpm test` is this row. Break one on purpose once if you want to trust it.
- [ ] **The one part no test drives:** at slice 3, boot `pnpm start` against a database with a
      pending migration and confirm the `readline` prompt actually renders and honours `n`. That
      is six lines of plumbing over logic already tested, but nobody has seen it run.
- [ ] The column-parity guard fails if you delete a column from one side of a shared factory —
      worth breaking on purpose once, since it is the only thing standing between a routine
      schema change and silent data loss in games.
