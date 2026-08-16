# Slice 7 — Code Review

**Companion to** [`slice-7-functional-review.md`](slice-7-functional-review.md), which covers
spec/requirement compliance for the player device (PRD 5) — the last of the four surfaces — and
the fixes made in response to the slice 6 review round. This document covers architecture,
maintainability, and test quality.

**Verdict up front:** the slice 6 fix pass was, once again, structural rather than cosmetic — it
resolved a standing, admitted infrastructure gap (vitest's unresolved `@/` alias) rather than
working around it, which is exactly the kind of fix that pays off for the next slice too. Slice
7's own domain-layer work (the shared `rankAmong`/`standings` tie rule, the `abandoned` flag, the
device-token protocol change) is well-reasoned and well-tested. The gaps this round are
concentrated almost entirely in one component — `buzzer.tsx` — which is also the one component
this project's test infrastructure structurally cannot reach, and in one un-owned client-side
recovery flow (the `UNKNOWN_DEVICE` redirect). Both are exactly the kind of gap CLAUDE.md §6
predicts: logic that belongs in a pure, testable function is instead living where only a browser
can see it go wrong.

---

## Findings

### 1. `buzzer.tsx`'s outcome logic is the one place this slice didn't apply its own established pattern

**Where:** `apps/web/components/player/buzzer.tsx`, `apps/web/components/player/
answer-moments.ts`

This slice's own log records a good lesson from slice 6: pull change-detection and decision logic
out of a component into a plain, directly-testable `.ts` function, because vitest can't import
`.tsx` in this workspace. `answer-moments.ts` does exactly this for the auto-submit-at-zero
logic, and it's exactly why that logic's edge cases (including two of the three self-reported
bugs) are now covered by a real test. `buzzer.tsx`'s outcome decision — arguably *more*
safety-critical, since it's the surface for D35's deny→reopen loop, one of two mechanics CLAUDE.md
names by number as a must-test path — never got the same extraction. It's exactly where this
review found a real, multi-part bug (functional review finding #1), and exactly the kind of thing
that pattern was built to catch.

**Recommend:** extract `Buzzer`/`Outcome`'s decision (given `question`, the device's own `teamId`,
and local `tapped` state, what should render) into a pure function alongside
`answer-moments.ts`, the way the auto-submit logic already is. This both fixes the underlying bug
and puts it under the kind of test that would prevent it recurring.

### 2. The `UNKNOWN_DEVICE` recovery path has no single owner

**Where:** `apps/web/components/player/player-game.tsx`, `apps/web/components/player/
team-picker.tsx`, `apps/web/lib/client/device.ts`

