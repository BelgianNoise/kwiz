# PRD 3 — Master Control (laptop)

**Status:** Draft · **Last updated:** 2026-08-04

The quiz master's control desk during a live game, on their laptop screen. The
projected screen is [PRD 4](./04-main-screen.md); authoring and review are
[PRD 2](./02-config.md).

Governed by [PRD 1](./01-main.md); the [data model](../spec/data-model.md) and
[protocol](../spec/protocol.md) specs are normative over anything here.

Route: `/control/:gameId` (D21 — no route means "the current game").

---

## 1. What this surface is for

PRD 1 G4: *"At every moment, the control screen shows exactly what needs their
attention, and nothing else competes for it."*

### 1.1 The operating context

Sharper than PRD 2's, and it governs every decision below:

> The master is **standing**, talking to a room, holding a microphone. They look at this
> screen in **two-second glances**. Music is playing. Someone is shouting a question at
> them. They have one hand free.

Three rules follow, and they are not negotiable:

1. **One decision at a time, chosen by the server.** The master must never have to work
   out *what needs me now* — that's game logic, it lives in `packages/domain`, and it
   arrives pre-computed as `attention` (protocol §5.4).
2. **Two-second glanceability.** The primary action must be identifiable and hittable
   without reading a sentence.
3. **No confirmation dialogs during live play**, except for genuinely irreversible acts
   (end game, abandon). Everything else is correctable — a wrong accept is fixed by
   re-validating (protocol §4.3), a wrong adjustment by revoking it (D41). A confirm
   dialog costs a real second every time to prevent a mistake that costs nothing to undo.

### 1.2 Why the master's screen, not the projector

This surface exists because a set of things must reach the master and **must not reach
the room**: correct answers before reveal, `masterNotes`, unopened Jeopardy prompts,
who still owes a validation. Those are enforced server-side (PRD 1 §7); this document
is about arranging what's left.

---

## 2. Layout

One frame, four regions, stable for the whole game. Nothing moves between states — only
the attention zone's contents change. A layout that reflows as the game progresses
forces the master to re-locate the button they need, every time.

```
┌──────────────────────────────────────────────────────┬──────────────────┐
│ Pub Quiz #4    Round 2 of 5 · Music    7KMQ2X   [⋯]  │  SCORES          │
├──────────────────────────────────────────────────────┤                  │
│                                                      │ ● Quizzly   340  │
│                    ATTENTION ZONE                    │ ● Quizinart 310  │
│                                                      │ ● Norfolk   290  │
│         whatever needs the master right now           │ ● Team 4    150  │
│              — or the leaderboard, big                │                  │
│                                                      │ ⚡ live · 4/4    │
│                                                      │ [+ Adjust]       │
├──────────────────────────────────────────────────────┤                  │
│ ◀ Q1✓ Q2✓ Q3✓ [Q4] Q5 Q6⚠ Q7 Q8 Q9 Q10 ▶            │                  │
└──────────────────────────────────────────────────────┴──────────────────┘
```

| Region | Contents | Why fixed |
| --- | --- | --- |
| **Header** | Quiz, round *n* of *m*, join code, overflow menu | Orientation after a glance away; the code because someone always asks for it again |
| **Attention zone** | The one thing needing the master, or the leaderboard when nothing does | The only region that changes |
| **Right rail** | Teams with live scores, device/connection status, adjust-score entry | PRD 1: *"if there is no input needed, the total scores can be shown prominently"* — and the master is asked "what's the score?" constantly |
| **Timeline** | Every question in the round, with state markers | Answers "where are we?" and "what did I skip?" without navigating |

### 2.1 The timeline

