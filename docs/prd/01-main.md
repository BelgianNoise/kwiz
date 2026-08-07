# PRD 1 — Kwiz: Main Product Requirements

**Status:** Draft · **Last updated:** 2026-08-03 · **Owner:** Arthur Joppart

This is the root document. It defines what Kwiz is, the decisions that bind every
surface, and the cross-cutting architecture. Four surface-specific PRDs sit under it:

| Doc | Surface | Audience |
| --- | --- | --- |
| [PRD 2](./02-config.md) | Configuration / admin pages | Quiz master, before & after a game |
| [PRD 3](./03-master-control.md) | Master control (laptop) | Quiz master, during a game |
| [PRD 4](./04-main-screen.md) | Main screen (projected) | Everyone in the room |
| [PRD 5](./05-player.md) | Player device (phone) | One shared phone per team |

Two shared specs are referenced by all of the above and are **normative** — where a
surface PRD conflicts with them, the spec wins:

| Doc | Contents |
| --- | --- |
| [Data model](../spec/data-model.md) | Drizzle schema, entities, relationships, ID policy |
| [Realtime & export](../spec/protocol.md) | Event catalogue, role-filtered payloads, zip format |
| [Conventions](../spec/conventions.md) | Toolchain, code alphabet, team palette, error codes, timing constants, i18n keys |

And one document that is **not** a spec but a working agreement:

| Doc | Contents |
| --- | --- |
| [`/CLAUDE.md`](../../CLAUDE.md) | Onboarding for implementing agents (§15) |

---

## 1. Overview

Kwiz is a self-hosted pub-quiz engine. A quiz master authors a quiz on their own
machine, carries it anywhere as a single zip file, and runs it live for teams in the
room who join from their phones over the local network — **with no internet
connection and no accounts**.

The quiz master's laptop *is* the server. Their laptop screen is the control desk,
a projector shows the audience-facing screen, and each team shares one phone.

### 1.1 Why this exists

Existing quiz platforms are cloud services: they need connectivity, they hold your
content, and they charge per event. Kwiz targets the venue with bad wifi, the quiz
master who wants their content to remain theirs, and the setup where the whole
system fits on a USB stick.

### 1.2 The four surfaces

One codebase serves four very different surfaces. Keeping them distinct is the
central design discipline of this project — they differ in viewing distance, input
device, and, critically, **in what information they are allowed to receive**.

```
                       ┌──────────────────────────┐
                       │  Quiz master's laptop    │
                       │  ┌────────────────────┐  │
                       │  │ Kwiz server (Node) │  │  ← SQLite + attachments on disk
                       │  └─────────┬──────────┘  │
                       └────────────┼─────────────┘
                    ┌───────────────┼───────────────┐
                    │               │               │
            ┌───────▼──────┐ ┌──────▼──────┐ ┌──────▼───────┐
            │ Main screen  │ │   Master    │ │ Player phones│
            │ (projector)  │ │   control   │ │  (per team)  │
            │ read-only    │ │ full access │ │ own team only│
            └──────────────┘ └─────────────┘ └──────────────┘
```

---

## 2. Goals

| # | Goal | How we know we hit it |
| --- | --- | --- |
| G1 | Runs with zero internet connectivity | Aeroplane-mode laptop + phones on its hotspot completes a full quiz |
| G2 | A quiz is portable as one file | Export on machine A, import on machine B, play it — including all media |
| G3 | Joining is frictionless for a guest | Scan QR → pick team → waiting screen, with no app install, no account, no typing beyond an optional code |
| G4 | The master is never blocked or confused | At every moment, the control screen shows exactly what needs their attention, and nothing else competes for it |
| G5 | Answers never leak | No surface ever receives data it must not display — enforced server-side, not by hiding in the UI |
| G6 | A crash is survivable | Killing the server mid-round and restarting resumes the game with all answers, buzzes and scores intact |
| G7 | The projected screen looks good | Legible from 10m, adapts to the question's media, feels designed rather than functional |

### 2.1 Scale envelope

Design targets, not hard limits. These numbers justify choosing simple approaches
over scalable ones throughout.

- **Concurrent live games:** typical 1, up to 5 supported (D21)
- **Teams per game:** up to 20 (typical 6–10)
- **Devices per team:** 1 typical, cap configurable, default 3 (D20)
- **Concurrent SSE connections:** ~25 per game (20 phones + main screen + control +
  spares), so ~125 at the five-game ceiling
- **Rounds per quiz:** up to 15 · **Questions per round:** up to 40
- **`DSMTW_FINALE`:** at most one per quiz, last round, 5 keywords per question, ≥2 finalists
- **Attachment size:** up to 50 MB per file, ~2 GB per quiz

At this scale a single Node process with an in-memory projection is not a
compromise — it is comfortably the right tool.

---

## 3. Non-goals (v1)

Explicitly out of scope. Listed so they don't get built by accident.

- **Authentication and authorisation.** Anyone who reaches the server can host or
  join. This is a deliberate trust model, not an oversight — see §4.
- **Multi-tenancy in the isolation sense.** Multiple *concurrent games* on one server
  **are** supported (D21). What is not supported is separation between quiz masters:
  with no authentication, any visitor can list, open and edit every quiz on the
  server, and open any game's control screen. Two unrelated masters can share a
  deployment technically, but not safely.
- **Serverless deployment.** Excluded by G1 (see §6.2).
- **Live collaborative quiz authoring.** One person edits a quiz at a time.
- **Player-visible chat, reactions, or emoji.**
- **Answer grading beyond lowercase + trim.** No fuzzy matching, no AI, no semantic
  comparison (D22). Anything not an exact normalised match goes to the master.
- **Multilingual quiz *content*.** The interface is EN/NL; a question's text and
  answers exist in exactly one language, as authored (§9.4).
- **Mobile apps.** Mobile web only.
- **Public quiz library / sharing marketplace.** The zip file is the sharing mechanism.
- **Round types beyond `QUESTION_SET`, `JEOPARDY` and `DSMTW_FINALE`.** The schema is built
  to extend (§8.3), but only these three ship.

---

## 4. Trust model

Kwiz has **no authentication**, by requirement. That is defensible for a room full
of people who can see each other, but it must be stated precisely so nobody later
mistakes it for a security model.

**What is assumed:** every person who can reach the server is physically present
and playing in good faith. Cheating is socially policed, not technically prevented.

**What follows, and is accepted:**
- Anyone on the network can open the master control screen and change scores.
- Anyone who knows a game code can join as any team, including a team already taken.
- A player who opens devtools can read whatever the server sent their device.

**What is nonetheless enforced, because it protects the game rather than the
system** — the difference between *"we trust players"* and *"we hand players the
answer key"*:
- Correct answers are **never transmitted** to a player device or the main screen
  before reveal. Not sent-and-hidden — not sent. (§7)
- One team's answers are never transmitted to another team's device, at any point.

**Hard rule for internet deployment:** if this server is exposed publicly, the game
code is the only thing standing between a stranger and your quiz. Codes are
therefore drawn from a large enough space to resist casual guessing (§8.11), but
**public exposure is at the operator's risk and is not a supported configuration.**

---

## 5. Decision log

Every entry here was a real fork. Recorded with rationale so they can be revisited
knowingly rather than re-argued from scratch.

