# PRD 5 — The Player Device (phone)

**Status:** Draft · **Last updated:** 2026-08-04

The phone a team plays on. The last surface. Authoring is [PRD 2](./02-config.md),
master control [PRD 3](./03-master-control.md), the projected screen
[PRD 4](./04-main-screen.md).

Governed by [PRD 1](./01-main.md); the [data model](../spec/data-model.md) and
[protocol](../spec/protocol.md) specs are normative over anything here.

Routes: `/play/:code` (join), then `/play/:code/game`. Audience `PLAYER(teamId)`
(protocol §5.3).

---

## 1. What this surface is for

PRD 1 G3: *"Scan QR → pick team → waiting screen, with no app install, no account, no
typing beyond an optional code."*

### 1.1 The operating context

The most hostile environment of the four, and every decision below follows from it:

> **One phone, four people.** It sits in the middle of a table and gets passed around;
> two or three people read it at once, at an angle. The pub is loud and dim. The wifi is
> a hotspot on the quiz master's laptop with twenty other phones on it. The battery is
> at 23% and the screen wants to lock every 30 seconds. Nobody will install anything,
> read instructions, or create an account.

Four rules follow:

1. **Nothing is ever lost.** A phone that sleeps, drops wifi or gets locked mid-question
   must not cost the team the question. Every mechanism here exists for this.
2. **One thing to do, large.** Whoever is holding the phone should see a single obvious
   action without reading.
3. **No per-person state.** There is no "your turn", no identity, no profile. The device
   is the team, not a person.
4. **Nothing sensitive ever arrives** — enforced server-side (PRD 1 §7), so there is no
   client-side hiding to get wrong.

---

## 2. Join flow

### 2.1 The two entry points

```
QR code    →  http://192.168.1.42:3000/play/7KMQ2X   →  team picker
Typed code →  landing page (PRD 2 §3) → /play/7KMQ2X →  team picker
```

- **The QR encodes the full join URL including the code**, so scanning goes straight to
  the team picker with nothing typed (PRD 1 §8.10).
- **The code is normalised on entry**, in this order: strip whitespace and hyphens →
  uppercase → map the excluded glyphs onto what they were mistaken for (`O`→`0`, `I`→`1`,
  `L`→`1`) → validate. Someone is squinting at a projector across a dark room, so
  `kmq2x` and `KMQ2X` and `kMQ-2X` all work. Exact rules: [conventions §2](../spec/conventions.md).

### 2.2 Team picker

```
┌──────────────────────────────┐
│  Pub Quiz #4                 │
│  Which team are you?         │
│                              │
│  ┌──────────────────────────┐│
│  │ ●  Quizzly Bears         ││
│  └──────────────────────────┘│
│  ┌──────────────────────────┐│
│  │ ●  The Quizinart         ││
│  └──────────────────────────┘│
│  ┌──────────────────────────┐│
│  │ ●  Norfolk & Chance      ││
│  │    already has 3 phones  ││
│  └──────────────────────────┘│
│                              │
└──────────────────────────────┘
```

- **Teams are created by the master** (PRD 2 §11) — players choose from a list and never
  name themselves. This is what keeps team identity under the master's control for
  scoring, and it means the picker needs no text input at all.
- **Full teams are shown, not hidden**, with the reason (D20). Hiding a team makes a
  player think they scanned the wrong code; showing it full tells them to sit elsewhere or
  ask the master.
- **Rows are large tap targets** — this is being tapped by someone holding a drink.
- One tap joins. **No confirmation step**, and no "are you sure?" — switching is
  available afterwards (§2.4).

### 2.3 Device identity

On joining, the server returns a `deviceToken` which is stored in `localStorage` and sent
as `X-Kwiz-Device` on every request (protocol §7.1).

- **Reopening the URL resumes** — same team, same state, nothing to re-enter. This is what
  makes an accidental tab close, a browser crash or a phone restart a non-event.
- The token is **device continuity, not authentication** (PRD 1 §4). It answers *which
  team is this?*, nothing more.
- **If the token is unknown** (game deleted, database reset, token cleared), the device is
  returned to the team picker with a plain explanation rather than an error.
- `localStorage` survives what a session cookie would not — private-browsing modes are the
  known exception, and there the player simply picks their team again.

### 2.4 Switching team

A player who tapped the wrong row needs a way out. Available from a small menu, never
prominent — it is a correction, not a feature.

