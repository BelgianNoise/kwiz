'use client'

import type { PlayerQuestion, PlayerView } from '@kwiz/domain'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { buzzerFace } from '@/components/player/buzzer-face'
import { player } from '@/lib/client/api'

/**
 * PRD 5 §8 — **the most latency-sensitive thing in the product, and the only place immediacy beats
 * confirmation.**
 *
 * The buzzer is nearly the whole screen because a phone in the middle of a table gets stabbed at by
 * whoever reacts first: a small button loses races to hand-eye coordination rather than to knowledge.
 *
 * **Every decision about what to show lives in `buzzerFace`**, a pure function with a test. What is
 * left here is the tap, the haptic, and the markup — see that file for why the split is not
 * decoration.
 */
export function Buzzer({
  view,
  question,
  gameId,
  token,
}: {
  view: PlayerView
  question: PlayerQuestion
  gameId: string
  token: string
}) {
  const t = useTranslations('player.buzzer')
  const api = player(gameId, token)

  /*
   * **Local, immediate, and it never lies.**
   *
   * Set on the tap, before the server responds — waiting for a round trip to acknowledge a buzz
   * feels broken even at 3 ms. It can only ever produce *"buzzed"*: first is a server fact (D35).
   */
  const [tapped, setTapped] = useState(false)

  const live = question.buzzersLive ?? false
  const holder = question.buzzHolderTeamId

  // A new question is a new race. Without this, the previous question's tap would leave the button
  // showing "buzzed" over a live buzzer.
  useEffect(() => setTapped(false), [question.id])

  /*
   * §8 — *"buzzers going live again after another team's denial re-enables the button with a visible
   * transition, so a team that looked away notices."* Clearing the local tap is what does it: the
   * button comes back from "buzzed" to armed on its own.
   */
  useEffect(() => {
    if (live && (holder === null || holder === undefined)) setTapped(false)
  }, [live, holder])

  const face = buzzerFace({
    lockedOut: question.iAmLockedOut ?? false,
    live,
    holderTeamId: holder,
    myTeamId: view.team.id,
    tapped,
  })

  if (face === 'LOCKED_OUT') {
    /*
     * §8 — a lockout is *"a disabled buzzer **with the reason** — never a dead control that looks
     * broken."* D35: the team answered wrong, and the others are buzzing now.
     */
    return (
      <Panel>
        <p className="text-2xl font-semibold">{t('wrongAnswer')}</p>
        <p className="text-muted-foreground text-lg">{t('othersBuzzing')}</p>
      </Panel>
    )
  }

  if (face === 'WE_HAVE_IT') {
    return (
      <Panel>
        <p className="text-3xl font-semibold">{t('youreIn')}</p>
        <p className="text-muted-foreground text-lg">{t('answerOutLoud')}</p>
      </Panel>
    )
  }

  if (face === 'BEATEN') {
    /*
     * §8's own mockup names the team — *"Norfolk & Chance got there first"* — and it can, because
     * `buzzHolderTeamId` is public (protocol §5.3). It is who beat us, not what they answered, which
     * would be forbidden in every state (PRD 1 §7 invariant 3).
     */
    const them = view.otherTeams.find((team) => team.id === holder)
    return (
      <Panel>
        <p className="text-2xl">
          {them ? t('gotThereFirst', { team: them.name }) : t('beatenToIt')}
        </p>
      </Panel>
    )
  }

  if (face === 'BUZZED') {
    // Tapped, nothing back yet. **Never "you're first".**
    return (
      <Panel>
        <p className="text-3xl font-semibold">{t('buzzed')}</p>
      </Panel>
    )
  }

  return (
    <button
      type="button"
      disabled={face === 'IDLE'}
      onClick={() => {
        setTapped(true)
        // §8 — haptics where available. `navigator.vibrate` works on Android and not in iOS Safari,
        // so the visual state change is what actually carries this everywhere.
        navigator.vibrate?.(30)
        // Repeated taps are harmless: the first buzz counts and the rest are server-side no-ops.
        void api.buzz(question.id)
      }}
      /*
       * §8 — *"nearly the whole screen."* `flex-1` takes everything the prompt and the standing row
       * do not, which is the sentence's actual meaning; the fixed `45dvh` it replaces was closer to
       * half the viewport, and half a screen is a target you can miss under a hand racing for it.
       */
      className="bg-primary text-primary-foreground w-full flex-1 rounded-2xl text-6xl font-bold tracking-wide disabled:opacity-40"
    >
      {t('buzz')}
    </button>
  )
}

/** Everything that replaces the button keeps its footprint, so the layout never jumps mid-question. */
function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-border flex w-full flex-1 flex-col items-center justify-center gap-3 rounded-2xl border p-6 text-center">
      {children}
    </div>
  )
}
