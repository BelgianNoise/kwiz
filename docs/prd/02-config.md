# PRD 2 — Configuration & Admin Pages

**Status:** Draft · **Last updated:** 2026-08-03

The quiz master's workshop: everything they do **before** and **after** an event, on
their own laptop. Live-game control is [PRD 3](./03-master-control.md).

Governed by [PRD 1](./01-main.md); the [data model](../spec/data-model.md) and
[protocol](../spec/protocol.md) specs are normative over anything here.

---

## 1. Scope

**In:** landing page, first-run network setup, quiz dashboard, quiz/round/question
authoring, the Jeopardy board builder, attachments, pre-flight validation, export &
import, game setup, launch links, post-game review and correction, settings.

**Out:** the live control surface (PRD 3), the projected screen (PRD 4), player
devices (PRD 5).

### 1.1 The operating context this surface must survive

Design assumption, and the reason several decisions below lean the way they do:

> A quiz master authors a quiz across several relaxed evenings — and then does game
> setup **fifteen minutes before doors open, in a noisy room, on battery, possibly
> having just discovered a broken audio file.**

Authoring can be leisurely and dense. Game setup and pre-flight cannot. Where the two
conflict, setup wins.

---

## 2. Information architecture

```
/                                    Landing — Host or Join
/admin                               Dashboard — quizzes + games
/admin/setup                         First-run: network interface
/admin/settings                      Network, language, storage
/admin/quizzes/:quizId               Quiz editor — round list
/admin/quizzes/:quizId/rounds/:id    Round editor — question list OR Jeopardy board
/admin/games/:gameId                 Game detail — teams, code, launch, review
```

Two deliberate absences:

- **No `/admin/questions/:id` route.** Questions are edited in a side sheet over their
  round, never on their own page. A master authoring 40 questions must keep the list in
  view; a full-page navigation per question destroys that context and makes "is question
  12 the odd one out?" impossible to answer.
- **No route that means "the current game".** Per D21 there is no such thing. Every game
  URL carries its `gameId`.

---

## 3. Landing page (`/`)

The only page a guest and a master both see. It has exactly one job: get each of them
into the right place with no reading.

```
┌──────────────────────────────────────────────┐
│                                     [EN ▾]   │  ← prominent here (PRD 1 §9.4)
│                   kwiz                       │
│                                              │
│   ┌────────────────────┐  ┌───────────────┐  │
│   │   I'm playing      │  │  I'm hosting  │  │
│   │                    │  │               │  │
│   │  Scan the QR code  │  │  Manage my    │  │
│   │  on screen, or     │  │  quizzes and  │  │
│   │  enter the code    │  │  run a game   │  │
│   │                    │  │               │  │
│   │  [______]  Join →  │  │   Open →      │  │
│   └────────────────────┘  └───────────────┘  │
└──────────────────────────────────────────────┘
```

- **Player side is larger and first** in DOM and visual order. On any given night one
  person hosts and twenty play; the layout should reflect that ratio. The code field is
  inline so a player never needs a second tap to start typing.
- The code field accepts lowercase and stray spaces and normalises them (PRD 1 §8.10) —
  it is being typed by someone squinting at a projector.
- **No "recent games" or history on this page.** It is a public-facing screen in a room
  full of strangers; it shows nothing about what's on this machine.
- Player flow continues in [PRD 5](./05-player.md).

---

## 4. First-run setup (`/admin/setup`)

Shown once, when no network interface has been chosen (D10). Reachable later from
settings.

The problem it solves: a laptop has several interfaces — wifi, ethernet, VPN, Docker
bridges, WSL adapters — and picking the wrong one hands players a QR code that resolves
to nothing. This is the single most likely way a first-time setup fails, and it fails
*silently* at the worst possible moment.

```
Which address should players use?

  ○ 192.168.1.42     Wi-Fi (en0)              ✓ reachable
  ○ 10.13.37.5       Ethernet (eth0)          ✓ reachable
  ○ 172.17.0.1       docker0                  ✗ no route from other devices
  ○ 127.0.0.1        Loopback                 ✗ this machine only

  Selected → http://192.168.1.42:3000     [ Test with my phone ]  [ Continue ]
```