- **Their draft for the current question is discarded** (protocol P4): a draft belongs to
  `(question, team)`, and carrying one team's in-progress answer to another is worse than
  losing it.
- **Already-submitted answers stay with the team they were submitted for.** A device
  moving does not move history — which is the honest behaviour, and also why switching mid-
  game is rare enough to keep out of the way.

---

## 3. Stages

Rendered from `PlayerView.stage` (protocol §5.3). Exactly one at a time.

| Stage | Shows |
| --- | --- |
| `WAITING` | Team confirmed; the gentle wait screen (§4) |
| `BETWEEN_QUESTIONS` | Calm holding state; look at the main screen |
| `QUESTION` | The answer surface — §5–§8 by method |
| `JEOPARDY_BOARD` | The board, read-only (§9) |
| `BREAK` | Countdown to resume (§10) |
| `FINALE` | The `DSMTW_FINALE` round, watch-only (§10.1) |
| `FINISHED` | Final standings (§11) |

---

## 4. `WAITING` — the gentle wait screen

PRD 1 flow step 9 asks for a "gentle wait" screen. Its job is reassurance: *you are in,
you are on the right team, nothing is required of you.*

```
┌──────────────────────────────┐
│                              │
│            ●                 │
│      Quizzly Bears           │
│                              │
│      You're in.              │
│                              │
│      The quiz will start     │
│      soon — keep an eye on   │
│      the big screen.         │
│                              │
│      4 teams ready           │
│                              │
└──────────────────────────────┘
```

- **The team name and colour are the largest thing**, because the one mistake a player can
  make here is being on the wrong team, and this is where they'd notice.
- **No spinner.** A spinner says *something is loading*; nothing is. It invites a player to
  reload, which is the one thing that could actually go wrong.
- Points at the main screen, which is where the next thing happens.

---

## 5. `QUESTION` — shared rules

Before the per-method designs, five rules that apply to all of them.

### 5.1 Select is not submit (D44)

Typing and selecting are **freely reversible**; only an explicit Submit is final. Without
this, D43's finality would make a thumb-mis-tap on a radio option unrecoverable — and
mis-tapping on a phone in a dim pub is easy.

```
   ┌──────────────────────────┐
   │  ○  Radiohead            │   tap freely, change freely
   │  ●  Blur                 │
   │  ○  Oasis                │
   └──────────────────────────┘
   ┌──────────────────────────┐
   │        Submit            │   ← the only irreversible tap
   └──────────────────────────┘
```

The buzzer is the deliberate exception (§8): the buzz *is* the action, and its immediacy
is the whole point.

### 5.2 After submitting, it's over (D43)

The input locks. The screen shows what was submitted, plainly:

```
   ┌──────────────────────────┐
   │  Your answer             │
   │                          │
   │      Radiohead           │
   │                          │
   │  Locked in ✓             │
   └──────────────────────────┘
```

- **No edit affordance, no "change answer" link.** Ambiguity here invites a team to argue
  about whether they can still change it.
- **The submitted text is shown large**, because the next thing that happens is four people
  asking each other "what did we put?"

### 5.3 The second-device case (D43, D45)

Two devices on one team is the case that makes this non-trivial.

- **Drafts are shared.** Whatever one device types appears on the others (D45), so they
  normally hold the same text and can't diverge.
- **The first submission wins.** If a second device submits a *different* value it is
  rejected, and that device switches to showing the team's actual answer — *"Your team
  answered: Radiohead"* (protocol §7.3). It never silently discards what someone typed
  without telling them.
- **The focused field ignores incoming draft echoes.** A field being typed into must not
  be overwritten by the server echo of its own text, or the cursor jumps on every
  keystroke. Unfocused fields follow the server.
- **Honest limitation:** if two devices are typing *simultaneously* into a focused field,
  they will show different text until one blurs, at which point it snaps to the server's
  value. Rare (a team huddles round one phone), and the alternative — a real collaborative
  text merge — is disproportionate.

### 5.4 The timer

```
                    ┌────────┐
                    │   18   │
                    └────────┘
```

- Counts down against the server's absolute `deadlineAt` (D7), never a local `setTimeout`.
  A phone that connects three seconds late must not get 33 seconds.
- **At zero the client submits** whatever is currently entered (D8), flushing any pending
  debounce rather than waiting for it — a pending debounce at zero would race the submit.
