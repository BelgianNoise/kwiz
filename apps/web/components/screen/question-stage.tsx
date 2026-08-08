'use client'

import type { MainScreenQuestion } from '@kwiz/domain'

import { FittedText } from '@/components/screen/fitted-text'
import { resolveLayout, type QuestionLayout } from '@/components/screen/layout'

/**
 * PRD 4 §6 — the `QUESTION` stage.
 *
 * **Five named layouts and a deterministic resolver**, not a general layout engine: five cases can be
 * designed, reviewed and tested, and a general system cannot. Resolution is by attachment **kind and
 * count only** — never by prompt length, because a layout that changes when someone edits a word is
 * impossible to author against.
 *
 * Built here in slice 4 rather than slice 6 because PRD 2 §7.1's preview needs the *real* renderer —
 * a preview drawn by a second, throwaway implementation would confirm the wrong thing. Slice 6's
 * screen surface imports this rather than reimplementing it.
 *
 * Sizes are `cqh` against `StageFrame`, so every number transcribes PRD 4 §2.1 directly. The layout
 * resolver itself lives in `./layout` — it is a rule, and it is tested there.
 */
export function QuestionStage({ question }: { question: MainScreenQuestion }) {
  const layout = resolveLayout(question.media)

  return (
    // §2.2 — dark background, light text. A light background washes out and makes a projector's
    // black level look grey. The 5% safe area is the padding: overscan clips the edges on some
    // projectors, and nothing meaningful may sit outside it.
    <section className="relative h-full w-full bg-neutral-950 text-neutral-50">
      <div className="flex h-full w-full flex-col p-[5cqh]">
        {layout === 'TEXT' ? (
          // Nothing to show but words, so the prompt gets the whole stage at maximum size.
          <div className="min-h-0 flex-1">
            <FittedText max={14} className="font-semibold">
              {question.prompt}
            </FittedText>
          </div>
        ) : (
          <>
            {/* Every other layout is a prompt band above the media. */}
            <div className="h-[22cqh] shrink-0">
              <FittedText max={9} className="font-semibold">
                {question.prompt}
              </FittedText>
            </div>
            <div className="min-h-0 flex-1 pt-[2cqh]">
              <Media question={question} layout={layout} />
            </div>
          </>
        )}

        {/*
          §6 — points "somewhere, not prominent", but still obeying §2.1's 4vh floor: not prominent
          is not the same as unreadable. Deliberately absent: the question number and any submission
          progress, both of which cost a line of a very small budget to tell the room something it
          does not act on.
        */}
        <p className="text-right text-[4cqh] font-medium text-neutral-400">
          {question.points} pt
        </p>
      </div>

      {question.timer ? <Timer timer={question.timer} /> : null}
    </section>
  )
}

function Media({
  question,
  layout,
}: {
  question: MainScreenQuestion
  layout: QuestionLayout
}) {
  const visuals = question.media.filter(
    (item) => item.kind === 'IMAGE' || item.kind === 'VIDEO',
  )

  if (layout === 'AUDIO') return <AudioPresence />

  if (layout === 'SPLIT') {
    return (
      <div className="flex h-full gap-[2cqh]">
        <div className="min-w-0 flex-1">
          <Grid items={visuals} />
        </div>
        <div className="w-[30cqw] shrink-0">
          <AudioPresence />
        </div>
      </div>
    )
  }

  return <Grid items={visuals} />
}

function Grid({ items }: { items: MainScreenQuestion['media'] }) {
  // 1 → hero, 2 → side by side, 3–4 → 2×2. Beyond that §6 hands over to `SPLIT`.
  const columns = items.length <= 1 ? 1 : 2

  return (
    <div
      className="grid h-full w-full gap-[2cqh]"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {items.map((item) => (
        <div key={item.id} className="flex min-h-0 items-center justify-center">
          {item.kind === 'VIDEO' ? (
            <video
              src={item.url}
              className="max-h-full max-w-full object-contain"
              muted
              playsInline
            />
          ) : (
            /* A plain <img>, not next/image: this is a local attachment served from
               `/api/attachment` off this machine's own disk, so there is no remote asset to
               optimise and no network to save. */
            <img src={item.url} alt="" className="max-h-full max-w-full object-contain" />
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * §6.1 — a music round is a large slice of pub quizzes and the screen has nothing to show, so audio
 * gets a designed presence rather than an empty stage.
 *
 * **The equaliser is a fixed loop, not real analysis.** Its one job is to prove sound is playing;
 * spectrum analysis needs Web Audio wiring and looks like noise at projector scale. Its going still
 * is the "no sound" signal — if the room hears nothing while the screen moves, someone shouts about
 * the volume within seconds.
 *
 * **No track length**, deliberately: a duration is a hint about the answer, so it lives on control.
 */
function AudioPresence() {
  const bars = [0.4, 0.7, 1, 0.6, 0.9, 0.5, 0.8, 0.45, 0.95, 0.55, 0.75, 0.35]

  return (
    <div className="flex h-full items-end justify-center gap-[1cqh] pb-[6cqh]">
      {bars.map((height, index) => (
        <span
          // The bars are a fixed decorative loop, so position is identity.
          // oxlint-disable-next-line no-array-index-key
          key={index}
          className="w-[2cqh] rounded-full bg-neutral-100"
          style={{
            height: `${height * 30}cqh`,
            animation: `kwiz-eq 1.2s ease-in-out ${index * 0.08}s infinite alternate`,
          }}
        />
      ))}
    </div>
  )
}

/**
 * §7 — top-right of the safe area, the same place on every stage that has one. A timer that moves is
 * a timer people hunt for.
 *
 * Static here: the preview shows a question's *layout*, and a running clock in a dialog would be a
 * distraction rather than information. Slice 6 drives it from `deadlineAt`, counting down client-side
 * (D52) — this component takes the number so that swap is a prop, not a rewrite.
 */
function Timer({ timer }: { timer: NonNullable<MainScreenQuestion['timer']> }) {
  const seconds = Math.max(0, Math.round((timer.deadlineAt - Date.now()) / 1000))

  return (
    <div className="absolute top-[5cqh] right-[5cqh] flex size-[14cqh] items-center justify-center rounded-full border-[1cqh] border-neutral-500">
      {/* Never hidden at zero: the question is still open server-side (D8) and answers still arrive. */}
      <span className="text-[7cqh] font-semibold tabular-nums">
        {timer.pausedAt === null ? seconds : '⏸'}
      </span>
    </div>
  )
}