- Interfaces are enumerated and **each is annotated with a reachability verdict** —
  loopback, link-local, and known-virtual ranges are marked unusable rather than
  offered as equals.
- **"Test with my phone"** shows the QR code and waits for a hit on a probe endpoint,
  confirming with *"Your phone reached this machine."* This turns the highest-risk step
  into something verified rather than assumed.
- The choice is persisted and used for every QR code and join URL.
- **If the address later becomes invalid** (different wifi network, new DHCP lease), the
  dashboard shows a warning banner with a re-pick action. A stale saved IP is the second
  most likely failure, and it must not be silent either.

---

## 5. Dashboard (`/admin`)

Two sections, quizzes above games.

```
Quizzes                                    [+ New quiz]  [Import…]

  Pub Quiz #4          5 rounds · 84 questions   edited 2 Aug     [Play] [⋯]
  Christmas Special    3 rounds · 40 questions   edited 12 Dec    [Play] [⋯]

Games                                                    [show finished ▾]

  ● SETUP     Pub Quiz #4    code 7KMQ2X   8 teams   ⚠ template updated  [Open]
  ● LIVE      Christmas…     code B4RTZ9   6 teams   round 2 of 3        [Open]
    FINISHED  Pub Quiz #4    11 Jul        9 teams   winner: Quizzly…    [Open]
```

- **`[Play]` is the primary action on a quiz**, not `[Edit]`. The verb a master reaches
  for is "run this"; editing is the occasional act. `[Play]` runs pre-flight (§9) then
  goes to game setup (§10).
- **Live and setup games are pinned above finished ones**, and finished games are
  collapsed behind a toggle. A master who has run 30 quizzes should not scroll past them
  to find tonight's.
- **The `⚠ template updated` badge** appears when a `SETUP` game's `quizRevision` is
  behind its template's `revision` (data model §7.1), with a re-sync action. Without it
  a master edits the template, wonders why the game still shows the typo, and has no
  idea a re-sync exists.
- **Empty state** is a real screen, not an error: *"No quizzes yet. Create one, or
  import a `.zip` you exported elsewhere."* This is what the very first visit shows, and
  it is also the moment the SQLite file gets created (PRD 1 §6.6).
- `[⋯]` → Duplicate, Export, Delete.

**Deleting a quiz is now safe** (data model §10) — games keep their own copies. The
confirmation says so explicitly: *"2 played games will be kept and stay reviewable."*
Masters otherwise assume deletion destroys their history and never clean up.

---

## 6. Quiz editor (`/admin/quizzes/:quizId`)

```
← Dashboard        Pub Quiz #4                      [Play]  [Export]  [⋯]

  Name         [Pub Quiz #4                    ]
  Description  [Monthly quiz at De Kroon       ]

  Rounds                                              [+ Add round]
  ⠿  1  Warm-up            QUESTION_SET   12 questions   120 pts   [Open →]
  ⠿  2  Music              QUESTION_SET   10 questions   100 pts   [Open →]
  ⠿  3  Jeopardy!          JEOPARDY       5×5 board      1500 pts  [Open →]
  ⠿  4  Do or Die          QUESTION_SET    4 questions   200 pts   [Open →]

  Total: 84 questions · 1920 points · est. 95 min
```

- **Round rows show per-round point totals and the quiz total.** Balance between rounds
  is the thing a master actually worries about while authoring, and it's invisible
  unless computed for them.
- **An estimated runtime** from question counts and timers. Rough by nature — label it
  "est." and don't pretend otherwise — but a master planning an evening needs to know
  whether they have written 45 minutes or 3 hours.
- **Drag to reorder** via the `⠿` handle, writing contiguous `position` values
  (data model I7). Keyboard-accessible alternative required (§14.2).
- `+ Add round` asks only for **type** and **title** — everything else has defaults and
  is set in the round editor. A dialog that demands eight fields before you can write a
  question is how authoring stalls.

---

## 7. Round editor — `QUESTION_SET` (`/admin/quizzes/:id/rounds/:roundId`)