| # | Decision | Rationale | Revisit if |
| --- | --- | --- | --- |
| D1 | **Single Next.js app**, not Next + separate backend | The QR code must encode exactly one origin. Two processes means two ports, cross-process game state, and CORS — recurring cost for capability we don't need. | Realtime needs outgrow one process |
| D2 | **SSE (server→client) + POST (client→server)** — **locked** | Native to Next.js App Router, no custom server, `EventSource` reconnects and replays via `Last-Event-ID` for free. HTTP/1.1's 6-connection cap is irrelevant at 1–2 tabs per device and vanishes over HTTP/2. Every action in the product (submit, buzz, draft, adjust score, open tile) is discrete and low-frequency — precisely SSE+POST's strength. | A drawing/pictionary or live-chat round type is added later — see O1 for the migration path |
| D3 | **Transport behind a `RealtimeTransport` interface; the event log is the contract** | Makes D2 reversible. No game logic may reference SSE, HTTP, or request objects. | — |
| D4 | **Event-sourced game state; SQLite authoritative, in-memory projection for reads** | One mechanism delivers three things we need anyway: crash recovery (G6), replay-on-reconnect for a phone that slept, and the buzz-ordering audit trail. | — |
| D5 | **Attachments on disk, metadata in SQLite** | Keeps the DB small and fast to copy; lets audio/video be served with HTTP range requests so seeking works. All quiz, score and answer data still lives in SQLite. | — |
| D6 | **`QUESTION_SET` is lockstep, master-driven** | The only model compatible with buzzer questions and with a shared main screen showing one attachment. Avoids maintaining two pacing models across four PRDs. | — |
| D7 | **Optional per-question timer, server-authoritative deadline** | Master sets seconds (inheriting a round default). Absolute `deadlineAt` is broadcast; clients render a countdown against it. A client-side `setTimeout(30s)` would give a late-joining phone 33 seconds. | — |
| D8 | **The player device auto-submits when its own countdown ends. The server does not reject late answers.** Only the master closing the question locks it, and the next question never auto-starts. | Follows directly from the trust model (§4): rejecting a late answer punishes a team whose phone froze, slept, or briefly lost wifi — a far worse failure than a team getting three extra seconds. Debounced drafts stay as a safety net for a phone that never comes back at all. Advancing stays a deliberate master action so the room can react to a reveal. | — |
| D9 | **Import collision → prompt Replace or Import-as-copy** | Supports the real workflow (author on desktop, re-import on laptop) without silently destroying either local edits or recorded game history. | — |
| D10 | **Single terminal command; first-run screen picks the LAN interface** | A laptop has several interfaces (wifi, ethernet, VPN, Docker bridges). Auto-guessing hands players a dead QR code. | Non-technical masters become a target user → package with Tauri |
| D11 | **Full i18n (next-intl), English + Dutch** | Guest-facing surfaces must speak the room's language. | — |
| D12 | **`DO` answer method** — a challenge with no player input, scored directly by the master, either winner-takes-all or a score per team | Physical and performed rounds are a staple of live quizzes and can't be expressed as text or multiple choice. Introduces the first question type with no player submission, and the `masterNotes` field. | — |
| D13 | **Locale is per-device and always defaults to English; quiz content is never translated** | The four surfaces have different audiences — a game-wide locale would force one of them to be wrong. `Accept-Language` sniffing is deliberately *not* used (§9.4). Content translation would double every authoring form for no real benefit. | — |
| D14 | **Drizzle ORM + `better-sqlite3`.** Pending migrations are **prompted for**, not applied silently | Drizzle gives migrations as auditable plain-SQL files and types inferred from the schema, with a far smaller runtime footprint than Prisma's engine on a laptop. Prompting matters because a migration mutates a master's only copy of their quiz history — silent schema changes on boot are how people lose data they can't get back. | — |
| D15 | **The master can adjust any team's score by any amount at any time, with an optional reason** | No rule set survives a live room. A round goes wrong, a question turns out to be ambiguous, a team deserves a bonus for a good joke. Every adjustment is an event with an audit trail, so "who gave them 5 points?" is always answerable. | — |
| D16 | **In Jeopardy, the master selects the tile — never the player.** The board may be mirrored on player devices, read-only | Matches how the game is actually run: a team says "Geography for 400" out loud and the master clicks it. Removes tile-selection UI, turn-locking, and the race condition of two teams tapping the same tile — and removes the need for the server to model whose turn it is at all. | — |
| D17 | **Locale always defaults to `en`; `Accept-Language` is not consulted** | Predictability over cleverness: one QR code should produce the same first screen on every phone, and a master testing the join flow should see what guests will see. | — |
| D18 | **Unit tests target critical and unusual paths, not coverage. Mocks are a smell.** | A test needing a large mock is evidence the logic is in the wrong place — it belongs in `packages/domain` as a pure function over the event log. The mock-avoidance rule is therefore an architectural guardrail, not just a testing preference. | — |
| D19 | **A playthrough is a "Game"** (`games`, `gameId`) | What a master says out loud. Avoids "session", which collides with the web meaning in a codebase that also has persisted device identity. | — |
| D20 | **Multiple devices per team, cap set by env var, default 3** | Teams normally use one phone, but a dead battery must not eliminate a team. An env var rather than a hardcoded constant because the right cap depends on the venue, not on the code. | — |
| D21 | **Multiple concurrent live games are supported. Every surface is explicitly scoped to a `gameId`; nothing anywhere resolves "the current game"** | Required for online hosting, but adopted mainly because implicit global state leaks into every surface and is painful to remove later. Explicit scoping is cleaner even when only one game is ever live. | — |
| D22 | **Free-text matching is lowercase + trim only** | Least code, entirely predictable, and exactly as originally specified. Normalisation is isolated in one pure function so it can be strengthened later without touching the schema, the queue, or any surface. | Masters report the validation queue is dominated by obvious near-misses |
| D23 | **`DO` / `WINNER_TAKES_ALL`: multiple winners allowed, "no winner" allowed, and a per-question setting for whether tied winners split or each receive full points** | A master forced to invent a single winner just picks arbitrarily, which is worse than the UI admitting that races tie and that sometimes everybody fails. | — |
| D24 | **`DO` / `PER_TEAM_SCORE`: free numeric entry, clamped to `0 … question.points`, integers only** | Free entry is faster than a stepper when judging eight teams in a row. The question's point value doubling as the maximum keeps one meaning for "points" across every answer method and keeps round totals predictable. | — |
| D25 | **A manual score adjustment is announced on the main screen, reason included** | It's a pub quiz — a visible "+5, best heckle of the night" is part of the entertainment, and hiding the reason makes a correction look arbitrary to the room. Masters get a per-adjustment opt-out for the unflattering cases. | — |
| D26 | **A draft-only answer is marked "not confirmed by team" in the validation queue** | Tells the master why an answer looks half-typed, at precisely the moment they'd otherwise wrongly deny it. Affects presentation only, never scoring. | — |
| D27 | **Audio and video render on the main screen only. Images render on the main screen, with a per-attachment "also show on player devices" toggle** | The speakers are at the main screen, and ten phones playing the same song 200ms apart is unusable. Images are the exception because detail-heavy ones genuinely benefit from being in the hand. | — |
| D28 | **Full EN/NL parity on the player and main screens; config and control are i18n-wired but English-first if effort needs trimming** | Guest-facing surfaces must speak the room's language. The master is one known person who can work in English. Halves the copy-specification burden with no architectural difference. | — |
| D29 | **A game carries a default player language, defaulting to `en`** | With `Accept-Language` dropped (D17), this is the only thing that gets a Dutch room into Dutch without twelve people each tapping a switcher. Overrides the default, never a player's explicit choice. | — |
| D30 | **Jeopardy turn order is a computed rule, displayed authoritatively, overridable by the master** | Lowest score picks first; whoever answers correctly picks next; nobody correct falls back to lowest score. A real rule rather than a hint, but never a hard block — a locked UI in a live room is a trap (§8.6). | — |
| D31 | **No partial credit on free-text answers** | Accept or deny only. The rare "half right" case is covered by manual score adjustment (§8.9) without adding a scoring dimension to every surface and every payload. | — |
| D32 | **Tied teams share a rank, displayed as a visible tie. No tiebreaker round** | Honest, and a tiebreaker round is a whole round type's worth of design for an occasional event a master can handle verbally. | — |
| D33 | **The authoring UI exposes alternative accepted answers** | With matching at lowercase+trim (D22), alternatives are the only tool a master has to keep obvious variants out of the live validation queue. | — |
| D34 | **Every Jeopardy tile is a buzzer question. The answer method is not configurable on a tile** | Buzzer adjudication always resolves to exactly one credited team or none — which is precisely the condition D30’s turn rule needs. It is also what makes the pick-passing rule meaningful: a simultaneous-answer tile has no single winner to hand the next pick to. | — |
| D35 | **A buzzer question loops: first buzz locks all buzzers; a denial locks out that team and automatically reopens the buzzers to the rest, until a team is credited or everyone is locked out** | A single-shot buzzer wastes the question whenever the fastest team is wrong, which is often. Lockout-on-denial is what stops the denied team re-buzzing instantly. Automatic reopen (rather than a second master click) matters because this is the fastest-moving moment in the game. Carries one non-obvious requirement: the question timer must **pause during adjudication**, or the master’s judging time silently eats the remaining teams’ answer time. | — |
| D36 | **A quiz is a template. Creating a game deep-copies the whole quiz tree into game-scoped tables, which are never edited afterwards** | The only way to actually keep the "editing a quiz never alters a played game" promise, since template rows stay mutable. Separate tables (rather than a JSON blob or a shared-table discriminator) keep real foreign keys throughout and make it impossible to query game copies as templates by accident. Cost is a doubled quiz-tree schema, mitigated by shared column factories. | — |
| D37 | **Attachment files are content-addressed by SHA-256, not by row id** | Falls out of D36: per-game attachment rows must share one file or a 2 GB quiz would duplicate 2 GB per playthrough. Content addressing gives that for free, dedupes identical uploads, reduces file GC to one query, and makes deleting a template attachment always safe. | — |
| D38 | **The server pushes complete audience-filtered views, not deltas and not events for the client to reduce** | If clients reduced events locally, the rules for "what may this surface see" would exist twice — once in `packages/domain` and once in the browser, where nobody tests them. That duplication is exactly where a leak appears. Pushing finished views means the client holds no game logic at all. Views are idempotent, so reconnection needs no replay. | — |
| D39 | **A pushed view must be O(teams + current question), never O(questions × teams)** | Master control's end-of-round validation set is ~800 answers; re-pushing all of it on every accept/deny click would move tens of MB and stall the screen exactly when the master is most rushed. Live push carries the current item plus a count; anything unbounded is fetched over REST. | — |
| D40 | **The reveal is two beats: the correct answer first, then whatever the master chooses to **spotlight**. Teams’ free-text answers are never dumped on the projector** | Reading out a funny wrong answer is a highlight of a pub quiz, but a 20-row answer table is illegible at 10 m — only ~6–8 rows fit at projector type scale — and every team already learns its own verdict privately on its phone. So the projector serves only the *social* moment, and a real quizmaster serves that by curating one answer, not by broadcasting all of them. Multiple choice is the exception: a per-option distribution of team colours is compact, scales to any team count, and is the best thing on that screen. | Team counts stay reliably ≤6 |
| D41 | **Corrections are revocations, not deletions.** A mistaken score adjustment is undone by a `SCORE_ADJUSTMENT_REVOKED` event; the original row survives and is excluded from totals | Keeps the append-only guarantee intact while letting the UI show one struck-through line. Countering a fat-fingered +50 with a −45 would make the log read as two deliberate decisions when there was one mistake. Establishes the pattern for any future correctable fact: revoke, never delete. | — |
| D42 | **An answer can be validated the moment it is submitted** — while the question is still open, at lock, before reveal, or deferred to round end | Lets the master use the dead time waiting for a slow team, so the reveal can carry honest verdicts without putting a mandatory validation step in the critical path of all 40 questions. A permission relaxation, not new machinery: same event, same UI component. | — |
| D43 | **Submission is final and first-write-wins.** The player UI locks after submit; the server accepts the first submission per (question, team) and rejects later ones, returning the canonical answer | Not a technical block — §4 still trusts players — but the *product* rule: handing in your answer is handing it in, as with a paper sheet. First-write-wins matters because of multi-device teams (D20): under last-write-wins, a second device that was mid-typing would silently overwrite the first device’s deliberate submission. Because nothing changes after submission, a validated verdict can never go stale. | — |
| D44 | **Selecting is not submitting.** Typing and option-selection stay freely reversible; only an explicit Submit is final | Without this, D43 makes a mis-tap on a phone unrecoverable — and mis-tapping a radio option with a thumb is easy. The buzzer is the deliberate exception: the buzz *is* the action, and its immediacy is the whole point. | — |
| D45 | **A team’s draft is shared across all of its devices** via the pushed view | Makes D20’s "all of a team’s devices see identical state" true rather than aspirational, and means two devices cannot diverge in the first place — so D43’s reject path is a rare safety net rather than a routine occurrence. | — |
| D46 | **`SKIPPED` is a terminal question state**, reachable from `PENDING` or `OPEN` | PRD 2 §10’s *play anyway* deliberately creates questions the master intends to skip, and a master may abandon an open question whose audio turns out to be broken. Without an explicit state, "skipped" and "never reached" are indistinguishable in the timeline, on the main screen and in review. Awards nothing; answers already submitted stay recorded and are marked *question skipped*. | — |
| D47 | **The master may submit an answer on a team’s behalf, flagged as master-entered** | PRD 1 §14 already names this as the mitigation for unusable wifi — without it, a team whose phone cannot reach the server is out of the quiz entirely. Flagged because an unflagged proxy answer makes the review log assert something untrue: that the team typed it. This is the sole exception to D43’s finality, and it resets the verdict. | — |
| D48 | **Player devices keep the screen awake via `nosleep.js`.** Scoped to player devices only | A phone locking mid-question is the most common way a team loses a question they knew. `navigator.wakeLock` needs a secure context and the LAN is plain HTTP (§6.10), so it is `undefined` exactly where it is needed — `nosleep.js` uses it where present and falls back to a muted looping video, which works over HTTP on iOS and Android. Using the library rather than hand-rolling gets the `playsinline`/codec/browser-quirk handling that this technique needs. The projected screen is excluded: it runs on the master’s own laptop, where display sleep is an OS setting they can set once. | LAN HTTPS ever becomes practical |
| D49 | **A journey-based end-to-end browser suite is built after the surfaces exist**, covering the flows the PRDs document | Not a contradiction of D18 — that is about unit-test coverage, whereas E2E answers whether documented behaviour survives being wired together. Justified here by a public, unrecoverable failure mode, by most of the subtle rules being cross-surface, and by one assertion that exists only at this level: that no secret crosses the wire into a player’s browser. Journey-based, never exhaustive. | — |
| D50 | **A third round type: `DSMTW_FINALE`** — keyword questions played as a timed, elimination final round | Modelled on the Flemish game show *De Slimste Mens ter Wereld*. Named for the format rather than generically, so a future differently-shaped finale can be added beside it rather than overloading one type. Full mechanics in §8.7. | — |
| D51 | **The finale decides the final ranking outright; points are shown alongside, not summed** | Points are *spent* to buy seconds, so they are gone. Ranking is survival order. The `FINISHED` screen carries **two tabs** — elimination result and total points earned — because the points view stays interesting even though it no longer decides anything. | — |
| D52 | **Every clock is derived from event timestamps. No server timer exists** | `remaining = startingSeconds − Σ turn durations − penalties − (now − currentTurnStart)`. Consistent with D4 and D8: nothing in this system enforces time server-side. It also means a restart mid-turn recovers every clock exactly, for free. | — |
| D53 | **An unguessed keyword’s text never reaches the room. Only its word-length shape does** | "Blurred" cannot mean sending the text and blurring it in CSS — that is §7 invariant 8 and devtools reads the answers. The payload carries `wordLengths` (`"i like cows"` → `[1,4,4]`), so the room sees three blurred words of the right shape. A real hint, deliberately given, with no secret transmitted. | — |
| D54 | **The per-keyword penalty and the points→seconds rate are authored as defaults and overridable while `SETUP`** | The right penalty depends on how many teams are playing, which is only known at game setup. Overridden by a `FINALE_CONFIGURED` event rather than by editing the game copy, which I16 forbids. | — |
| D55 | **Finalists are chosen by the master when the round opens; the default is every team** | Scores are only final at that moment. Defaulting to all teams keeps the master in control rather than the app deciding who is worthy; presenting them in descending score order makes deselecting the bottom few a two-second job. Minimum two finalists. | — |
| D56 | **No floor on converted seconds — 0 points is 0 seconds and immediate elimination** | Your time is what you earned. The finalist picker shows each team’s converted seconds, so a `0s · out immediately` row is visible while the master is still choosing rather than discovered live. | Masters report it lands badly in the room |
| D57 | **Finale clocks are shown as whole seconds — `120`, never `2:00`** | The entire round is mental arithmetic against a penalty measured in seconds: a master and a room subtracting 20 from `2:00` are doing a base-60 conversion under time pressure, while `120 → 100` is instant. Comparing two teams is also immediate when both are plain integers. Applies to finale banks only — break countdowns and media durations stay `m:ss`, because neither is arithmetic. | — |
| D58 | **The authoring and setup UIs compute and show a suggested question count** | A finale that runs out of questions with three teams still alive falls back to "most seconds wins", which is a flat ending to the most dramatic round. The needed count is not guessable — it swings from 4 to 16 questions on a fourfold penalty change — so it is simulated and shown, recomputed live as the penalty and team count change. **Over-supplying is free**: the round ends when one finalist remains, whatever questions are left. Under-supplying breaks the finale. So the suggestion errs high and the shortfall is a warning, never a block. | — |

