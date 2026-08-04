# PRD 4 — The Main Screen (projected)

**Status:** Draft · **Last updated:** 2026-08-04

The audience-facing screen at the front of the room. Read-only, no controls, no
chrome. The master's control desk is [PRD 3](./03-master-control.md).

Governed by [PRD 1](./01-main.md); the [data model](../spec/data-model.md) and
[protocol](../spec/protocol.md) specs are normative over anything here.

Route: `/screen/:gameId`. Audience `MAIN_SCREEN` (protocol §5.2).

---

## 1. What this surface is for

PRD 1 G7: *"Legible from 10 m, adapts to the question's media, feels designed rather
than functional."*

This is the only surface the paying audience looks at, and the only one where **looking
good is a requirement rather than a nicety.** It is also the surface with the least
information: everything sensitive is filtered out server-side before it arrives
(PRD 1 §7), so what remains has to be arranged well rather than merely displayed.

### 1.1 The operating context

> A **projector** throwing a washed-out image onto a pub wall. The nearest table is 3 m
> away, the furthest 10 m. The room is **not dark** — there are lights on and a window.
> Nobody can interact with this screen. Half the audience is looking at their phone
> instead, and glances up when something changes.

The last sentence matters most: **this screen is glanced at, not watched.** Anything
important must survive being missed for ten seconds and then noticed.

---

## 2. Hard constraints

These are physics and platform limits, not preferences. Everything in §4 onward obeys
them.

### 2.1 Legibility — a concrete floor, not "make it big"

Comfortable reading needs a cap height of roughly **1 cm per 2 m of viewing distance**.
At 10 m that is a 5 cm cap height. On a typical 2.5 m-wide projected 16:9 image (1.4 m
tall), 5 cm is **3.5% of image height** — so a cap height of `3.5vh`, which for most
faces means a font size of about **5vh**.

| Role | Size | Notes |
| --- | --- | --- |
| Absolute floor — *any* text on this screen | **4vh** | Below this, the back tables cannot read it. Nothing is exempt, including timings and captions. |
| Body / answer text | 5–7vh | |
| Question prompt | 7–14vh, **fitted** (§2.4) | |
| Hero moments — buzzing team, correct answer | 12–20vh | |
| Decorative numerals — round number, timer | up to 30vh | |

**Consequence to internalise: there is room for very little.** A 16:9 screen at 6vh
body text fits roughly 12 lines total. Every stage design below is a consequence of
that budget, and the reason PRD 1 D40 refused to put twenty answers on this screen.

### 2.2 Projector reality

| Constraint | Requirement |
| --- | --- |
| **Projectors crush contrast.** Dark greys collapse to black; subtle tints vanish. | Minimum 7:1 contrast for all text. No information carried by a subtle tint. No thin font weights — hairlines disappear. |
| **Overscan** clips the edges on some projectors and TVs. | A **5% safe-area margin** on all sides. Nothing meaningful outside it, ever. |
| **Aspect ratios vary** — 16:9 mostly, 16:10 and 4:3 exist. | Design for 16:9. On other ratios, **letterbox the 16:9 stage** rather than reflowing. A layout that reflows per projector cannot be designed or tested. |
| **Colour reproduction is poor and inconsistent.** | Team colours come from the curated palette (PRD 1 §9.3), and colour is **always paired with the team name** (PRD 1 §9.5) — never the sole identifier. |
| **Ambient light**, not a dark cinema. | A **dark background with light text** at high contrast. Light backgrounds wash out badly and make a projector's black level look grey. |

### 2.3 No chrome, ever

The audience must never see application furniture.

- No navigation, no buttons, no scrollbars, no focus rings, no toasts.
- **The mouse cursor is hidden** after 2 s of inactivity.
- The language switcher appears **only** on mouse movement, then fades (PRD 1 §9.4).
- **Nothing on this screen is scrollable.** If content doesn't fit, the design is wrong
  — content is fitted (§2.4) or split across beats, never scrolled.