`Q1✓ Q2✓ Q3✓ [Q4] Q5 Q6⚠ Q7` — current question bracketed, done ticked, and `⚠` marking
a question that failed pre-flight (PRD 2 §10's *play anyway*).

**Clicking a past question navigates the timeline only — it does not reopen anything.**
Questions are never re-opened for answers (§9.2). This is a read-only jump to see what
happened, and the distinction has to be visually obvious or a master will reopen a
question by accident in front of a room.

---

## 3. The attention model

`attention` is a discriminated union computed server-side (protocol §5.4). The client
renders it and never derives it.

### 3.1 Priority

Exactly one attention state is active. When several conditions hold, the server picks by
this order — highest first:

| Priority | State | Rationale |
| --- | --- | --- |
| 1 | `ADJUDICATE_BUZZ` | The room is silent, waiting. Nothing is more urgent. |
| 2 | `FINALE_TURN` | Clocks are running and every second costs a team. Only a buzz outranks it, and the two cannot co-occur. |
| 3 | `SCORE_DO` | A challenge just finished; teams are watching for a verdict. |
| 4 | `BREAK_TIE_FOR_PICK` | The Jeopardy board is stalled until this resolves. |
| 5 | `PICK_FINALISTS` | The finale cannot start until it resolves, but no clock is running yet. |
| 6 | `VALIDATE_QUESTION` | Needed before scores are honest, but the room isn't blocked. |
| 7 | `ADVANCE` | Nothing is wrong; the master decides the pace. |
| 8 | `NONE` | Show the leaderboard. |

**The UI never shows two competing primary zones.** If something lower-priority is
waiting, it appears as a quiet count in the right rail (*"3 answers to validate"*), never
as a second call to action.

### 3.2 When something arrives mid-task

If a buzz lands while the master has the adjust-score popover open, the popover is **not
dismissed** — losing half-typed input to an interruption is worse than a moment's delay.
The attention zone updates behind it and the popover gets a one-line notice:
*"A buzz came in — finish or cancel."*

---

## 4. Pre-game (`SETUP`)

```
┌─ ATTENTION ─────────────────────────────────────────────┐
│                                                         │
│   Waiting for players                                   │
│                                                         │
│   ●  Quizzly Bears      1 device   ready                │
│   ●  The Quizinart      1 device   ready                │
│   ●  Norfolk & Chance   —          not joined yet        │
│   ●  Team 4             2 devices  ready                │
│                                                         │
│   2 of 4 teams have joined.        [+ Add team]          │
│                                                         │
│              [  Start the quiz  ]                        │
└─────────────────────────────────────────────────────────┘
```

- **Which teams haven't joined is the whole content of this screen.** It's what the
  master is actually doing: chasing the table that hasn't scanned the QR yet.
- `[Start the quiz]` is enabled even with teams unjoined — PRD 1 flow step 10 explicitly
  does not block joins after start, and a team that's still ordering drinks shouldn't
  hold up the room. No confirmation, per §1.1.
- The QR code and join URL live on PRD 2 §12's game detail page, which is where the
  master has been while people arrive. Control shows the code in its header; it does not
  duplicate the QR — this screen is for starting, not for joining.

---

## 5. Question flow — `QUESTION_SET`

### 5.1 Question open

```
┌─ ATTENTION ─────────────────────────────────────────────┐
│  Q4 · FREE TEXT · 10 pts                          18s ⏱  │
│                                                         │
│  Who released "Kid A" in 2000?                          │
│                                                         │
│  Answer   Radiohead                                     │
│           also: "radiohead - kid a", "kid a"            │
│                                                         │
│  📝 Accept "Everything In Its Right Place" too           │
│                                                         │
│  🎵 kid-a.mp3   ▶ ──────────●───────  1:12 / 2:14       │
│                                                         │
│  Answers so far                          3 of 4 teams   │
│   ● Quizzly Bears      Radiohead       auto ✓           │
│   ● The Quizinart      radiohead       auto ✓           │
│   ● Norfolk & Chance   Radio Head      [Y] [N]          │
│   ● Team 4             — still answering                │
│                                                         │
│              [  Close answers  ]                         │
└─────────────────────────────────────────────────────────┘
```

- **The correct answer is shown while the question is open.** This is the master's
  screen; they need it to field "is 'Radio Head' ok?" shouted from the back before
  they've even locked.
- **`masterNotes` are visually distinct** (`📝`) so the master's own reminder doesn't read
  as part of the question.
- **Media playback is controlled here, never on the main screen.** The master has the
  scrub bar; the room has the speakers. Playback is always master-triggered (D27, PRD 1
  §14's autoplay risk).
- **Answers are listed as they arrive, and judgeable immediately** (D42). The master is
  usually waiting on one slow team; that dead time is the cheapest moment in the whole
  night to clear a `Radio Head`. By the time they close and reveal, there is often
  nothing left to judge.
- **A judged answer stays judged.** Submission is final (D43), so nothing the master
  clears can come back — which is what makes judging early safe rather than provisional.
  New rows only ever *append*, as slower teams submit.
- **Teams still answering are shown as such**, not as blanks. "Who am I waiting for?" is
  the other question the master has mid-question.
- **The timer is shown but subordinate**, because it is advisory (D8): it does not close
  the question. `[Close answers]` is the only thing that locks, and it stays available and
  identical whether the timer has expired or not.

**After the timer expires** the display changes to `Time up · 4 of 4 submitted` and
`[Close answers]` gets primary emphasis — but nothing happens automatically. This is
where D8's *"the master is prompted to start the next question"* is realised.

### 5.2 Locked → reveal → score

At lock, the answer list stays exactly where it was, with any unjudged rows still
carrying `[Y] [N]`. Nothing moves, and there is no separate validation screen to enter:

```
Q4 locked · 4 of 4 answered · 1 unjudged        [  Reveal answer  ]
```

`[Reveal answer]` is **never blocked by outstanding validations** (D42, and §1.1's
no-dialogs rule). An unjudged answer simply carries no verdict — the reveal still shows
the correct answer, which is the part the room is waiting for. The count is stated so the
choice is informed rather than accidental.

### 5.3 The reveal, and spotlighting

The reveal is two beats (D40): the correct answer, then whatever the master chooses to
show. **Teams' answers are not broadcast wholesale** — the master curates.

```
Q4 revealed · showing "Radiohead" to the room

  ● Quizzly Bears      Radiohead      ✓        [ Show on screen ]
  ● The Quizinart      radiohead      ✓        [ Show on screen ]
  ● Norfolk & Chance   Radio Head     ✓        [ ● On screen   ]   ← spotlit
  ● Team 4             radiohed       ✗        [ Show on screen ]

                                    [ Next question ]
```

- **`[Show on screen]` per answer** toggles `ANSWER_SPOTLIT` (protocol §4.3). This is how
  the funniest wrong answer gets its moment without a 20-row table nobody can read at
  10 m, and it is what a real quizmaster does anyway: pick one and read it out.
- **Multiple choice needs no spotlighting** — the main screen shows the full distribution
  as team-colour dots on each option (D40). Four buckets fit where twenty rows do not.
- **Buzzer questions have nothing to spotlight**: one team answered, out loud.
- Spotlights clear when the next question opens.

### 5.4 Deferring validation

Validation may still be deferred entirely — D6's original flow. Anything left unjudged at
`ROUND_CLOSED` surfaces as `VALIDATE_QUESTION` (§6), and the right rail carries a running
count throughout so it cannot be forgotten. The between-round leaderboard is marked
*provisional* while anything is outstanding.

The practical effect of D42 is that **this sweep is usually short or empty**, because the
master cleared most of it during the dead time in §5.1. It remains the safety net rather
than the main path.

---

## 6. The round-end validation sweep

The safety net for anything not already judged inline (§5.1). With D42 this is often
short or empty — but it must exist, because a master running a fast round will defer, and
D6 explicitly promises this screen.

### 6.1 Grouped by question, not one answer at a time

The sweep presents **all teams' answers for one question together** — pending ones
actionable, already-decided ones as context:

```
┌─ ATTENTION ─────────────────────── question 2 of 3 ─────┐
│  Q1 · Who released "Kid A" in 2000?                     │
│  Accepted: Radiohead · "radiohead - kid a" · "kid a"    │
│  📝 Accept "Everything In Its Right Place" too           │
│                                                         │
│   ● Quizzly Bears      Radiohead        auto ✓  10      │
│   ● The Quizinart      radiohead        auto ✓  10      │
│   ● Norfolk & Chance   Radio Head              [Y] [N]  │
│   ● Team 4             radiohed  ⚠ not confirmed [Y] [N]│
│                                                         │
│                                       [ Next question ] │
└─────────────────────────────────────────────────────────┘
```

**Grouping is the important part.** One-answer-at-a-time would be simpler to build and is
what protocol §5.4 currently specifies — but it makes the master's real question
unanswerable. Judging `Radio Head` in isolation, they cannot see they just accepted
`radiohead` two screens ago. Side by side, the inconsistency is impossible to miss.

The same grouping is used inline in §5.1, so this is one component in two places rather
than two designs.

It is the same argument as PRD 2 §13.1's review grid, and it respects D39's bounded-view
rule because a group is O(teams) — at most 20 rows.

Protocol §5.4 carries this as `attention.VALIDATE_QUESTION` with `items:
ValidationItem[]` — one entry per team.

- **Auto-graded answers are shown greyed but present**, not hidden. They are the reference
  the master judges against, and hiding them removes the entire benefit.
- **`⚠ not confirmed`** is D26's draft-only marker — the team never sent a final
  submission, which is exactly when a master would otherwise wrongly deny a half-typed
  answer.
- **An auto-graded verdict can be overridden** by clicking it. Auto-correct is not
  infallible: a master may decide `radiohead` was a lucky guess on a question about the
  band's spelling.
- **`Y` / `N` keys act on the topmost undecided row**, so the master can clear a question
  without touching the trackpad. Chosen over Enter/Escape because a binary judgement
  should not share a key with "the obvious next thing" — and `Y` and `N` are far apart, so
  a slip is unlikely to be the opposite decision.
- **Each team is judged separately** (O1), rather than collapsing identical answers into
  one decision. It costs more keystrokes, but the master keeps per-team judgement — the
  draft-only marker differs per team, and a master may have reason to treat two identical
  strings differently.
- **Identical answers are visually linked** (`hasIdenticalSibling`, protocol §5.4) — a
  soft aid so an inconsistent pair is hard to miss, without ever auto-applying a verdict.
  *Flagged as my addition; say the word and it goes.*

### 6.2 Triggering and deferral

At `ROUND_CLOSED`, every still-unvalidated answer surfaces as `VALIDATE_QUESTION`,
question by question, with `question n of m` progress — D6's *"at the end of a
QUESTION_SET round, the admin is shown each question with each team's answer"*.

**Closing a round with validations outstanding is allowed**, and closing the *game* with
them outstanding is too. Scores simply aren't final: the main screen's leaderboard carries
a *"scores provisional"* marker so the room isn't misled, and PRD 2 §13.1's review grid
remains available indefinitely. Blocking the master from moving on would be the one thing
worse than provisional scores.

---

## 7. Buzzer adjudication

The most time-critical screen in the product. The room is silent and looking at the
master.

```
┌─ ATTENTION ────────────────────────────── ⏸ timer paused ─┐
│                                                           │
│      ● NORFOLK & CHANCE          buzzed at 4.21s          │
│                                                           │
│      Answer   Radiohead                                   │
│                                                           │
│                                                           │
│        [  ✓  Correct  (Y) ]     [  ✗  Wrong  (N) ]        │
│                                                           │
│      Also buzzed   Quizzly 4.28s · Quizinart 5.902s       │
│      Locked out    —                                      │
└───────────────────────────────────────────────────────────┘
```

- **The buzzing team's name dominates**, in their colour. The master has to say it out
  loud immediately; reading it must take no effort.
- **Two buttons, nothing else competing.** No skip, no next, no reveal — those would be
  mis-clicks at the worst moment.
- **`⏸ timer paused` is stated explicitly.** D35 requires the timer to pause during
  adjudication, and the master needs to know their thinking time isn't costing the other
  teams theirs.
- **Other buzzes are listed with timings** — the record behind "who was first" and any
  dispute (D35).

### 7.1 The deny loop

On `N`, per D35, **without a second click**:

```
      ✗ Norfolk & Chance — wrong.  Buzzers are live again.

      Locked out   ● Norfolk & Chance
      Waiting for a buzz…                    3 teams can still buzz
```

- The transition is **loud** — colour, motion, and text — because the master must know
  the room is live again without reading carefully.
- **`[Reopen for everyone]`** is available here, clearing all lockouts for when the master
  simply misheard (D35 rule 5).
- **When every team is locked out**, this resolves itself to
  `ADVANCE / suggestion: 'REVEAL'` with *"Nobody got it."* — D35 rule 4's requirement that
  the master is never left with no live buzzers and no prompt.

---

## 8. `DO` questions

### 8.1 `WINNER_TAKES_ALL`

```
┌─ ATTENTION ─────────────────────────────────────────────┐
│  Q4 · Build the tallest tower · 50 pts                  │
│  📝 Hide the spare blocks behind the bar first           │
│                                                         │
│  Who won?                        tap more than one for a tie
│                                                         │
│   [ ● Quizzly Bears ]  [ ● The Quizinart ]              │
│   [ ● Norfolk & Ch. ]  [ ● Team 4 ]                     │
│                                                         │
│   [ Nobody got it ]                    [ Award 50 pts ] │
└─────────────────────────────────────────────────────────┘
```

- **Large team tiles in team colours**, selectable by tap or by number key `1`–`9`.
- **Multi-select is hinted in place** — D23 allows ties, but a master won't discover it
  without being told, and will otherwise pick one winner arbitrarily.
- **`[Nobody got it]` is a real button**, per D23: sometimes every team fails, and the
  master needs to say so decisively rather than inventing a winner.
- With multiple winners selected, the button reflects the configured payout:
  `Award 50 pts each` or `Split 50 pts` (D23).

### 8.2 `PER_TEAM_SCORE`

```
  Score each team          max 20 each              1 of 4 scored

   ● Quizzly Bears      [ 18 ]
   ● The Quizinart      [ __ ]   ← empty, not zero
   ● Norfolk & Chance   [ __ ]
   ● Team 4             [ __ ]

                                          [ Save scores ]
```

- **Tab moves down the list**; the field is numeric with the max stated. Judging eight
  teams in a row is a data-entry task and should feel like one.
- **Empty and zero look different** while entering, per D24 — a master mid-way through
  needs to see who they haven't got to, even though both resolve to 0.
- Values are clamped to `0…points` on entry rather than rejected on save.

---

## 9. Jeopardy

```
┌─ ATTENTION ─────────────────────────────────────────────┐
│  ● NORFOLK & CHANCE pick next            [ Change ▾ ]   │
│                                                         │
│   Geography    Film        Music       Sport    Random  │
│   ──────────  ──────────  ──────────  ───────  ──────── │
│    100 ····    100 ····    100 ····    ✓        100 ····│
│    200 ····    ✓           200 ····    200 ···· 200 ····│
│    300 ····    300 ····    ✓           300 ···· 300 ····│
│    400 ····    400 ····    400 ····    400 ···· ✓       │
│    500 ····    500 ····    500 ····    500 ···· 500 ····│
│                                                         │
│   Hover or focus a tile to read its question.           │
└─────────────────────────────────────────────────────────┘
```

- **The master picks the tile** (D16) — the board here is the input device.
- **Tile prompts are readable on hover/focus**, master-only. The master needs to know
  what's behind a tile when a team asks "what's left in Music?" and to sanity-check
  before committing.
- **The current picker is stated at the top, in their colour**, with `[Change ▾]` to
  override (D30). Override is one click away, not buried, because house rules vary and the
  rule will be wrong sometimes.
- **`BREAK_TIE_FOR_PICK`** replaces the picker line with the tied teams as buttons when
  the lowest-score rule ties (D30).

Opening a tile runs §7's buzzer flow, since every tile is a buzzer question (D34).

### 9.1 Skipping a question

A question marked `⚠` by pre-flight (PRD 2 §10), or one the master simply decides against,
can be skipped from the overflow menu: `[Skip this question]`.

Skipping emits `QUESTION_SKIPPED` and moves the question to the terminal `SKIPPED` state
(D46). It is legal from `PENDING` (never opened) or `OPEN` (opened, then abandoned —
the audio wouldn't play). It scores nothing; anything already submitted stays recorded and
is marked *question skipped* in review.

`[Skip this question]` is pointer-only, never a keystroke (§12) — a stray key must not be
able to discard a question in front of a room.

### 9.2 What cannot be undone from here

Stated plainly because the absence is deliberate:

| Not offered | Why | Where instead |
| --- | --- | --- |
| Re-opening a locked question for answers | Teams have seen the answer; re-opening is not a fair state | — |
| Editing a question's text or answers mid-game | Game copies are write-once (data model I16) | Template edit + next game |
| Deleting a team | Would orphan answers and rewrite scores | Rename/recolour instead (PRD 2 §13.4) |
| Un-revealing an answer | The room has seen it | — |
| Un-eliminating a team | Their clock genuinely reached zero, and the ranking depends on the order | Un-mark a keyword (§10.4) if the elimination was caused by a mis-marked penalty |

**Every scoring mistake is correctable** — via re-validation (§6.1) or a score adjustment
(§10) — which is what makes refusing the above acceptable.

---

## 10. `DSMTW_FINALE` (D50)

The most time-pressured screen in the product. Clocks are running, the room is watching, and
every keyword the master hears must be marked *now*. PRD 1 §8.8 has the mechanics; this is
the desk.

### 10.1 Picking finalists

`attention: PICK_FINALISTS` when the round opens.

```
┌─ ATTENTION ─────────────────────────────────────────────┐
│  Who plays the finale?          2 points = 1 second     │
│                                                         │
│   ☑ ● Quizzly Bears        340 pts  →  170s             │
│   ☑ ● The Quizinart        310 pts  →  155s             │
│   ☑ ● Norfolk & Chance     290 pts  →  145s             │
│   ☑ ● Team 4                40 pts  →   20s             │
│   ☐ ● Late Arrivals          0 pts  →    0s  out at once │
│                                                         │
│   Penalty per keyword: 20s → up to 320s off a 490s pool │
│                                                         │
│                              [ Start the finale ]        │
└─────────────────────────────────────────────────────────┘
```

- **Descending score order, all pre-selected** (D55). Deselecting the bottom few is then a
  couple of clicks, which is the common case; the master never has to hunt.
- **Converted seconds are shown next to points**, so the consequence of the conversion rate
  is visible *before* the round rather than inferred during it.
- **`0s · out at once` is spelled out** — D56 has no floor, so a team on zero points is
  eliminated before speaking. The master should see that while choosing.
- **The penalty arithmetic is restated live** against the actual finalist count, because it
  is the one number that decides whether the round lasts five questions or one (PRD 1 §8.8's
  design note).
- Minimum two finalists; `[Start the finale]` stays disabled below that.

### 10.2 The turn desk

`attention: FINALE_TURN`. Everything the master needs, arranged for speed rather than
completeness.

```
┌─ ATTENTION ─────────────────────────────────────────────┐
│  Q3 of 6 · What do you know about Michael Jackson?      │
│                                                         │
│   ● NORFOLK & CHANCE            84        next: Team 4  │
│                                                         │
│   1  Thriller          ✓ Quizzly                        │
│   2  Bad                                        [ mark ]│
│   3  Moonwalk          ✓ Norfolk                        │
│   4  Neverland                                  [ mark ]│
│   5  Billie Jean                                [ mark ]│
│                                                         │
│                          [  Pass to Team 4  ]           │
├─────────────────────────────────────────────────────────┤
│  ● Quizzly 138   ● Quizinart 155   ● Team 4 91          │
│  ● Late Arrivals — out 21:03                            │
└─────────────────────────────────────────────────────────┘
```

**Why it's shaped like this:**

- **The current team's name and clock dominate.** The master says the name aloud and watches
  that number; both must be readable without focusing.
- **Clocks are whole seconds, never `m:ss`** (D57). `84 → 64` after a penalty is instant; `1:24 → 1:04` is a base-60 conversion the master does not have spare attention for.
- **`next:` is always visible.** PRD 1 §8.8 recomputes order live, so "who's next" changes as
  penalties land. Showing it means the handover needs no thought.
- **Unmarked keywords are the buttons.** One click per keyword, no dialog, no confirmation.
  A marked keyword becomes static text with the credited team — so the row list doubles as
  the record of who got what.
- **Marking never pauses the clock.** The room's time keeps running while the master clicks,
  exactly as the show works. Only a handover stops it.
- **Every clock is on screen at all times**, in the bottom strip. The master is asked "how
  long have I got?" constantly, and a team about to be eliminated by someone else's correct
  guess is the thing they most need to see coming.
- **`[Pass to <next team>]` names the team**, so the handover is one deliberate click rather
  than a generic "next" the master has to interpret.

### 10.3 Keyboard

This round earns its own bindings, because clicking five buttons under time pressure is
where a master falls behind the room:

| Key | Action |
| --- | --- |
| `1`–`5` | Mark that keyword |
| `Space` | Pass to the next team |
| `Shift`+`1`–`5` | Un-mark (mis-heard) |

`Space` for pass is the one deliberate overload of a common key in this product. It is safe
because passing is *reversible in effect* — the next team starts, and the master can pass
straight back — and because the alternative is the master looking down to find a button
while a clock runs.

### 10.4 Un-marking

A mis-marked keyword is not merely a wrong tick: it **charged every other team the penalty**.
`Shift`+`n` appends `KEYWORD_UNMARKED`, which reverses the mark *and* the time it took from
everyone (protocol §4.6).

This is why marks are revoked rather than deleted (D41): reversing seconds requires knowing
exactly what was charged and to whom.

### 10.5 Closing a question

When all five are found, or every remaining finalist has passed:

```
   All teams passed · 1 unguessed        [ Reveal remaining ]
```

Master-triggered, so they keep the beat to say *"nobody? it was Billie Jean."* Then
`[Next question]`. Clocks stop while nobody is on turn.

### 10.6 Elimination and the end

- A clock reaching zero eliminates immediately. Control detects it and posts the event; the
  **server recomputes the exact instant from the log** so the ranking cannot be skewed by a
  slow browser (protocol §4.6).
- **Elimination can happen off-turn** — a penalty can take a waiting team to zero. The bottom
  strip is where the master sees it, and the room needs to be told, so it is announced on the
  main screen (PRD 4).
- The round ends on one finalist left, all eliminated, or questions exhausted. Control then
  shows the final ranking with its two tabs (D51) mirroring PRD 4's `FINISHED` stage.

---

## 11. Score adjustment

Available at all times from the right rail (D15), per team.

```
┌─ Adjust · Quizzly Bears ────────────┐
│   [ −10 ] [ −5 ] [ −1 ]             │
│   [  +1 ] [ +5 ] [ +10 ]   [ 25 ]   │
│                                     │
│   Reason (optional)                 │
│   [best heckle of the night      ]  │
│                                     │
│   ☑ Announce on the main screen     │
│                     [ Apply +5 ]    │
└─────────────────────────────────────┘
```

- **Stepper buttons before free entry.** The overwhelmingly common case is ±5 or ±10, and
  a stepper is faster and less error-prone than typing while distracted. Free entry stays
  for the rest.
- **Announce is on by default** (D25) — the reason is usually funny and part of the show.
  Unticking it covers the *"penalty, caught using a phone"* case.
- Recent adjustments are listed with `[Undo]`, which appends
  `SCORE_ADJUSTMENT_REVOKED` (D41).

### 11.1 Showing the leaderboard on demand

`[Show scores on screen]` in the right rail pushes the leaderboard to the main screen
mid-round (`SCOREBOARD_TOGGLED`). It **clears automatically when the next question opens**,
so the master cannot accidentally leave it up over a question.

**It is deliberately legal over an *open* question, and the leaderboard wins.** The slice-6
review round read the sentence above as possibly forbidding that, since it does hide a
question the room is still answering — so it is settled here rather than left ambiguous. A
master who wants the standings up mid-question has a reason the software cannot know: a
dispute, a stalled table, a moment they want to build. Nothing is lost by obeying them —
the deadline is advisory (D8), the question stays open, phones still show it and answers
still arrive — and the alternative is a refusal the master has to work around by ending the
round early, which is the exact distortion this button exists to prevent. Contrast
`[Start break]`, which **is** refused over an open question (protocol §4.5): a break walks
the room away from a live deadline, and that genuinely loses answers.

Between rounds the leaderboard appears without being asked for (PRD 1). This toggle exists
for the master finishing a long stretch of questions who wants to show standings before
pressing on — whose only alternative would be ending the round early, distorting the quiz's
structure to work around a missing button.

### 11.2 Starting a break

`[Start break]` in the overflow menu asks for one number — how many minutes — and puts the
main screen into its `BREAK` stage with a countdown (PRD 4 §11).

- **The countdown reaching zero does not resume the game.** The master presses
  `[Resume]` when the room is actually back. Nothing in this product auto-advances (D8),
  and a quiz that restarted itself while half the tables were at the bar would be worse
  than one that waited.
- While on break, `attention` stays `NONE`, so control shows the leaderboard — which is
  what the master wants to look at anyway, and it is the moment they are most likely to
  clear any outstanding validations (§6).
- **Entering a duration is optional.** Left blank, the screens show "back shortly" with no
  clock — better than a master inventing ten minutes and taking twenty.
- **`[Start break]` is disabled while a question is `OPEN`**, with the reason shown. A
  break over a live question would leave its deadline running while the room is at the
  bar, so late auto-submits trickle in from whichever phones are still awake and the teams
  who walked away lose the question. The master locks or skips it first.
- **`[Extend break]` replaces `[Start break]` during a break** and adds time by
  re-issuing the same call — because "five more minutes" is the most predictable thing
  that happens during an interval.

### 11.3 Entering an answer for a team

When a team's device cannot reach the server, the master can type their answer (D47). The
control appears on the team's row in the answer list (§5.1) as
`[ can't connect — enter answer ]`, shown only when that team has **no** connected device —
so it never invites use as a shortcut when the team could have answered themselves.

The answer is stored flagged `enteredByMaster` and marked `✳ entered by quizmaster` in
review. This is the one path allowed to overwrite an existing submission, and doing so
resets the verdict to unjudged.

---

## 12. Edge cases & failure handling

| Situation | Behaviour |
| --- | --- |
| **Server restarts mid-game** | Control reconnects and receives the current view (protocol §3.2). No replay, no recovery UI, no lost state — this is the payoff for D4 and D38. |
| **Two control screens open** | Possible, since there is no auth (PRD 1 §4). A passive *"2 control screens connected"* indicator appears so the master knows. All actions are idempotent or event-superseding, so a double accept is harmless. |
| **A team's device disconnects** | The right rail shows it. **No game state changes** (protocol §3.3) — a dead battery is not a forfeit. |
| **A team can't answer at all** | The master can submit on their behalf from the validation screen. This is PRD 1 §14's stated fallback for unusable wifi, and it's the difference between a salvageable evening and a dead one. See §13 O3. |
| **Attachment fails to play live** | The master sees the failure on their own player control (§5.1) before the room notices silence, and can skip (§9.1). |
| **Master closes the tab** | Nothing is lost. Reopening `/control/:gameId` resumes exactly. |

---

## 13. Keyboard map

The master has one hand free. Every high-frequency action is reachable without the
trackpad.

| Key | Action |
| --- | --- |
| `Y` | Accept — buzz, or the topmost undecided validation row |
| `N` | Deny — same target |
| `Enter` | The primary suggested action (open / close / reveal / next) |
| `1`–`9` | Select team — `DO` winners, tie-breaks |
| `←` `→` | Move along the timeline (read-only, §2.1) |
| `1`–`5` | Mark a finale keyword (§10.3) |
| `Shift`+`1`–`5` | Un-mark a finale keyword |
| `Space` | Play/pause an attachment — **or pass the finale turn** when a finale turn is active |
| `Esc` | Close a popover |

Deliberately **not** bound, because a stray keystroke during a live event must not be able
to do any of them: end the game, abandon the game, skip a question (D46), or submit on a
team's behalf (D47).

---

## 14. Question log

| # | Question | Recommendation | Affects |
| --- | --- | --- | --- |
| ~~O1~~ | ~~Validation grouping~~ | **Resolved: group by question, judge each team separately** (§6.1). `attention.VALIDATE_QUESTION` carries `items[]`. Identical answers are visually linked as a soft consistency aid only. |
| ~~O2~~ | ~~`QUESTION_SKIPPED`~~ | **Resolved → D46.** Explicit event and a terminal `SKIPPED` state, legal from `PENDING` or `OPEN`. No reason field — §1.1 says mid-round is the wrong moment to ask for typing. |
| ~~O3~~ | ~~Master submits for a team~~ | **Resolved → D47.** Allowed, flagged `enteredByMaster`, own endpoint. The sole exception to D43’s finality; resets the verdict. |
| ~~O4~~ | ~~Leaderboard on demand~~ | **Resolved: yes, a manual toggle.** `SCOREBOARD_TOGGLED`; clears when the next question opens. No auto-show every N questions — that interrupts pacing the master didn’t choose. |
| ~~O5~~ | ~~Round progress estimate~~ | **Resolved: not v1.** Needs per-question timing data we don’t collect, and a wrong estimate is worse than none for someone pacing an evening. Revisit after real games. |
| ~~O6~~ | ~~Auto-reveal after the last denial~~ | **Resolved: no — prompt, don’t act.** D35 rule 4 requires a prompt, and auto-revealing steals the master’s chance to say “nobody? it was Radiohead” with any timing. |

---

## 15. Next

[PRD 4 — the main screen](./04-main-screen.md): the projected surface, where D40's
two-beat reveal, the buzz timings from §7, and O4's leaderboard toggle all have to look
good from ten metres.
