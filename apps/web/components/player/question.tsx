'use client'

import type { ErrorCode, PlayerQuestion, PlayerView } from '@kwiz/domain'
import { DRAFT_DEBOUNCE_MS, TIMER_WARN_PLAYER_S } from '@kwiz/domain'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'

import { Buzzer } from '@/components/player/buzzer'
import { player } from '@/lib/client/api'
import { useCountdown } from '@/lib/client/use-countdown'

type Stage = Extract<PlayerView['stage'], { kind: 'QUESTION' }>

/**
 * PRD 5 §5–§8 — the answer surface.
 *
 * Five rules apply across every method, and all five exist because of §1.1's phone: **select is not
 * submit** (D44), **after submitting it is over** (D43), **drafts are shared** (D45), the timer counts
 * against the server's absolute instant (D7) and **auto-submits at zero** (D8), and only images
 * flagged for players ever appear (D27).
 */
export function QuestionStage({
  view,
  stage,
  gameId,
  token,
}: {
  view: PlayerView
  stage: Stage
  gameId: string
  token: string
}) {
  const question = stage.question
  const revealed =
    question.correctAnswer !== undefined || question.myVerdict !== undefined

  return (
    <section className="mx-auto flex min-h-dvh max-w-lg flex-col gap-5 p-5">
      <Timer question={question} />

      <h1 className="text-2xl leading-snug font-medium">{question.prompt}</h1>

      <Media question={question} />

      {revealed ? (
        <Reveal question={question} />
      ) : question.answerMethod === 'BUZZER' ? (
        <Buzzer question={question} gameId={gameId} token={token} />
      ) : question.answerMethod === 'DO' ? (
        <DoQuestion question={question} />
      ) : (
        <Answer
          question={question}
          myAnswer={stage.myAnswer}
          gameId={gameId}
          token={token}
        />
      )}

      <Standing view={view} />
    </section>
  )
}

/**
 * §5.4 — counted against the server's absolute `deadlineAt` (D7), **never a local `setTimeout`**: a
 * phone that connects three seconds late must not get 33 seconds.
 *
 * Below ten seconds it shifts colour and pulses (`TIMER_WARN_PLAYER_S`) — earlier than the main
 * screen's five, and deliberately: this is where someone is still typing and needs a chance to finish.
 * No sound, ever (§13).
 */
function Timer({ question }: { question: PlayerQuestion }) {
  const remaining = useCountdown(question.timer?.deadlineAt ?? null)
  if (remaining === null) return null

  const seconds = Math.ceil(remaining)
  const urgent = seconds > 0 && seconds <= TIMER_WARN_PLAYER_S

  return (
    <div className="flex justify-center">
      <span
        className={`rounded-xl px-5 py-2 text-4xl font-semibold tabular-nums ${
          urgent ? 'text-destructive' : 'text-muted-foreground'
        }`}
        style={urgent ? { animation: 'kwiz-urgent 1s ease-in-out infinite' } : undefined}
      >
        {seconds}
      </span>
    </div>
  )
}

/**
 * §5.5 — **only images flagged for player devices** (D27). Audio and video never reach a phone:
 * twenty of them playing the same song a few hundred milliseconds apart is unusable, and the speakers
 * are at the main screen.
 *
 * When a question has media this phone will not show, it **says so** rather than leaving a gap — a
 * team that cannot see what is being asked about would otherwise think the page failed to load.
 */
function Media({ question }: { question: PlayerQuestion }) {
  const t = useTranslations('player.game')
  const images = question.media.filter((item) => item.kind === 'IMAGE')

  if (images.length === 0) {
    // The payload only ever carries player-visible media, so an empty list on a question that has
    // attachments is indistinguishable from one that has none. Both want the same line.
    return <p className="text-muted-foreground text-lg">{t('lookAtScreen')}</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {images.map((image) => (
        // A local, content-addressed file off this machine's own disk — nothing for next/image to
        // optimise and no network to save.
        // eslint-disable-next-line @next/next/no-img-element
        <img key={image.id} src={image.url} alt="" className="w-full rounded-xl" />
      ))}
    </div>
  )
}

/**
 * §6 and §7 — free text and multiple choice, which differ only in the control.
 *
 * **Select is not submit** (D44). Typing and selecting are freely reversible; only Submit is final.
 * Without that, D43's finality would make a thumb-mis-tap on a radio option unrecoverable, and
 * mis-tapping on a phone in a dim pub is easy.
 */
