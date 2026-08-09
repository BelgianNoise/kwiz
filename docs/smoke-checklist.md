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

### After slice 1 — schema & migrations

- [ ] `pnpm db:generate` reports **24 tables** and produces no unexpected diff on a clean tree.
- [ ] The generated SQL still carries `CREATE UNIQUE INDEX game_active_code_idx … WHERE status IN
      ('SETUP','LIVE')`. Losing the `WHERE` would silently exhaust the code space.
- [ ] All of D14's boot paths — silent on fresh, backup-then-prompt on existing, declined leaves
      the data intact, `KWIZ_AUTO_MIGRATE` skips the question but still backs up, no-TTY refuses
      — are covered by `boot.test.ts` against a **real directory and a real backup file**, so
      `pnpm test` is this row. Break one on purpose once if you want to trust it.
- [ ] The prompt itself is covered by `boot.test.ts` from slice 3 — a real `readline` over injected
      streams, asserting it lists each migration by name, names the backup, honours `n` and treats a
      bare Enter as yes. **What is left for a human is only whether it *looks* right:** boot
      `pnpm start` against a database with a pending migration once, in a real terminal.
- [ ] The column-parity guard fails if you delete a column from one side of a shared factory —
      worth breaking on purpose once, since it is the only thing standing between a routine
      schema change and silent data loss in games.

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

### After slice 3 — transport

Needs a game in the database. Slice 3 has no authoring UI, so seed one through the real code:
a throwaway `packages/db/src/*.test.ts` calling `createGameFromQuiz` against `./data`, run with
`npx vitest run --project db <name>`, then **delete the file**. It prints the `gameId` and code.

- [ ] `curl -N http://localhost:3000/api/live/<gameId>/screen` returns `200` with
      `content-type: text/event-stream` and **`x-accel-buffering: no`** — without that header a
      proxy buffers the stream and the room sees the game in bursts.
- [ ] The first two frames are `retry: 3000` and one `state`, and the `state` carries
      **`id: <gameId>:<seq>`** — qualified by game, or protocol §3.2's cross-game rule cannot hold.
- [ ] A `: ping` arrives every **15 s**. Leave the stream open for 40 s and count two.
- [ ] **No polling** (D2): the network panel shows one long-lived request per surface, not a
      repeating one.
- [ ] The **main-screen and player payloads contain no `masterNotes`** while a question is open,
      and the control payload does. Seed the question with a distinctive string and grep the raw
      SSE text for it — this is the network-level version of the sentinel test, and the unit test
      cannot prove the filter is the thing being used.
- [ ] `POST /api/games/join` returns a `deviceToken`; the same token on
      `/api/live/<gameId>/play` resolves to that team, and on **another game's** stream returns
      `401 UNKNOWN_DEVICE`.
- [ ] Submit twice with the same text → both `{ ok: true }`. Submit different text → `409`
      `ALREADY_SUBMITTED` **carrying the canonical answer** (D43).
- [ ] **Kill the server mid-question and restart it.** Every stream comes back with the same
      question, the same submitted answer and the same `attention` — from the log alone (D4).
- [ ] `POST /api/attachments` with an image returns a checksum; uploading the identical file again
      returns `stored: false` and leaves **one** file in `data/attachments/`.
- [ ] `GET /api/attachment/<id>` answers `200` with `accept-ranges: bytes`, a `Range: bytes=4-8`
      request answers `206` with `content-range`, and a range past the end answers `416` (D5).
- [ ] `data/` is at the **repo root**, not `apps/web/data` — the `.env.development` anchor is
      working (PRD 1 §6.6).
- [ ] `actions.test.ts` still lists every path in protocol §7.1–§7.2. It transcribes the spec
      independently of the route table, so an endpoint dropped or renamed fails there rather than
      being discovered by a surface that cannot call it.

### After slice 4 — the config surface

- [ ] **Boot with no `data/settings.json`.** `/admin` redirects to `/admin/setup` once, and only
      once — after choosing an address it never nags again. This is D10's whole point and the
      easiest thing to regress by touching the dashboard.
- [ ] The picker lists this machine's real interfaces and marks the unusable ones. On a laptop with
      Docker or WSL, **those must not read `reachable`** — that is the dead QR code §4 exists to
      prevent. `network.test.ts` covers the rules; this row is whether *your* machine looks right.
- [ ] `[Test with my phone]` → scan → the screen says **"Your phone reached this machine."** Do it
      from an actual phone at least once per slice that touches `lib/server/*`: it is the only
      check that exercises the page-writes/route-reads path the singleton fixes, and it fails
      silently when that breaks.
- [ ] Edit the saved address in `settings.json` to one this machine does not have. The dashboard
      shows the stale banner **and still works** — a stale address is a warning, not a block.
- [ ] Pre-flight on a deliberately broken quiz: an empty prompt, a finale with fewer than five
      keywords, an uneven board. Every finding links to the round that owns it, and
      **`[Play anyway]` is present** — pre-flight never blocks (§10).
- [ ] Game setup: add and remove a team and watch the finale arithmetic move. Leave a name blank
      and confirm it is stored as `Team n`, not empty. Open a colour picker and confirm the other
      teams' colours are *marked*, not disabled.
- [ ] The game hub shows the code large, a scannable QR, and `http://<address>:<port>/play/<code>`
      — not a relative path. Regenerate the code and confirm both update.
- [ ] Settings → Storage: drop a junk file into `data/attachments/`, reload, confirm it is offered
      as reclaimable with the right count and size, reclaim it, and confirm **the referenced file
      is still there**. This is the one button in the app that deletes a master's files.
