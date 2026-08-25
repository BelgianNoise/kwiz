# Field rehearsal — the human pass

**Status:** Runbook for slice 10 · ready to execute · findings feed back into the suite

Slice 9's suite proves the **software** works: 32 browser journeys, both locales' legibility
floor, URL rules, kill-and-restart. This rehearsal proves the **system** works — hardware,
network, room, and the checks agent-workflow §4.5 says no browser can make. It exists as a
runbook because "run a real quiz and write down what broke" without one becomes an evening of
improvisation and half-remembered failures.

**How to use it:** execute top to bottom on the night (or a dedicated dry-run). Annotate
directly — every step has a *watch for* line; anything unexpected goes in Findings at the
bottom, whatever it is. Afterwards, triage Findings per §Triage.

---

## Bring

| Item | Why |
| --- | --- |
| Laptop + charger | Battery + projector = death by power save |
| Projector + cable/adapter | The second display |
| Extension lead / power strip | Venues never have enough sockets where you need them |
| Speaker (if using venue audio) | The arming click proves laptop audio; venue PA is another path |
| 3+ charged phones | At least two on one team (D43/D45 are invisible with one phone each) |
| Phone stand or printed QR fallback | For the back-of-the-room scan test |

## Before doors (~30 min)

1. **Start the app**: `pnpm build && pnpm start` on the laptop. Note the port.
   - *Watch for:* migration prompt on an existing data dir — decide deliberately, don't
     reflex-accept; it writes a timestamped backup first.
2. **Network picker** (`/admin/setup`): choose the interface on the **venue wifi**, not
   ethernet-to-projector-only, not a VPN adapter. `[Test with my phone]` must end with
   *"Your phone reached this machine."*
   - *Watch for:* a stale saved address banner — re-pick before the room arrives.
3. **Create tonight's game** with real team names and the real question count.
4. **Projector**: extend (not mirror) at 1920×1080 if possible. Eyeball the safe area —
   nothing important within ~5% of any edge.
   - *Watch for:* overscan clipping the join code or the timer ring.
5. **Scan test from the back**, under room lights, from 3–5 m. Two phones join; put a second
   phone on one team.
   - *Watch for:* the URL fallback (`and enter`) being readable even if scanning fails.
6. **Arm the projector** (click anywhere): `♪ sound ready` must appear.
   - *Watch for:* `Sound could not start` — click again once; if it persists, stop and fix
     before doors, not mid-round.
7. **Browser console clean** on control and screen (F12 → Console): React warnings count.
8. **Baseline sanity**: `pnpm e2e` passed on this machine before you left home. If it didn't,
   the rehearsal measures a moving target.

## The walkthrough (~25 min dry-run quiz)

Drive one short quiz across every mechanic. Each numbered step lists what to *do* and what to
*watch for* — the watch-fors are where rehearsals earn their keep.

### Phase A — doors open
1. Teams join while the waiting screen is up.
   - *Watch for:* device counts updating live; a full team shown **with its reason**, still
     listed (D20); late joiners mid-phase-A also fine.
2. Start the quiz.
   - *Watch for:* `[Start the next round]` offered immediately — a dead leaderboard here was
     slice 5's worst bug.

### Phase B — QUESTION_SET round
3. Open the free-text question with a timer. Let it expire with an answer typed but unsubmitted.
   - *Watch for:* `Time up`, then auto-submit of the typed value; the question **stays open**
     (D8); a late manual submit still counts.
4. Submit wrong-ish answers from two teams ("Radiohead" vs "radio head"). Judge inline.
   - *Watch for:* auto ✓ vs pending [Y][N]; overriding to correct updates the rail immediately.
5. Lock, reveal, spotlight one answer.
   - *Watch for:* two beats on the projector (correct answer, then the spotlit answer); the
     spotlight button reading `On screen`.
6. Multiple choice next: both teams submit differently, lock, reveal.
   - *Watch for:* dots land on options ~1.5 s **after** the tick, not simultaneously.