```
← Pub Quiz #4      Round 2 · Music                                   [⋯]

  Title              [Music                          ]
  Default points     [ 10 ]        Default timer  [ 30 ] s   ☐ no timer

  Questions                                          [+ Add question]
  ⠿ 1  Who released "Kid A" in 2000?          FREE_TEXT   10  30s  🎵   ✓
  ⠿ 2  Name this song                         BUZZER      20  —    🎵   ✓
  ⠿ 3  Which of these never charted?          CHOICE      10  20s        ✓
  ⠿ 4  Dance to this for 30 seconds           DO          50  30s  🎵   ⚠
```

Each row shows, at a glance: order, prompt, answer method, points, timer, attachment
icons, and a **readiness marker** (`✓` complete / `⚠` incomplete — §8). A master
scanning for what's unfinished should never have to open anything.

**Round defaults cascade**: `defaultPoints` and `defaultTimerMs` are inherited by new
questions and by questions that haven't overridden them (D6, D7). Changing a round
default updates every inheriting question — and the UI must say how many that is
(*"12 questions will change from 10 to 15 points"*) before applying, because silently
rewriting a whole round's scoring is a nasty surprise.

### 7.1 Question editor (side sheet)

Clicking a question opens a sheet **over** the list — the list stays visible.

```
┌─ Question 2 of 10 ───────────────── [↑ ↓] [✕] ─┐
│                                                 │
│  Prompt                                         │
│  [Name this song                             ]  │
│                                                 │
│  Answer method                                  │
│  ( ) Free text  ( ) Multiple choice             │
│  (•) Buzzer     ( ) Do / challenge              │
│                                                 │
│  Points [ 20 ]   Timer [ — ] s  ☑ no timer      │
│                                                 │
│  ── method-specific section ──                  │
│                                                 │
│  Attachments                          [+ Add]   │
│  🎵 kid-a.mp3  4.0 MB  2:14  ✓ playable  ▶ ──   │
│                                                 │
│  Master notes (never shown to anyone else)      │
│  [Accept "Everything In Its Right Place" too ]  │
└─────────────────────────────────────────────────┘
```

- **`[↑ ↓]` walk to the previous/next question without closing.** Authoring is a bulk
  activity; close-reopen-scroll per question is the difference between pleasant and
  tedious. Bound to `Alt+↑/↓` as well.
- **Master notes are labelled with their guarantee**, not just named. "Never shown to
  anyone else" is the whole reason a master will trust the field (PRD 1 §7 invariant 7).
- Changing answer method **keeps** any data the new method can't use, hidden rather than
  deleted, so flipping to multiple choice and back doesn't silently destroy typed
  answers. Discard only on explicit "clear".
- **`[Preview on main screen ↗]`** opens the real PRD 4 renderer in a mock `OPEN` state
  showing this question, at true projector type scale (O4). It exists to catch the two
  failures that are common and completely invisible on a laptop: a long prompt
  overflowing at projector scale, and a dark image disappearing under projector
  contrast.

#### Attachment upload (O6)

Playability is **verified in the browser at upload time**, not inferred from the file
extension:

```
1. hand the file to an off-screen media element
2. wait for loadedmetadata → playable, and read duration
3. on error → reject before uploading, naming formats that work
4. otherwise stream up, hashing as it goes (data model §8)
```

This tests the question that actually matters — *can a browser play this?* — rather than
trusting a MIME type. An `.mp4` carrying an exotic codec passes every extension check and
then fails silently in front of the room.

**Two honest limits of this check**, both worth knowing:

- It verifies playability in **the browser doing the upload**. If a master authors in one
  browser and projects from another, the guarantee doesn't transfer. In practice it's the
  same machine and usually the same browser, and this is still far stronger than a MIME
  check.
- **Pre-flight (§9) cannot re-verify playability** — it runs server-side and can only
  re-hash the file. So upload-time verification and the §7.1 main-screen preview are the
  two things that actually confirm media works; together they cover it end to end.

**No transcoding.** Bundling ffmpeg to re-encode a pub quiz's media is a large
per-platform dependency and a whole class of failure states, for a problem a master
solves by exporting differently. Rejection messages name working formats: mp3/m4a,
mp4/webm (H.264/VP9), jpg/png/webp.

### 7.2 Method-specific sections

