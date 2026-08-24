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
      a team's behalf. **Then get the desk to suggest `[End the game]`** — play the last round out —
      and press `Enter`: it must do **nothing**, and clicking the button must ask first (§1.1).
- [ ] **The sweep must never be a trap** (§6.2). Defer a validation on a round's *last* question,
      score it, and confirm the desk still offers a way forward — `[Start the next round]`, or
      `[End the game]` on the last round. It offered nothing at all for most of slice 5, and the
      screen looks completely reasonable while it does.
- [ ] Switch to `/nl` and walk the same screens. Dutch runs 20–30% longer; the header and the
      finale's clock strip are where that shows first.

### After slice 6 — the main screen

Open `/screen/<gameId>` at **1920×1080**, and do the last row in `nl` rather than `en` — build-order
says both are trivially skipped and are the whole point of the surface.

- [ ] **Arming (§4.1).** The click enables sound and fullscreen and the waiting screen then says
      `♪ sound ready`. Reopen the route: it asks again, because the browser's permission did not
      survive either. It must **always** reach an answer — there is no other way out of that screen,
      and awaiting `requestFullscreen()` hung it for a while in slice 6.
- [ ] **Nothing on this screen is below `4vh`** (§2.1) — *"nothing is exempt, including timings and
      captions."* The mechanical version, run on **each stage and on the arming screen**, is worth
      more than a squint. It has caught three violations so far: Jeopardy category names at `3.6cqh`,
      the finale's `−20s` penalty label at `3.03cqh`, and the arming screen's own copy at `1.85vh`.

      **Scan from `document.body`, not from the stage.** The first version of this check queried
      `[style*="container-type"]` — inside `StageFrame` only — so it structurally could not see the
      arming screen, which §4.1 requires to render *before* that frame. The floor is `4%` of the
      viewport height outside the frame and `4cqh` inside it; both are the same 43.2px at 1080, which
      is why one threshold covers both.
      ```js
      const floor = window.innerHeight * 0.04
      const bad = []
      document.body.querySelectorAll('*').forEach((el) => {
        // Skip the framework's inline payload — it is text nodes nobody reads.
        if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) return
        const t = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim())
        if (!t.length) return
        const px = parseFloat(getComputedStyle(el).fontSize)
        if (px < floor - 0.5) bad.push([el.textContent.slice(0, 30), Math.round(px * 10) / 10])
      })
      bad // the language switcher is chrome, not stage content — ignore its two entries
      ```
- [ ] **§4's QR resolves to something a phone can reach.** Not a relative `/play/CODE` — that was a
      real bug until slice 6, invisible until something rendered a QR from the pushed `joinUrl`. If
      the network picker has run, the address is absolute; if it has not, relative is correct and
      deliberate (a guessed origin is a dead QR that looks authoritative).
- [ ] **The gap between rounds is a leaderboard**, headed `AFTER ROUND n` — not the finished round's
      intro again, which is what it was for most of slice 6.
- [ ] **`▲2` needs two leaderboards.** Show one, change a score, show another. The first is blank
      (nothing has moved yet) and only the second has arrows. Hiding the board in between must not
      become the baseline.
- [ ] **The timer (§7).** The ring visibly depletes, the last five seconds pulse, `⏸` shows while a
      buzz is adjudicated, and at zero it says `TIME` and **holds** — the question is still open
      server-side (D8) and a vanishing timer reads as "the question is over".
- [ ] **The reveal's two beats (§8).** Free text: the answer at hero scale, then spotlight an answer
      the master has *not* judged — it gets **no** verdict mark (D42). Judge it and the `✗` appears.
      Multiple choice: the correct option is marked and the team dots arrive **~1.5 s later** (P5).
- [ ] **Two buzzes, then deny the first** (§8.3, D35). Timings show two decimals — `24.19s` vs
      `24.92s` is the drama — the denied team is **struck through, not removed**, and `BUZZERS OPEN`
      appears at hero scale.
- [ ] **A scored Jeopardy tile hands the stage back to the board** (§3, §9), which is where the next
      picker learns it is their turn. Used tiles read `—`; a value a category never had is blank, and
      the two must look different.
- [ ] **The finale (§12).** A multi-word keyword draws **one block per word** — `i like cows` is three
      blocks of 1 / 4 / 4, never one bar and never blurred text (D53). Mark one: the tile crossfades
      to text, `−20s` flashes beside **every other** clock for about a second, and the team that found
      it pays nothing. Whole seconds throughout, never `m:ss` (D57).
- [ ] **An off-turn elimination gets its moment** (§12.4): a penalty takes a *waiting* team to zero,
      and their name fills the screen with `OUT` before it returns to the turn. Without that the room
      would just notice a row had greyed out.
- [ ] **`FINISHED`'s two tabs (§10.2, D51)** are switched **from control** and the room follows.
      `RESULT` shows survival with the winner's remaining seconds; `POINTS` shows the pre-finale
      totals, and the two disagree. Simultaneous eliminations share a rank and the next number skips.