The redirect loop in functional finding #2 exists because clearing a stale token and redirecting
away from it are two different files' responsibility, and neither one is checking what the other
assumes: `player-game.tsx` redirects on `UNKNOWN_DEVICE` without clearing the token (only "Leave
this quiz" in `device-menu.tsx` does that), and `team-picker.tsx` redirects straight back
whenever *any* token is present, without distinguishing "a token that already proved valid this
session" from "a token that error handling just bounced off of." The `?rejoin=1` query parameter
exists specifically to communicate the second case and is dead code — nothing reads it.

**Recommend:** the token-invalidation and the redirect-away-from-it should happen in the same
place, ideally the exact same call as `clearDeviceToken`. If a "we just failed with this token"
signal needs to reach the picker for messaging purposes, don't route it through an unread query
parameter — check it explicitly on mount and delete the dead parameter, or drop it.

### 3. Two related fields (`PlayerView.abandoned`, protocol.md §5.3) are correct in code and stale in the spec — a small but recurring pattern worth naming

**Where:** `docs/spec/protocol.md`, `packages/domain/src/views.ts`

This is the second slice in a row where a genuinely important field (last slice: `MainScreenView`
gained nine fields, all written back into the spec; this slice: `PlayerView.abandoned` was not).
The field itself is correct, well-tested, and arguably the single most safety-critical addition
this slice made (it's what fixes bug #6, the abandoned-game-shows-standings leak) — the gap is
purely documentary. Given this is the second occurrence of the same drift class across two
consecutive slices, it may be worth a standing habit rather than a one-off fix: whenever a
protocol type gains a field, grep the spec doc for the type name as the very last step before
calling a slice done, the same mechanical discipline the project already applies to the message
catalogue (grepping for unused keys).

---

## What's strong, worth preserving

- **The vitest `@/`-alias fix, and what it enabled.** This had been an open, admitted gap since
  slice 5's log entry ("no component tests... vitest still resolves no `@/` alias"). Resolving it
  — rather than continuing to work around it — is exactly the kind of infrastructure investment
  that compounds: the very next thing it enabled was extracting the finale-stage's two previously
  untested hooks into pure functions with real coverage, closing both the coverage gap and (per
  the slice-6 fix-verification) an actual bug in the same motion. Finding #1 above is the argument
  for applying the same treatment to `buzzer.tsx` next.
- **`rank.test.ts`'s cross-check is a strong pattern.** Rather than testing `rankAmong` and
  `standings` independently and hoping they agree, the test directly asserts they produce the
  same rank for the same team across six score shapes including multiple tie configurations. This
  is the right shape of test for "two functions that must never disagree" — it makes divergence a
  test failure by construction, not something a reviewer has to notice by inspection.
- **`answer-moments.ts` and its test file remain a model for this surface.** Every individual
  branch of the auto-submit decision (not-yet-expired, already-submitted, already-fired, entered
  vs. empty) is asserted independently, plus the two literal historical-bug repros. This is the
  standard the buzzer's decision logic should be held to.
- **The device-token protocol change is honestly and thoroughly reasoned in the spec document
  itself**, including the two alternatives considered and rejected with their real costs (a
  mirrored cookie's second storage mechanism, a fetch-based reader's lost auto-reconnect). This
  is exactly the kind of decision-log discipline the project asks for elsewhere, applied
  correctly to a genuinely debatable trade-off.
- **`use-wake-lock.ts` is a good example of translating a subtle spec table into equally subtle,
  correct code** — the tab-visibility handling is more general than the spec's literal row list
  (driven by `document.visibilityState` rather than enumerated per-stage), and it still produces
  the exact scoping the table asks for, including the row most likely to be gotten backwards.
- **Cross-surface architectural discipline held for a fourth consecutive slice**: no imports
  between `components/player`, `components/screen`, and `components/control`; the one genuinely
  neutral shared helper (`minuteSeconds`, extracted to `lib/format.ts` following the prior
  review's recommendation) is reused correctly rather than re-duplicated a fourth time.
- **No unexplained `any` or lint suppressions were found anywhere in this slice's diff** — the
  handful of `oxlint-disable`/`eslint-disable` comments present are narrow, justified, and
  unrelated to any architectural rule.

---

## Recommended sequencing

1. Fix the two critical functional findings first — both are small, localized changes (thread a
   team id into the buzzer, fix one redirect handler to clear its token first) with
   disproportionately large safety payoff.
2. Extract the buzzer's outcome decision into a pure function alongside the fix, closing the test
   gap at the same time the bug is fixed — this is the cheapest moment to do it, since the fix
   itself requires understanding the exact same logic a test would need to exercise.
3. Fix the `DO`/`BUZZER` reveal and the silent switch-team refusal together, since both are
   small, independent UI corrections in components already open for the above changes.
4. Add `abandoned` to protocol.md §5.3 and consider adding a "grep the protocol doc for new field
   names" step to whatever checklist this project already runs at the end of a slice.
5. The remaining minor items (the lingering reconnect loop, the retry-backoff button flicker, the
   wake-lock gesture timing, the two sentinel-test audience gaps, the reverse-proxy logging note)
   are cheap, independent cleanup — fine to fold into a future change that touches each area
   anyway.