**`FREE_TEXT`**

```
  Correct answer     [Radiohead                        ]
  Also accept                                 [+ Add alternative]
                     [radiohead - kid a               ]  [✕]
                     [kid a                           ]  [✕]

  ℹ Matching is exact after lowercasing and trimming. Anything else
    comes to you to accept or deny during the game.
```

The note is not decoration. With matching at lowercase+trim only (D22), a master who
assumes fuzzy matching will write one answer, then spend the game hand-validating
"The Beatles" against "Beatles". Telling them here, where they can act on it, converts a
live-game problem into an authoring one. The `+ Add alternative` affordance is D33.

**`MULTIPLE_CHOICE`**

```
  Options (2–4, pick the correct one)
  ⠿ (•) [Radiohead        ]  [✕]
  ⠿ ( ) [Blur             ]  [✕]
  ⠿ ( ) [Oasis            ]  [✕]                        [+ Add option]
```

Radio selection makes "exactly one correct" structural rather than validated (I4).

**`BUZZER`**

```
  Correct answer     [Radiohead                        ]
  ℹ You'll judge spoken answers yourself. This is shown on your
    control screen and revealed to the room afterwards.
```

Never auto-matched (data model §4.5) — the note prevents a master expecting otherwise.

**`DO`**

```
  Scoring
  (•) Winner takes all      ( ) Score each team

  ── when Winner takes all ──
  If several teams tie:  (•) each gets full points  ( ) split the points

  ── when Score each team ──
  ℹ Each team gets 0–20 points. Change "Points" above to change the maximum.
```

That last note earns its place: `points` doubling as the per-team maximum (D24) is
genuinely non-obvious, and a master wanting "rate out of 10" needs to know the field
they're looking for is `Points`.

---

## 8. Round editor — `JEOPARDY` board builder

The board is authored **as a board**, because that is what the room will see. A list of
questions with category and value fields would let a master build something that looks
wrong on the projector without ever noticing.

```
← Pub Quiz #4      Round 3 · Jeopardy!                               [⋯]

  Value ladder   [100] [200] [300] [400] [500]        [+ Row]

   ┌─ Geography ─┬─ Film ──────┬─ Music ─────┬─ Sport ─────┬─ Random ────┐
   │  [edit ▾]   │  [edit ▾]   │  [edit ▾]   │  [edit ▾]   │  [edit ▾]   │
   ├─────────────┼─────────────┼─────────────┼─────────────┼─────────────┤
   │ 100      ✓  │ 100      ✓  │ 100      ✓  │ 100      ✓  │ 100      ✓  │
   │ 200      ✓  │ 200      ✓  │ 200      ✓  │ 200      ⚠  │ 200      ✓  │
   │ 300      ✓  │ 300      ✓  │ 300      ✓  │ 300      ✓  │ 300      ✓  │
   │ 400      ✓  │ 400      ✓  │ 400      ✓  │ 400      ✓  │     +       │
   │ 500      ✓  │ 500      ✓  │     +       │ 500      ✓  │     +       │
   └─────────────┴─────────────┴─────────────┴─────────────┴─────────────┘
                                    ⚠ 3 empty tiles · 1 incomplete question

  ℹ Every tile is a buzzer question — any team can buzz in.       [+ Category]
```

- **Clicking a tile opens the same question sheet** as §7.1, with the method locked to
  `BUZZER` and stated as a fact rather than a disabled control (D34): *"Jeopardy tiles
  are always buzzer questions."* A greyed-out radio group invites the master to wonder
  what's broken.
- **Empty cells are `+` buttons.** Building a board is filling in a grid, and the grid
  should be directly fillable.
- **The value ladder governs tile values, and tiles cannot deviate** (O3). `question.points` is written from `valueLadder[row]`, so editing the ladder re-values the
  whole row — which is what a master means when they change it. A column that doesn't read
  100/200/300 looks broken to a room that knows the game. The schema permits per-tile
  values, so this can be opened later without a migration.
- **Uneven columns are allowed** (data model §4.3) but flagged, because a master
  building incrementally has legitimately-unfinished columns *and* a master who thinks
  they're done has a mistake. Same warning, and pre-flight (§9) is where it becomes a
  decision.