- [ ] **§10.1's banner** shows team, signed delta and reason for ~6 s, below the stage's content and
      never over it. A **revocation announces nothing** (D41), and nothing announces on the waiting or
      finished screens.
- [ ] **Kill the server mid-question.** Nothing happens for three seconds, then a small wordless pulse
      appears in a corner — never a modal, never red, never the word "error" — and the last good view
      **stays on screen** with its clock still running locally (D52). Restart: the pulse goes and the
      state is exactly as it was (D4).
- [ ] **No polling** (D2). One long-lived GET per stream in the network panel, `: ping` about every
      15 s, and `X-Accel-Buffering: no` on the response.
- [ ] **Two `/screen/<gameId>` tabs show the same view** (O5) — nothing about `MAIN_SCREEN` is
      per-connection.
- [ ] **Walk every stage in `nl`.** Dutch is this surface's layout baseline (PRD 1 §9.2), and the
      round intro's `3 vragen · 40 punten` line and the finale's clock strip are where it shows first.

#### Added by slice 6's review round

Six behaviours whose absence looks like nothing being wrong, which is why they need rows of their own.

- [ ] **Delete the game while the screen is watching it** (PRD 2 §12.1 allows it at any status). The
      projector goes to §14's neutral `kwiz` mark within a few seconds. It froze on the last frame
      forever until slice 6's review round — twice, for two different reasons: no `FAILED` branch on
      the client, and `delete` never closing the streams the way `abandon` does.
- [ ] **Abandon a game mid-question.** The room keeps **whatever was showing** (§14) — no winner, no
      final standings, no announcement. A calm pulse is allowed; a `FINISHED` screen is not.
- [ ] **Two finalists out at once.** Take two clocks to zero and eliminate both back to back, the way
      control does when a penalty lands. **Both names appear in one `OUT` moment**, and the screen
      returns to the turn afterwards. Watch it actually clear: the hold used to be cancelled by the
      next pushed view and stay on screen indefinitely.
- [ ] **A marked keyword names the team that found it** (§12.1), in their colour. A keyword *revealed
      unguessed* gets the text and **no** marker — the absence is the point.
- [ ] **A score change counts up rather than snapping** (§15), and lands on the right number even in a
      tab the browser is not painting. The animation is the nicety; the number is not.
- [ ] **Fail the sound arming** (block autoplay, or mute the OS device) and follow the on-screen
      instruction: clicking again must actually retry it, not just re-request fullscreen.

### After slice 7 — the player device

At **~390×844**, and with **two tabs on one team** — most of this surface's rules are invisible with
one phone (agent-workflow §4.2). Do the last row in `nl`.

- [ ] **Join by code and by the QR's URL.** Both land on the picker. A full team is **shown with its
      reason**, not hidden (D20). One tap joins, with no confirmation.
- [ ] **Reopen `/play/:code`** — it resumes straight into the game, same team, nothing re-entered
      (§2.3). Then clear the token from `⋮ → Leave this quiz` and confirm it returns to the picker.
- [ ] **The free-text field carries `autocapitalize`/`autocorrect`/`spellcheck` off** (§6). Check the
      attributes, not the appearance — this is the highest-value line in the slice and a desktop
      browser cannot show you it working. Real iOS is slice 10's.
- [ ] **Type on device A, watch it appear on device B** (D45), then focus B's field and type: B must
      **not** be overwritten by A's echo while focused, and must snap to the server's value on blur.
- [ ] **Submission finality with two devices** (D43): A submits `Radiohead`, B submits something
      different. B is refused and switches to showing the team's actual answer — never silently
      discarding what someone typed.
- [ ] **Let a timer run to zero with the field empty.** Nothing is submitted, and the team can still
      answer afterwards (D8). With text entered, it auto-submits at zero instead. Both matter: the
      empty case burned a team's only answer until slice 7's browser pass caught it.
- [ ] **Buzz with three teams and two devices on one of them** — not two teams, which is what this
      row used to say and why the buzzer's worst bug walked straight past it. Every one of these is a
      separate audience and the old code got two of them wrong:
      - the device that tapped and **won** → *You're in! Answer out loud*
      - the **other phone on that same team**, which never tapped → the same thing
      - a device that tapped and **lost** → the winner **named**
      - a team that **never buzzed** → the winner named, and then, after the master denies →
        **its BUZZ button back, live**, which is the whole point of D35's loop
- [ ] Local feedback says *buzzed* and **never** *first*; the server's answer arrives a moment later.
- [ ] **The menu disappears entirely while buzzers are live** (§14) — not merely disabled. The whole
      screen is the buzzer at that moment.
- [ ] **A `DO` question and the finale have no input control at all** — not a disabled one (§8.1,
      §10.1). A greyed field invites a team to try to type in it.
- [ ] **The finale on a phone**: the team's own clock is the largest thing on screen, whole seconds
      (D57), the same word shapes as the projector (D53), and *"You're up next"* when it is their turn
      after this one. A non-finalist gets the spectator variant.