### 5.1 Timer mechanics (consequence of D7 + D8)

Spelled out in full because three surfaces depend on it and because the division of
authority here is easy to get backwards.

**Who owns what:**

| Concern | Owner |
| --- | --- |
| The deadline value (`deadlineAt`, absolute) | Server — broadcast once, so a phone joining late doesn't get a fresh 30 seconds |
| Deciding when to submit | **Client** — it submits when its own countdown reaches zero |
| Deciding when answers stop being accepted | **Master** — and only the master |

The deadline is therefore **advisory**: it drives what every screen renders and
prompts the player device to submit, but it does **not** change server state and does
**not** close the question.

```
Master clicks "Open question"
  server: state → OPEN, deadlineAt = now + durationMs, append event, broadcast
  player: renders countdown against deadlineAt
          on each keystroke / selection change → debounced (≈500ms) POST of draft

deadlineAt passes
  player: countdown hits zero → POST the FINAL value immediately,
          bypassing the debounce (a pending debounce must be flushed, not awaited),
          then show "answer submitted" and disable the input
  main:   countdown hits zero; shows how many teams have submitted
  master: prompted — "Reveal answer" / "Next question"      ← no auto-advance
  server: state is STILL `OPEN`. Late answers are accepted.

Master clicks Reveal (or Next)
  server: state → LOCKED. Only now are further submissions rejected.
```

**Why the server doesn't enforce the deadline.** A phone that is asleep, frozen, or
briefly off wifi at zero would submit nothing under server enforcement, and the team
loses a question they answered correctly. Under this model the phone submits whenever
it comes back, and it counts. That is the trust model (§4) applied consistently.

**The accepted cost, stated plainly:** a team whose device countdown runs slightly
behind gets slightly longer to answer, and a team that deliberately blocks their
device clock could answer late. We do not care — §4 assumes good faith, and the
alternative punishes honest teams for their hardware.

**Draft fallback.** Drafts are upserted onto the team's answer row as they arrive.
If a device never sends a final submission (dead battery, closed browser), the last
draft stands as that team's answer, but it is flagged as **draft-only** so master
control can show it differently — the master should know they are grading something
the team never confirmed.

**Two required implementation details** that are easy to get wrong and both cause
silent answer loss:

1. **Flush, don't await.** At zero the client must send the current input value
   immediately. A debounce timer still pending at zero must be cancelled and its
   value sent, not allowed to fire afterwards — otherwise the final keystroke races
   the submit.
2. **The final submit must be retried.** If it fails (wifi blip at exactly the wrong
   moment) the client retries with backoff until acknowledged, because the server no
   longer has a deadline that would have committed the draft on the team's behalf.

---

## 6. Technical architecture

### 6.1 Stack

| Layer | Choice | Note |
| --- | --- | --- |
| Framework | Next.js (App Router), TypeScript strict | Server and all four surfaces in one app |
| Styling | Tailwind CSS, tokens in a globals file | §9 |
| Components | shadcn/ui | §9 |
| Database | SQLite via **Drizzle ORM** + `better-sqlite3` | Single file in the data directory (D14) |
| Migrations | Drizzle Kit, plain-SQL files, **prompted on boot** | §6.7 |
| Realtime | SSE + POST behind `RealtimeTransport` | D2, D3 |
| i18n | next-intl, `en` + `nl` | D11 |
| Package manager | pnpm workspaces | D10 |
| Screen wake (player devices) | `nosleep.js` | D48 — the only runtime dependency added for a browser-quirk reason |

**On the database layering**, since "Drizzle" and "SQLite" are sometimes mistaken for
alternatives — they are three stacked layers, and only the top one is a choice:

```
Drizzle          TypeScript schema, typed queries, migration generation
better-sqlite3   Node driver (native addon, ships prebuilt binaries)
SQLite           the embedded engine — one ./data/kwiz.db file
```

SQLite remains embedded and zero-configuration: **no daemon, no install step, no
connection string beyond a file path, and the database file is created automatically
on first boot.** Drizzle only changes how TypeScript talks to it. The driver is
swappable (`node:sqlite`, `@libsql/client`) without touching the schema, should
`better-sqlite3`'s native build ever cause install trouble on a given platform.

### 6.2 Process model

One long-running Node process serving one port. This is forced by G1 (offline LAN
operation) and has a consequence worth stating plainly:

**Serverless hosting is excluded** — on Vercel-style platforms, WebSockets don't
work at all and long-lived SSE is killed by function duration limits. "Deployable
to the web" therefore means *any Node host*: a VPS, Fly, Railway, or Docker. This
is a property of the process model, **not** of the transport choice, and would be
equally true with WebSockets.

### 6.3 Monorepo layout

```
kwiz/
├─ apps/
│  └─ web/                    Next.js app — all four surfaces
│     ├─ app/[locale]/
│     │  ├─ (landing)/        Choose: host or join
│     │  ├─ admin/            PRD 2 — config & instance review
│     │  ├─ control/[gameId]/ PRD 3 — master laptop
│     │  ├─ screen/[gameId]/  PRD 4 — projected
│     │  └─ play/[code]/      PRD 5 — player phone
│     └─ app/api/             SSE stream, action endpoints, attachment serving
├─ packages/
│  ├─ domain/                 Pure game logic — no I/O, no Next.js, no DB
│  ├─ db/                     Schema, migrations, repositories
│  └─ export/                 Zip read/write, manifest, validation
└─ docs/                      This directory
```

`packages/domain` is the load-bearing part of this layout and the reason a monorepo
is justified for a single app. It contains the round rules, the question state
machine, scoring, answer normalisation, and buzz ordering — as **pure functions
over the event log**. No database, no request objects, no transport. It is
unit-testable without booting a server, and it is what makes D3 real: if the
domain layer cannot import a transport, it cannot depend on one.

### 6.4 Request & event flow

```
Player POSTs an action
  → route handler validates shape (zod) and gameId / teamId / questionId identity
  → domain layer decides: reject, or produce one or more events
  → events appended to SQLite (durable) — this is the commit point
  → in-memory projection for THAT gameId updated
  → per-audience payloads computed (§7) and pushed to that game's subscribers only
```

The append is the commit point: nothing is broadcast that isn't already durable.
That ordering is what makes G6 hold — a crash can lose a broadcast, never a fact.

The projection is a `Map<gameId, GameState>` (D21). A game's projection is
**loaded lazily** by replaying its events on first access after boot, and may be
evicted when the game finishes and has no subscribers — so five concurrent games cost
five projections, and a hundred finished games cost nothing.

### 6.5 Reconnection