- `[edit ▾]` on a category header: rename, reorder, delete (with its tiles, confirmed).

---

## 9. Pre-flight check

Run when `[Play]` is pressed, and available any time from the quiz editor. This exists
because of §1.1: the master is fifteen minutes from doors open, and **the moment to
discover a missing correct answer is now, not in front of a room.**

```
Pub Quiz #4 — ready to play?

  ✗ 2 problems must be fixed
     Round 2 · Q4 "Dance to this…"   no scoring mode chosen        [Fix →]
     Round 3 · Film 300               audio file missing from disk  [Fix →]

  ⚠ 3 things worth a look
     Round 3 · Music                  4 tiles, other columns have 5 [View →]
     Round 3 · Random                 2 empty tiles                 [View →]
     Round 1 · Q7                     no correct answer alternatives — "Beatles"
                                      will need manual validation   [View →]

  ✓ 84 questions · 12 attachments verified · 5 rounds

                                  [ Play anyway ]   [ Fix problems ]
```

**Errors** (block nothing — see below) come from the data model invariants: missing
accepted answers (I5), a multiple-choice question without exactly one correct option
(I4), an empty prompt, a `DO` question with no scoring mode, an attachment whose file is
missing or whose checksum no longer matches (data model §8).

**Warnings** are judgement calls: uneven Jeopardy columns, empty tiles, a round with no
questions, a single accepted answer on a free-text question, a question with a timer
under 5 seconds.

> **`[Play anyway]` is deliberately available even with errors.** A master five minutes
> from doors open who knows question 34 is broken should be able to run the other 83 and
> skip it. Blocking them protects the data at the expense of the event. A broken question
> is shown on the master's control screen with a clear marker so they can skip it
> knowingly (PRD 3).

**Attachment verification is part of pre-flight, not an afterthought.** Re-hashing 12
files takes moments and catches the failure mode that is otherwise discovered live, with
the room waiting for a song that will not play.

---

## 10. Game setup

Reached from `[Play]`. Creates a game and deep-copies the quiz (data model §7).

```
New game from "Pub Quiz #4"

  Teams                          [+ Add team]   [Copy from last game]
  ⠿  ● [Quizzly Bears        ]  ← colour swatch opens the palette
  ⠿  ● [The Quizinart        ]
  ⠿  ● [Norfolk & Chance     ]
  ⠿  ● [Team 4               ]

  Player language   (•) English  ( ) Nederlands
                    ℹ Players can change this on their own phone.

                                          [ Create game ]
```

- **`[Copy from last game]`** pre-fills names and colours from this quiz's most recent
  game. The same pub tends to have the same teams, and re-typing eight names against the
  clock is exactly the §1.1 pressure point.
- **Colours come from a curated palette** (PRD 1 §9.3) with a custom option. The palette
  guarantees mutual distinguishability and readable contrast; free choice reliably
  produces two indistinguishable teams and unreadable text at projector scale. Already-
  taken colours are marked as such rather than disabled — a master may genuinely want a
  near-match.
- **Team names default to `Team 1…n`** so a master can create the game *now* and rename
  later; renaming works at any time, including after the game finishes (§12).
- **Player language** is the D29 per-game default, with the note making clear it is a
  default and not a lock.
- The code is generated on creation and shown next; it is not something the master picks.

### 10.1 Adding a team after the game has started (O5)

A table arriving during round 1 is normal in a pub, and PRD 1 explicitly does not block
late joins. So `[+ Add team]` stays available at every status, from both this surface and
master control (PRD 3).

It is gated by one dialog — which is justified only because the dialog is also where the
decision gets made, not merely where a warning is acknowledged:

```
Add a team mid-game?

  Round 2 of 5 is in progress.
  This team has missed 12 questions worth 140 points.
  Their maximum possible score is now 1780 (others: 1920).

  Team name  [Late Arrivals            ]   ● colour

  Starting score
  (•) Start on 0
  ( ) Give them  [ 70 ]  points          ← half of what they missed
      Recorded as a score adjustment with the reason
      "joined during round 2".

                              [ Cancel ]  [ Add team ]
```

