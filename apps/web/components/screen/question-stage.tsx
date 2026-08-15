'use client'

import type { MainScreenQuestion } from '@kwiz/domain'

import { BuzzDisplay } from '@/components/screen/buzz-display'
import { FittedText } from '@/components/screen/fitted-text'
import { resolveLayout, type QuestionLayout } from '@/components/screen/layout'
import { CorrectAnswer, Options, SpotlitAnswers } from '@/components/screen/reveal'
import type { Teams } from '@/components/screen/stage'
import { Timer } from '@/components/screen/timer'
import { useElapsed } from '@/lib/client/use-countdown'

/**
 * PRD 4 §6 — the `QUESTION` stage.
 *
 * **Five named layouts and a deterministic resolver**, not a general layout engine: five cases can be
 * designed, reviewed and tested, and a general system cannot. Resolution is by attachment **kind and
 * count only** — never by prompt length, because a layout that changes when someone edits a word is
 * impossible to author against.
 *
 * Built here in slice 4 rather than slice 6 because PRD 2 §7.1's preview needs the *real* renderer —
 * a preview drawn by a second, throwaway implementation would confirm the wrong thing. Slice 6 grew it
 * into the live stage: the timer, §8's reveal beats and §8.3's buzz display. `teams` is optional for
 * exactly one caller, the preview, which has a mock question and nobody to attribute anything to.
 *
 * Sizes are `cqh` against `StageFrame`, so every number transcribes PRD 4 §2.1 directly. The layout
 * resolver itself lives in `./layout` — it is a rule, and it is tested there.
 */
/** Stable, so the preview's default does not make a new map on every render. */
const NO_TEAMS: Teams = new Map()

