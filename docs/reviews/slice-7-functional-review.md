# Slice 7 — Functional Review

**Companion review to** [`slice-6-functional-review.md`](slice-6-functional-review.md) /
[`slice-6-code-review.md`](slice-6-code-review.md). This document covers the fixes made in
response to that review round, and slice 7 itself — the player device (PRD 5), the last of the
four surfaces. **All four surfaces now exist.**

**Reviewer:** independent audit, same method as the previous three rounds — ground truth
confirmed directly (`pnpm check`: 682 tests / 44 files, all green), PRD 5 and the current
protocol.md re-read in full, and a set of parallel deep-dive agents each re-verifying claims
against the actual current code.

## Verdict

**21 of 22 findings from the slice 6 review round are fixed**, several exceeding the literal
recommendation (the simultaneous-elimination fix handles both simultaneous *and* rapid-sequential
eliminations; the vitest `@/`-alias blocker was resolved rather than worked around, and the
finale-stage decision logic was additionally extracted into pure, directly-testable functions).
The one open item (`SCOREBOARD_TOGGLED` unguarded against an open question) was explicitly not
asserted as a confirmed bug in the original review.

**All nine bugs slice 7's own two-pass self-audit found and fixed are genuinely fixed**, verified
independently against the current code, not the commit messages.