- **The numbers are computed, not left to the master's arithmetic.** Working out "what
  have they missed?" mid-round, in a noisy room, is exactly the sort of task that gets
  skipped or got wrong.
- **The generosity option is inline**, so the master doesn't have to add the team, then
  remember to visit score adjustments. A choice offered in the moment it arises is the
  choice that actually gets made.
- **Half the missed points is suggested, not imposed** — a defensible default that the
  master can override or zero out. It writes a normal `SCORE_ADJUSTED` event with a
  generated reason (D15), so it shows up in the audit trail like any other adjustment
  and can be revoked (D41).
- **Nothing is back-filled.** No `NO_ANSWER` rows are created for questions already
  closed; the team simply has no answers for them, and every score view already handles a
  missing answer as zero.

---

## 11. Game detail (`/admin/games/:gameId`)

The hub for one game, before, during and after.

```
← Dashboard     Pub Quiz #4 · 3 Aug            ● SETUP        [⋯]

  ┌── Join ─────────────────────────────────────────────────┐
  │            ████ ▄▄ ████                                 │
  │            ██ ▄█▀▀█▄ ██        Code    7KMQ2X    [↻]     │
  │            ████ ▀▀ ████        http://192.168.1.42:3000  │
  └─────────────────────────────────────────────────────────┘

  [ Open main screen ↗ ]     [ Open control screen ↗ ]

  ⚠ Template updated since this game was created (rev 7 → rev 9)   [Re-sync]

  Teams                                             4 · 2 devices joined
    ● Quizzly Bears     1 device    ● Norfolk & Chance   1 device
    ● The Quizinart     —           ● Team 4             —

  Rounds        5 rounds · 84 questions · not started
```

- **Two launch buttons opening new tabs/windows**, because the two surfaces live on two
  displays. Per D21 neither is "the current game" — both URLs carry this `gameId`.
- **The QR and code are the visual anchor**, since during setup this page *is* what the
  master is using while people arrive.
- **`[↻]` regenerates the code** (`SETUP` only, data model Q3) with a confirmation that
  says already-joined devices keep working — because the obvious fear is that
  regenerating kicks everyone out.
- **Device counts per team** let the master see who has actually joined and chase the
  table that hasn't. This is live information on an otherwise static page: it uses the
  `MASTER_CONTROL` stream (protocol §2.1) rather than polling.
- **The re-sync banner** appears only while `SETUP` and only when stale, and its
  confirmation states what survives: *"Teams, devices and the join code are kept.
  Questions are refreshed from the template."*

### 11.1 The game overflow menu

| Action | Availability | Notes |
| --- | --- | --- |
| Export this game | any status | Quiz + this game only (§13.1) |
| Abandon game | `SETUP` / `LIVE` | Ends it without marking it finished; confirmed, since the room is mid-quiz |
| Delete game | any status | Confirmed, naming the loss: *"Delete this game, its 9 teams and all 84 answers? The quiz itself is kept."* |

**Per-game delete exists; bulk pruning does not** (data model Q5). A master who ran a game
by mistake must be able to remove it — it's their machine and their data. But a bulk
"delete everything older than N" is a destructive sweep over the only copy of their
history, and it solves a storage problem that doesn't exist: game copies are ~100–200 rows
each, and attachment files are shared by checksum so they never duplicate.

The confirmation names the **quiz survives** explicitly, for the same reason §5's does:
masters assume deleting a game takes its quiz with it, and never clean up.

---

## 12. Post-game review & correction

The reason PRD 1 promises a master can fix a validation mistake. Two views on a finished
(or live) game, both under §11 once the game has started.

### 12.1 Round review

```
Round 2 · Music                                        3 corrections made

              Quizzly Bears    The Quizinart    Norfolk & Chance
  Q1  Kid A   Radiohead ✓ 10   radiohead  ✓ 10  Radio Head  ✗  0   ← click a cell
  Q2  song    —         ✗  0   Creep      ✓ 20  Creep       ✓ 20
  Q3  charted (b)       ✓ 10   (a)        ✗  0  (b)         ✓ 10
  Q4  dance   —            50  —             30 —              40

  Correct answer: Radiohead · also accepted: "radiohead - kid a", "kid a"
```

