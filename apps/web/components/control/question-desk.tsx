'use client'

import type { Attention, MasterQuestionDetail, ValidationItem } from '@kwiz/domain'
import { AlertTriangle, Check, NotebookPen, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { AdvanceButton } from '@/components/control/advance-button'
import { BuzzerState } from '@/components/control/buzz-desk'
import type { Run, ZoneProps } from '@/components/control/control-desk'
import { useControlKeys } from '@/components/control/keys'
import { MediaControls } from '@/components/control/media-controls'
import { TeamDot } from '@/components/control/team-dot'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ControlApi } from '@/lib/client/api'
import { useCountdown } from '@/lib/client/use-countdown'
import { cn } from '@/lib/utils'

type Validating = Extract<Attention, { kind: 'VALIDATE_QUESTION' }>

/** The two states in which the room has already been shown the answer (D40's beat one). */
const revealsAnswer = (state: MasterQuestionDetail['state']): boolean =>
  state === 'REVEALED' || state === 'SCORED'

/**
 * PRD 3 §5 and §6 — **one component for the live question and the round-end sweep**, because §6.1
 * says so: the grouping that makes an inconsistent pair visible is the same grouping in both, and
 * two designs for it would drift.
 *
 * The three things that make this screen work:
 *
 * - **The correct answer is shown while the question is open.** This is the master's screen; they
 *   need it to field *"is 'Radio Head' ok?"* shouted from the back before they have even locked.
 * - **Answers are judgeable the moment they arrive** (D42). The master is usually waiting on one
 *   slow team, and that dead time is the cheapest moment in the night to clear a `Radio Head`.
 * - **The timer is subordinate.** It is advisory (D8) and does not close anything; `[Close answers]`
 *   is the only thing that locks, and it is identical whether the timer has expired or not.
 */
export function QuestionDesk({
  view,
  api,
  run,
  gameId,
  validating,
}: ZoneProps & { validating?: Validating }) {
  const tv = useTranslations('control.validate')

  /*
   * The sweep may be about a question that is no longer the current one (§6.2), in which case there
   * is no `view.question` to render — only the items. That is the whole difference between the two
   * modes, and it is why the header below falls back to the sweep's own copy.
   */
  const detail = view.question
  const sweeping =
    validating !== undefined && validating.gameQuestionId !== detail?.gameQuestionId

  const items = validating ? validating.items : (detail?.teamAnswers ?? [])
  const questionId = validating?.gameQuestionId ?? detail?.gameQuestionId
  // Carried on the payload, because a sweep can be about a question from an earlier round.
  const sweepPrompt =
    sweeping && validating
      ? { prompt: validating.prompt, accepted: validating.acceptedAnswers }
      : null

  if (!questionId) return null

  return (
    <section className="mx-auto max-w-3xl space-y-5">
      {sweeping ? (
        <header className="space-y-1">
          <h1 className="text-xl font-medium">{tv('title')}</h1>
          <p className="text-muted-foreground text-sm">
            {tv('remaining', { count: validating.remainingQuestions })}
          </p>
          {/*
           * §6.1 — **the accepted answers, on the sweep too.** They are the reference the master
           * judges against, and a sweep that shows the answers without what they should match is
           * a screen asking for a verdict with the evidence left on the previous page.
           */}
          {sweepPrompt ? <p className="text-lg">{sweepPrompt.prompt}</p> : null}
          {sweepPrompt && sweepPrompt.accepted.length > 0 ? (
            <p className="text-sm">
              {tv('accepted', { answers: sweepPrompt.accepted.join(' · ') })}
            </p>
          ) : null}
        </header>
      ) : detail ? (
        <QuestionHeader
          detail={detail}
          answered={items.length}
          teams={view.teams.length}
        />
      ) : null}

      {/* §7.1's deny loop lives here rather than on the buzz screen: once a buzz is denied there
          is no buzz to adjudicate, and `attention` has already moved on. */}
      <BuzzerState view={view} api={api} run={run} gameId={gameId} />

      <AnswerList
        items={items}
        teams={view.teams}
        questionId={questionId}
        revealed={detail?.state === 'REVEALED' || detail?.state === 'SCORED'}
        answerMethod={detail?.answerMethod}
        api={api}
        run={run}
      />

      <QuestionActions
        view={view}
        api={api}
        run={run}
        detail={detail ?? undefined}
        items={items}
      />
    </section>
  )
}

