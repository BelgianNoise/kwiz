'use client'

import type { MainScreenQuestion } from '@kwiz/domain'
import { MC_DISTRIBUTION_DELAY_MS } from '@kwiz/domain'
import { useEffect, useState } from 'react'

import { Dot } from '@/components/screen/parts'
import type { Teams } from '@/components/screen/stage'

/**
 * PRD 4 §8 — **the reveal, in D40's two beats.**
 *
 * Beat 1 is the correct answer. Beat 2 is what the master chooses to show, and its timing differs by
 * answer method for a reason stated in P5: for free text there *is* no timing, because beat 2 is the
 * master pressing `[Show on screen]` — that is the whole point of spotlighting. For multiple choice the
 * distribution arrives ~1.5 s later, so the room registers *what the answer was* before hunting for its
 * own team's dot.
 */

/** §8.1 — the correct answer replaces the prompt area, at hero scale. */
export function CorrectAnswer({ text }: { text: string }) {
  return (
    <p className="main-display text-center text-[16cqh] leading-none text-[var(--main-accent)]">
      {text}
    </p>
  )
}

/**
 * §8.1's beat 2 — *"a spotlit answer gets real space and hero-adjacent scale."*
 *
 * One curated answer shown large is the entire justification for not dumping twenty (D40); showing it
 * small would waste the trade. **Stacks up to two**, and a third replaces the oldest — beyond two,
 * §2.1's budget is gone.
 */
export function SpotlitAnswers({
  answers,
  teams,
}: {
  answers: NonNullable<MainScreenQuestion['spotlitAnswers']>
  teams: Teams
}) {
  if (answers.length === 0) return null

  // The most recent two. The payload carries them in submission order, so the oldest drops off the
  // front, which is what "a third replaces the oldest" means.
  const shown = answers.slice(-2)

  return (
    <div className="flex flex-col gap-[2cqh]">
      {shown.map((answer) => {
        const team = teams.get(answer.teamId)
        return (
          <div key={answer.teamId} className="flex items-center gap-[2cqh]">
            {/* O6 — *"named, in team colour. The laugh is social and needs an owner."* */}
            <Dot colour={team?.colour ?? '#737373'} size={3.5} />
            <span className="text-[5.5cqh] text-neutral-300">{team?.name}</span>
            <span className="min-w-0 flex-1 truncate text-[7cqh] font-semibold">
              “{answer.text}”
            </span>
            {/*
              §8.1 — **verdict marks appear only when the answer has been judged.** An unjudged spotlit
              answer shows *no* mark rather than a wrong one: validation may legitimately be outstanding
              (D42), and a `✗` on an answer the master has not ruled on is a false statement to a room.
            */}
            {answer.correct === null ? null : (
              <span
                className={`shrink-0 text-[7cqh] ${answer.correct ? 'text-emerald-400' : 'text-orange-400'}`}
              >
                {answer.correct ? '✓' : '✗'}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * §8.2 — multiple choice.
 *
 * **Options keep their original order**, never re-sorted to put the correct one first: that would break
 * the mapping to what teams saw on their phones while answering, and the room would be looking at a
 * different question from the one it was asked.
 */
export function Options({
  question,
  teams,
}: {
  question: MainScreenQuestion
  teams: Teams
}) {
  const options = question.options ?? []
  const revealed = question.correctOptionId !== undefined
  const distribution = useDelayedDistribution(question)

  return (
    <ul className="flex flex-col justify-center gap-[2cqh]">
      {options.map((option, index) => {
        const correct = option.id === question.correctOptionId
        const picked = distribution?.find(
          (entry) => entry.optionId === option.id,
        )?.teamIds

        return (
          <li key={option.id} className="flex items-center gap-[2cqh]">
            {/* A, B, C — what the room hears the master say, and what the phones show. */}
            <span className="w-[5cqh] shrink-0 text-[6cqh] font-semibold text-neutral-500">
              {String.fromCodePoint(65 + index)}
            </span>
            <span
              className={`text-[6.5cqh] ${revealed && !correct ? 'text-neutral-500' : 'text-neutral-50'}`}
            >
              {option.text}
            </span>
            {correct ? <span className="text-[6.5cqh] text-emerald-400">✓</span> : null}

            {/*
              §8.2's beat 2 — a bucket of team colour dots per option. Compact at any team count, and
              the reason multiple choice is D40's one exception to never showing the room who answered
              what: four buckets of dots fit where twenty rows of text do not.
            */}
            {picked && picked.length > 0 ? (
              <span className="flex items-center gap-[1cqh] pl-[2cqh]">
                {picked.map((teamId) => (
                  <Dot
                    key={teamId}
                    colour={teams.get(teamId)?.colour ?? '#737373'}
                    size={3}
                  />
                ))}
              </span>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * P5's 1.5-second beat, held on the client.
 *
 * The payload carries `optionDistribution` from the moment of reveal — the delay is *presentation*, and
 * protocol §5.2 says so in as many words. Keyed off the question id so a reveal that arrives while the
 * screen was reconnecting still gets its beat, and a new question resets it.
 */
function useDelayedDistribution(
  question: MainScreenQuestion,
): MainScreenQuestion['optionDistribution'] {
  const [ready, setReady] = useState(false)
  const distribution = question.optionDistribution

  useEffect(() => {
    if (!distribution) {
      setReady(false)
      return undefined
    }
    const timer = setTimeout(() => setReady(true), MC_DISTRIBUTION_DELAY_MS)
    return () => clearTimeout(timer)
  }, [distribution, question.id])

  return ready ? distribution : undefined
}