- **The submit retries with backoff until acknowledged.** There is no server-side deadline
  to commit the draft on the team's behalf, so this retry *is* the safety net.
- **A phone asleep at zero submits when it wakes**, and the server accepts it — late
  submission is a feature, not an error (D8). This is the single most important consequence
  of the trust model for this surface.
- Below 10 seconds the number shifts colour and pulses. No sound (§13).

### 5.5 Attachments

Only images explicitly flagged for player devices appear here (D27). Audio and video never
do — twenty phones playing the same song a few hundred milliseconds apart is unusable, and
the speakers are at the main screen.

When a question has media the phone won't show, the screen says so rather than leaving a
gap: *"Look at the big screen."*

---

## 6. `FREE_TEXT`

```
┌──────────────────────────────┐
│  Who released "Kid A" in     │
│  2000?                       │
│                              │
│  ┌──────────────────────────┐│
│  │ Radiohead              _ ││
│  └──────────────────────────┘│
│                              │
│  ┌──────────────────────────┐│
│  │        Submit            ││
│  └──────────────────────────┘│
└──────────────────────────────┘
```

**Autocorrect and autocapitalisation are disabled on this field.** This is not a
preference — it is a correctness requirement. Matching is exact after lowercase and trim
(D22), and iOS autocorrect will happily turn `Radiohead` into `Radio head`, `Beyonce` into
`Bounce`, and any band name it doesn't know into something else. A phone keyboard silently
rewriting answers would produce a stream of wrong verdicts that neither the player nor the
master could explain.

```html
autocapitalize="off" autocorrect="off" spellcheck="false"
```

- **`enterkeyhint="send"`**, and the keyboard's action key submits. On a phone the return
  key is a deliberate press, and reaching a button above the keyboard is not.
- **The input stays visible above the on-screen keyboard**, which covers roughly half a
  phone screen. The prompt may scroll out of view; the input and Submit may not.
- **Landscape works**, because a team typing a long answer will rotate for a bigger
  keyboard.
- Draft is pushed on a ~500 ms debounce (D45), and again immediately on blur.

---

## 7. `MULTIPLE_CHOICE`

```
┌──────────────────────────────┐
│  Which of these never        │
│  charted?                    │
│                              │
│  ┌──────────────────────────┐│
│  │ ○  Creep                 ││
│  ├──────────────────────────┤│
│  │ ●  Karma Police          ││
│  ├──────────────────────────┤│
│  │ ○  No Surprises          ││
│  └──────────────────────────┘│
│  ┌──────────────────────────┐│
│  │        Submit            ││
│  └──────────────────────────┘│
└──────────────────────────────┘
```

- **Options fill the width and are tall** — full-row tap targets, not radio dots with
  labels beside them.
- **Options appear in their authored order**, identical to the main screen's, so a team
  looking up and down between the two isn't remapping anything.
- **Which option is correct is not in the payload** until reveal (PRD 1 §7 invariant 2),
  and option ids are UUIDs so nothing in what arrives ranks them (data model §4.6).
- The selection is a shared draft like any other (D45), so the other device shows it too.

---

## 8. `BUZZER`

The most latency-sensitive thing in the product, and the only place immediacy beats
confirmation.

```
┌──────────────────────────────┐
│  Name this song              │
│                              │
│  ┌──────────────────────────┐│
│  │                          ││
│  │                          ││
│  │         BUZZ             ││
│  │                          ││
│  │                          ││
│  └──────────────────────────┘│
└──────────────────────────────┘
```

- **The buzzer is nearly the whole screen.** A phone in the middle of a table gets stabbed
  at by whoever reacts first; a small button loses races to hand-eye coordination rather
  than knowledge.
- **Feedback is immediate and local** — the button state changes and the device vibrates on
  the tap, before the server responds. Waiting for a round trip to acknowledge a buzz feels
  broken even at 3 ms.
- **But it never lies.** Local feedback says *"buzzed"*, never *"you were first"*. First is
  a server fact (D35) and arrives a moment later:

```
   you buzzed  →  ✓ You're in! Answer out loud
              →  Norfolk & Chance got there first
```

- **Repeated taps are harmless** — the first buzz counts, the rest are no-ops.
- **Haptics where available.** `navigator.vibrate` works on Android and not in iOS Safari;
  the visual state change carries it everywhere.
- **Locked out** after a denial (D35) shows a disabled buzzer *with the reason* — never a
  dead control that looks broken:

```
   ┌──────────────────────────┐
   │   Your answer was wrong  │
   │   Other teams are        │
   │   buzzing now            │
   └──────────────────────────┘
```

- **Buzzers going live again** after another team's denial re-enables the button with a
  visible transition, so a team that looked away notices.
- **No buzz sound on the phone** (protocol P3). Twenty phones buzzing a fraction of a
  second apart is noise; the buzz sound belongs to the main screen.

### 8.1 `DO` questions

Nothing to submit (PRD 1 §8.6). The phone shows the challenge and points at the room:

```
┌──────────────────────────────┐
│  Build the tallest tower     │
│  from what's on your table   │
│                              │
│  50 points                   │
│                              │
│  ──────────────────────      │
│  The quizmaster is judging   │
│  this one. Look at the big   │
│  screen.                     │
└──────────────────────────────┘
```

No input control at all — **not a disabled one.** A greyed-out field invites a team to try
to type in it and conclude the app is broken.

---

## 9. `JEOPARDY_BOARD`

The board mirrors read-only (D16). Values and used state only — never prompts (PRD 1 §7
invariant 5).

```
┌──────────────────────────────┐
│  ● Norfolk & Chance pick     │
│                              │
│   GEO  FILM  MUS  SPO  RND   │
│   100   100  100   —   100   │
│   200    —   200  200  200   │
│   300   300   —   300  300   │
│   400   400  400  400   —    │
│   500   500  500  500  500   │
│                              │
│  Tell the quizmaster which   │
│  one you want.               │
└──────────────────────────────┘
```

- **Not interactive** — no tap targets, no hover states, nothing that suggests it is.
  Tiles are chosen by telling the master out loud (D16), and the line of copy says so
  explicitly, because a grid on a touchscreen invites tapping.
- Category names abbreviate on narrow screens; values are the readable element, since
  values are what teams call out.
- **The current picker is named at the top** so a team knows whether it's their call.

---

## 10. `BREAK`

```
┌──────────────────────────────┐
│         BACK IN              │
│          4:37                │
│                              │
│  1 ● Quizzly Bears     340   │
│  2 ● The Quizinart     310   │
│  3 ● Norfolk & Chance  290   │
│  4 ● Team 4            150   │
└──────────────────────────────┘
```

The countdown matters more here than on the projector: **the phone is in the pocket of
someone standing at the bar**, which is exactly the person the countdown needs to reach.
Counts down against the absolute `resumesAt` (PRD 4 §11); shows *"back shortly"* with no
clock when the master set no duration.

---

### 10.1 `FINALE` — watch-only

The finale is played **out loud** (PRD 1 §8.8). Nothing is typed, tapped or buzzed, so this
screen has no controls at all — but it is far from idle, because a team's clock is the most
important number of their evening.

```
┌──────────────────────────────┐
│  ● Quizzly Bears             │
│          138                 │
│                              │
│  ─────────────────────────   │
│  ● Norfolk & Chance          │
│    guessing now    84        │
│                              │
│  1  ████████                 │
│  2  Thriller      ● Quizzly  │
│  3  ██████ ████              │
│  4  Moonwalk      ● Norfolk  │
│  5  ████ ████████            │
│                              │
│  You're up next.             │
└──────────────────────────────┘
```

- **Whole seconds, never `m:ss`** (D57) — identical to the projector, so a table glancing between the two never has to reconcile two formats.
- **Your own clock is the largest thing on the screen.** Not the keywords, not whose turn it
  is — the number that decides whether your team survives. It is also what the table will
  stare at while someone else guesses.
- **"You're up next" when the team is `nextTeamId`.** Turn order is recomputed live, so a
  team's position can change while they wait; telling them means the table is ready rather
  than caught out.
- **The same blurred word shapes as the main screen** (D53) — identical `wordLengths`, no
  text until marked. A team huddled over a phone gets exactly what the room gets, which
  matters because they will be reading their phone rather than looking up.
- **The penalty is visible when it lands**: the clock jumps and briefly shows `−20s`. A number
  that silently drops looks like a bug; a number that drops with a label is the game working.
- **No input control of any kind** — not a disabled one (same rule as `DO`, §8.1). A greyed
  field invites a team to try to type an answer that would never count.
- **Non-finalists** get a spectator variant: the tiles, the clocks, and a line explaining they
  are not in the finale and their placing is already set.
