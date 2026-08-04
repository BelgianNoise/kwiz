# Agent workflow

**Status:** Working agreement · **Last updated:** 2026-08-04

**What** to build and in what order: [`build-order.md`](build-order.md).
**How** to execute a slice: this document.

Read this once before your first slice, and re-read §4 and §5 before declaring one done.

---

## 1. The five phases of a slice

```
ORIENT  →  BUILD  →  VERIFY  →  REGRESS  →  REPORT
 read     write      prove       prove         hand
 what     the        this        nothing       over
 binds    code       slice       else broke    context
 you                 works
```

**REGRESS and REPORT are the two most commonly skipped and the two that matter most in a
sequential dispatch.** You are one of ten agents in a chain; the next one inherits your
code and none of your reasoning.

---

## 2. Phase 1 — Orient

### 2.1 Read in this order

1. **[`CLAUDE.md`](../CLAUDE.md)** — all of it. It is short and every §2 rule is one you
   will otherwise break.
2. **Your slice** in [`build-order.md`](build-order.md), including the *"do not"* lines.
3. **[`spec/conventions.md`](spec/conventions.md)** — every concrete value you need is
   here. Do not invent a hex colour, an error code, a debounce interval or a lint rule.
4. **The specs your slice touches** — [data model](spec/data-model.md) and
   [protocol](spec/protocol.md) are *normative*. Read the relevant sections in full, not
   by grep.
5. **The PRD your slice implements**, if it's a surface slice.
6. **[`slice-log.md`](slice-log.md)** — what previous agents did, deviated on, and stubbed.

### 2.2 Do not read everything

There are ~6,700 lines of design. Reading all of it before slice 1 wastes context you will
need for the code. The doc table in CLAUDE.md §1 tells you which document answers which
question — use it.

**But do read your slice's own spec sections completely.** Skimming a spec and grepping for
keywords is how invariants get missed; they are usually stated once, in prose, next to the
thing they constrain.

### 2.3 Before writing code, write down

- Which decisions (`D14`, `D35`, …) your slice implements, and which invariants (`I8`,
  `I15`) it must uphold.
- Anything in the spec you believe is wrong or ambiguous — **raise it now**, before it is
  baked into code. §3.3.

---

## 3. Phase 2 — Build

### 3.1 Stay inside your slice

The strongest temptation in a chained dispatch is to do a bit of the next slice while
you're in the file. Don't.

- **No stubs or placeholders for future slices.** An empty `PlayerScreen.tsx` written in
  slice 5 is worse than nothing: slice 7's agent finds it, assumes it is a starting point,
  and inherits decisions you made without reading PRD 5.
- **No speculative abstraction.** PRD 1 §11: abstract on the *second* use case, not the
  first. If slice 5 needs a shape slice 6 might also want, let slice 6 discover that.
- **If your slice genuinely cannot proceed without something from a later slice**, that's a
  build-order bug. Say so in the log rather than quietly reaching forward.

### 3.2 Where logic goes

One question decides most file placement:

> *Could this be tested with a literal array and no mocks?*

If yes, it belongs in `packages/domain`. If you are writing a mock of a database, a request
or a stream, **stop** — that is CLAUDE.md §6's design signal, not a testing inconvenience.

### 3.3 When the spec is wrong

It will happen. The specs were written before any code existed.

**The protocol is:**

1. **Stop.** Don't implement either the spec or your alternative yet.
2. State the problem precisely: what the spec says, why it can't work or is ambiguous, and
   what you propose.
3. **If it's unambiguous** — a contradiction, an impossible constraint, a missing type —
   fix the doc in the same change as the code, and note it in the log.
4. **If it's a judgement call** — a UX trade-off, a naming choice, a scope question — **ask
   rather than decide.** These documents were built by asking; a wrong assumption in code
   costs far more than one in a paragraph.
5. Never leave code and spec disagreeing. That is the one outcome worse than either being
   wrong, because the next agent cannot tell which to trust.

### 3.4 Dependencies

The dependency list in conventions §1 is closed. **Adding a package requires flagging it**
in your report with what it does and why nothing already present covers it. This is not
bureaucracy — a laptop-hosted offline app pays for every dependency in install fragility
(conventions §1.1).

---

## 4. Phase 3 — Verify your slice

### 4.1 The gate

```bash
pnpm check     # oxfmt --check && oxlint && tsc --noEmit && vitest run
```

Plus conventions §11's criteria. **`pnpm check` passing is necessary, not sufficient** — it
cannot tell you a layout is illegible at 10 m or that a buzzer feels slow.

