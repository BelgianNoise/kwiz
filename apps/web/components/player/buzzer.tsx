'use client'

import type { PlayerQuestion } from '@kwiz/domain'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { player } from '@/lib/client/api'

/**
 * PRD 5 §8 — **the most latency-sensitive thing in the product, and the only place immediacy beats
 * confirmation.**
 *
 * The buzzer is nearly the whole screen because a phone in the middle of a table gets stabbed at by
 * whoever reacts first: a small button loses races to hand-eye coordination rather than to knowledge.
 */
export function Buzzer({
  question,
  gameId,
  token,
}: {
  question: PlayerQuestion
  gameId: string
  token: string
}) {
  const t = useTranslations('player.buzzer')
  const api = player(gameId, token)

  /*
   * **Local, immediate, and it never lies.**
   *
   * The state changes and the device vibrates on the tap, before the server responds — waiting for a
   * round trip to acknowledge a buzz feels broken even at 3 ms. But it says *buzzed*, never *you were
   * first*: first is a server fact (D35) and arrives on the next view.
   */
  const [tapped, setTapped] = useState(false)

  // A new question is a new race. Without this, the previous question's tap would leave the button
  // showing "buzzed" over a live buzzer.
  useEffect(() => setTapped(false), [question.id])

  const lockedOut = question.iAmLockedOut ?? false
  const live = question.buzzersLive ?? false
  const first = question.firstBuzzTeamId

  /*
   * §8 — *"buzzers going live again after another team's denial re-enables the button with a visible
   * transition, so a team that looked away notices."* Clearing the local tap is what does it: the
   * button comes back from "buzzed" to armed on its own.
   */
  useEffect(() => {
    if (live && first === null) setTapped(false)
  }, [live, first])

  if (lockedOut) {
    /*
     * §8 — a lockout is *"a disabled buzzer **with the reason** — never a dead control that looks
     * broken."* D35: the team answered wrong, and the others are buzzing now.
     */
    return (
      <div className="border-border flex min-h-[45dvh] flex-col items-center justify-center gap-3 rounded-2xl border p-6 text-center">
        <p className="text-2xl font-semibold">{t('wrongAnswer')}</p>
        <p className="text-muted-foreground text-lg">{t('othersBuzzing')}</p>
      </div>
    )
  }

  if (tapped || first !== null) {
    return <Outcome mine={tapped} first={first} question={question} />
  }

  return (
    <button
      type="button"
      disabled={!live}
      onClick={() => {
        setTapped(true)
        // §8 — haptics where available. `navigator.vibrate` works on Android and not in iOS Safari,
        // so the visual state change is what actually carries this everywhere.
        navigator.vibrate?.(30)
        // Repeated taps are harmless: the first buzz counts and the rest are server-side no-ops.
        void api.buzz(question.id)
      }}
      className="bg-primary text-primary-foreground min-h-[45dvh] w-full rounded-2xl text-6xl font-bold tracking-wide disabled:opacity-40"
    >
      {t('buzz')}
    </button>
  )
}

/**
 * What the server said, once it has said it.
 *
 * The gap between the tap and this is the whole reason §8 separates local feedback from truth: the
 * phone must show *something* instantly, and that something must not be a claim it cannot support.
 */
function Outcome({
  mine,
  first,
  question,
}: {
  mine: boolean
  first: string | null | undefined
  question: PlayerQuestion
}) {
  const t = useTranslations('player.buzzer')
  // `firstBuzzTeamId` is public and part of the fun (protocol §5.3) — "who beat us" is the thing the
  // table wants to know, and it is not another team's *answer*, which would be forbidden.
  const someoneElse =
    first !== null && first !== undefined && !question.buzzersLive && !mine

  return (
    <div className="border-border flex min-h-[45dvh] flex-col items-center justify-center gap-3 rounded-2xl border p-6 text-center">
      {mine && first === undefined ? (
        // Tapped, nothing back yet. **Never "you're first".**
        <p className="text-3xl font-semibold">{t('buzzed')}</p>
      ) : someoneElse ? (
        <p className="text-2xl">{t('beatenToIt')}</p>
      ) : (
        <p className="text-3xl font-semibold">{t('youreIn')}</p>
      )}
      {mine ? (
        <p className="text-muted-foreground text-lg">{t('answerOutLoud')}</p>
      ) : null}
    </div>
  )
}