- Errors are calm and wordless where possible (§14).

### 2.4 Text is fitted, not sized

Question prompts vary from 3 words to 3 sentences, and **Dutch runs 20–30% longer than
English** (PRD 1 §9.2, which sets NL as this surface's layout baseline).

So prompt text is **fitted to its box** — scaled down within a clamped range until it
fits, rather than set at a fixed size. Two rules:

- The clamp floor is §2.1's **4vh absolute minimum**. Text that would need to go smaller
  than that does not get smaller: it is a content problem, and PRD 2 §10's pre-flight
  warns about over-long prompts at authoring time instead.
- Fitting is **deterministic and layout-only** — same string, same box, same result. No
  animation of the fit, or text visibly jumps on every re-render.

---

## 3. The stage model

The screen renders exactly one `stage` from `MainScreenView` (protocol §5.2). Stages are
mutually exclusive and there is no shared frame between them — no persistent header, no
sidebar. Each stage owns the whole safe area.

| Stage | When | §  |
| --- | --- | --- |
| `WAITING_FOR_PLAYERS` | Before the game starts | §4 |
| `ROUND_INTRO` | A round opens | §5 |
| `QUESTION` | A question is open, locked or revealed | §6–§8 |
| `JEOPARDY_BOARD` | Between tiles in a Jeopardy round | §9 |
| `LEADERBOARD` | Between rounds, or on demand (PRD 3 §10.1) | §10 |
| `BREAK` | The interval | §11 |
| `FINALE` | The `DSMTW_FINALE` round | §12 |
| `FINISHED` | The game has ended | §10.2 |

**Why no persistent frame:** at §2.1's size budget, a header costs 10–15% of the vertical
space on every stage, permanently, to display something the room does not need. The join
code is the only candidate, and it earns its place on just three stages (§4, §10, §11).

---

## 4. `WAITING_FOR_PLAYERS`

On screen while the room fills. This is the first impression and it does real work:
getting twenty people onto the right URL.

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│                      Pub Quiz #4                           │
│                                                            │
│      ████████████        Scan, or go to                    │
│      ██  ▄▄▄▄  ██        kwiz.local:3000                   │
│      ██  ████  ██                                          │
│      ████████████        and enter                         │
│                                                            │
│                          7 K M Q 2 X                       │
│                                                            │
│   ● Quizzly Bears   ● The Quizinart   ○ Norfolk & Chance   │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

- **The code is the largest element after the title** — letter-spaced, in a font where
  `0/O`, `1/I` and `5/S` are unmistakable. It is read aloud across a noisy room and typed
  by someone squinting. (The alphabet already excludes the worst offenders — PRD 1 §8.10 —
  but the typeface must not reintroduce ambiguity.)
- **The QR and the typed URL are equal partners.** Camera QR scanning fails often enough
  — old phones, cracked screens, bad light — that a text fallback is not optional.
- **Teams appear as they join**, filled dot for joined, hollow for not. This is social
  pressure that works: a table sees its name still hollow and does something about it.
- **No count of how many are missing.** The room can see. A number invites announcing it,
  which pressures a table that's just slow.
- Team names are shown at §2.1 body size, so the list is capped at what fits — beyond
  ~12 teams it becomes a two-column grid, then names only without dots.

### 4.1 Arming playback and fullscreen

Browsers block audio and video autoplay without a user gesture, and `requestFullscreen`
needs one too (PRD 1 §14's stated risk). One click satisfies both.

```
        ┌──────────────────────────────────┐
        │   Click anywhere to start        │
        │                                  │
        │   This enables sound and         │
        │   fullscreen for the quiz.       │
        └──────────────────────────────────┘
```

- Shown **before** the waiting screen, on load, every time this route is opened.
- The click enters fullscreen and plays a **silent primed audio element**, which is what
  actually unlocks later programmatic playback.
- **Then it verifies**: the waiting screen shows a small `♪ sound ready` confirmation. A
  master who is going to discover a muted projector should discover it while the room is
  still filling, not during the music round.
- If arming fails, the waiting screen says so plainly — this is the one place a technical
  message is acceptable, because the audience is still arriving and the master needs it.
- **Display sleep on this machine is an OS setting, not an app concern.** A screensaver
  mid-quiz would kill the projection, but this is the master's own laptop on mains power —
  the setup checklist covers it (PRD 1 §14). Keeping it awake in software is scoped to
  player devices only (D48), where the app has no other option.

---

## 5. `ROUND_INTRO`

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│                       ROUND 2                              │
│                                                            │
│                       M U S I C                            │
│                                                            │
│              10 questions  ·  100 points                   │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

Deliberately near-empty. It's on screen for a few seconds while the master introduces the
round out loud, and its job is to be readable instantly and then get out of the way.

**This is where PRD 2's O7 (per-quiz accent colour) is decided: no.** The reasoning is
specific to this surface — **colour here is reserved for team identity.** Team colours are
the only colour carrying meaning (PRD 1 §9.5), they are already constrained to a palette
guaranteeing mutual distinguishability, and a per-quiz accent would compete with the one
thing the audience uses colour to decode. A round intro carries its weight through
typography and scale instead, which is also what survives a bad projector.

---

## 6. `QUESTION` — layout resolution

The screen "adapts to the question's attachments" (PRD 1). Rather than a general layout
engine, there are **five named layouts** and a deterministic resolver. Five cases can be
designed, reviewed and tested; a general system cannot.

| Layout | Chosen when | Shape |
| --- | --- | --- |
| `TEXT` | No visible attachments | Prompt centred, fitted, maximum size |
| `HERO` | Exactly one image or video | Media dominant; prompt in a band above |
| `GRID` | 2–4 images | Prompt band + 2×1 / 2×2 media grid |
| `AUDIO` | Audio, and no image or video | Prompt + the audio presence element (§6.1) |
| `SPLIT` | Audio *and* an image, or >4 images | Prompt band, media left, audio element right |

```
TEXT                          HERO
┌────────────────────┐        ┌────────────────────┐
│                    │        │  Name this song    │
│   Who released     │        ├────────────────────┤
│   "Kid A" in       │        │                    │
│   2000?            │        │      [ image ]     │
│                    │        │                    │
│              10 pt │        │              20 pt │
└────────────────────┘        └────────────────────┘
```

- **Resolution is by attachment kind and count only** — never by prompt length. A layout
  that changes because someone edited a word is unpredictable to author against.
- **Only *visible* attachments count.** Audio and video never reach player devices (D27),
  but they are all visible here; the resolver uses this screen's visibility rules.
- **Points are shown small and low** — PRD 1 asks for them "somewhere, not prominent."
  They still obey §2.1's 4vh floor: not prominent is not the same as unreadable.
- **The question number is not shown.** It costs a line of the §2.1 budget to tell the
  room something the master says out loud, and it makes skipped questions (D46) visibly
  conspicuous — "why did we jump from 4 to 6?"
- **Submission progress is not shown either** — no "3 of 4 answered", no per-team dots.
  It is pressure aimed at whichever table is slowest, delivered to the whole room, and the
  only action it invites is rushing a good answer. The master has it on control (PRD 3
  §5.1), which is where the pacing decision actually gets made. The field is absent from
  the payload rather than merely unrendered (protocol §5.2).

### 6.1 The `AUDIO` layout

A music round is a large slice of pub quizzes and the screen has **nothing to show**. So
audio gets a designed presence rather than an empty stage:

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│                    Name this song                          │
│                                                            │
│             ▁▃▅▇▅▃▁▃▅▇▆▄▂▁▃▅▆▇▅▃▁                          │
│                                                            │
│                    ●───────────────  0:34                  │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

- **A gentle animated equaliser**, driven by a fixed loop rather than real audio
  analysis. It has one job: prove sound is playing. Real spectrum analysis needs Web Audio
  wiring, looks noisy at projector scale, and buys nothing the room needs.
- **Elapsed time counts up, and the progress bar does not reveal the track's length.**
  Total duration is a hint about the answer — a 2:14 track narrows the field — so it stays
  off this screen. It's on control (PRD 3 §5.1) where the master needs it.
- **The equaliser going still is the "no sound" signal.** If the room can't hear anything
  but the screen shows movement, someone shouts about the volume within seconds. That is
  the diagnostic §4.1's arming step cannot provide once the quiz is underway.

### 6.2 Video

Video fills the media area with no controls, no progress bar and no title overlay —
autoplay-style presentation, master-triggered (D27). It is **never** stretched:
letterboxed within the media area, preserving aspect ratio.

---

## 7. Timer

```
                                    ┌──────┐
                                    │  18  │        ring depleting
                                    └──────┘
```

- **Top-right of the safe area, consistent across every stage that has one.** A timer
  that moves is a timer people hunt for.
- **A depleting ring plus the number.** The ring is readable peripherally — someone
  looking at their phone catches the shape changing — and the number is exact.
- **Subordinate to the question.** Large (up to 12vh) but never the biggest thing; the
  question is what the room is meant to be reading.
- **The last 5 seconds shift colour and pulse.** Colour alone is insufficient at §2.2's
  contrast reality, so motion carries it.
- **At zero it does not disappear.** It shows `TIME` and holds — the question is still
  open server-side (D8), teams' auto-submits are still arriving, and a vanishing timer
  would read as "the question is over."
- **Paused during buzz adjudication** (D35): the ring stops and shows `⏸`. The room
  needs to see that the clock isn't running while the master judges, or a team that
  buzzed feels cheated of the remaining time.

---

## 8. The reveal

D40's two beats, plus P5's timing.

### 8.1 Free text and buzzer

```
t=0     the correct answer replaces the prompt area, at hero scale
        ┌──────────────────────────────┐
        │        Radiohead             │
        └──────────────────────────────┘

t=?     the master spotlights an answer (PRD 3 §5.3) — arrives whenever they choose
        ┌──────────────────────────────┐
        │        Radiohead             │
        │                              │
        │  ● Norfolk & Chance said     │
        │    "Radio Head"       ✗      │
        └──────────────────────────────┘
```

- **Beat 2 has no timing** — it is the master pressing `[Show on screen]`, which is the
  whole point of spotlighting (D40): they read it out and it appears as they do.
- **A spotlit answer gets real space and hero-adjacent scale.** One curated answer shown
  large is the entire justification for not dumping twenty; showing it small would waste
  the trade.
- **Verdict marks (`✓`/`✗`) appear only when the answer has been judged.** An unjudged
  spotlit answer shows no mark rather than a wrong one — validation may legitimately be
  outstanding (D42).
- Multiple spotlights stack up to **two**; a third replaces the oldest. Beyond two,
  §2.1's budget is gone.

### 8.2 Multiple choice

```
t=0.0    A  Radiohead   ✓          correct option marked
         B  Blur
         C  Oasis

t=1.5    A  Radiohead   ✓  ●●●     team dots animate in (P5)
         B  Blur           ●
         C  Oasis
```

The 1.5 s delay is P5: the room registers *what the answer was* before hunting for its
own team's dot. Options keep their original order — never re-sorted to put the correct
one first, which would break the mapping to what teams saw while answering.

### 8.3 Buzz display

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│              ● NORFOLK & CHANCE                            │
│                                                            │
│                    4.21s                                   │
│                                                            │
│         Quizzly 4.28s  ·  The Quizinart 5.90s              │
└────────────────────────────────────────────────────────────┘
```

- **The team name dominates**, in their colour, at hero scale. This is the moment; it
  needs no explanation.
- **Times are shown to 2 decimal places** — PRD 1 asks for buzz timing, and `4.21` vs
  `4.28` is the drama. Whole seconds would flatten a photo finish into a tie.
- **Other buzzes are listed below at body size**, so a team that lost by 70 ms can see it.
  This is the record that settles arguments (D35).
- **A locked-out team is struck through** rather than removed — the room should see who
  has already had a go.
- On a denial the display flips to the reopened state loudly enough to be caught
  peripherally: the buzzed team's name struck through, `BUZZERS OPEN` at hero scale.

---

## 9. `JEOPARDY_BOARD`

```
┌────────────────────────────────────────────────────────────┐
│   ● NORFOLK & CHANCE pick                                  │
│                                                            │
│   GEOGRAPHY   FILM      MUSIC     SPORT     RANDOM         │
│      100       100       100        —         100          │
│      200        —        200       200        200          │
│      300       300        —        300        300          │
│      400       400       400       400         —           │
│      500       500       500       500        500          │
└────────────────────────────────────────────────────────────┘
```

- **The current picker is stated at the top in their colour** (D30). It's the only
  instruction the room needs, and it prevents the "whose turn is it?" pause.
- **Used tiles become `—`, not blank.** A blank cell reads as a rendering fault from 10 m;
  a dash reads as spent.
- **Values are the largest element**, since that's what teams call out ("Music for 300").
  Category names are smaller and set in caps.
- **Category names must fit without truncation.** At 5 categories on a 16:9 screen each
  column is ~18% of width, so authoring-side length matters — PRD 2 §10's pre-flight warns
  on category names that will not fit here.
- Uneven columns (data model §4.3) render as short columns. No filler.
- **Tile prompts never appear on this screen** until the tile is opened — PRD 1 §7
  invariant 5, and the payload simply doesn't carry them.

---

## 10. `LEADERBOARD`

```
┌────────────────────────────────────────────────────────────┐
│                     AFTER ROUND 2                          │
│                                                            │
│   1   ● Quizzly Bears           340    ▲2                  │
│   2   ● The Quizinart           310    ▼1                  │
│   3   ● Norfolk & Chance        290    ▼1                  │
│   4   ● Team 4                  150    —                   │
│                                                            │
│   scores provisional · 3 answers still being checked       │
└────────────────────────────────────────────────────────────┘
```

- **Rank movement since the last leaderboard** (`▲2`) is the cheapest drama available and
  costs one number. It is what makes a leaderboard a moment rather than a table.
- **Ties share a rank and show it** (D32) — both rows read `2`, and neither is silently
  ordered above the other.
- **`scores provisional`** appears whenever validations are outstanding (PRD 3 §6.2). The
  room must not be told a standing is final when it isn't — and it also nudges the master.
- **Above ~10 teams it becomes two columns**, then drops the movement indicator, then
  compresses to rank/name/score. It **never scrolls** (§2.3) and never shows a partial
  list: an audience member whose team is missing assumes a bug.
- Also reachable mid-round on demand (PRD 3 §10.1), where the heading reads
  `CURRENT SCORES` rather than `AFTER ROUND n`.

### 10.1 Score adjustment banner

D25: announced with the reason, transient, never obscuring question content.

```
                    ┌──────────────────────────────────────┐
                    │ ● Quizzly Bears  +5                  │
                    │   best heckle of the night           │
                    └──────────────────────────────────────┘
```

- **A lower band, ~6 s, then gone.** Occupies dead space at the bottom of whatever stage
  is showing; if a question is open or revealing it goes *below* the content, never over it.
- Shows team colour, name, signed delta, and the reason when given.
- Suppressed entirely when the master ticked "don't announce" (D25), and never shown for
  adjustments made before `GAME_STARTED` or after `GAME_FINISHED`.
- A revoked adjustment (D41) produces **no banner** — undoing a mistake is not an
  announcement, and re-announcing it would draw attention to the error.

### 10.2 `FINISHED`

The winner gets a dedicated moment before the full standings: name at maximum scale, in
team colour, then the leaderboard settles in beneath. On a tie for first, both names
share it — D32 all the way to the end.

The final leaderboard then **stays up indefinitely**. People photograph it, and the
screen has nothing better to do.

#### After a `DSMTW_FINALE` — two tabs (D51)

When the game ended with a finale, the ranking came from survival, not points. Points still
happened, though, and they are still interesting — so the screen carries **two tabs**, master-
switchable from control:

```
   ┌─ RESULT ─┬─ POINTS ─┐
   │ 1 ● Norfolk & Chance    survived  41s left
   │ 2 ● Quizzly Bears       out 21:14
   │ 3 ● The Quizinart       out 21:02
   │ 4 ● Team 4              out 20:51
   │ ─────────────────────────────────────────
   │ 5 ● Late Arrivals       did not play the finale
```

- **`RESULT` is the default and decides the game.** Survival order, with the winner's
  remaining seconds shown because "won with 41 seconds left" is the story.
- **`POINTS` shows the pre-finale totals** — the leaderboard as it stood when points were
  converted. Useful, and often the team that scored highest is *not* the one that won, which
  is worth letting the room see.
- **Non-finalists sit below the finalists**, ranked among themselves by points, labelled so
  nobody reads their position as an elimination.
- Tabs are on the projected screen but **switched from control**, since this surface has no
  controls (§2.3).

---

## 11. `BREAK` — the interval

```
┌────────────────────────────────────────────────────────────┐
│                       BACK IN                              │
│                        4:37                                │
│                                                            │
│   1   ● Quizzly Bears           340                        │
│   2   ● The Quizinart           310                        │
│   3   ● Norfolk & Chance        290                        │
│   4   ● Team 4                  150                        │
│                                                            │
│                  7 K M Q 2 X                               │
└────────────────────────────────────────────────────────────┘
```

A pub quiz has a break, and leaving the last question on screen for fifteen minutes looks
broken.

- **A counting-down clock, not a static message.** It does work a message doesn't: it gets
  people back to their tables. The master enters the duration when starting the break.
- **A duration is optional.** A master who doesn't know how long shows `BACK SHORTLY` with
  no clock, rather than inventing a number they'll then overrun.
- **The same countdown appears on every player device** (PRD 5). The projector is the
  screen people have walked away from; the phone in their pocket is the one that actually
  reaches them.
- **`m:ss` here, unlike the finale's whole seconds** (D57). A break is minutes long and nobody is doing arithmetic on it; `4:37` is the natural reading. The finale's format exists for subtraction, which does not apply here.
- **`resumesAt` is an absolute server timestamp** — same principle as question timers (D7),
  so a screen that connects halfway through the break shows the correct remaining time
  rather than restarting the countdown.
- **Reaching zero changes nothing on the server.** It holds at `0:00` and the heading
  becomes `STARTING SOON`; the master resumes when the room is actually back. Consistent
  with D8 — nothing in this product auto-advances the game.
- **Standings sit beneath**, because they're what people want to look at during a break
  anyway, and **the join code returns** — a break is exactly when a late arrival has time
  to join (§16 O2).

---

## 12. `FINALE` (D50)

The climax, and the busiest this screen ever gets: five keyword tiles, a clock per finalist,
and whose turn it is — all at §2.1's size floor.

```
┌────────────────────────────────────────────────────────────┐
│  What do you know about Michael Jackson?          Q3 / 6    │
│                                                            │
│   1  ████████                                              │
│   2  Thriller                          ● Quizzly           │
│   3  ██████  ████                                          │
│   4  Moonwalk                          ● Norfolk           │
│   5  ████  ████████                                        │
│                                                            │
│   ● NORFOLK & CHANCE   84   ← guessing                     │
│   ● Quizzly 138   ● Quizinart 155   ● Team 4 91            │
│   ● Late Arrivals  OUT                                     │
└────────────────────────────────────────────────────────────┘
```

### 12.1 The blurred tiles (D53)

**The payload never contains an unmarked keyword's text** — only `wordLengths`. So a tile is
*drawn* from that shape rather than being blurred text:

- `"Thriller"` → one block, 8 characters wide
- `"i like cows"` → **three blocks**, 1 / 4 / 4 wide, with real word gaps

That per-word structure is the point: the room can see it's a three-word phrase with a
one-letter first word, which is a genuine and fair hint. Rendering one long bar would throw
that away, and rendering the real text blurred would leak it to anyone with devtools.

On marking, the tile **crossfades from blocks to the text** with the crediting team's name
and colour beside it. Revealed-unguessed tiles resolve the same way but with no team — the
absence is the point, so they get no marker rather than a placeholder one.

### 12.2 Clocks

- **The team on turn is on its own line, larger, in its colour**, with `← guessing`. That
  team's clock is the one the room is watching.
- **Every other finalist's clock is on one strip below.** All of them, always — a team about
  to be eliminated by someone else's correct guess is the tensest thing on screen and must be
  visible.
- **Whole seconds, never `m:ss`** (D57). A room watching a 20-second penalty land needs to see `84` become `64`, not perform a base-60 conversion. It is also the largest legible format at §2.1's scale — two or three digits rather than four glyphs and a colon.
- **Counted down client-side from `turnStartedAt`** (D52). The server pushes no ticks; a
  reconnect mid-turn resumes at the right number because the arithmetic is in the payload.
- **Between turns nothing ticks.** All clocks hold, and the `← guessing` marker disappears —
  the room can see that the handover isn't costing anyone.
- **Eliminated teams read `OUT`**, greyed, and stay listed. Removing the row would erase the
  drama of who has already gone.
- **Under 15 seconds a clock pulses.** Colour alone is unreliable at §2.2's contrast (this is
  the same reasoning as §7's timer, at a threshold suited to a bank of seconds rather than a
  question timer).

### 12.3 The penalty moment

When a keyword is marked, every other finalist loses time. That must be *seen*, or the room
cannot follow why a clock jumped:

- The marked tile resolves to text.
- **Every other clock flashes and visibly subtracts** — a brief `−20s` beside each, then the
  new value. Counting down smoothly would hide the size of the hit; a jump with a label shows
  it.
- Eliminated teams don't flash. They've stopped paying.

### 12.4 Elimination

A clock reaching zero gets a moment of its own: the team's name at hero scale, in colour,
`OUT` beneath it, held briefly before the screen returns to the turn.

This is worth the interruption for two reasons. It is one of the few genuinely dramatic beats
in a quiz, and elimination can happen **off-turn** — a penalty can take a waiting team to
zero — so without an announcement the room would just notice a row had greyed out.

---

## 13. Sound

Sound follows the same rule as motion (§15): **it carries a message or it doesn't exist.**

| Sound | When | Why it earns its place |
| --- | --- | --- |
| **Buzz** | A team buzzes | Marks an instant. Nothing visual replaces a sound for "right now" — and half the room is looking at a phone (§1.1) |
| **Timer expiry** | The countdown hits zero | Answers are closing; the visual ring alone is missed by anyone not looking up |

**Nothing else.** No reveal sting, no round-intro fanfare, no correct/incorrect chime. A
venue usually has its own atmosphere and often its own music: decorative audio competes
with it, dates quickly, and is the first thing a master asks to switch off.

- **Buzz sound plays on the main screen only** (protocol P3). Twenty phones buzzing a
  fraction of a second apart is the same failure as twenty phones playing the same song.
- **Both sounds depend on §4.1's arming.** If audio was never unlocked they fail silently
  — which is the right failure, but it is also why §4.1 confirms `♪ sound ready` before
  the quiz starts.
- **A global mute lives in PRD 2 §16 settings**, not on this screen. A venue with its own
  music needs it, and hunting for OS volume mid-quiz is not acceptable.
- Sounds are **short and unbranded** — a tone, not a jingle. This screen is in someone
  else's pub.

---

## 14. Failure and edge states

The governing rule: **the room must never see a technical failure.** They will read a
scary message as "the quiz is broken", and the master then spends five minutes on
reassurance.

| Situation | What the room sees |
| --- | --- |
| **Stream disconnected** | Nothing, for the first 3 s — reconnection is usually faster than that (protocol §3.2). Then a small, calm, wordless pulse in a corner. Never a modal, never red, never the word "error". The last good view stays on screen: it is still true. |
| **Reconnected** | The pulse disappears. No "reconnected!" announcement — nobody knew it was gone. |
| **Media fails to load** | The layout resolves as if the attachment weren't there (`HERO` degrades to `TEXT`). No broken-image icon, no placeholder. The master is told on control instead (PRD 3 §11). |
| **Game not found / deleted** | A neutral full-screen `kwiz` mark. No error text. |
| **Game abandoned** | Whatever was showing, held. No announcement — the master handles the room. |
| **Question skipped** (D46) | It never appeared, so nothing changes. This is why §6 omits question numbers. |
| **Server restarted** | Momentary reconnect, then the correct current view. Indistinguishable from a brief network blip (D4, D38). |

---

## 15. Motion

Motion on this surface has one purpose: **making a change noticeable to someone who was
looking at their phone** (§1.1).

| Rule | Reason |
| --- | --- |
| Stage transitions are 250–400 ms and directional | Long enough to be caught peripherally; short enough not to delay the room |
| Only one thing animates at a time | Two simultaneous animations at projector scale read as a glitch |
| Nothing loops except the audio equaliser (§6.1) | Looping motion in peripheral vision is genuinely irritating over two hours |
| No motion during a question that is open | The room is reading and thinking; movement is a distraction with no message |
| Numbers count up rather than snapping | A score changing from 290 to 340 should be seen changing |
| `prefers-reduced-motion` is honoured | Crossfades replace movement; the timer ring becomes stepwise |

---

## 16. Question log

| # | Question | Recommendation |
| --- | --- | --- |
| ~~O1~~ | ~~Sound effects~~ | **Resolved → §13.** Buzz and timer-expiry only — sounds that carry a message. No reveal sting. Global mute in PRD 2 §15. |
| ~~O2~~ | ~~Persistent join code~~ | **Resolved: no.** Shown on `WAITING`, `LEADERBOARD` and `BREAK` only. A permanent code is chrome (§2.3) costing §2.1 budget on every stage, and the master can toggle the leaderboard on demand (PRD 3 §10.1). |
| ~~O3~~ | ~~Break stage~~ | **Resolved: yes, with a master-set countdown** (§11). Absolute `resumesAt`; reaching zero does not auto-resume. |
| ~~O4~~ | ~~Fullscreen/kiosk~~ | **Resolved: §4.1 covers it.** One click arms audio and fullscreen together. If fullscreen is exited mid-game, re-arm silently on the next click — never show the room a prompt. |
| ~~O5~~ | ~~Second main screen~~ | **Resolved: supported, no code.** Two browsers on `/screen/:gameId` receive the same view, because nothing about the `MAIN_SCREEN` audience is per-connection (protocol §2.1). Worth one test. |
| ~~O6~~ | ~~Spotlight attribution~~ | **Resolved: named, in team colour.** The laugh is social and needs an owner. The editorial safeguard is that the master chose to show that specific answer (D40). |

---

## 17. Next

[PRD 5 — the player device](./05-player.md): the last surface. Where D43's submission
finality, D44's select-then-submit, D45's shared drafts and the buzzer's one-tap
immediacy all have to work on a phone passed between four people.