/** The prompt, the reference answer, the master's own note, and the media controls. */
function QuestionHeader({
  detail,
  answered,
  teams,
}: {
  detail: MasterQuestionDetail
  answered: number
  teams: number
}) {
  const t = useTranslations('control.question')
  const remaining = useCountdown(detail.timer?.deadlineAt ?? null)

  return (
    <header className="space-y-3">
      <div className="text-muted-foreground flex items-baseline gap-3 text-sm">
        <span className="uppercase">{detail.answerMethod.replace('_', ' ')}</span>
        <span>{t('points', { points: detail.points })}</span>
        {remaining !== null ? (
          <span className="ml-auto text-base tabular-nums">
            {/*
             * Whole seconds — always under a minute in practice (conventions §8.2). At zero it
             * becomes §5.1's `Time up · 4 of 4 submitted`, because the question the master now has
             * is no longer "how long" but "who is still out"; **nothing happens automatically**,
             * and `[Close answers]` is identical either side of it (D8).
             */}
            {remaining <= 0
              ? `${t('timeUp')} · ${t('submitted', { answered, total: teams })}`
              : Math.ceil(remaining)}
          </span>
        ) : null}
      </div>

      <h1 className="text-2xl leading-snug font-medium">{detail.prompt}</h1>

      {detail.acceptedAnswers.length > 0 ? (
        <p>
          <span className="text-muted-foreground mr-2 text-sm">{t('answer')}</span>
          <span className="font-medium">{detail.acceptedAnswers[0]}</span>
          {detail.acceptedAnswers.length > 1 ? (
            <span className="text-muted-foreground ml-2 text-sm">
              {t('alsoAccepted', { answers: detail.acceptedAnswers.slice(1).join(', ') })}
            </span>
          ) : null}
        </p>
      ) : null}

      {detail.options ? (
        <ul className="text-sm">
          {detail.options.map((option) => (
            <li key={option.id} className={option.isCorrect ? 'font-medium' : ''}>
              {option.isCorrect ? '✓ ' : '· '}
              {option.text}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Visually distinct, so the master's own reminder never reads as part of the question. */}
      {detail.masterNotes ? (
        <p className="bg-muted flex items-start gap-2 rounded-md p-2 text-sm">
          <NotebookPen aria-label={t('notes')} className="mt-0.5 size-4 shrink-0" />
          {detail.masterNotes}
        </p>
      ) : null}

      {detail.failsPreflight ? (
        <p className="text-destructive flex items-center gap-2 text-sm">
          <AlertTriangle aria-hidden className="size-4" />
          {t('failsPreflight')}
        </p>
      ) : null}

      {/* D27 — playback is controlled here and only here. The master has the scrub bar; the room
          has the speakers. */}
      {detail.media.length > 0 ? <MediaControls media={detail.media} /> : null}
    </header>
  )
}

/**
 * §5.1 / §6.1's grouped list — **all teams together, judged one at a time**.
 *
 * Judging `Radio Head` in isolation, the master cannot see they just accepted `radiohead` two rows
 * up. Side by side, the inconsistency is impossible to miss — and identical text is linked as a soft
 * aid (`hasIdenticalSibling`) that never applies a verdict by itself.
 */
function AnswerList({
  items,
  teams,
  questionId,
  revealed,
  answerMethod,
  api,
  run,
}: {
  items: ValidationItem[]
  teams: ZoneProps['view']['teams']
  questionId: string
  revealed: boolean
  answerMethod: MasterQuestionDetail['answerMethod'] | undefined
  api: ControlApi
  run: Run
}) {
  const t = useTranslations('control.question')
  const answered = new Set(items.map((item) => item.teamId))

  // §13 — `Y`/`N` act on the **topmost undecided row**, so a question can be cleared without the
  // trackpad. Far apart on the keyboard, so a slip is unlikely to be the opposite decision.
  const nextUndecided = items.find((item) => item.verdict === 'PENDING')
  useControlKeys((event) => {
    const key = event.key.toLowerCase()
    if ((key !== 'y' && key !== 'n') || !nextUndecided) return false
    run(() => api.validate(questionId, nextUndecided.teamId, key === 'y'))
    return true
  })

  return (
    <section className="space-y-2">
      <div className="text-muted-foreground flex items-baseline justify-between text-sm">
        <h2>{t('answersSoFar')}</h2>
        <span>{t('ofTeams', { answered: items.length, total: teams.length })}</span>
      </div>

      <ul className="divide-y">
        {items.map((item) => (
          <AnswerRow
            key={item.teamId}
            item={item}
            questionId={questionId}
            spotlightable={
              revealed && answerMethod !== 'MULTIPLE_CHOICE' && answerMethod !== 'BUZZER'
            }
            api={api}
            run={run}
          />
        ))}

        {/* **Teams still answering are shown as such**, not as blanks — "who am I waiting for?" is
            the other question the master has mid-question (§5.1). */}
        {teams
          .filter((team) => !answered.has(team.id))
          .map((team) => (
            <li key={team.id} className="flex items-center gap-3 py-1.5">
              <TeamDot colour={team.colour} />
              <span className="min-w-0 flex-1 truncate">{team.name}</span>
              <span className="text-muted-foreground text-sm">{t('stillAnswering')}</span>
              {/* §11.3 — offered only when the team has no connected device at all, so it never
                  invites use as a shortcut when the team could have answered themselves. */}
              {team.deviceCount === 0 ? (
                <ProxyAnswer team={team} questionId={questionId} api={api} run={run} />
              ) : null}
            </li>
          ))}
      </ul>
    </section>
  )
}

function AnswerRow({
  item,
  questionId,
  spotlightable,
  api,
  run,
}: {
  item: ValidationItem
  questionId: string
  /** §5.3 — free-text only, and only once revealed. Everything else has nothing to curate. */
  spotlightable: boolean
  api: ControlApi
  run: Run
}) {
  const t = useTranslations('control.question')
  const tv = useTranslations('control.validate')

  const decided = item.verdict !== 'PENDING'
  const correct = item.verdict === 'AUTO_CORRECT' || item.verdict === 'ACCEPTED'
  const auto = item.verdict === 'AUTO_CORRECT' || item.verdict === 'AUTO_WRONG'

  return (
    <li className="flex items-center gap-3 py-1.5">
      <TeamDot colour={item.teamColour} />
      <span className="w-40 shrink-0 truncate">{item.teamName}</span>

      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          // A soft aid only — the master still decides each team separately (O1).
          item.hasIdenticalSibling && 'underline decoration-dotted underline-offset-4',
        )}
        title={item.hasIdenticalSibling ? tv('identical') : undefined}
      >
        {item.answerText}
      </span>

      {/* D26's marker: the team never sent a final submission, which is exactly when a master
          would otherwise wrongly deny a half-typed answer. */}
      {item.isDraft ? (
        <span className="text-destructive text-xs">{t('notConfirmed')}</span>
      ) : null}
      {item.enteredByMaster ? (
        <span className="text-muted-foreground text-xs">{t('enteredByMaster')}</span>
      ) : null}

      {/* Auto-graded rows are shown **greyed but present**, not hidden: they are the reference the
          master judges against, and an auto verdict can be overridden by clicking the other one. */}
      <span
        className={cn(
          'w-16 shrink-0 text-right text-xs',
          decided ? (correct ? '' : 'text-muted-foreground') : 'invisible',
        )}
      >
        {auto ? `${t('auto')} ` : ''}
        {correct ? t('correct') : t('wrong')}
      </span>

      <span className="flex shrink-0 gap-1">
        <Button
          size="icon-xs"
          aria-label={t('accept')}
          variant={decided && correct ? 'default' : 'outline'}
          onClick={() => run(() => api.validate(questionId, item.teamId, true))}
        >
          <Check aria-hidden />
        </Button>
        <Button
          size="icon-xs"
          aria-label={t('deny')}
          variant={decided && !correct ? 'default' : 'outline'}
          onClick={() => run(() => api.validate(questionId, item.teamId, false))}
        >
          <X aria-hidden />
        </Button>
      </span>

      {/* §5.3 — how the funniest wrong answer gets its moment, without a 20-row table nobody can
          read at 10 m. It is what a real quizmaster does anyway: pick one and read it out. */}
      {spotlightable ? (
        <Button
          size="xs"
          variant={item.spotlit ? 'secondary' : 'ghost'}
          onClick={() => run(() => api.spotlight(questionId, item.teamId, !item.spotlit))}
        >
          {item.spotlit ? t('onScreen') : t('showOnScreen')}
        </Button>
      ) : null}
    </li>
  )
}

/** §11.3 / D47 — the master types an answer for a team whose device cannot reach the server. */
function ProxyAnswer({
  team,
  questionId,
  api,
  run,
}: {
  team: { id: string; name: string }
  questionId: string
  api: ControlApi
  run: Run
}) {
  const t = useTranslations('control.question')
  const [text, setText] = useState<string | null>(null)

  if (text === null) {
    return (
      <Button size="xs" variant="outline" onClick={() => setText('')}>
        {t('cantConnect')}
      </Button>
    )
  }

  return (
    <span className="flex items-center gap-1">
      <Input
        // Focused on mount: this field replaced the button the master just pressed.
        ref={(node) => node?.focus()}
        aria-label={t('enterFor', { team: team.name })}
        className="h-7 w-48"
        value={text}
        onChange={(event) => setText(event.target.value)}
        /* Matching is exact after lowercase and trim (D22), so the master's own keyboard must not
           be allowed to "help" either. */
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      <Button
        size="xs"
        disabled={text.trim() === ''}
        onClick={() => {
          run(() => api.submitForTeam(questionId, team.id, { text }))
          setText(null)
        }}
      >
        {t('submitFor')}
      </Button>
    </span>
  )
}

/**
 * The one primary action, chosen by `attention.suggestion` where there is one.
 *
 * `[Reveal answer]` is **never blocked by outstanding validations** (D42, §1.1's no-dialogs rule):
 * an unjudged answer simply carries no verdict, and the reveal still shows the correct answer, which
 * is the part the room is waiting for. The count is stated so the choice is informed.
 */
function QuestionActions({
  view,
  api,
  run,
  detail,
  items,
}: Omit<ZoneProps, 'gameId'> & {
  detail: MasterQuestionDetail | undefined
  items: ValidationItem[]
}) {
  const t = useTranslations('control.question')
  const unjudged = items.filter((item) => item.verdict === 'PENDING').length

  return (
    <footer className="flex items-center gap-4">
      {detail?.state === 'LOCKED' || detail?.state === 'REVEALED' ? (
        <span className="text-muted-foreground text-sm">
          {t('lockedLine', { answered: items.length, total: view.teams.length })}
          {' · '}
          {unjudged === 0 ? t('allJudged') : t('unjudged', { count: unjudged })}
        </span>
      ) : null}

      {/*
       * §5.3 — the reveal is two beats (D40). Beat one is the correct answer, and this is the desk
       * saying which words are on the projector right now, so the master reads out the same ones.
       */}
      {detail && revealsAnswer(detail.state) && detail.acceptedAnswers[0] ? (
        <span className="text-sm">
          {t('revealed', { answer: detail.acceptedAnswers[0] })}
        </span>
      ) : null}

      {detail?.state === 'REVEALED' && detail.answerMethod === 'MULTIPLE_CHOICE' ? (
        <span className="text-muted-foreground text-sm">{t('spotlightHint')}</span>
      ) : null}

      {/* One team answered, out loud — there is nothing to spotlight, and saying so beats a row
          of buttons that quietly do not appear (§5.3). */}
      {detail && revealsAnswer(detail.state) && detail.answerMethod === 'BUZZER' ? (
        <span className="text-muted-foreground text-sm">{t('buzzerNothing')}</span>
      ) : null}

      {/*
       * **The same button as everywhere else**, including on the sweep — which is the whole fix for
       * §6.2: deferring is explicitly allowed, so the screen that shows a deferred question must
       * offer the same way forward as any other, right through to `[Next round]` and the (confirmed)
       * end of the game. It used to offer only "open the next question in this round", which is
       * nothing at a round boundary.
       */}
      <span className="ml-auto">
        <AdvanceButton view={view} api={api} run={run} />
      </span>
    </footer>
  )
}