- [ ] Export a quiz with games, then import the same zip back. It must land as a **second** quiz
      with a **different join code**, and the imported game's scores must be present — they exist
      only if replay rebuilt them. Then re-export the copy and confirm the collision dialog names
      both sides and says which is older **in words**.
- [ ] Import a zip that is not a Kwiz file, and one whose `schemaVersion` is bumped by hand. Both
      refuse with a specific message, and **nothing is written** — the quiz list is unchanged.
- [ ] Switch the admin locale to Dutch and walk one screen of each kind. A missing key is a build
      error, so what this catches is layout: Dutch runs 20–30% longer.
- [ ] **Drag a round, and try to drag one past the finale.** The handle is real, not decoration —
      it did nothing for most of slice 4 and nothing failed. Then do the same with `↑`/`↓`: both
      routes must refuse identically (§15.2), or the keyboard is a way around §6.1.
- [ ] `[+ Add team]` on a **live** game: the dialog must state what they missed, what their ceiling
      now is versus everyone else's, and suggest half the missed points. Add with the starting
      score, then confirm it appears as an ordinary revocable adjustment rather than a magic
      opening balance.
- [ ] Upload an image and a sound file to a question, and try a text file renamed `.png`. The last
      one is refused by its **bytes**, not its extension, and names the formats that work.
- [ ] **The game overflow menu has all three items** — export this game, abandon, delete — and the
      delete confirmation names the real team and answer counts. Delete one and confirm the **quiz
      survives**; that fear is why masters never tidy up.
- [ ] Reorder a Jeopardy column left and right. Column order is what the room reads.
- [ ] Pick a custom team colour of dark navy: it is **accepted, with a warning**, not refused.
- [ ] **`[Preview on main screen]` on three questions**: one short and text-only, one with an image,
      one with a deliberately enormous prompt. The first fills the stage, the second becomes the
      `HERO` layout, and the third shrinks — but **never below 4% of the frame height**, because
      below that the back tables cannot read it and it is a content problem for pre-flight, not a
      rendering one. A board tile must show its **ladder** value, not the question row's own (O3).

### After slice 5 — master control

- [ ] **The four regions never move.** Walk a whole round — setup, question, lock, reveal, break,
      board, finale — and watch the header, the right rail and the timeline stay exactly where they
      are. A layout that reflows makes the master re-locate the button they need, every time (§2).
- [ ] **A freshly started game offers a way to start.** `[Start the quiz]` → `[Start the next
      round]` → `[Open the next question]`, with no dead end between them. This was broken for the
      whole of slice 5's build and no test caught it: `attention` was `NONE`, and `NONE` looks like
      a perfectly good leaderboard.
- [ ] Open a question and let the timer run out. It says `Time up` and **nothing else happens** —
      `[Close answers]` is identical before and after, because only the master locks (D8).
- [ ] Judge an answer inline while the question is still open, then lock. The verdict is still
      there and the row did not move (§5.1, D42).
- [ ] `Y` and `N` act on the **topmost undecided row**, and `Enter` fires whatever the primary
      button says. Then click into the adjustment popover's reason field and type `y` — it must
      appear as the letter `y`, not accept an answer.
- [ ] **Defer a validation and move on.** Open the next question, finish it, and confirm the desk
      comes back to the deferred one (§6.2) — but *not* while a question is open, where it would
      pull the master backwards mid-question.
- [ ] Reveal, then `[Show on screen]` one answer. The button says `On screen` afterwards, and
      pressing it again takes it back off (§5.3).
- [ ] Two devices on one team, one buzzer question: adjudicate the first buzz as **wrong** and
      confirm buzzers reopen, the denied team is listed as locked out, and `[Reopen for everyone]`
      clears it (D35).
- [ ] Score a `DO` question both ways: winner-takes-all with **two** teams selected (the button
      must state the payout), and per-team scores where an empty box is visibly not a zero (D24).
- [ ] Adjust a score with a reason, watch the banner line appear in the rail, then `[Undo]`. The
      total reconciles and the row stays listed, struck through (D41).
- [ ] Start a break over a locked question, watch the `m:ss` countdown run to zero, and confirm
      **nothing resumes by itself**. `[Extend break]` adds time; `[Resume]` is the only way back
      (§11.2, D8). Then try to start one over an *open* question — the menu item is disabled.
- [ ] **Kill the server mid-question and restart it.** The desk shows `Reconnecting…`, keeps the
      last view on screen, and comes back to the same state with **no reload and no click** (D4).
- [ ] Open a second `/control/<gameId>` tab. Both desks show `1 other control screen` within a
      few seconds, and closing one clears it on the other (§12).
- [ ] The finale, end to end: pick finalists and watch the penalty line and the suggested question
      count move as you deselect teams; start a turn; mark a keyword with `1`; un-mark it with
      `Shift`+`1` and confirm **the seconds come back to every other team** (§10.4); pass with
      `Space`. Then let a clock run out and confirm the team goes out on its own.
- [ ] The finale's ranking has **two tabs** — survival, and points before the finale — and they
      disagree, which is the whole point of showing both (D51).
- [ ] Nothing irreversible is bound to a key (§13). Press every key on the map during a live
      question and confirm none of them ends the game, abandons it, skips a question or submits on
      a team's behalf.
- [ ] Switch to `/nl` and walk the same screens. Dutch runs 20–30% longer; the header and the
      finale's clock strip are where that shows first.