The server pushes **complete, audience-filtered views** rather than deltas or events
(D38). Reconnection is therefore trivial: send the current view. A phone locked for two
minutes catches up without the player doing anything, and without any replay machinery.

Each view carries a monotonic `seq` **scoped to its game** as the SSE event id. On
reconnect the browser resends `Last-Event-ID` automatically, and the server uses it
only to skip the send when nothing has changed — an optimisation, not a correctness
mechanism.

Because `seq` is per-game and not global, a `Last-Event-ID` from a different game must
be treated as unknown, never compared numerically against this game's `seq`. The
numbers are in the same range and would silently match.

Full contract in the [protocol spec](../spec/protocol.md).

### 6.6 Data directory

```
./data/
├─ kwiz.db                    SQLite: quizzes, games, teams, answers, events
├─ attachments/<id>.<ext>     Media, content-addressed by attachment id
└─ tmp/                       Upload staging, export building
```

Created on first boot. On first visit, if no quiz exists, the admin dashboard shows
an empty state rather than an error.

**`./data/` means the repo root, and that takes one line of configuration to be true.**
`KWIZ_DATA_DIR` defaults to `./data`, resolved against the process working directory — and both
`pnpm dev` and `pnpm start` run Next from `apps/web`, which would put a master's only database at
`apps/web/data`. `apps/web/.env.development` and `.env.production` set `KWIZ_DATA_DIR=../../data`
so the documented layout holds. A real environment variable still wins, which is how a deployment
moves the directory somewhere else.

### 6.7 Migrations (D14)

Migrations are Drizzle Kit-generated plain SQL files, committed to the repo and
applied in order. **They are not applied silently on boot** — a migration mutates
the only copy of a master's quiz and game history, and on a self-hosted laptop
there is no ops team and no backup to roll back to.

Boot behaviour distinguishes two cases, because they carry very different risk:

| Case | Behaviour |
| --- | --- |
| **No database exists** (first ever run) | Created and migrated to head **automatically, no prompt.** There is nothing to lose, and this satisfies the "DB is instantiated the first time the admin visits" requirement. |
| **Database exists, migrations pending** | The server **prompts in the terminal** before applying anything, listing each pending migration by name. |

```
$ pnpm start

  Database schema is out of date.
  3 pending migrations:
    0007_add_master_notes.sql
    0008_add_score_adjustments.sql
    0009_do_question_scoring.sql

  A backup will be written to ./data/backups/kwiz-<timestamp>.db first.
  Apply now? [Y/n]
```

- A **timestamped copy of the database file is written before** the first migration
  runs. Cheap on SQLite, and it turns an irreversible mistake into an annoyance.
- Declining leaves the DB untouched and boots the server into a **blocked state**:
  every surface renders a single "database needs migrating" screen rather than
  half-working against a schema the code doesn't match.
- `KWIZ_AUTO_MIGRATE=1` (or `--migrate`) skips the prompt, for Docker and scripted
  runs where no terminal is attached. **If stdin is not a TTY and this flag is
  absent, the server refuses to start** rather than guessing.
- Migrations must be **forward-only and additive wherever possible**. Destructive
  changes (dropping or narrowing a column that holds quiz or answer data) require an
  explicit note in the migration file explaining what is lost.

---

### 6.8 Configuration

Operational knobs are environment variables with sensible defaults, so the app runs
correctly with no configuration at all. **Product behaviour is not configured here** —
anything a quiz master should decide belongs in the UI, not in an env var.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `KWIZ_DATA_DIR` | `./data` | Database, attachments, backups (§6.6) |
| `KWIZ_MAX_DEVICES_PER_TEAM` | `3` | Device cap per team (D20). `1` reproduces strict one-phone-per-team |
| `KWIZ_AUTO_MIGRATE` | unset | Apply pending migrations without prompting (§6.7) |
| `KWIZ_MAX_UPLOAD_MB` | `50` | Per-attachment upload limit (§2.1) |

All are read and validated **once at boot** through a single typed config module — a zod
schema with the types inferred from it — which fails fast with a clear message on an
invalid value. `KWIZ_MAX_DEVICES_PER_TEAM=abc` must stop the server, not become `NaN` and
silently admit unlimited devices. No `process.env` access anywhere
else in the codebase, and never in `packages/domain`.

`KWIZ_MAX_DEVICES_PER_TEAM` is enforced server-side on join. When a team is at its cap,
the joining device is told the team is full and offered the other teams — it is never
silently connected, and it never silently evicts an existing device.

### 6.9 If realtime needs change later (D2 migration path)

D2 is locked, but a future drawing/pictionary or chat round type would need
bidirectional high-frequency messaging. Recording the route now is what keeps that
option cheap — and, more importantly, tells implementers **which constraints exist
solely to protect it**, so they aren't optimised away as pointless indirection.

**Constraints that must hold** (each is load-bearing for this migration):

1. No code in `packages/domain` imports `Request`, `Response`, `EventSource`, or
   anything else transport- or HTTP-shaped.
2. All server→client communication goes through the `RealtimeTransport` interface.
   No route handler writes to a stream directly.
3. All client→server actions go through one typed client module — components never
   call `fetch` themselves.
4. The **event log is the contract**: transports ship events, they don't interpret
   them.

**What a migration would then touch:** the SSE route handler, the client subscriber,
and the action-dispatch module — three files. Game logic, schema, payload filtering,
and all four surfaces stay untouched.

**A likely better answer than a full migration:** add a WebSocket *alongside* SSE for
just the high-frequency channel (stroke data), leaving discrete game events on the
existing path. Drawing strokes don't need durability, ordering guarantees, or replay,
so they don't belong in the event log anyway — which means they don't need the
transport that serves it.

---

### 6.10 Secure-context limits on the LAN

G1 puts the primary deployment on **plain HTTP over a LAN** (`http://192.168.1.42:3000`).
That origin is **not a secure context**, so an entire class of browser APIs is unavailable —
not degraded, but `undefined`.

HTTPS is not a realistic escape: a self-signed certificate makes every guest click through
a security warning before they can play, and a local CA means installing a root certificate
on twenty phones belonging to strangers.

| API | On the LAN | Consequence |
| --- | --- | --- |
| **Screen Wake Lock** | ✗ unavailable | Handled by `nosleep.js`, which falls back to a looping muted video (D48, PRD 5 §12.1) |
| **Clipboard `writeText`** | ✗ unavailable | Don't build "copy join link" for players. Fine for the master, who is on `localhost` |
| **`getUserMedia`** | ✗ unavailable | **In-browser QR scanning is impossible.** Players must use their phone's native camera — which is what the QR-encodes-a-full-URL design (PRD 1 §8.10) already assumes |
| **Service Workers** | ✗ unavailable | No offline caching layer. Not needed. |
| Fullscreen | ✓ available | PRD 4 §4.1 is safe |
| Audio/video playback | ✓ available | Gated on user activation, not on secure context |
| `localStorage` | ✓ available | Device identity (PRD 5 §2.3) is safe |
| `EventSource` | ✓ available | The whole transport (D2) is safe |
| `navigator.vibrate` | ✓ generally | Not secure-context gated, but absent in iOS Safari regardless — treat as an enhancement |

**`localhost` is treated as secure**, so the master's own surfaces — control and the
projected screen, both opened on the machine running the server — *do* get the full API
surface. Only player devices are constrained.

> **Standing rule:** before using any browser API on a player-facing surface, check whether
> it requires a secure context. This is the cheapest possible time to discover it, and the
> most expensive is a live event.

---

## 7. Answer confidentiality (G5)

The requirement "never shows answers that should not be shown" is treated as an
**architectural** requirement, not a UI one. Hiding data with CSS or conditional
rendering fails the moment someone opens devtools or a payload shape changes — and
more practically, it fails when a future refactor renders a field that was always
present in the props.

**Mechanism.** Every subscriber is bound to exactly one audience:

| Audience | Receives |
| --- | --- |
| `MASTER_CONTROL` | Everything |
| `MAIN_SCREEN` | Only what the room may see, at the current question state |
| `PLAYER(teamId)` | Only what that team may see, plus only that team's own answers |
| `CONFIG` | Full quiz content (authoring context, no live game) |

The server computes a **separate payload per audience** from the projection. A
field that must not be displayed is **absent from the payload**, not falsy in it.

**Invariants** (each must have a test):

1. A `correctAnswer` never appears in a `MAIN_SCREEN` or `PLAYER` payload while the
   question state is `PENDING`, `OPEN`, or `LOCKED`.
2. Multiple-choice options are sent when `OPEN`; **which option is correct is not**,
   until `REVEALED`.
3. Team A's answer text never appears in any `PLAYER(B)` payload, in any state.
4. Teams' answers do not reach `MAIN_SCREEN` before `REVEALED` — **not** merely before
   `LOCKED`. Showing eight wrong answers while the correct one is still hidden is a
   spoiler in reverse, and the master already sees everything on control at `LOCKED`,
   so tightening this costs nothing. At `REVEALED` and later, two different rules apply
   (D40):
   - **Free-text and buzzer answer *text*** reaches `MAIN_SCREEN` only for answers the
     master has explicitly **spotlighted**. It is never broadcast wholesale.
   - **Multiple-choice per-team option choices** reach `MAIN_SCREEN` as a distribution
     (which teams picked which option). Compact enough to always show, and it is the
     visual highlight of a multiple-choice reveal.
5. A Jeopardy tile's question text is not sent to `MAIN_SCREEN` or `PLAYER` until the
   master selects that tile. The board itself — category names, point values, and
   which tiles are already used — carries no question text, so it is safe to mirror
   onto player devices (D16).
6. A question's text is not sent to `PLAYER` or `MAIN_SCREEN` while `PENDING`.
7. A question's `masterNotes` (setup instructions, judging criteria, hints to read
   aloud) appear **only** in `MASTER_CONTROL` and `CONFIG` payloads — never in
   `MAIN_SCREEN` or `PLAYER`, in any state. Introduced by `DO` questions (§8.6) but
   available on every question type, since "don't accept 'Paris' if they mean the
   person" is a note the master wants everywhere.
8. A `DSMTW_FINALE` keyword's **text** never appears in a `MAIN_SCREEN` or `PLAYER` payload
   until that keyword is marked as guessed or revealed (D53). Only its `wordLengths` shape
   does. Blurring transmitted text in CSS is a leak, not a filter.

> **Design note.** Invariant 5 has a real consequence: the main screen cannot
> pre-load a tile's media, so there may be a visible fetch delay when a Jeopardy
> tile opens. Mitigation options (pre-warm the media file without its question
> text; accept a short spinner) are decided in [PRD 4](./04-main-screen.md).

