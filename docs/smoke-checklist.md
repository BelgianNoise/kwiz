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