- Eliminated teams see their own clock at `0` and `OUT`, and keep watching the rest.

---

## 11. Reveal, scores and `FINISHED`

At reveal the phone shows the team's **own** outcome. Never another team's answer — that
is forbidden in every state (PRD 1 §7 invariant 3).

```
┌──────────────────────────────┐
│  Correct answer              │
│      Radiohead               │
│                              │
│  You said                    │
│      Radio Head       ✓ 10   │
│                              │
│  ─────────────────────────   │
│  Quizzly Bears   340   2nd   │
└──────────────────────────────┘
```

- **Own verdict and points**, from `myVerdict` / `myPoints` (protocol §5.3).
- **A pending verdict says so** — *"the quizmaster is checking this one"* — rather than
  showing nothing. Validation may legitimately be outstanding (D42), and silence reads as
  a lost answer.
- **Live rank and score are always present** (protocol P2). It is public information
  already on the projector; hiding it on phones would make the two surfaces disagree, which
  reads as a bug rather than as suspense.
- `FINISHED` shows the full standings with the team's own row highlighted, and stays up.

---

## 12. Reliability

Everything in §1.1's environment conspires against a phone staying connected. This section
is where PRD 1 G3 and rule 1 are actually delivered.

| Threat | Mitigation |
| --- | --- |
| **Screen locks mid-question** | Kept awake — see §12.1. §5.4's late-submit-on-wake remains the backstop. |
| **Wifi drops** | `EventSource` reconnects automatically and receives the whole current view (protocol §3.2). **Typed text is never cleared on reconnect.** |
| **Offline while typing** | The field keeps working. Drafts fail to sync silently; the local text is what gets submitted. A small calm indicator shows the connection state — not a modal, and never over the input. |
| **Submit fails** | Retries with backoff until acknowledged (§5.4). The button shows a *sending* state rather than success. |
| **Tab closed / browser crashed / phone restarted** | Reopening resumes from `localStorage` (§2.3). |
| **Server restarts** | Reconnect, current view, nothing lost (D4, D38). |
| **Battery** | No looping animations, no polling, no video. One SSE connection is cheap; the wake lock is the main cost and is worth it. |

### 12.1 Keeping the screen awake (D48)

A phone locking mid-question is the most common way a team loses a question they knew the
answer to. So the screen is held awake — but **not** with the API you'd reach for first.

**`navigator.wakeLock` requires a secure context, and the LAN deployment is plain HTTP**
(PRD 1 §6.10). On `http://192.168.1.42:3000` the API is `undefined` — unavailable exactly
where it matters most. HTTPS on a LAN isn't an escape: a self-signed cert puts a security
warning between every guest and the quiz.

