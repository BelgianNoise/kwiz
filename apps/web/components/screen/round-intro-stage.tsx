'use client'

import type { MainScreenView } from '@kwiz/domain'
import { useTranslations } from 'next-intl'

import { FittedText } from '@/components/screen/fitted-text'

type RoundIntro = Extract<MainScreenView['stage'], { kind: 'ROUND_INTRO' }>

/**
 * PRD 4 §5 — `ROUND_INTRO`.
 *
 * **Deliberately near-empty.** It is on screen for a few seconds while the master introduces the round
 * out loud, and its job is to be readable instantly and then get out of the way.
 *
 * §5 also settles PRD 2's O7 here, and the reasoning is specific to this surface: **no per-quiz accent
 * colour.** Colour on this screen is reserved for team identity — it is the one thing the audience uses
 * colour to decode (PRD 1 §9.5), and an accent would compete with it. A round intro carries its weight
 * through typography and scale instead, which is also what survives a bad projector.
 */
export function RoundIntroStage({ stage }: { stage: RoundIntro }) {
  const t = useTranslations('screen.round')

  return (
    <section className="flex h-full w-full flex-col items-center justify-center gap-[4cqh] bg-neutral-950 p-[5cqh] text-neutral-50">
      <p className="text-[8cqh] font-medium tracking-[0.2em] text-neutral-400">
        {t('number', { number: stage.roundNumber })}
      </p>

      {/*
        Fitted rather than sized: a round title is authored free text, and Dutch runs 20–30% longer
        while being this surface's layout baseline (§2.4, PRD 1 §9.2). Letter-spaced like §5's mock,
        which is where the near-empty stage's weight comes from.
      */}
      <div className="h-[30cqh] w-full">
        <FittedText max={22} className="font-semibold tracking-[0.15em] uppercase">
          {stage.title}
        </FittedText>
      </div>

      {/*
        §5's `10 questions · 100 points` — the round's shape, stated once. Safe where a question
        *number* is not (§6): it is announced before anything can be skipped, so it never has to
        explain a gap.
      */}
      <p className="text-[5cqh] text-neutral-400">
        {t('shape', { questions: stage.questionCount, points: stage.points })}
      </p>
    </section>
  )
}