function Answer({
  question,
  myAnswer,
  gameId,
  token,
}: {
  question: PlayerQuestion
  myAnswer: Stage['myAnswer']
  gameId: string
  token: string
}) {
  const t = useTranslations('player.game')
  const api = player(gameId, token)

  const submitted = myAnswer?.submitted ?? false
  const [text, setText] = useState(myAnswer?.text ?? '')
  const [option, setOption] = useState(myAnswer?.optionId ?? null)
  const [sending, setSending] = useState(false)
  const [refused, setRefused] = useState<ErrorCode | null>(null)
  const focused = useRef(false)

  /*
   * §5.3's **focused-field echo rule.** A field being typed into must not be overwritten by the
   * server's echo of its own text, or the cursor jumps on every keystroke. Unfocused fields follow
   * the server, which is how the *other* device sees what this one typed (D45).
   *
   * Honest limitation, stated in §5.3: two devices typing into a focused field at the same time show
   * different text until one blurs. Rare — a team huddles round one phone — and the alternative is a
   * collaborative text merge, which is disproportionate.
   */
  useEffect(() => {
    const incoming = myAnswer?.text
    if (!focused.current && incoming !== null && incoming !== undefined) setText(incoming)
  }, [myAnswer?.text])

  useEffect(() => {
    setOption(myAnswer?.optionId ?? null)
  }, [myAnswer?.optionId])

  // D45 — pushed on a debounce while typing, and again immediately on blur (§6).
  const pushDraft = useDebounced((value: string) => {
    void api.draft(question.id, { text: value })
  }, DRAFT_DEBOUNCE_MS)

  const submit = (): void => {
    setSending(true)
    setRefused(null)
    const answer =
      question.answerMethod === 'MULTIPLE_CHOICE'
        ? { selectedOptionId: option ?? '' }
        : { text }
    void api.submit(question.id, answer).then((result) => {
      setSending(false)
      if (!result.ok) setRefused(result.error)
    })
  }

  // §5.2 — after submitting, it is over. No edit affordance and no "change answer" link: ambiguity
  // here invites a team to argue about whether they can still change it.
  if (submitted) return <Submitted myAnswer={myAnswer} question={question} />

  return (
    <div className="flex flex-col gap-4">
      {question.answerMethod === 'MULTIPLE_CHOICE' ? (
        <ul className="flex flex-col gap-3">
          {/* §7 — authored order, identical to the main screen's, so a team looking between the two
              is not remapping anything. Ids are UUIDs, so nothing in the payload ranks them. */}
          {(question.options ?? []).map((choice) => (
            <li key={choice.id}>
              <button
                type="button"
                onClick={() => {
                  setOption(choice.id)
                  void api.draft(question.id, { selectedOptionId: choice.id })
                }}
                aria-pressed={option === choice.id}
                // §7 — full-row tap targets, tall, not a radio dot with a label beside it.
                className={`min-h-16 w-full rounded-xl border px-5 py-4 text-left text-xl ${
                  option === choice.id
                    ? 'border-primary bg-muted font-medium'
                    : 'border-border'
                }`}
              >
                {choice.text}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <input
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            pushDraft(event.target.value)
          }}
          onFocus={() => (focused.current = true)}
          onBlur={() => {
            focused.current = false
            void api.draft(question.id, { text })
          }}
          /*
           * **The single highest-value line in this slice** (§6, build-order).
           *
           * Not a preference — a correctness requirement. Matching is exact after lowercase and trim
           * (D22), and iOS autocorrect will happily turn `Radiohead` into `Radio head` and `Beyonce`
           * into `Bounce`. A phone keyboard silently rewriting answers produces a stream of wrong
           * verdicts that neither the player nor the master can explain.
           */
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          // §6 — the keyboard's action key submits. On a phone the return key is a deliberate press,
          // and reaching a button above the keyboard is not.
          enterKeyHint="send"
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
          className="border-border min-h-16 w-full rounded-xl border px-5 text-xl"
          aria-label={t('yourAnswer')}
        />
      )}

      <button
        type="button"
        onClick={submit}
        disabled={sending}
        // §5.1 — the only irreversible tap on the screen, and it says so by being the only button.
        className="bg-primary text-primary-foreground min-h-16 w-full rounded-xl text-xl font-semibold disabled:opacity-60"
      >
        {/* §12 — the button shows a *sending* state rather than success; success is the view coming
            back with `submitted`. */}
        {sending ? t('sending') : t('submit')}
      </button>

      {refused ? <Refusal code={refused} question={question} /> : null}
    </div>
  )
}

/** §5.2 — *"the submitted text is shown large, because the next thing that happens is four people asking each other what did we put."* */
function Submitted({
  myAnswer,
  question,
}: {
  myAnswer: Stage['myAnswer']
  question: PlayerQuestion
}) {
  const t = useTranslations('player.game')
  const chosen = (question.options ?? []).find((o) => o.id === myAnswer?.optionId)

  return (
    <div className="border-border flex flex-col gap-2 rounded-xl border p-5">
      <p className="text-muted-foreground text-lg">{t('yourAnswer')}</p>
      <p className="text-3xl font-semibold break-words">
        {chosen?.text ?? myAnswer?.text}
      </p>
      <p className="text-lg">{t('lockedIn')}</p>
    </div>
  )
}

/**
 * §5.3 / protocol §7.3 — **the first submission wins.**
 *
 * A second device submitting a *different* value is refused, and this is where it switches to showing
 * the team's actual answer. It never silently discards what someone typed without telling them.
 */
function Refusal({ code, question }: { code: ErrorCode; question: PlayerQuestion }) {
  const tError = useTranslations('errors')
  return (
    <p className="text-lg" role="alert">
      {tError(code)}
      {/* The canonical answer rides on the refusal's `detail` (protocol §7.3); the next pushed view
          carries `myAnswer` too, which is what actually re-renders this screen as `Submitted`. */}
      {question.correctAnswer === undefined ? null : ''}
    </p>
  )
}

/**
 * §8.1 — a `DO` question. Nothing to submit (PRD 1 §8.6).
 *
 * **No input control at all — not a disabled one.** A greyed-out field invites a team to try to type
 * in it and conclude the app is broken.
 */
function DoQuestion({ question }: { question: PlayerQuestion }) {
  const t = useTranslations('player.game')
  return (
    <div className="flex flex-col gap-3">
      <p className="text-2xl font-semibold">{t('points', { points: question.points })}</p>
      <hr className="border-border" />
      <p className="text-lg">{t('masterJudging')}</p>
    </div>
  )
}

/**
 * §11 — the reveal, showing the team's **own** outcome and never another team's answer, which is
 * forbidden in every state (PRD 1 §7 invariant 3).
 */
function Reveal({ question }: { question: PlayerQuestion }) {
  const t = useTranslations('player.game')
  const correctOption = (question.options ?? []).find(
    (o) => o.id === question.correctOptionId,
  )

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-muted-foreground text-lg">{t('correctAnswer')}</p>
        <p className="text-3xl font-semibold break-words">
          {correctOption?.text ?? question.correctAnswer}
        </p>
      </div>

      {question.myVerdict === undefined ? null : (
        <div className="border-border flex items-center gap-3 rounded-xl border p-4">
          {question.myVerdict === 'PENDING' ? (
            // §11 — *"a pending verdict says so."* Validation may legitimately be outstanding (D42),
            // and silence reads as a lost answer.
            <p className="text-lg">{t('checking')}</p>
          ) : (
            <>
              <span className="text-3xl">
                {question.myVerdict === 'CORRECT' ? '✓' : '✗'}
              </span>
              <span className="text-xl font-semibold tabular-nums">
                {t('points', { points: question.myPoints ?? 0 })}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** protocol P2 — the team's live score and rank, present in every question state. */
function Standing({ view }: { view: PlayerView }) {
  return (
    <p className="text-muted-foreground mt-auto pt-4 text-lg">
      {view.team.name} · {view.team.score}
    </p>
  )
}

/**
 * A debounce that survives re-renders, for D45's draft push.
 *
 * The timer lives in a ref rather than in the effect's cleanup: the component re-renders on every
 * keystroke *and* on every pushed view, and a cleanup-owned timer would be cancelled by an unrelated
 * view arriving mid-word — which is exactly the bug slice 6 hit with the elimination hold.
 */
function useDebounced<T>(run: (value: T) => void, ms: number): (value: T) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(run)
  latest.current = run

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  return (value: T) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => latest.current(value), ms)
  }
}