**This audit found one further CRITICAL area and several MAJOR gaps, concentrated almost entirely
in the buzzer and in device-recovery paths** — exactly the two places this surface's own
architecture makes hardest to test (`buzzer.tsx` cannot be unit-tested at all in this vitest
config, and device-recovery is a multi-navigation client flow no domain test can reach). The
buzzer is PRD 5's own stated "most latency-sensitive thing in the product" and the mechanic
CLAUDE.md names by number as a must-test path (D35's deny→reopen loop) — it is currently broken
for exactly the multi-team, multi-device scenarios that mechanic exists to handle.

**Recommend fixing the CRITICAL findings before any live event** — both are reachable in an
ordinary game (any buzzer question with more than two teams; any device whose token goes stale)
and both leave a team with no way to participate, silently.

---

## Priority 1 — Fix before any live use

### 1. [CRITICAL] The buzzer's post-buzz outcome logic is broken for two of its three real audiences

**Where:** `apps/web/components/player/buzzer.tsx`, `packages/domain/src/derive.ts`

PRD 5 §8 calls the buzzer "the most latency-sensitive thing in the product," and D35's deny→
lockout→reopen loop is one of the two mechanics CLAUDE.md names explicitly as must-test. On the
player device, it is currently wrong for both audiences that aren't the single device that
happened to win the buzz:

**(a) A team that hasn't buzzed at all gets stuck after any deny+reopen.** `firstBuzzTeamId`
(`derive.ts`) is derived as the chronologically-first-ever buzz on the question, with **no
filtering by `forceReopenedAt`** — unlike `lockedOutTeamIds`, which correctly filters denials by
`since = play.forceReopenedAt ?? 0`. So once *any* team has ever buzzed on a question,
`firstBuzzTeamId` stays non-null for the rest of that question's life, through every subsequent
denial and reopen. `buzzer.tsx`'s render gate is `tapped || first !== null` — once that's true
for a team that never personally buzzed, they permanently fall into the static outcome view
("✓ You're in! Answer out loud") instead of ever seeing the live `BUZZ` button reappear, even
though `buzzersLive` has correctly flipped back to `true` server-side. A team that hasn't had a
turn yet is silently locked out of a mechanic that exists precisely to give them one.

**(b) A second device on the *winning* team, or a device that tapped but lost, gets the wrong
message.** `Outcome`'s `mine` prop is purely local per-device tap state (`tapped`), never compared
against `firstBuzzTeamId === ownTeamId` — and `Buzzer` isn't even given the team id to make that
comparison, since its props are `question, gameId, token` only. Consequences: a device that
tapped but lost the race still shows "You're in! Answer out loud" (because `mine` is true
regardless of who actually won); a second device on the team that *won*, which didn't personally
tap, shows "Another team got there first" — the exact opposite of the truth.

Only the single case of "the one device that tapped happens to be on the team that won" renders
correctly. This is precisely the two-device-per-team scenario this project's own slice-6/7
driving sessions were built to exercise for every other answer method — but the smoke checklist's
buzzer row only exercises two devices on *different* teams, so neither failure mode was walked.
No test exists for `buzzer.tsx` at all (Vitest can't import `.tsx` in this workspace's config, and
unlike the auto-submit logic, this decision was never extracted into a plain-`.ts`, directly
testable function).

**Recommend:** thread the device's own `teamId` into `Buzzer`/`Outcome` and decide the message
from `firstBuzzTeamId === ownTeamId` rather than local tap state; scope `firstBuzzTeamId`'s
derivation by `forceReopenedAt` the same way `lockedOutTeamIds` already is, so a team that hasn't
buzzed sees the live button again after a reopen. Extract the decision into a pure, testable
function the way `answer-moments.ts` already does for the auto-submit logic — this is exactly the
kind of change CLAUDE.md §6 asks for, and it would have made this bug visible without a browser.

### 2. [CRITICAL] An unknown/stale device token traps the player in an infinite redirect loop

**Where:** `apps/web/components/player/player-game.tsx`, `apps/web/components/player/
team-picker.tsx`, `apps/web/lib/client/device.ts`

PRD 5 §2.3 is explicit: *"If the token is unknown (game deleted, database reset, token cleared),
the device is returned to the team picker with a plain explanation."* This is exactly the case a
tired player is most likely to hit — a bookmark reopened after the master deleted the game, a
database reset between events, or a token that's simply gone stale.

What actually happens: on `error === 'UNKNOWN_DEVICE'`, `player-game.tsx` redirects to
`/play/${code}?rejoin=1` **without clearing the stale token** — `clearDeviceToken` is only ever
called from the explicit "Leave this quiz" menu action. Meanwhile the team picker unconditionally
redirects straight back to the game page whenever *any* token is present for that game,
regardless of validity — it never inspects `?rejoin=1` at all (confirmed dead: nothing in the
codebase reads that parameter). The result is a closed loop: game page → 401 `UNKNOWN_DEVICE` →
redirect to picker → picker sees the still-present stale token → redirects straight back to the
game page → 401 again — forever, with no picker ever rendering and no explanation ever shown.
This is unrecoverable by the player; only "Leave this quiz," which they have no reason to look
for since nothing tells them their token is the problem, gets them out.

**Recommend:** the `UNKNOWN_DEVICE` handler in `player-game.tsx` must clear the device token
before redirecting (mirroring what "Leave this quiz" already does), so the picker's normal
no-token path renders instead of bouncing straight back.

---

## Priority 2 — Major, fix before slice 8

### 3. [MAJOR] `DO` and `BUZZER` reveals show a blank "Correct answer" and a false "Nothing submitted"

**Where:** `apps/web/components/player/question.tsx` (`Reveal`)

`QuestionStage` routes every answer method through the same generic `Reveal` component once
revealed, with no special-casing for `DO`/`BUZZER`. For both methods, `acceptedAnswers` is
legitimately empty (there's nothing to type or select) and the server always writes
`text: null, selectedOptionId: null` for these outcomes even when the team was correctly scored.
`Reveal` doesn't know this: it renders the "Correct answer" heading over nothing, and — because
`myAnswer.submitted` is `true` while `myAnswer.text` is `null` — the "You said" section shows the
literal "Nothing submitted" message, even for a team that answered correctly out loud or
completed a `DO` challenge and was scored for it. This is misleading precisely on the two
answer methods where something real happened in the room but nothing textual did, and it's a
common path in a live buzzer- or challenge-heavy round.

**Recommend:** special-case the reveal for `DO`/`BUZZER` — omit the "correct answer"/"you said"
text entirely and show only the verdict/points, which is all these methods can honestly report.

### 4. [MAJOR] Switching team silently swallows a refusal (e.g. a full team)

**Where:** `apps/web/components/player/device-menu.tsx`

The switch-team action resolves to a typed `ActionResult` and never rejects — the server does
enforce `TEAM_FULL` — but the menu's handler runs `.then(() => setOpen(false))` unconditionally,
regardless of `result.ok`. A player who taps a full team from the switch menu gets zero
feedback: the menu just closes, the team hasn't actually changed, and nothing anywhere explains
why. This directly contradicts D20's own stated philosophy — *"a full team is shown with its
reason, never hidden"* — except here it isn't shown at all, because `PlayerView.otherTeams`
doesn't carry a device count for the switch-team list to check against ahead of time, and the
refusal (the only available signal) is discarded.

**Recommend:** check `result.ok` before closing the menu, and surface the refusal (reusing the
join picker's "already has N phones" copy, or an equivalent inline message).

### 5. [MAJOR] The buzzer occupies roughly half the screen, not "nearly the whole screen"

**Where:** `apps/web/components/player/buzzer.tsx`, `apps/web/components/player/question.tsx`

PRD 5 §8 uses "nearly the whole screen" and "near-fullscreen" to describe this control, with an
explicit rationale: *"a small button loses races to hand-eye coordination rather than knowledge."*
The actual button is fixed at `min-h-[45dvh]` and shares the screen with a timer, the prompt, a
media placeholder, and an always-rendered footer — on a typical phone viewport that's roughly
45–50% of the visible area, not the dominant near-fullscreen target the spec's own mockup and
rationale call for.

**Recommend:** let the buzzer fill remaining space (`flex-1` or equivalent) rather than a fixed
viewport-height fraction.

---

## Priority 3 — Minor

| # | Finding | Where | Note |
| --- | --- | --- | --- |
| 6 | `protocol.md` §5.3's `PlayerView` type is stale — missing the `abandoned` field the shipped code actually has and tests | `docs/spec/protocol.md`, `packages/domain/src/views.ts` | The field itself is correct and well-tested; only the normative spec document wasn't updated to match, the same class of drift found (and by-then-usually-avoided) in earlier slices |
| 7 | The EventSource reconnect loop keeps running (masked, not stopped) after a game ends | `apps/web/lib/client/use-live-view.ts`, `apps/web/components/player/player-game.tsx` | The visible "reconnecting" band is correctly suppressed (bug #9's fix), but the underlying retry loop itself isn't torn down — a phone left open on a finished game keeps reopening connections against nothing, in tension with §12's "no polling" battery row |
| 8 | The submit button briefly flickers back to plain "Submit" during the retry backoff wait | `apps/web/lib/client/use-submit.ts`, `apps/web/components/player/question.tsx` | `state` is briefly `'IDLE'` between a failed attempt and the next retry, contradicting §12's "the button shows a sending state rather than success" — not a functional failure (a manual tap during this window correctly cancels and resends), just a confusing flicker |
| 9 | `nosleep.js`'s `enable()` doesn't run literally inside the team-pick click handler, unlike PRD 5 §12.1's explicit "MUST be called inside a user-gesture handler" instruction | `apps/web/lib/client/use-wake-lock.ts` | Low risk in the actual deployment: native `navigator.wakeLock` is `undefined` on the plain-HTTP LAN target anyway (§6.10), so only the muted-video fallback is ever exercised, and that generally doesn't require a strict gesture. Worth knowing if this is ever tested over HTTPS/localhost |
| 10 | `views.sentinel.test.ts`'s two positive-direction finale-keyword assertions ("absent while unmarked," "appears once marked") only check `MAIN_SCREEN`, not `PLAYER_A` | `packages/domain/src/views.sentinel.test.ts` | The code is correct by construction (both audiences funnel through the same `finaleView`/`keywordView` functions, and the third assertion in the same block — revocation — does check both), but the test doesn't independently prove it for `PLAYER` |
| 11 | `protocol.md` §2.1's justification for moving the SSE device token into a query parameter slightly understates one real cost: a fronting reverse proxy's default access log (which typically records the request line/query string but not headers) will now persistently record team-identifying tokens where it previously wouldn't | `docs/spec/protocol.md` | The overall decision is sound and well-reasoned for this trust model (the token still isn't authorisation, and PRD 1 §4 already accepts stronger unauthenticated capabilities) — this is a documentation-completeness note, not a reason to reverse the decision |

---

## Carried over from the prior review — verification results

Every finding from `slice-6-functional-review.md` and `slice-6-code-review.md` was independently
re-checked against current code. **21 of 22 findings are confirmed FIXED**, several structurally
exceeding the literal recommendation:

- The HIGH finding (a deleted/not-found game freezing the last frame) is fixed with an explicit
  `status === 'FAILED'` branch.
- The simultaneous-finale-elimination bug is fixed by switching from `.find()` to `.filter()` and
  accumulating across updates — verified to handle both a simultaneous and a rapid-sequential
  multi-team elimination, with new tests covering both.
- The missing keyword-attribution rendering, the sub-4vh arming text, the missing count-up
  numbers, the orphaned `usePrefersReducedMotion` hook, the broken sound-arm retry copy, and the
  `ABANDONED`-renders-as-`FINISHED` bug are all fixed — the last one via a genuine new `abandoned`
  boolean field on both `MainScreenView` and (as this round confirms) `PlayerView`, rather than a
  workaround.
- The code-review's `minuteSeconds` duplication was resolved by extracting it to a neutral
  `apps/web/lib/format.ts` — and this round confirms the player surface correctly reuses that same
  helper rather than adding a fourth copy.
- The vitest `@/`-alias blocker (which had been an open, admitted gap since slice 5) was actually
  resolved in this fix pass, and the finale-stage's two previously-untested hooks were
  additionally refactored into pure, directly-tested decision functions — closing the root cause
  of the coverage gap, not just adding a workaround test.
- **One item remains open**: `SCOREBOARD_TOGGLED` still has no guard against an open question, and
  no decision-log entry was added either. The original review explicitly declined to assert this
  as a confirmed bug, so this is a carried-forward "worth a decision" item, not a regression.

**No regressions were found in any of the fixes.**

---

## What was verified as genuinely correct in slice 7

- **All nine bugs slice 7's own two-pass self-audit reports were independently re-verified as
  genuinely fixed**: the empty-answer auto-submit, the auto-submit effect re-arming on every
  keystroke, the missing question+team keying (verified fixed on *both* axes — a new question and
  a team switch both correctly force a remount and discard stale state), the raw 404 on a stale
  game-route reload, `ABANDONED` announcing standings, the missing "You said" line, the missing
  own-rank display (confirmed present in *every* question state, not only the branch the original
  fix commit touched), and the reconnecting band failing to clear after a game ends (the visible
  symptom is fixed; see minor finding #7 for the underlying loop that's merely masked).
- **The buzzer's other properties are all correct**: local feedback is genuinely synchronous
  (state updates before the network call, never gated on a response) and never claims "first";
  repeated taps are harmless because the button itself unmounts after one tap; haptics are
  properly feature-detected (`navigator.vibrate?.()`, silently absent on iOS); the locked-out
  state shows its reason as text, not just a disabled control. (The outcome-*message* logic that
  sits downstream of these correct primitives is what's broken — see finding #1.)
- **`rankAmong`/`standings` genuinely share one tie-rule implementation**, cross-checked by a test
  that walks six score shapes including a three-way tie and a rank-skip case — so the phone and
  the projector cannot disagree about a team's rank.
- **The device-token-in-URL security trade-off is sound for this product's trust model**, verified
  by independent critical assessment rather than trusting the spec's own reasoning: the token
  remains high-entropy, POST actions still use the header (the query parameter is additive, not a
  replacement), and a leaked token grants strictly less than capabilities PRD 1 §4 already
  concedes to anyone on the network. The one real gap (reverse-proxy default logging, minor
  finding #11) is a documentation completeness note, not a reason to reverse the decision.
- **`use-wake-lock.ts`'s full §12.1 scoping table is correctly implemented**, including the one
  row most likely to be gotten backwards (kept *enabled*, not disabled, during the `FINALE`
  stage) and `nosleep.js` is genuinely lazy-loaded rather than bundled into initial page load.
- **No in-browser QR/camera scanning exists anywhere** — correctly deferring to the phone's native
  camera per PRD 1 §6.10's secure-context constraint.
- **Cross-surface architectural separation holds**: `components/player` never imports from
  `components/screen` or `components/control`; three genuinely independent `Dot` components exist
  rather than one shared one creating cross-surface coupling; the stage switch ends in the same
  `const unhandled: never = stage` exhaustiveness pattern used on the other two surfaces.
- **FREE_TEXT's autocorrect-defeating attributes are present and correct** on the actual DOM
  element (`autoCapitalize="off" autoCorrect="off" spellCheck={false}`), not merely claimed in a
  comment. Tap targets meet the 44×44px floor throughout, and EN/NL parity holds across the full
  `player` message namespace.