7. Score, then adjust a score ±5 with a reason; undo it.
   - *Watch for:* the projector banner with team, signed delta, reason (~6 s); undo reconciles
     totals and leaves the row struck through; **undo announces nothing**.
8. Skip the last question via the menu.
   - *Watch for:* nobody paid, including auto-graded answers (D46); pacing offers the next
     round, not the skipped question.
9. End this round early with a question still pending somewhere (or reuse step 8's round).
   - *Watch for:* `[Start the next round]` offered — **never** `[Next question]` into the ended
     round; the timeline shows history but no open link (PRD 3 §9.2).

### Phase C — break
10. Start a 5-minute break. Watch it tick on projector **and** phones. Let it hit zero.
    - *Watch for:* `Starting soon` at zero, and **nothing resumes by itself** (D8); attention
      stays NONE on the desk; `[Resume]` is the only way back. Extend once mid-break.

### Phase D — Jeopardy
11. Open the board. Check picker logic against scores; hover tiles to read prompts privately.
    - *Watch for:* lowest score named; ties show the chooser instead; spent tiles read `played`.
12. Play a tile: buzz, adjudicate, deny once, let another team buzz.
    - *Watch for:* buzz timings to two decimals on the projector; denied team struck through;
      `BUZZERS OPEN`; the desk handing back to the board after scoring (D16/D30).
13. Try to open a tile after ending the round early.
    - *Watch for:* refused — closed rounds don't reopen (§9.2).

### Phase E — DO
14. One winner, one tie, one nobody.
    - *Watch for:* tie button saying "each" vs "split" per authored config; per-team mode
      holding the desk while teams are blank, yielding when the last score lands; clamping on
      entry, not on save.

### Phase F — finale
15. Pick finalists (deselect one), start, mark keywords with `1`, un-mark with `Shift+1`,
    pass with `Space`.
    - *Watch for:* penalty flash on **every other** clock; un-mark returning seconds to everyone;
      turn order recomputing after penalties; off-turn elimination announced on the projector;
      whole seconds everywhere (D57); word shapes never words until marked (D53).
16. Run to one survivor (or exhaust questions), end the game.
    - *Watch for:* FINISHED with survival ranking; tabs switched **from control**; pre-finale
      points tab disagreeing with survival — that disagreement is the feature (D51).

### Phase G — failure drills (after the room has seen everything)
17. Kill the server mid-question (close the lid isn't enough — end the process). Restart.
    - *Watch for:* a quiet pulse, last view held, full state back on reconnect with **no
      reload and no clicks** on any of the four surfaces (D4, D38).
18. Flip the projector to `/nl` and walk the current stage.
    - *Watch for:* Dutch running 20–30% longer — round intro line, clock strip, and board
      categories overflow first (PRD 1 §9.2).

## Physical-only checks

These cannot be automated and this runbook cannot substitute for them:

| Check | Method |
| --- | --- |
| iOS autocorrect mangling answers | Type "Radiohead" into Notes first, then the answer field; compare |
| `nosleep.js` keeping phones awake | Phone idle screen-on through one full round |
| Haptics on buzz | Feel it — Android only |
| Projector contrast / washed palette | Squint from the back row; check the dimmest team colour |
| Ten-plus devices on the hotspot | Whatever the venue will actually host; watch join latency |
| 10 m legibility | Read the timer, join code and buzz name from the back wall |

## Triage

Every Finding gets exactly one verdict:

1. **Automatable** → add to `e2e/specs/` (see `legibility.spec.ts` for the stage-walk pattern;
   scenario numbering follows build-order groups). Cite the finding in the spec's comment.
2. **Product bug** → fix branch off main, smallest change that closes it, spec included.
3. **Copy or doc gap** → PRD/spec edit in the same commit as any code it justifies.
4. **Physical/hardware** → note it; it recurs until the hardware changes.

Then append a paragraph to `docs/slice-log.md` — what broke, what it cost, what it changed.

## Findings

*(annotate during the run)*

| # | Phase | What happened | Verdict |
| --- | --- | --- | --- |
| 1 | | | |
| 2 | | | |
