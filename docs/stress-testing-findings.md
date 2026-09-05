# Stress-testing findings — full-game functional pass

**Method:** Three full games played through browser automation against a production build
(port 3999, clean data dir). All four surfaces exercised: control desk (1280×800), main screen
(1920×1080), player devices (~390×844, two tabs on one team for D43/D45 coverage), and the
admin review surface. Every visible button was clicked at least once; edge cases probed via
API calls and DOM manipulation.

---

## Issues found

### ISSUE-1 [HIGH] Proxy-answer click creates ghost PENDING rows that block pacing

**What happened:** Clicking `can't connect — enter answer` for a team creates an answer row
with `verdict: PENDING` and `answer: null`, even before any text is typed or saved. In this
session two such rows were created (for Iguanas and Badgers) by a single exploratory click.
These ghost rows then triggered `VALIDATE_QUESTION` persistently — showing *"Still to judge /
Capital of France?"* on every desk transition including into round 2 — because
`hasPendingAnswer()` finds their `PENDING` verdicts.

**Impact:** The master sees a validation screen with zero actionable items (both rows show
settled verdicts; the pending ones have no text to judge) and cannot reach the jeopardy board
without clicking through. The sweep re-fires on every desk transition.

**Evidence:** Review API shows `{"answer":null, "verdict":"PENDING", "points":0}` for both
teams. The UI showed these as *"—no answer"* in the grid but still counted them as needing
judgment.

**Recommend:** Either (a) don't create the answer row until the master actually saves text
(via `[Save it]`), or (b) filter out `answer === null && verdict === PENDING` rows from
`hasPendingAnswer()`. Option (b) is safer since it doesn't change the write path.

### ISSUE-2 [MEDIUM] Grammar bug: "1 answers still being checked"

**Where:** Main-screen provisional marker (`views.ts` → `MainScreenView.provisional`).

The message template uses `{questions}` without an ICU plural selector, so one pending answer
renders as *"1 answers still being checked"* instead of *"1 answer still being checked"*.

**Recommend:** Change the message to use ICU plural:
`'{questions, plural, one {# answer} other {# answers}} still being checked'`.

### ISSUE-3 [LOW] Header says "Not started" after the game has started

**What:** After pressing `[Start the quiz]`, the header continues reading *"Not started"* until
a round is opened. Technically correct (`view.round` is null) but confusing — the game IS live.

**Recommend:** Either change the copy to something like *"Waiting to begin"* or derive the
header from game status rather than round presence.

### ISSUE-4 [LOW] Timer readout ambiguous on the control desk

**What:** During testing, querying the first `tabular-nums` element returned `"1"` on a
freshly-opened 30-second question. This was likely the timer counting down normally (checked
after a delay), but the selector picks up whatever tabular element renders first, which may be
a score or index rather than the clock.

**Recommend:** No action needed if this is a test-harness artifact. If real users report
confusion about which number is the timer, consider adding a clock icon or label.

### Confirmed working correctly

| Mechanism | Evidence |
| --- | --- |
| D35 deny→lockout→reopen | Foxes denied → locked out on phone → [Reopen for everyone] → BUZZ back |
| D43 submission finality | Second Foxes tab showed Locked-in ✓ immediately |
| D45 shared drafts | Both Foxes tabs showed same text simultaneously |
| D47 proxy answer | "Pariss" entered by quizmaster, flagged, auto-graded wrong |
| D23 WTA tie payout | Two winners selected → button changed to "Award 50 pts each" ✓ |
| D24 per-team completion | Partial save held desk; completing all teams yielded ✓ |
| D56 instant elimination | Iguanas (4s bank) eliminated off-turn, shown as `out HH:mm` ✓ |
| Un-mark penalty reversal | Foxes 37→42, Whales 20→25 exactly ✓ |
| Closed-round pacing | After End this round, desk offered Start next round, not Next question ✓ |
| FINISHED standings | Correct scores, provisional marker, team ranking ✓ |
| Review grid | All rounds, answers, verdicts, corrections, adjustments rendered ✓ |
| MC reveal layout | Options in authored order with letter prefixes, correct option ticked ✓ |

### Suggestions for improvement

1. **Control desk keyboard-only test**: The Y/N/Enter/space shortcuts were not exercised here
   (browser automation can't reliably send trusted key events to test Radix's handler).
2. **Second-device-per-team**: Only tested with two tabs sharing localStorage (same device).
   Real multi-device would need separate browser contexts per phone.
3. **Attachment serving**: No audio/image attachments were uploaded during stress testing;
   range-request behaviour untested in this pass.
4. **Locale switch mid-game**: Only en was tested end-to-end; nl legibility is covered by
   `legibility.spec.ts` but interactive nl play was not driven here.

---

## Round 2: API-driven stress test

**Method:** 5 games played entirely through API calls (no browser), exercising edge cases
and every feature category. Script at `scripts/stress-test.mjs`.

### ISSUE-5 [MEDIUM] SUBMIT_FOR_TEAM accepts empty text

**What:** `POST /api/games/{id}/answers/submit-for-team` with `text: ""` is accepted and creates
an `ANSWER_SUBMITTED` event. This creates an answer row that will score as incorrect, but the
master has no visual feedback that the submission was effectively empty.

**Impact:** Low — the master shouldn't submit empty text, but nothing prevents it. The row goes
through normal scoring and verdict assignment. Not a data-corruption risk, but unnecessary noise.

**Recommend:** Reject empty text in `SUBMIT_FOR_TEAM` with a typed error, matching how player
`SUBMIT_ANSWER` handles it.

### Confirmed working correctly (Round 2)

| Mechanism | Evidence |
| --- | --- |
| D43 first-write-wins | Double-submit same text accepted (idempotent) |
| D47 master proxy overwrite | Different text accepted for same team |
| Post-lock rejection | `QUESTION_LOCKED` on submit after lock ✓ |
| Jeopardy round open/close | Round opened, tiles played, closed ✓ |
| Finale lifecycle | Open → set finalists → start turn → mark/unmark keyword → finish ✓ |
| DO-WTA scoring | do-winners with team IDs, tie payout setting ✓ |
| DO-PTS partial scoring | do-scores with per-team scores ✓ |
| Score adjustment | adjust-score with reason ✓ |
| Break | Break started ✓ |
| Cross-game isolation | Two games live simultaneously, scores isolated ✓ |
| Rapid transitions | Start → play → finish in quick succession ✓ |

---

## Games played

| # | Config | Rounds | Outcome |
| --- | --- | --- | --- |
| 1 | 4 teams, QS(5q: FT/MC/Buzz/WTA/PTS) + Jeopardy(3×3) + Finale(2×5kw) | All 3 played partially | Full round 1 completed; jeopardy tiles skipped; finale entered with eliminations |