**Use [`nosleep.js`](https://www.npmjs.com/package/nosleep.js)** rather than hand-rolling
this. It uses the native Wake Lock API where available and falls back to a muted looping
video, which keeps the display on over plain HTTP on both iOS and Android. Reaching for the
library is the right call because the fallback has a set of browser quirks —
`playsinline` (without which iOS takes the phone fullscreen), codec pairs, autoplay
policies — that are exactly the sort of thing to inherit rather than rediscover.

```ts
const noSleep = new NoSleep()

// MUST be called inside a user-gesture handler. We already have the right one:
// the tap that picks a team (§2.2). No extra "tap to continue" screen.
onTeamPicked(() => noSleep.enable())
```

**Scope it deliberately** — this is the part the library can't decide:

| Event | Action | Why |
| --- | --- | --- |
| Team picked | `enable()` | The gesture we already have |
| `BREAK` starts | `disable()` | The phone is in a pocket at the bar; let it sleep |
| `FINALE` | keep enabled | The table is watching a clock for several minutes without touching the screen — the one stretch where a phone would certainly lock, and the worst time for it |
| Tab hidden | `disable()` | Nothing to keep awake for, and it would be lost anyway |
| Tab visible again, game `LIVE` | `enable()` | Both mechanisms drop on backgrounding |
| `FINISHED` / `ABANDONED` | `disable()` | |

A blanket two-hour hold would be a real battery cost on a phone already at 23% (§1.1), for
stretches when nobody is looking at it.

**Failure is silent and non-fatal.** If neither mechanism works, §5.4's
late-submit-on-wake means the team still doesn't lose the question — they just have to
unlock the phone to see it.

**Bundle cost is a few tens of KB** (the fallback embeds a tiny base64 video). Worth
noting because players load this over the master's laptop hotspot alongside twenty other
phones, but it is a one-off on first load and trivially worth it.

**A connection problem must never look like a scoring problem.** The indicator says
*"reconnecting"*, never *"your answer wasn't saved"* — a team that believes it lost points
will interrupt the quiz to argue about it.

---

## 13. Sound, motion and text

- **No sound at all on player devices.** Twenty phones making noise a fraction of a second
  apart is unusable — this is the same reasoning that keeps audio attachments (D27) and the
  buzz cue (protocol P3) on the main screen only.
- **Motion is functional only**: state changes, the buzzer's tap response, the timer pulse.
  Nothing decorative — it costs battery and adds nothing in a dim pub.
- **`prefers-reduced-motion` is honoured.**
- **Text is large by default**, because two or three people read this screen at once from
  an angle. Minimum 44×44 px tap targets, primary actions in thumb reach.
- **Full EN/NL parity** (D28) — this is a guest-facing surface, so it is a translation
  priority alongside the main screen, not an afterthought. Locale defaults to `en` (D17)
  unless the game sets otherwise (D29), and is switchable from the small menu.

---

## 14. The device menu

One small control, top corner, away from the buzzer. Everything in it is a correction or a
preference — nothing here is part of playing.

```
   ⋮
   ┌────────────────────────────┐
   │  Language      English  ›  │
   │  Switch team               │
   │  ────────────────────────  │
   │  Leave this quiz…          │
   └────────────────────────────┘
```

| Item | Behaviour |
| --- | --- |
| **Language** | Per-device locale (D13), defaulting to `en` (D17) or the game's default (D29). Shows language names in their own language, never a flag |
| **Switch team** | §2.4 — discards the current draft, keeps submitted history with the original team |
| **Leave this quiz** | Clears the `deviceToken` and returns to the team picker. **Confirmed**, because it genuinely severs this device's link |

- **Placement is deliberate: as far from the buzzer as the layout allows.** This surface's
  primary control is a near-fullscreen button being stabbed at by whoever reacts first
  (§8); a destructive action anywhere near it will be hit by accident.
- **"Leave this quiz" earns its place** even though it is destructive, because *"clear your
  browser storage"* is not an instruction you can give a pub guest. Without it, a phone
  handed to a different table between games, or stuck on a stale token, is unrecoverable
  and the master cannot help.
- The menu is **not available during buzzer questions while buzzers are live** — the whole
  screen is the buzzer at that moment, and a menu affordance would be a target competing
  with it.

---

## 15. Open questions

| # | Question | Recommendation |
| --- | --- | --- |
| ~~O1~~ | ~~Screen Wake Lock~~ | **Resolved → D48, §12.1.** Keep the screen awake via `nosleep.js` — `navigator.wakeLock` needs a secure context and the LAN is plain HTTP (PRD 1 §6.10). Scoped to player devices only, and to `LIVE` + visible. |
| ~~O2~~ | ~~Device reset~~ | **Resolved: yes** — "Leave this quiz" in the device menu (§14), confirmed, placed as far from the buzzer as the layout allows. |
| ~~O3~~ | ~~Opening a finished game's URL~~ | **Resolved.** `FINISHED` shows the final standings — the likely visitor is someone reopening a bookmark the morning after, and standings are what they want. `ABANDONED` gets a bare message. Neither is an error page. |
| ~~O4~~ | ~~Submission progress~~ | **Resolved: control only.** Not on phones *and not on the main screen* — it is pressure aimed at the slowest table and the only action it invites is rushing. `submittedTeamIds` removed from the `MAIN_SCREEN` payload entirely (protocol §5.2, PRD 4 §6). |
| ~~O5~~ | ~~Per-team question history~~ | **Resolved: not v1.** Can't be pushed (D39), so it needs a REST endpoint plus a screen to serve curiosity the reveal already mostly meets. Revisit if masters report teams asking. |
| ~~O6~~ | ~~Collapsing select-and-submit~~ | **Resolved: never.** Always two taps. A timer running out is when mis-taps are most likely, and D43 makes them unrecoverable. If the timer expires with a selection but no Submit, §5.4 auto-submits it anyway. |

---

## 16. Next

All five surfaces and both specs are drafted. Remaining: **`/CLAUDE.md`** per PRD 1 §13 —
the agent onboarding document, which can now point at real conventions rather than
describing them twice.