export function QuestionStage({
  question,
  teams = NO_TEAMS,
}: {
  question: MainScreenQuestion
  teams?: Teams
}) {
  const layout = resolveLayout(question.media)
  const revealed = question.correctAnswer !== undefined
  const buzzes = question.buzzes ?? []

  /*
   * §8.3 takes over the stage once anybody has buzzed, and hands it back at the reveal. The prompt is
   * deliberately gone while it does: the question was read out a moment ago, and §8.3's mock is the
   * team name and the timings and nothing else.
   */
  const buzzing = !revealed && buzzes.length > 0

  return (
    // §2.2 — dark background, light text. A light background washes out and makes a projector's
    // black level look grey. The 5% safe area is the padding: overscan clips the edges on some
    // projectors, and nothing meaningful may sit outside it.
    <section className="relative h-full w-full bg-neutral-950 text-neutral-50">
      <div className="flex h-full w-full flex-col p-[5cqh]">
        {buzzing ? (
          <div className="min-h-0 flex-1">
            <BuzzDisplay
              buzzes={buzzes}
              lockedOutTeamIds={question.lockedOutTeamIds ?? []}
              teams={teams}
            />
          </div>
        ) : (
          <Body question={question} layout={layout} teams={teams} revealed={revealed} />
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

/**
 * The prompt, the media and — once revealed — the answer.
 *
 * §8.1's first beat *replaces the prompt area*: at hero scale the answer needs the room the prompt was
 * using, and the prompt has done its job by then. The media stays, because a `HERO` image is usually
 * what the answer is *about*.
 */
function Body({
  question,
  layout,
  teams,
  revealed,
}: {
  question: MainScreenQuestion
  layout: QuestionLayout
  teams: Teams
  revealed: boolean
}) {
  const multipleChoice = question.options !== undefined

  if (layout === 'TEXT') {
    return (
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-[3cqh]">
        {revealed && !multipleChoice ? (
          <>
            <CorrectAnswer text={question.correctAnswer ?? ''} />
            <SpotlitAnswers answers={question.spotlitAnswers ?? []} teams={teams} />
          </>
        ) : (
          <>
            {/* Nothing to show but words, so the prompt gets the stage at maximum size — less the
                room the options need, when there are options. */}
            <div className="min-h-0 flex-1">
              <FittedText max={multipleChoice ? 9 : 14} className="font-semibold">
                {question.prompt}
              </FittedText>
            </div>
            {multipleChoice ? <Options question={question} teams={teams} /> : null}
          </>
        )}
      </div>
    )
  }

  return (
    <>
      {/* Every other layout is a prompt band above the media — or, revealed, an answer band. */}
      <div className="h-[22cqh] shrink-0">
        {revealed && !multipleChoice ? (
          <CorrectAnswer text={question.correctAnswer ?? ''} />
        ) : (
          <FittedText max={9} className="font-semibold">
            {question.prompt}
          </FittedText>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-[2cqh] pt-[2cqh]">
        <div className="min-h-0 flex-1">
          <Media question={question} layout={layout} />
        </div>
        {multipleChoice ? <Options question={question} teams={teams} /> : null}
        {revealed && !multipleChoice ? (
          <SpotlitAnswers answers={question.spotlitAnswers ?? []} teams={teams} />
        ) : null}
      </div>
    </>
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

  if (layout === 'AUDIO') return <AudioPresence playback={question.playback} />

  if (layout === 'SPLIT') {
    return (
      <div className="flex h-full gap-[2cqh]">
        <div className="min-w-0 flex-1">
          <Grid items={visuals} />
        </div>
        <div className="w-[30cqw] shrink-0">
          <AudioPresence playback={question.playback} />
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
            /*
             * §6.2 — no controls, no progress bar, no title overlay, and **never stretched**:
             * letterboxed within the media area, preserving aspect ratio. Playback is triggered from the
             * master's desk (D27), so this element is a picture rather than a player — muted, because
             * the room's audio comes through the venue's speakers from that machine.
             */
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
 * spectrum analysis needs Web Audio wiring and looks like noise at projector scale.
 *
 * **Its going still is the "no sound" signal** — *"if the room can't hear anything but the screen shows
 * movement, someone shouts about the volume within seconds. That is the diagnostic §4.1's arming step
 * cannot provide once the quiz is underway."* Which only works if stillness means something, so the
 * bars are driven by the master's transport (`playback`) rather than animating unconditionally. Absent
 * means nothing has been played yet, and the honest display for that is a still equaliser at 0:00.
 */
function AudioPresence({ playback }: { playback?: MainScreenQuestion['playback'] }) {
  const bars = [0.4, 0.7, 1, 0.6, 0.9, 0.5, 0.8, 0.45, 0.95, 0.55, 0.75, 0.35]
  const playing = (playback?.playingSince ?? null) !== null

  // D52's pattern again: an absolute instant plus an offset, ticked here. The server sends no position.
  const since = useElapsed(playback?.playingSince ?? null)
  const elapsed = (playback?.positionMs ?? 0) / 1000 + (playing ? since : 0)

  return (
    <div className="flex h-full flex-col items-center justify-end gap-[4cqh] pb-[4cqh]">
      <div className="flex items-end justify-center gap-[1cqh]">
        {bars.map((height, index) => (
          <span
            // The bars are a fixed decorative loop, so position is identity.
            // oxlint-disable-next-line no-array-index-key
            key={index}
            className="w-[2cqh] rounded-full bg-neutral-100"
            style={{
              height: `${height * 30}cqh`,
              ...(playing
                ? {
                    animation: `kwiz-eq 1.2s ease-in-out ${index * 0.08}s infinite alternate`,
                  }
                : // Still, and dimmed, so "nothing is playing" reads as a state rather than as a
                  // frozen animation.
                  { opacity: 0.35, transform: 'scaleY(0.35)' }),
            }}
          />
        ))}
      </div>

      {/*
        §6.1 — **elapsed counts up, and the bar does not reveal the track's length.** A total duration is
        a hint about the answer — a 2:14 track narrows the field — so it stays off this screen. It is on
        control, where the master needs it.
      */}
      <p className="text-[5cqh] font-medium text-neutral-300 tabular-nums">
        {clock(elapsed)}
      </p>
    </div>
  )
}

/** `m:ss` — conventions §8.2's format for media positions. */
function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