- [ ] **Go offline mid-question**, keep typing, come back. The text is never cleared, the submit
      retries until acknowledged, and the indicator says *reconnecting* — **never** anything about an
      answer not being saved (§12).
- [ ] **Kill the server mid-question.** The phone reconnects and resumes with typed text intact (D4).
- [ ] **Walk it in `nl`.** Guest-facing surface, full parity required (D28).
- [ ] **Switch team mid-question**, with text already typed. The field is **empty** on the new team
      (or shows that team's own draft) — never the old team's answer, which submitting would file
      against the wrong team (protocol P4).
- [ ] **At the reveal, the phone shows both** the correct answer and *"You said"* with the team's own
      answer. A team that submitted nothing is told so. Never another team's answer, in any state.
- [ ] **The team's rank sits beside its score** in every question state and between questions, and
      **ties share it** — two teams level on points both read `1st`, and the next reads `3rd`.
- [ ] **Abandon a live game from control.** Every phone gets one plain sentence — no standings, no
      winner, no error page, and no lingering *reconnecting* band.
- [ ] **Reload `/play/:code/game` after the game has ended.** The plain "no quiz with that code"
      explanation, never a 404.
- [ ] **Corrupt the device token in `localStorage` and reload the game page.** The picker renders with
      a plain explanation and the stale token is gone (§2.3) — never a bounce between the game page
      and the picker with neither ever settling.
- [ ] **Try to switch to a full team.** The refusal is shown, the list stays open under it, and the
      menu does not close (D20).
- [ ] **Reveal a `BUZZER` and a `DO` question.** Neither claims the team submitted nothing, and
      neither prints a "correct answer" heading over an empty line — the verdict and the points are
      all these two can honestly report.

### After slice 8 — review, correction & the finished-game bookmark

Needs a **played** game: answers on the board, at least one judgement, an adjustment, and a finale
that ran. Most of this is meaningless against a `SETUP` game.

- [ ] **Open `Review & correct` on a live game and on a finished one** — the button beside the two launch buttons, not inside the `⋯` menu. Both work (§13 covers
      both); the entry point is absent only while `SETUP`, when there is nothing to review.
- [ ] **The grid reads side by side.** `Radio Head ✗` next to `radiohead ✓` is the whole point —
      check a question where two teams answered differently, with the correct answer and its
      accepted alternatives under the prompt.
- [ ] **Click a cell.** The verdict flips, the cell is marked *corrected*, and the count appears at
      both the round and the page level. Click again: `corrected 2×`, not back to zero.
- [ ] **Watch the control desk while you do it**, on a live game and without reloading it. The
      verdict and the score change there too (§13.1) — the review appends an event like any other
      surface.
- [ ] **A team that answered nothing** has an inert cell, not a button that would invent an answer
      to accept.
- [ ] **The finale section is read-only and says so.** Keywords show who got each, `— nobody` for a
      revealed-unguessed one, and *not reached* where the round never got there — three states, not
      two. Started/ended seconds are whole (D57); an elimination is `HH:mm`.
- [ ] **Undo an adjustment.** The row stays, struck through with *undone*, and the team's score and
      every rank recompute. A revoked row is never removed (D41).
- [ ] **Rename a team and leave the field.** It saves, and the new name reaches every live surface.
      Type a name and then let the save fail (stop the server): the box must not keep showing a name
      the server never took.
- [ ] **Open a finished game's code on a phone** (§15 O3). The final standings, with shared ranks —
      not *"no quiz with that code"*, and not an error page. An **abandoned** game still gets the
      plain sentence rather than a podium.
- [ ] **Walk the review in `nl`**, and confirm the quiz's own content is still in the language it was
      written in.
- [ ] **Abandon a live game, then open its code on a phone.** A sentence of its own — *"the
      quizmaster ended this quiz"* — not the unknown-code page and not a podium. All three outcomes
      (§15 O3) must read differently: finished → standings, abandoned → the sentence, unknown → check
      the code.

### After slice 9 — the suite is the smoke test

`pnpm e2e` automates most of the rows above (build-order slice 9, D49). After it passes:

- [ ] **`pnpm e2e` is green from a clean checkout** — fresh data dir per run, production build,
      all four surfaces driven. Traces land in `test-results/` on failure; open the trace before
      re-running anything.
- [ ] **The manual rows a browser cannot verify stay manual** (agent-workflow §4.5): iOS
      autocorrect mangling answers, `nosleep.js` on a real phone, haptics, projector contrast and
      overscan, 10 m legibility, twenty phones on one hotspot. Those are slice 10's field
      rehearsal, not candidates for automation.
- [ ] **A red spec is a finding before it is a flake.** Re-run the failing spec solo first; if it
      fails alone it is a bug or an over-tight assertion — fix or raise it, never retry-and-forget.
- [ ] **Keep `--workers=2`.** Every spec shares one SQLite file with the server, and fixture
      writes are deferred transactions `busy_timeout` cannot wait out (`e2e/support/db.ts`);
      four workers turned that into phones stuck on the team picker.

---