### 4.2 Prove it in a browser

For any slice with a UI, run the app and interact with it. Use whatever browser automation
you have — Chrome DevTools MCP, Playwright MCP, or a driven browser — and use it to
*observe*, not just to click:

| Capability | Use it for |
| --- | --- |
| **Multiple tabs/contexts at once** | This app is four surfaces interacting. A single tab cannot test a buzzer race, shared drafts, or two live games |
| **Viewport emulation** | Player surfaces at ~390×844; main screen at **1920×1080**; control at a laptop size |
| **Console** | Any error or warning is a finding, even if the UI looks fine |
| **Network panel** | Confirm the SSE stream stays open, `: ping` frames arrive, and **no polling is happening** (D2) |
| **Screenshots** | The only way to judge PRD 4's legibility claims |

**Concrete multi-surface setup** for slices 5–8:

```
tab 1  /admin              author, then start a game
tab 2  /control/<gameId>   master
tab 3  /screen/<gameId>    projected, at 1920×1080
tab 4  /play/<code>        team A, mobile viewport
tab 5  /play/<code>        team B, mobile viewport   ← the one that finds real bugs
```

Tab 5 is not optional. Most of the subtle rules in this design — submission finality (D43),
shared drafts (D45), buzz ordering (D35), lockout (D35) — are invisible with one player.

### 4.3 What to actually look at

Beyond "it works":

- **Kill the server mid-game and restart it.** Every surface must resume with correct state
  and no user action (D4, D38). This is a two-minute test that validates the whole
  event-sourcing decision, and nothing else does.
- **Open the same game in two `/play` tabs on one team** and try to submit different
  answers. Second one must be *rejected with the canonical answer shown*, not overwritten.
- **Throttle or disable the network** on a player tab mid-question. Typed text must survive;
  the submit must retry.
- **Run two games at once** and confirm nothing crosses over (D21).
- **Check `nl`**, not just `en` — especially on the main screen, where Dutch is the layout
  baseline (PRD 1 §9.2).

### 4.4 End-to-end tests

**The full suite is slice 9's job, not yours** (D49). Twenty-two journey-based scenarios,
listed in [`build-order.md`](build-order.md).

**During slices 4–8, write an E2E test only when** the interaction *between* surfaces is the
thing under test and you found a bug no unit test could have caught. Add it to the suite's
directory so slice 9 inherits it rather than rediscovering it.

Otherwise, verify manually per §4.2–§4.3 and record what you checked in the smoke checklist.
The reason not to front-load E2E is ordering, not value: a browser test written against a
half-built surface gets rewritten when the surface finishes, and rewritten tests are how a
suite becomes distrusted.

### 4.5 What a browser cannot prove

Be honest about this rather than claiming verification you don't have. These go to slice 9's
field rehearsal:

| Cannot be verified in a desktop browser | Why |
| --- | --- |
| **iOS autocorrect mangling answers** | The exact risk `autocapitalize/autocorrect/spellcheck="off"` guards (PRD 5 §6) — only reproducible on a real iPhone |
| **`nosleep.js` actually preventing sleep** | Needs a real phone left alone for its lock timeout |
| **Haptics on buzz** | Android device only |
| **Projector contrast and overscan** | PRD 4 §2.2 is about physical hardware |
| **20 phones on one laptop hotspot** | Behaves differently from 5 tabs on loopback |
| **10 m legibility** | A screenshot approximates it; a room proves it |

If your slice's correctness depends on one of these, **say so in the report** and describe
what you did check instead.

---

## 5. Phase 4 — Regression

You are not done when your slice works. You are done when **everything before it still
works.**

### 5.1 The full test suite, every time

`pnpm check` runs every package's tests, not only yours. If a test you didn't write fails,
**it is your problem** — you changed something. Never skip, `.skip`, or "temporarily"
loosen a test to get a slice green. Two tests in particular:

- **The sentinel leak test** (protocol §6.2) — if it fails, you added a field to a payload
  that leaks. Fix the filter, not the test.
- **Projection == replay** (I15) — if it fails, a reducer and a writer have drifted.

### 5.2 From slice 9 onwards, run the E2E suite too

Once [slice 9](build-order.md)'s suite exists, `pnpm e2e` joins the regression gate. It
automates most of §5.3's checklist, which is the point — a manual list depends on diligence,
and by slice 8 it is long.

The checklist does not go away: it keeps the rows a browser cannot verify (§4.5).

### 5.3 The living smoke checklist