- **A grid of questions × teams**, because "did I mark that consistently?" is the actual
  question a master has, and it is only answerable side by side. `Radio Head ✗` sitting
  next to `radiohead ✓` makes an inconsistency obvious in a way a per-question list
  never would.
- **Clicking any cell toggles the verdict**, appending `ANSWER_VALIDATED` (protocol
  §4.3). Corrected cells are marked, and a per-round count of corrections is shown —
  visible, not hidden, because an auditable correction is the point.
- **Score changes propagate immediately** and reach the main screen live if the game is
  still running.
- This is a REST-loaded page, not a pushed view (D39 — it is O(questions × teams)).

### 12.2 Score adjustments

```
Score adjustments                                    [+ Adjust score]

  Quizzly Bears      +5   "best heckle of the night"       20:14   [Undo]
  Norfolk & Chance  −10   "phone use"          not announced 20:41  [Undo]
  The Quizinart     +50   —                                 21:02   ↩ undone
```

**`[Undo]` needed a protocol change**, and it's worth explaining why rather than hiding
it. `game_event` is append-only, so a mistaken `+50` cannot be deleted. The options were:

| Option | Verdict |
| --- | --- |
| Master counters with a `−50` adjustment | Auditable but reads as two mistakes, and the log stops meaning what it says |
| Add `SCORE_ADJUSTMENT_REVOKED` | **Chosen.** The projection excludes revoked rows; the log keeps both facts; the UI shows one struck-through line |

So the protocol gains `SCORE_ADJUSTMENT_REVOKED { adjustmentId }` and the projection
gains `revokedAt` — see §16 O1.

### 12.3 Team corrections

Renaming and recolouring a team works **at any time**, including after the game ends
(protocol §4.1 `TEAM_UPDATED`) — a master who typed "Team 3" all night can fix it before
exporting. Teams can never be **deleted** from a game (data model §10): it would orphan
answers and rewrite scores.

---

## 13. Export & import

### 13.1 Export

```
Export "Pub Quiz #4"

  (•) Quiz only                       ~4 MB    for taking to another machine
  ( ) Quiz + 2 played games          ~4 MB    for archiving a night

  ☑ Include attachments (12 files, 3.8 MB)

                              [ Cancel ]  [ Export ]
```