### 7.1 Question lifecycle

The state machine that invariants 1–6 are written against. Owned by
`packages/domain`; every transition is an event.

```
                      ┌─────────┐
                      │ PENDING │  not yet shown to anyone
                      └────┬────┘
                     master opens
                      ┌────▼────┐
              ┌───────│  OPEN   │  question + media visible; answers accepted
              │       └────┬────┘  optional deadlineAt running — advisory only,
        buzz  │            │       it does NOT leave this state (§5.1)
   (buzzer    │            │ master closes / reveals / advances
    questions)│       ┌────▼────┐
              │       │ LOCKED  │  submissions now rejected
              │       └────┬────┘
        ┌─────▼─────┐      │ master reveals
        │  BUZZED   │ ┌────▼─────┐
        │ (team, at)│ │ REVEALED │  correct answer now transmitted
        └─────┬─────┘ └────┬─────┘
       master adjudicates  │ scores applied
              │       ┌────▼────┐
              └──────►│ SCORED  │  final; editable later from PRD 2
                      └─────────┘
```

> **`BUZZED` in the diagram is not a state.** The canonical type has six members —
> `PENDING`, `OPEN`, `LOCKED`, `REVEALED`, `SCORED`, `SKIPPED` (protocol §5.5) — and the box
> above is drawn only to show where adjudication happens. A buzzed question **stays `OPEN`**
> throughout. Treating it as a state would make D35's deny → reopen loop a cycle in the state
> machine, when what it actually is is repeated buzzes against one unchanged question.

**Buzzer detail:** a buzz does not end the question — it pauses it for adjudication.
The first buzz locks all buzzers; on a denial the buzzing team is locked out and the
buzzers **reopen to the remaining teams**, looping until a team is credited or every
team is locked out. All buzzes are recorded with server arrival order and timing. Full
rules in §8.4.

**`DO` detail:** `DO` questions skip `REVEALED` entirely (`LOCKED → SCORED`) —
there is nothing hidden to reveal. The master scores from `LOCKED`. See §8.6.