Each slice **appends** to `docs/smoke-checklist.md` and **runs the whole list**. It takes a
few minutes and it is the only mechanism that catches "slice 6 broke slice 4".

Create it in slice 0 and grow it:

| After slice | Add |
| --- | --- |
| 0 | App boots; `pnpm check` clean; `/en` and `/nl` both render |
| 1 | Fresh DB is created and migrated silently; an existing DB **prompts**; backup written |
| 2 | *(no UI — covered by the test suite)* |
| 3 | SSE stream opens and stays open; `: ping` visible in the network panel; reconnect after a server restart |
| 4 | Author a quiz with all four answer methods + a Jeopardy round; upload an image and an audio file; pre-flight catches a deliberately broken question; export and re-import |
| 5 | Open a question, validate an answer inline, adjudicate a buzz, deny it and confirm buzzers reopen, score a `DO` question both ways, adjust a score and revoke it |
| 6 | Every stage renders at 1920×1080; reveal sequences correctly; break countdown runs; buzz timings show 2 decimals; `nl` doesn't overflow |
| 7 | Join by code and by QR; two devices on one team; submit and confirm it locks; buzz from two devices; go offline mid-question and recover |
| 8 | Correct a verdict post-game and see the score change; export with history and re-import onto a clean data dir |

**Run the whole list, not just your rows.** That is the entire point.

---

## 6. Phase 5 — Report

Append an entry to `docs/slice-log.md`. The next agent inherits your code and none of your
reasoning; this file is the only channel.

```markdown
## Slice 4 — Config & authoring

**Status:** complete

**Built:** dashboard, quiz editor, question sheet, Jeopardy board builder, pre-flight,
export/import, game setup.

**Spec deviations:**
- PRD 2 §8 showed the value ladder above the board; moved beside the category headers
  because at 5 columns it pushed the grid below the fold. PRD 2 updated.

**Raised, not resolved:**
- Pre-flight's "attachment missing" check needs a checksum re-verify pass that will be
  slow for 2 GB of video. Left synchronous; may need a progress state. Flagged for slice 8.

**Stubbed / deliberately absent:**
- Post-game review (PRD 2 §13) — deferred to slice 8 per build-order.

**Not verifiable here:** none.

**Next agent should know:**
- `PalettePicker` in `apps/web/components/` reads conventions §3's list from
  `@kwiz/domain/palette` — reuse it in game setup and control, don't re-declare the hexes.
```

Five things every entry must answer: **what you built, where you deviated and why, what you
raised without resolving, what you deliberately left out, and what the next agent would
otherwise have to rediscover.**

---

## 7. Git

- **One branch per slice**, one PR, merged before the next slice starts. Sequential
  dispatch means no concurrent branches — if two exist, something went wrong in dispatch.
- Commit messages reference decisions where relevant: `feat(db): append-and-project (D4)`.
- **Spec edits go in the same PR as the code they justify**, never a separate "docs" PR.
  Reviewing them together is how the reviewer checks the reasoning.
- `data/` is never committed.

---

## 8. Anti-patterns

Specific to this project, each seen in similar builds:

| Don't | Why |
| --- | --- |
| Stub future surfaces "to save time" | §3.1 — the next agent inherits your unread assumptions |
| Weaken a lint override to ship | Two of them *are* the architecture (conventions §1.4) |
| Add a mock of the DB or a request | CLAUDE.md §6 — the logic is in the wrong layer |
| `.skip` a failing test you didn't write | §5.1 — you changed something |
| Paste PRD text into code comments | Two sources of truth; cite the section instead |
| Implement your own reading of an ambiguous spec | §3.3 — ask |
| Report "done" with `pnpm check` as the only evidence | §4.2 — it cannot see a UI. Note `pnpm check` excludes `e2e` by design (conventions §1.5) |
| Claim a browser verified something from §4.5 | It didn't. Say what you actually checked |
| Add a dependency without flagging it | §3.4 |
| "Improve" a decision from the log without raising it | Every one has a *revisit if* — meet it or discuss it |

---

## 9. If you are blocked

In order:

1. **Decision log** (PRD 1 §5) — 48 entries with rationale. It probably answers this.
2. **The relevant spec** — normative, and more detailed than the PRDs.
3. **`conventions.md`** — if the question is "what exact value?"
4. **`slice-log.md`** — a previous agent may have hit it.
5. **Ask.** State what you're building, what the docs say, what's ambiguous, and what you'd
   choose. A blocked slice that asks is cheaper than an unblocked one that guessed.