Sizes are computed, not estimated — a master on a slow USB stick wants to know. Unticking
attachments produces a zip that **imports with clearly-marked missing media** rather than
a broken one (protocol §8.1's per-file reporting), which is what makes "just send me the
questions" viable.

### 13.2 Import

Drop a `.zip` anywhere on the dashboard, or use `[Import…]`. Validation happens before
anything is written (protocol §8.3).

```
Import "Pub Quiz #4"

  ⚠ You already have a quiz with this identity.

              On this machine          In this file
    Edited    2 Aug, 19:04             1 Aug, 22:30
    Rounds    5 · 84 questions         5 · 82 questions
    Games     2 played                 2 played

    ℹ The file is older than your local copy.

  ( ) Replace my local copy — deletes it and its 2 games
  (•) Import as a separate copy
  ( ) Cancel
```

- **Compared by `updatedAt`, not by revision number.** This corrects how I framed D9:
  with autosaved editing (§14.1) revision counters increment per keystroke, so "rev 7 vs
  rev 9" is meaningless to a human even though it orders correctly. Dates are what a
  master can reason about; revision remains the machine tiebreak.
- **The older/newer verdict is spelled out in words.** Two timestamps side by side still
  require the master to do the comparison, at speed, and getting it wrong is destructive.
- **"Import as a separate copy" is the default**, since it is the non-destructive option.
- Replace states its cost explicitly, including the game count.

---

## 14. Authoring behaviour & cross-cutting rules

### 14.1 Autosave

All authoring fields autosave on a ~600 ms debounce, with a quiet
`Saved · 19:04` indicator. No save buttons, no unsaved-changes dialogs.

The trade-off this creates, and how it's handled:

| Risk | Handling |
| --- | --- |
| Accidental destructive edits | Structural deletes (round, category, question, option) require confirmation naming what is lost. Field edits do not. |
| `quiz.revision` inflating | Accepted. Revision is machinery for import ordering (§13.2); the UI shows `updatedAt` instead and never surfaces the number. |
| A half-typed question looking "done" | Readiness markers (§7, §9) are computed live, so incomplete work is visibly incomplete. |

### 14.2 Interaction & content rules

- **Reordering**: drag via `⠿`, plus `Alt+↑/↓` on a focused row. Drag-only reordering is
  unusable on a trackpad in a hurry and inaccessible by keyboard.
- **Destructive confirmations name the loss**: *"Delete round 3 'Jeopardy!' and its 25
  questions?"* — never a bare "Are you sure?".
- **No undo system in v1.** Autosave plus confirmations covers the realistic cases; a
  general undo stack over a tree this shape is disproportionate. Flagged as §16 O2.
- **Components come from shadcn/ui** (PRD 1 §6.1), styled through the semantic Tailwind
  tokens in the globals file — never literal colours. This surface has by far the most
  components, so the sheet, dialog, table, select, popover and form primitives here set the
  pattern the other three follow.
- **Every string goes through the messages module** (D11). Per D28 the config surface is
  i18n-wired but English-first; NL translation here is lower priority than player and
  main-screen copy.
- **Empty states are designed screens**, not blank areas: no quizzes, no rounds, no
  questions, no games, no attachments.

---

## 15. Settings (`/admin/settings`)

Small and boring on purpose.

| Section | Contents |
| --- | --- |
| **Network** | Current address, re-run the §4 picker, re-test reachability |
| **Language** | Admin interface locale (D13 — per-device, not per-game) |
| **Sound** | `Mute all quiz sounds` — silences the main screen's buzz and timer audio (PRD 4 §12). Lives here rather than on the projected screen, which has no controls at all; a venue with its own music needs this, and hunting for OS volume mid-quiz is not acceptable |
| **Storage** | Data directory path, database size, attachment count and total size, **`Reclaim space`** running the orphaned-file reconciliation (data model §8) |
| **About** | Version, schema version, migration status |

`Reclaim space` is user-facing because content-addressed files accumulate: a replaced
image leaves the old file until reconciliation runs (data model §8), and on a laptop
that's the master's disk.

---

## 16. Open questions

| # | Question | Recommendation | Affects |
| --- | --- | --- | --- |
| ~~O1~~ | ~~Undoing a score adjustment~~ | **Resolved → D41.** `SCORE_ADJUSTMENT_REVOKED` added; projection gains `revokedAt`; revoked rows excluded from totals but never deleted. |
| ~~O2~~ | ~~Undo beyond confirmations~~ | **Resolved: none in v1.** Autosave plus loss-naming confirmations (§14). A general undo stack over quiz → round → question → option is disproportionate for a single-user local app. |
| ~~O3~~ | ~~Tile value deviation~~ | **Resolved: no.** The ladder governs; `question.points` is written from `valueLadder[row]` (§8). Schema permits deviation if it's ever wanted. |
| ~~O4~~ | ~~Main-screen preview~~ | **Resolved: minimal.** One action opening the real PRD 4 renderer in a mock `OPEN` state at projector type scale (§7.1). |
| ~~O5~~ | ~~Teams after `GAME_STARTED`~~ | **Resolved: allowed, with a warning dialog that computes what was missed and offers an inline starting score** (§10.1). |
| ~~O6~~ | ~~Unplayable media~~ | **Resolved: verify in-browser at upload.** Off-screen media element confirms playability before upload; no transcoding (§7.1). |
| ~~O7~~ | ~~Quiz cover image or accent colour~~ | **Resolved in PRD 4 §5: no.** On the projected surface **colour is reserved for team identity** — team colours are the only colour carrying meaning (PRD 1 §9.5) and are palette-constrained for mutual distinguishability. A per-quiz accent would compete with the one thing the audience uses colour to decode. Round intros carry their weight through typography and scale, which is also what survives a bad projector. |

---

## 17. Next

[PRD 3 — master control](./03-master-control.md): the live surface, where §9's
"play anyway" markers, §12's validation queue and the D35 buzzer loop all have to work
under time pressure.