**`SKIPPED` detail (D46):** a terminal state reachable from `PENDING` (never opened — a
broken question the master went around) or from `OPEN` (opened, then abandoned because the
audio wouldn't play). It awards nothing to anyone. Answers already submitted stay
recorded and are marked *question skipped* in review, rather than being deleted — the
team did answer, and the record should say so.

```
  PENDING ──────┐
                ├──▶ SKIPPED   (terminal; scores nothing)
  OPEN ─────────┘
```

---

## 8. Domain model

Detailed schema in the [data model spec](../spec/data-model.md). This section fixes
vocabulary and the rules that bind all surfaces.

### 8.1 Vocabulary

Used consistently in code, UI copy, and all PRDs.

| Term | Meaning |
| --- | --- |
| **Quiz** | An authored template. Reusable. Has rounds, questions, attachments. |
| **Round** | An ordered section of a quiz with a `roundType`. |
| **Question** | A single scorable item within a round. |
| **Attachment** | An image, audio or video file bound to a question. |
| **Keyword** | One of the 5 accepted terms on a `DSMTW_FINALE` question (§8.8). Guessed aloud, marked by the master. |
| **Game** | One playthrough of a quiz. Your "quiz instance". Has its own teams, answers, scores, and event log. |
| **Team** | A group playing in one game, with a name and colour chosen by the master. |
| **Device** | One browser playing on behalf of a team. |
| **Answer** | A team's response to a question in a game. |
| **Buzz** | A timestamped buzzer press by a team. |
| **Validation** | The master's accept/deny of an answer that wasn't auto-matched. |

A **Quiz** is the template; a **Game** is the playthrough. Editing a quiz never
alters an already-played game: creating a game **deep-copies the quiz tree** into
game-scoped tables, and the game plays and is reviewed entirely from its own copy
(D36). A revision number alone could not deliver this, because template rows are
mutable.

Multiple games may be live at once, and none of them is "the current game" — see
§8.10, which every surface must respect.

### 8.2 Identifiers

- Every entity has an opaque, non-human-readable primary key. **Names are never
  identifiers** — two teams may be called "The Quizzly Bears" without collision,
  and renaming a team or round changes nothing else.
- **UUIDv7** for all primary keys: globally unique (so imports never collide) and
  time-sortable (so it indexes well as a SQLite key and gives free creation
  ordering).
- Ordering of rounds/questions uses an explicit `position` column, never id order
  and never name order.
- The **game code** is the sole exception: a short human-readable string. It is a
  lookup handle, not a key — `games.id` remains the identifier everywhere.

### 8.3 Round type extensibility

`round.type` is a discriminated union tag; type-specific settings live in a
validated JSON `config` column, with a zod schema per type. Adding a round type
means adding a schema, a domain reducer, and one component per surface — touching
no existing round type and requiring no migration.

Ships with **`QUESTION_SET`** (§8.4), **`JEOPARDY`** (§8.7) and **`DSMTW_FINALE`** (§8.8).

`DSMTW_FINALE` is the proof the extension point works: it added a table pair for keywords and
a set of events, but no existing round type changed. It is also the first type with a
*positional* constraint — at most one per quiz, and it must be last.

### 8.4 Answer methods

**`QUESTION_SET` questions only.** Jeopardy tiles are always buzzer questions and have
no answer-method setting (D34, §8.7). A fifth method, **`KEYWORDS`**, exists solely for
`DSMTW_FINALE` questions and is illegal anywhere else (§8.8, I18) — it is not an option a
master ever picks.

| Method | Player device shows | Scoring |
| --- | --- | --- |
| `FREE_TEXT` | Text input | Auto-matched on lowercased, trimmed text against the accepted answers; anything else → master validation queue (D22) |
| `MULTIPLE_CHOICE` | Up to 4 options | Fully automatic |
| `BUZZER` | A buzzer button | Master accepts or denies the spoken answer |
| `DO` | No input — a prompt to look at the main screen | Master scores directly (§8.6) |

Points default per round and are overridable per question (D6 flow).

#### Free-text matching (D22)

Normalisation is **lowercase and trim, nothing else**:

```ts
// packages/domain — the single place normalisation happens.
const normalise = (s: string) => s.toLowerCase().trim()
```

A team's answer auto-scores as correct if its normalised form equals the normalised
form of **any** accepted answer. Everything else — including near-misses — goes to the
master's validation queue, where they accept or deny it (PRD 3).

**Accepted answers are stored as an array**, even though v1 may expose only one field
in the authoring UI. A one-to-many answer relationship is expensive to introduce later
(schema migration, export format change, matching logic, validation queue, authoring
form) and free to include now.

The authoring UI exposes alternatives (D33): one field plus an "add alternative"
affordance. With matching at lowercase+trim, this is the master's only tool for
keeping obvious variants out of the live validation queue.

**Deliberately excluded:** diacritic stripping, punctuation stripping, whitespace
collapsing, article handling, and fuzzy/Levenshtein matching. The consequence is
accepted and known: `"the beatles"` matches only if the master listed that variant,
and `"café"` vs `"cafe"` goes to manual validation. Because normalisation is one pure
function with its own tests, strengthening it later is a contained change.

#### Buzzer mechanics (D35)

Shared by `QUESTION_SET` buzzer questions and every Jeopardy tile (D34). A buzzer
question is a **loop**, not a single shot: a denied answer hands the chance to the
teams who haven't had one.

```
Master opens the question
  ↓
BUZZERS_LIVE ──────────────────────────────┐   any team not locked out may buzz
  ↓ first buzz arrives                     │
AWAITING_ADJUDICATION                      │   all buzzers locked; timer paused
  ↓                                        │
  ├─ master ACCEPTS → team credited → question resolves
  │
  └─ master DENIES  → that team locked out for this question
        ├─ teams remain → automatically back to BUZZERS_LIVE ──┘
        └─ none remain  → nobody credited; master prompted to reveal
```

**Rules:**

1. **The first buzz locks all buzzers.** The action stops so the master can hear the
   answer.
2. **A denied team is locked out for the remainder of that question.** Without this,
   they simply buzz again immediately and monopolise the question.
3. **Reopening on deny is automatic**, not a second master click. Deny *is* the signal.
   This is the fastest-moving moment in the game and the master's hands are busy — but
   both screens must make it unmistakable that buzzers are live again.
4. **When every team is locked out**, the question resolves to nobody-credited on its
   own and the master is prompted to reveal. It must never sit in a dead state with no
   live buzzers and no prompt.
5. **The master can force-reopen to everyone**, clearing all lockouts — because
   sometimes they simply misheard an answer.

**Four details that are easy to miss, each of which is a bug if unhandled:**

- **The timer pauses during adjudication.** A master takes several seconds to hear and
  judge an answer; that time must not eat the remaining answer time of the teams still
  waiting. It resumes when buzzers go live again. If a question has no timer, this is
  a no-op.
- **Buzzes arriving after the lock are still recorded**, not discarded. Two teams
  buzzing 40ms apart is normal, and the main screen showing *"Team A by 0.04s"* is part
  of the drama — and the answer to any dispute. Late arrivals simply aren't first.
- **A locked-out player device shows a disabled buzzer with the reason** ("your answer
  was incorrect"), never a dead control that looks broken.
- **Lockouts are per question**, and reset when the next question opens.

**Buzz ordering** is by server arrival time. On a LAN that's 1–3ms of jitter against a
50–200ms spread in human reaction time, so it is fair in every case that matters — and
per §4 we are not defending against a team engineering their network stack.

### 8.5 Attachment visibility (D27)

Which surfaces render a question's media. Set per attachment, with defaults that are
right almost always:

| Type | Main screen | Player devices |
| --- | --- | --- |
| Audio | Yes | **Never** |
| Video | Yes | **Never** |
| Image | Yes (default) | Off by default, per-attachment toggle |

Audio and video are main-screen-only and not configurable. The speakers are there, and
ten phones playing the same song a few hundred milliseconds apart is genuinely
unusable — not merely untidy. Images get a toggle because a detail-heavy image (a map,
a crowded photo, a "spot the difference") is far better in the hand than on a projector
across the room.

Attachments are available on **every** question type and answer method, including `DO`
questions — where they're arguably most useful (show the reference photo, play the
track the teams must dance to).

Playback is always master-triggered from control, never automatic — see the autoplay
risk in §14.

### 8.6 `DO` questions — physical / live challenges

A challenge performed in the room rather than answered on a phone: a dance-off, a
paper-aeroplane throw, a taste test, a charade. **No player input is collected at
all**; the master watches and scores.

Two scoring modes, chosen per question in its settings:

| Mode | Master's action | Use for |
| --- | --- | --- |
| `WINNER_TAKES_ALL` | Picks the winning team(s) | A race or head-to-head — "first to build a tower" |
| `PER_TEAM_SCORE` | Enters a score for each team | Judged performances — "rate each team's dance out of 10" |

#### `WINNER_TAKES_ALL` rules (D23)

- **One or more winners** may be selected. Real races tie, and a master forced to
  invent a single winner will just pick arbitrarily.
- **"No winner"** is an explicit action — sometimes every team fails the challenge.
  This must be a button, not the absence of one, so the master can move on decisively.
- When multiple teams win, a **per-question setting** decides the payout:

  | Setting | 100-point question, 2 winners |
  | --- | --- |
  | `SPLIT` | 50 each (rounded down; remainder discarded, not redistributed) |
  | `FULL` (default) | 100 each |

  `FULL` is the default because it's what people expect in a pub and needs no
  explanation. `SPLIT` exists for masters who care about total-points integrity.

#### `PER_TEAM_SCORE` rules (D24)

- **Free numeric entry** per team — faster than a stepper when judging eight teams in
  a row.
- **Clamped to `0 … question.points`.** The question's point value *is* the maximum, so
  "rate out of 10" is simply a 10-point question. This keeps one meaning for "points"
  across every answer method.
- **Integers only.** A master who wants half-points can double the scale (rate out of
  20 instead of 10) — cheaper than admitting decimals into every score total,
  leaderboard, and export.
- **No negatives.** Penalising a team is what manual score adjustment is for (§8.8).
- Teams left blank score **0**, but the master must be able to see at a glance which
  teams they haven't scored yet — blank and zero must look different while entering,
  even though they resolve identically.

**Consequences across surfaces**, because this is the first answer method with no
player submission:

- **Lifecycle:** `PENDING → OPEN → LOCKED → SCORED`. It has no `REVEALED` state —
  there is no hidden correct answer to reveal. A timer is still useful (`OPEN` for
  60 seconds while the challenge runs) but expiry commits nothing (D8's draft
  mechanism doesn't apply); it simply closes the challenge.
- **Player device:** shows the challenge prompt and a "watch the main screen"
  state, never an input control. Teams must not see a dead input they can't use.
- **Main screen:** this is the surface the room actually reads the challenge from,
  so the prompt and its media carry the whole question. It is the one question type
  where the main screen is load-bearing rather than supporting.
- **Master control:** in `WINNER_TAKES_ALL`, a single row of team buttons. In
  `PER_TEAM_SCORE`, a numeric entry per team. Both must be operable in seconds
  while the master is also running the room.
- **Master-only instructions:** a `DO` question needs setup notes the room must not
  see ("hide the object behind the bar before starting"). This introduces a
  `masterNotes` field — see invariant 7 in §7.


### 8.7 Jeopardy mechanics (D16)

A grid of categories × point values. Each cell holds a question.

**The master selects the tile, never the player.** A team says *"Geography for 400"*
out loud, and the master clicks that tile. Player devices may **mirror the board
read-only** so teams can see what's still available without craning at the projector,
but the board is not interactive on a phone.

This is worth stating as a decision rather than an omission, because choosing it
deletes four problems rather than deferring them:

- No turn ownership to model — the server never needs to know whose pick it is.
- No race between two teams tapping the same tile.
- No lockout UI on player devices, and no "it's not your turn" state to design.
- No disputes caused by network latency deciding who tapped first.

The room already has a turn-taking mechanism: people talking to each other. The
master arbitrates it, exactly as in the televised game.

#### Every tile is a buzzer question (D34)

The answer method is **not configurable on a Jeopardy tile** — opening a tile always
opens the buzzers to every team.

This isn't a simplification for its own sake; it's what makes the turn rule below
work. Buzzer adjudication resolves to **exactly one credited team, or none**, which is
precisely the condition "whoever answered correctly picks next" depends on. A tile
answered simultaneously by every team on their phones has no single winner to hand the
next pick to, so the pick-passing rule would collapse.

Flow for a tile:

```
Master clicks the tile
  → question + any media appear on the main screen; buzzers open on every device
  → first buzz locks the buzzers and is shown on both screens with its timing
  → master accepts or denies the spoken answer
      accepted → team scores the tile's value, and picks the next tile
      denied   → that team is locked out; buzzers reopen to the rest (§8.4)
  → every team locked out, or nobody buzzed → the lowest-scoring team picks next
```

The buzz/deny/reopen loop is specified once in §8.4 and behaves identically here.

A tile's **point value comes from its position on the board** (its row), not from a
per-question override. That's what the grid means.

Because tiles are always buzzer questions, the `FREE_TEXT`, `MULTIPLE_CHOICE` and `DO`
methods in §8.4 apply to `QUESTION_SET` rounds only.

Once a tile is opened, the question runs through the normal lifecycle (§7.1).

#### Turn order (D30)

Whose pick it is, is **computed by the app and displayed authoritatively** — it is a
rule, not a suggestion. The master still clicks the tile (D16); the app tells the room
whose call it is.

**The rule:**

| Situation | Who picks |
| --- | --- |
| Start of the round | The team with the **lowest score** |
| A tile was answered correctly by exactly one team | **That team** |
| Nobody answered correctly | The team with the **lowest score** |

The lowest-score fallback is what makes the round self-balancing: a team that keeps
missing keeps getting the pick, so they stay in the game.

**Resolution details** — each is a case the plain rule leaves undefined:

- **"Lowest score" means the team's total game score**, across all rounds, not points
  earned within the Jeopardy round. This is the number already on the leaderboard, so
  the rule stays verifiable by everyone in the room rather than depending on a hidden
  sub-total.
- **"Exactly one team"** is guaranteed by D34, not merely hoped for: a buzzer tile
  ends with one team credited or none, never several. The zero case — nobody buzzed,
  or every buzzer was denied — is the only fallback that can actually occur.
- **Ties for lowest score:** the master arbitrates. The tied teams are highlighted and
  the master picks between them. A deterministic tiebreak (creation order, fewest
  picks) would be arbitrary in a way the room can see and object to; the master
  arbitrating is honest and takes one click.

**Displayed, not enforced.** The current picker is shown prominently on the main screen
("Quizzly Bears — your pick") and on master control. But the master **can override it**
by assigning the pick to another team, behind a small confirmation. House rules vary,
teams swap, and something always happens that the rule didn't anticipate — a UI that
refuses to let the master proceed is a trap in a live room. Overrides are recorded as
events like everything else.

**No automatic penalty for a wrong answer** in v1. Real Jeopardy deducts points; here
the master can use manual score adjustment (§8.9) if they want that. Making it
automatic would need a per-round setting and interacts awkwardly with every answer
method, for a house rule not everyone uses.


### 8.8 `DSMTW_FINALE` — the timed keyword finale (D50)

Modelled on the finale of the Flemish game show *De Slimste Mens ter Wereld*. It is a
**final round only**: it consumes the teams' points and replaces the leaderboard as the way
the game is decided.

#### The shape

- The round holds **keyword questions**: an open prompt — *"What do you know about Michael
  Jackson?"* — with exactly **5 keywords or phrases** as its answers.
- Teams guess **out loud**. Nothing is typed on any phone during this round.
- The master marks each keyword as it is said. The room sees it unblur (D53).

#### The twist: points become time

At round open, each finalist's **points convert to a bank of seconds** at the authored rate
(D54). Then:

| Rule | Detail |
| --- | --- |
| **The guessing team's clock runs** | Ticking down for as long as it is their turn |
| **A correct keyword costs every *other* remaining finalist the penalty** | Default 20 s (D54). Eliminated teams lose nothing further |
| **Fewest seconds goes first** | Recomputed live, so the team most in trouble always speaks next |
| **Drying up passes the question on** | To the next-fewest-seconds team that hasn't yet passed *this question* |
| **Zero seconds is elimination** | Immediate, and it can happen off-turn — a penalty can take a waiting team to zero |
| **Between turns, no clock runs** | The master hands over explicitly; nobody is charged for the handover |
| **Every clock reads as whole seconds** | `120`, never `2:00` (D57). The round is arithmetic; base-60 conversion under pressure is not |

#### Deriving a clock (D52)

There is no server timer. Every clock is a pure function of the event log:

```
remaining(team) =
    startingSeconds(team)                                  from the conversion at round open
  − Σ (turnEndedAt − turnStartedAt)   over that team's turns
  − penaltySeconds × (keywords marked for other teams while this team was still in)
  − (now − turnStartedAt)             if this team is currently on turn
```

Clients render a countdown from the current turn's start; nothing is authoritative but the
event timestamps. A server restart mid-turn recovers every clock exactly.

#### Question lifecycle

Maps onto the existing state machine (§7.1) without a new one:

| State | Meaning here |
| --- | --- |
| `OPEN` | Teams are taking turns guessing |
| `LOCKED` | All 5 found, or every remaining finalist has passed |
| `REVEALED` | Master has shown the keywords nobody got |
| `SCORED` | Done; move on |

Unguessed keywords are revealed **per question, master-triggered** — the room learns the
answers while they still care, and the master keeps the beat to say *"nobody? it was Billie
Jean."*

#### Ending, and the final ranking (D51)

The round ends when **one finalist remains**, when **all finalists are eliminated**, or when
**the questions run out**.

| Position | Determined by |
| --- | --- |
| 1st | Last finalist standing. If the questions ran out first, most seconds remaining |
| 2nd … | Reverse order of elimination — last out is second, first out is last among finalists |
| Below the finalists | Non-finalists, ranked among themselves by points |

**Simultaneous elimination shares a rank.** Two teams on identical seconds, taken to zero by
the same keyword's penalty, are eliminated at the same computed instant and tie — consistent
with D32 everywhere else. In the degenerate case where *every* finalist is eliminated by one
keyword, there is **no winner**, and the result shows a shared first place. It is a reachable
outcome with equal banks and a high penalty, so it is defined rather than left to whatever the
sort happens to do.

**Points do not carry into the result.** They were spent. The `FINISHED` screen therefore
shows two tabs — the elimination result, and total points earned — because the points view is
still worth seeing even though it decides nothing (PRD 4).

#### Constraints

- **A finale is optional.** Most quizzes won't have one, and nothing requires it.
- **Enough questions to plausibly reach one survivor.** Not enforced — a master may know
  their room — but computed and shown while authoring and again at game setup (D58,
  PRD 2 §9). Running out of questions is a legal ending, just a flat one.
- **But at most one per quiz, and it must be the last round.** The authoring UI *prevents*
  both violations rather than reporting them later — the round-type picker stops offering
  `DSMTW_FINALE` once one exists, and no round can be placed after it (PRD 2 §6). Pre-flight
  re-checks as a backstop (PRD 2 §10, I20).
- **Exactly 5 keywords per question**, no more, no fewer.
- **At least 2 finalists**, or there is no contest.
- Attachments work as on any question, though a keyword question rarely needs one.

> **Design note on the penalty.** It does not scale with team count: 5 keywords × 8 teams at
> 20 s removes up to 700 s from a 960 s pool, ending the round in roughly one and a half
> questions. This is why the penalty is configurable at setup (D54) and why the authoring UI
> shows the arithmetic. The master is trusted with it — but they must be *shown* it.

### 8.9 Manual score adjustment (D15)

The master can add or subtract any number of points from any team **at any moment** —
between rounds, mid-question, after the game has finished — with an **optional
reason**.

- Available from both master control (PRD 3) and the config pages (PRD 2).
- Recorded as a `SCORE_ADJUSTED` event: `{ teamId, delta, reason?, createdAt }`.
- **Never silently folded into a question's score.** Adjustments are a separate,
  visible line in a team's score breakdown, so the sum always reconciles and
  "why do they have 47?" is always answerable.
- The reason is optional by design — requiring it would mean the master types
  something meaningless under time pressure, or avoids the feature. But it is
  strongly encouraged in the UI, because the person asking "what was this for?" three
  rounds later is usually the master themselves.
- Deltas may be negative. Team totals **may** go negative; this is not clamped.

#### Announcement on the main screen (D25)

An adjustment is **announced to the room, reason included** — a visible
*"Quizzly Bears +5 · best heckle of the night"* is part of the entertainment, and
showing the delta without the reason makes a correction look arbitrary.

Display rules:

- A **transient banner**, shown for a few seconds, then gone. Not a permanent element.
- It **must not obscure question content.** If a question is open or being revealed,
  the banner occupies a lower band; it never overlays the question, the media, or the
  answer.
- It shows team name, colour, signed delta, and the reason if one was given.
- Adjustments made **before a game starts or after it ends** are applied silently —
  there is no room watching yet, or no longer.

**One addition, flagged as mine to veto:** a per-adjustment **"don't announce"**
checkbox, default off. Reasons are usually funny, but occasionally they are
*"penalty — caught using a phone"*, and putting that on a projector in front of the
team is a different kind of moment. Default-on announcement keeps your intent; the
checkbox costs one control and covers the case where the master needs discretion.

> Every adjustment is recorded and visible in the config pages regardless of whether
> it was announced. Suppressing the announcement hides it from the room, never from
> the audit trail.

### 8.10 Game scoping (D21)

Multiple games may be live simultaneously, so **there is no such thing as "the current
game"** anywhere in the system. This is stated as an invariant because it's the kind of
convenience that gets reintroduced accidentally, and once one module assumes it,
removing it means touching everything.

**Rules:**

- Every surface route carries an explicit game identifier:
  `/control/[gameId]`, `/screen/[gameId]`, `/play/[code]` (the code resolves to a
  `gameId` on join, after which the device holds it).
- **No endpoint, query, or component resolves a game implicitly** — not from "the most
  recent", not from "the only active one", not from a server-held variable. If a
  handler needs a game, it is passed one.
- The in-memory projection is a **map keyed by `gameId`**, not a single object.
- Every event, subscription, and broadcast is scoped to one game. A broadcast must not
  be able to reach a subscriber of a different game — this is worth a test, because it
  fails silently and only under concurrency.
- Game codes are unique across all **active** games (§8.11).
- Devices bind to `(gameId, teamId)`. A device holding a stale `gameId` for a finished
  game gets a clear "this game has ended" state, not an error.

**Consequence for the master:** selecting which game to project is a deliberate act.
The config dashboard lists games and offers "open control screen" / "open main screen"
per game, each yielding a URL the master opens on the relevant display. There is no
"project the current game" shortcut, because there is no current game.

### 8.11 Game codes

- 6 characters from **Crockford Base32** — `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, which
  excludes `I`, `L`, `O` and `U`. An existing standard designed for humans reading and
  re-typing codes, which is exactly the job: read aloud across a noisy room, typed by
  someone squinting at a projector. Exact alphabet and normalisation rules in
  [conventions §2](../spec/conventions.md).
- Unique among **active** games only; retired codes are reusable.
- Case-insensitive and whitespace-insensitive on entry.
- The QR code encodes a full join URL including the code, so scanning skips entry
  entirely.

---

## 9. Design system & styling

### 9.1 Token-driven theming

All colour, radius, spacing and typography flow from CSS custom properties in a
single globals file, in the shadcn convention. Components reference semantic tokens
(`--primary`, `--muted-foreground`), never literal colours. Retheming the app is
editing one file.

### 9.2 Per-surface scale

The four surfaces have wildly different viewing distances, and one type scale
cannot serve them. Each gets its own scale built from the same tokens:

| Surface | Viewing distance | Constraint |
| --- | --- | --- |
| Main screen | 3–10 m, projected | Very large type, high contrast, no thin weights, no dependence on subtle colour differences — projectors crush contrast |
| Master control | 0.5 m, laptop | Information-dense, scannable, action targets unambiguous under time pressure |
| Player | 0.3 m, phone in hand | Large touch targets, thumb-reachable primary action, works one-handed |
| Config | 0.5 m, laptop | Standard application density |

### 9.3 Input conventions

Always prefer the native, purpose-built control over a generic text field: a colour
picker for team colours, file drop zones with preview for attachments, sliders or
steppers for point values, native pickers for durations. Team colours are
constrained to a curated palette with a custom option — free colour choice reliably
produces two indistinguishable teams and unreadable text on the main screen, so
the palette guarantees mutual distinguishability and sufficient contrast.

### 9.4 Language switching

Every surface exposes a language switcher. But the important decision here isn't the
widget — it's **what scope a locale has**, and **what actually gets translated.**

#### What is and isn't translated

| Localised (EN/NL) | Never translated |
| --- | --- |
| All UI chrome, labels, buttons, empty states, errors, validation messages | Question text, answer options, correct answers, `masterNotes` |
| Status copy ("Hang tight — the quiz starts soon", "Answer locked in") | Team names |
| Number, date and duration formatting | Round and quiz titles |

**Quiz content is authored once, in whatever language the master types.** A player
who switches to Dutch gets a Dutch interface around English questions if that's how
the quiz was written. This must be stated in the UI near the switcher, or masters
will report it as a bug. Multilingual quiz content — one question carrying both an
EN and NL variant — is a **non-goal** (§3): it doubles every authoring form and no
real pub quiz needs it.

#### Locale scope: per-device, not per-game

Each browser holds its own locale. A table of Dutch speakers switches their phone to
NL without affecting the projected screen, the master's laptop, or any other team.

This is the right scope because the four surfaces genuinely have different
audiences: the master may prefer an English admin interface while the room is Dutch.
A single game-wide locale would force one of them to be wrong.

#### Resolution order

Applied on first load of any surface:

1. Explicit `[locale]` route segment (a shared or bookmarked link wins)
2. Persisted preference cookie from a previous visit on this device
3. **`en`** — always the default (D17)

**`Accept-Language` is deliberately not consulted.** The upside would have been
Dutch-configured phones landing on Dutch automatically; the cost is unpredictability —
the same QR code produces different-looking screens on different phones, and a master
demoing the join flow on their own device can't tell what a guest will see. A fixed
default is boring and predictable, which is the correct trade for the surface a
stranger meets first.

> The consequence is that Dutch-speaking rooms must switch manually. This makes
> **O13** (master sets a default player language per game) considerably more valuable
> than it was — with `Accept-Language` gone, it becomes the only mechanism that gets a
> Dutch room into Dutch without twelve people each tapping a switcher. Recommend
> keeping it.

Switching writes the cookie and swaps the `[locale]` segment, preserving the current
path and all game state. **Switching must never drop an SSE connection or lose an
in-progress draft answer** — a player changing language mid-question keeps what they
typed.

#### Placement per surface

Deliberately different, because a control that belongs in the corner of an admin
page would be vandalism on a projected screen:

| Surface | Placement |
| --- | --- |
| Landing / join | **Prominent** — top-right, before any other decision. This is where a player will look, and it's the moment before they have to read anything that matters. |
| Player (in game) | Collapsed into a small menu; not competing with the answer control. Available but never a mis-tap target next to a buzzer. |
| Main screen | **Not visible during play.** Available in the pre-game/idle state and via a control bar that appears only on mouse movement, then fades. The projected screen must never show application chrome to an audience. |
| Master control | Small, in the persistent header. Set once, never touched again. |
| Config pages | Standard header position alongside other app-level settings. |

Both locales must be reachable from a device that **cannot read the current one** —
so the switcher shows language names in their own language ("English" / "Nederlands"),
never translated, and never a flag icon alone (flags mean countries, not languages).

#### Copy constraints

Dutch runs roughly 20–30% longer than English. Layouts on all four surfaces must be
verified in Dutch, and the main screen is the risk case: a button or heading sized
to fit English at projector scale can overflow badly. Treat NL as the layout
baseline for the main screen, not as an afterthought.

### 9.5 Accessibility floor

Not a full WCAG commitment, but: keyboard-operable master control (the master's
hands are busy), visible focus states, contrast checked on the main screen, and no
information conveyed by colour alone — team colour is always paired with the team
name.

---

## 10. Export & import

Full format in the [protocol spec](../spec/protocol.md).

A `.zip` containing everything needed to reproduce the quiz **and its played
history** on another machine:

```
kwiz-export.zip
├─ manifest.json      schemaVersion, quizId, revision, exportedAt, checksums
├─ quiz.json          rounds, questions, answers, attachment metadata
├─ games.json         played games: teams, answers, buzzes, validations, events
└─ attachments/
   └─ <attachmentId>.<ext>
```

- `schemaVersion` is checked on import; an unknown newer version is refused with a
  clear message rather than partially imported.
- Attachment checksums are verified; a corrupt or missing file is reported per-file
  rather than failing the whole import.
- Import is **transactional** — it fully succeeds or leaves the database untouched.
- Collision handling per D9.
- Exporting is available with or without game history (carrying a quiz to a new
  venue vs. archiving a night).

---

## 11. Code quality

The stated bar is "relatively clean and maintainable, compromises allowed". Where
compromise is and isn't acceptable:

**Hold the line on:**
- `packages/domain` stays pure. No I/O, no framework imports. This is what keeps
  the game rules testable and D3 honest.
- The §7 payload invariants have automated tests. A leak is unrecoverable at a live
  event — you cannot un-show an answer.
- All external input (POST bodies, imported zips) is zod-validated at the boundary.
- Every event type is explicitly enumerated and typed; no untyped payload bags.
- TypeScript strict, no `any` in domain or db packages.

**Compromise freely on:**
- UI component decomposition — inline until it hurts.
- Optimising anything for scale beyond §2.1.
- Abstracting before the second use case exists.

### 11.1 Testing (D18)

**Unit tests are required. Full coverage is explicitly not the goal.** Test critical
paths and the unusual paths that specific features introduce. A coverage percentage
is not a target and should not be reported as one.

**Must be tested** — each is either invisible until it's embarrassing in front of an
audience, or destroys data:

| Area | Why |
| --- | --- |
| Question state machine (§7.1) | Every surface's behaviour derives from it |
| Payload filtering invariants 1–7 (§7) | You cannot un-show an answer at a live event |
| Answer normalisation & matching (O6) | Silently marking a correct answer wrong is the worst possible bug |
| Scoring, incl. `DO` modes and manual adjustments (§8.6, §8.9) | Wrong totals invalidate the whole night |
| Buzz ordering, and the buzz/deny/reopen loop (§8.4) | Contested by definition, must be deterministic given an event sequence — and the lockout loop has states (all teams locked out, timer paused mid-adjudication) that are tedious to reach by hand |
| Export → import round-trip | Data loss, and the one operation with no undo |
| Reconnect replay from `seq` (§6.5) | Fails only under conditions nobody tests manually |
| Game isolation with two live games (§8.10) | Cross-game leakage fails silently and only under concurrency — never caught by hand |

**Explicitly not worth testing:** presentational components, layout, styling, and
anything whose failure is immediately visible the first time you look at the screen.

**Avoid large mocks — treat one as a design signal.** If a test needs an elaborate
mock of a database, a request, or an SSE stream, the logic under test is in the wrong
place: it belongs in `packages/domain` as a pure function over an event list, where
the "fixture" is a literal array and no mock exists at all.

```ts
// The shape almost every domain test should have: no mocks, no setup.
const state = reduce([
  gameStarted(), questionOpened(q1), answerSubmitted(teamA, 'paris'),
  questionLocked(q1), answerValidated(teamA, true),
])
expect(state.scores[teamA]).toBe(10)
```

### 11.2 End-to-end browser tests (D49)

Separately from the unit bar above, a **journey-based end-to-end suite** is built once the
surfaces exist (build-order slice 9). This is not a contradiction of D18: that decision is
about not chasing unit-test coverage percentages. E2E here answers a different question —
*does the documented behaviour actually work once four surfaces are wired together?*

It earns its place for three reasons specific to this product:

- **The failure mode is public and unrecoverable.** "It broke in front of a room" is the
  risk the whole design optimises against.
- **Most of the subtle rules are cross-surface** — buzz ordering, submission finality,
  shared drafts, cross-game isolation, payload filtering. Unit tests prove the logic; only
  E2E proves the wiring.
- **One test can only exist at this level:** a **network-level sentinel assertion** that no
  secret crosses the wire into a player's browser. §7's unit sentinel test proves the filter
  function is correct; this proves the filter is the thing actually being used.

**Journey-based, not exhaustive.** Scenarios derive from the flows the PRDs document, not
from enumerating controls. Full scenario list in
[build-order slice 9](../build-order.md).

---

## 12. Question log

**All resolved.** Kept as a record of what was asked and why each answer was chosen, so
a later reader can see which paths were considered and rejected.

Blocking items are marked. Nothing below has been assumed in this document.

| # | Question | Recommendation | Blocks |
| --- | --- | --- | --- |
| ~~O1~~ | ~~Drawing/pictionary or live chat round type~~ | **Resolved: not planned.** D2 is locked to SSE + POST. See §6.9 for the migration path if this changes. | — |
| ~~O2~~ | ~~Database layer~~ | **Resolved → D14.** Drizzle + `better-sqlite3`, migrations prompted on boot (§6.7). | — |
| ~~O3~~ | ~~Word for a playthrough~~ | **Resolved → D19.** "Game". | — |
| ~~O4~~ | ~~Multiple devices per team~~ | **Resolved → D20.** Allowed, cap via `KWIZ_MAX_DEVICES_PER_TEAM`, default 3 (§6.8). | — |
| ~~O5~~ | ~~Concurrent games~~ | **Resolved → D21.** Multiple concurrent games supported; everything explicitly scoped to a `gameId`, nothing resolves "the current game" (§8.10). | — |
| ~~O6~~ | ~~Free-text matching~~ | **Resolved → D22.** Lowercase + trim only (§8.4). | — |
| ~~O7~~ | ~~Attachment visibility~~ | **Resolved → D27.** Audio/video main screen only; images main screen by default with a per-attachment player toggle (§8.5). | — |
| ~~O8~~ | ~~Partial credit~~ | **Resolved → D31.** Accept/deny only; manual adjustment covers the rare case. | — |
| ~~O9~~ | ~~i18n depth~~ | **Resolved → D28.** Full EN/NL on player + main screen; config/control i18n-wired, English-first if trimming. | — |
| ~~O10~~ | ~~Tie handling~~ | **Resolved → D32.** Shared rank, shown as a visible tie. No tiebreaker round. | — |
| ~~O11~~ | ~~`WINNER_TAKES_ALL` ties~~ | **Resolved → D23.** Multiple winners, explicit "no winner", per-question `SPLIT`/`FULL` payout (§8.6). | — |
| ~~O12~~ | ~~`PER_TEAM_SCORE` bounds~~ | **Resolved → D24.** Free numeric entry clamped to `0 … question.points`, integers only (§8.6). | — |
| ~~O13~~ | ~~Per-game default player language~~ | **Resolved → D29.** A game setting defaulting to `en`, overriding the default but never a player’s explicit choice (§9.4). | — |
| ~~O14~~ | ~~`DO` attachments~~ | **Resolved.** Attachments work on every question type including `DO` (§8.5). | — |
| ~~O15~~ | ~~Jeopardy turn order~~ | **Resolved → D30.** A computed rule, not a hint: lowest score picks first, correct answerer picks next, nobody-correct falls back to lowest score. Displayed authoritatively, overridable by the master (§8.7). | — |
| ~~O16~~ | ~~Main-screen visibility of score adjustments~~ | **Resolved → D25.** Announced with the reason, as a transient banner that never obscures question content; per-adjustment "don't announce" opt-out (§8.8). | — |
| ~~O17~~ | ~~Draft-only answer marker~~ | **Resolved → D26.** Marked "not confirmed by team" in the validation queue (§5.1). | — |
| ~~O18~~ | ~~Alternative accepted answers in the authoring UI~~ | **Resolved → D33.** Exposed (§8.4). | — |
| ~~O19~~ | ~~Who answers a Jeopardy tile~~ | **Resolved → D34.** Every Jeopardy tile is a buzzer question; the method is not configurable (§8.7). | — |

---

## 13. Agent onboarding (`/CLAUDE.md`)

Implementation will be done substantially by coding agents, so the repo needs a root
`CLAUDE.md` that is the entry point for any agent picking up a task. Required
contents:

- **Where the truth lives** — this PRD set, and that the two specs in `docs/spec/`
  are normative over surface PRDs when they conflict.
- **The rules an agent will otherwise break**, drawn from this document:
  - `packages/domain` is pure — no I/O, no Next.js, no DB imports (§6.3)
  - Names are never identifiers; UUIDv7 keys, explicit `position` ordering (§8.2)
  - Never add a field to a payload that §7 says that audience can't have
  - The deadline is advisory; the master locks questions, not the timer (§5.1)
- **Database conventions** — Drizzle schema location, how to add a table, the ID
  column pattern, timestamp conventions, and that everything about a live game is an
  **event**, not a mutable row (D4).
- **Migration conventions** — always generate via Drizzle Kit, never hand-edit an
  applied migration, forward-only, additive by default, destructive changes carry a
  written note (§6.7).
- **Testing conventions** — what must be tested, what must not, and the
  no-large-mocks rule with its rationale (§11.1).
- **i18n conventions** — no hardcoded user-facing strings, ever; where message files
  live; that quiz content is not translated (§9.4).
- **Styling conventions** — semantic Tailwind tokens only, never literal colours; the
  per-surface type scales (§9.2).
- **Commands** — install, dev, build, start, generate a migration, run tests.

> Best written **after** the two specs, so it can point at real schema and migration
> conventions rather than describing them twice. Flagged here so it isn't forgotten.

---

## 14. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Venue wifi is unusable / laptop hotspot saturated | Game cannot run — total failure | SSE reconnect + replay (§6.5) means dropouts self-heal; master control can submit an answer on a team's behalf as a manual fallback |
| Browser blocks autoplay of audio/video on the main screen | Song round silently fails in front of an audience | Main screen requires one explicit master click to arm playback at game start; playback is thereafter master-triggered, never automatic. Verified before the room fills. |
| Master picks the wrong network interface → dead QR code | Nobody can join | First-run interface picker (D10) shows a live reachability check, plus an in-app "is this URL reachable?" test |
| Laptop sleeps mid-game | Server dies with an audience watching | Event-sourced recovery (D4); setup checklist covers sleep, screensaver and power settings — it is the master's own machine on mains power, so an OS setting is the right fix rather than app code |
| A player-facing feature is built on a secure-context API | Works on the developer's `localhost`, silently absent for every guest | §6.10 lists what is unavailable, and its standing rule |
| Large video attachments make exports unwieldy | Slow, fragile transfers | Range-request serving (D5), per-file checksums, size warnings at upload, export-without-history option |
| Two teams pick indistinguishable colours | Main screen becomes unreadable | Curated palette with guaranteed distinguishability (§9.3); colour always paired with name (§9.5) |

---

## 15. Next steps

PRD 1 is complete: **34 decisions locked, no open questions.**

1. Write the [data model spec](../spec/data-model.md) — the Drizzle schema. Blocked on
   nothing.
2. Write the [protocol spec](../spec/protocol.md) — event catalogue, per-audience
   payload shapes, export format.
3. PRD 2 (config) → PRD 3 (control) → PRD 4 (main screen) → PRD 5 (player).
4. Write [`/CLAUDE.md`](../../CLAUDE.md) per §13, once the specs exist so it can point
   at real conventions.

New questions will surface while writing the surface PRDs — particularly around
Jeopardy board authoring and the validation-queue interaction. Those belong in the
relevant PRD's own question log, not here. §12 stays closed.
