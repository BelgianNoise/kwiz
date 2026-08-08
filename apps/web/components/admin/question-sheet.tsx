'use client'

import {
  ANSWER_METHODS,
  type AnswerMethod,
  type QuestionContent,
  type RoundContent,
} from '@kwiz/domain'
import { ChevronDown, ChevronUp, Monitor } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { AttachmentList } from '@/components/admin/attachment-list'
import { DoSection } from '@/components/admin/question-sections/do-section'
import { FreeTextSection } from '@/components/admin/question-sections/free-text-section'
import { KeywordSection } from '@/components/admin/question-sections/keyword-section'
import { MultipleChoiceSection } from '@/components/admin/question-sections/multiple-choice-section'
import { SaveIndicator } from '@/components/admin/save-indicator'
import { ScreenPreview } from '@/components/admin/screen-preview'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/client/api'
import { useAutosave } from '@/lib/client/use-autosave'

/**
 * PRD 2 §7.1 — the question sheet, **over the list rather than on its own page.**
 *
 * A master authoring forty questions has to keep the list in view; a full-page navigation per
 * question destroys that context and makes *"is question 12 the odd one out?"* impossible to answer.
 * That is also why there is no `/admin/questions/:id` route at all (§2).
 *
 * `[↑ ↓]` walk to the previous and next question **without closing**, and are bound to `Alt+↑/↓`.
 * Authoring is a bulk activity: close-reopen-scroll per question is the difference between pleasant
 * and tedious.
 */
export function QuestionSheet({
  round,
  question,
  index,
  total,
  onClose,
  onStep,
  onChanged,
}: {
  round: RoundContent
  question: QuestionContent | undefined
  index: number
  total: number
  onClose: () => void
  onStep: (delta: number) => void
  onChanged: () => void
}) {
  const t = useTranslations('admin.question')
  const open = question !== undefined

  /*
   * `Alt+↑/↓` as well as the buttons (§7.1). Bound on the window rather than the sheet, because the
   * master may be focused in any field inside it — and `Alt` rather than a bare arrow, which would
   * fight every text input in here.
   */
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (!event.altKey) return
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        onStep(-1)
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        onStep(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onStep])

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        {question ? (
          <QuestionForm
            key={question.id}
            round={round}
            question={question}
            index={index}
            total={total}
            onStep={onStep}
            onChanged={onChanged}
          />
        ) : (
          <SheetHeader>
            <SheetTitle>{t('heading', { index: 0, total: 0 })}</SheetTitle>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  )
}

/**
 * Keyed by question id by the sheet above, so switching questions **remounts** this rather than
 * reusing it. That is deliberate: every field here is uncontrolled with a `defaultValue`, which is
 * what lets a master type without a round trip per keystroke — and an uncontrolled field does not
 * update when its prop changes.
 */
function QuestionForm({
  round,
  question,
  index,
  total,
  onStep,
  onChanged,
}: {
  round: RoundContent
  question: QuestionContent
  index: number
  total: number
  onStep: (delta: number) => void
  onChanged: () => void
}) {
  const t = useTranslations('admin.question')

  const [method, setMethod] = useState<AnswerMethod>(question.answerMethod)
  const [noTimer, setNoTimer] = useState(question.timerMs === null)
  const [previewing, setPreviewing] = useState(false)

  const prompt = useAutosave<string>((value) =>
    api.updateQuestion(question.id, { prompt: value }),
  )
  const notes = useAutosave<string>((value) =>
    api.updateQuestion(question.id, { masterNotes: value === '' ? null : value }),
  )
  const points = useAutosave<number>((value) =>
    api.updateQuestion(question.id, { points: value }),
  )
  const timer = useAutosave<number | null>((value) =>
    api.updateQuestion(question.id, { timerMs: value }),
  )

  /*
   * §8 and §9.1 — the method is a **fact** for a board tile and a finale question, stated in words
   * rather than shown as a disabled radio group. A greyed-out control invites the master to wonder
   * what is broken; a sentence tells them the rule (D34, I18).
   */
  const methodLocked = round.type !== 'QUESTION_SET'

  const changeMethod = (next: AnswerMethod): void => {
    setMethod(next)
    void api
      .updateQuestion(question.id, {
        answerMethod: next,
        // `DO` is the only method with settings, and it cannot be scored without them (D24).
        ...(next === 'DO' && !('scoringMode' in question.config)
          ? { config: { scoringMode: 'WINNER_TAKES_ALL', tiePayout: 'FULL' } }
          : {}),
      })
      .then(onChanged)
  }

  return (
    <>
      <SheetHeader className="flex-row items-center justify-between gap-2 border-b">
        <SheetTitle>{t('heading', { index: index + 1, total })}</SheetTitle>
        <div className="flex items-center gap-1">
          <SaveIndicator status={prompt.status} savedAt={prompt.savedAt} />
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('previous')}
            disabled={index === 0}
            onClick={() => onStep(-1)}
          >
            <ChevronUp className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('next')}
            disabled={index >= total - 1}
            onClick={() => onStep(1)}
          >
            <ChevronDown className="size-4" />
          </Button>
        </div>
      </SheetHeader>

      <div className="space-y-6 p-4">
        <div className="space-y-2">
          <Label htmlFor="question-prompt">{t('prompt')}</Label>
          <Textarea
            id="question-prompt"
            rows={2}
            defaultValue={question.prompt}
            placeholder={t('promptPlaceholder')}
            onChange={(event) => prompt.push(event.target.value)}
          />
        </div>

        {methodLocked ? (
          <p className="text-muted-foreground text-sm">
            {round.type === 'JEOPARDY' ? t('lockedBuzzer') : t('lockedKeywords')}
          </p>
        ) : (
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">{t('answerMethod')}</legend>
            <RadioGroup
              value={method}
              onValueChange={(next) => {
                const found = ANSWER_METHODS.find((candidate) => candidate === next)
                // `KEYWORDS` is never offered outside a finale (I18), so it cannot be picked here.
                if (found && found !== 'KEYWORDS') changeMethod(found)
              }}
              className="grid grid-cols-2 gap-2"
            >
              {ANSWER_METHODS.filter((candidate) => candidate !== 'KEYWORDS').map(
                (candidate) => (
                  <div key={candidate} className="flex items-center gap-2">
                    <RadioGroupItem value={candidate} id={`method-${candidate}`} />
                    <Label htmlFor={`method-${candidate}`}>
                      {t(`method.${candidate}`)}
                    </Label>
                  </div>
                ),
              )}
            </RadioGroup>
          </fieldset>
        )}

        {round.type === 'DSMTW_FINALE' ? null : (
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-24 space-y-2">
              <Label htmlFor="question-points">{t('points')}</Label>
              <Input
                id="question-points"
                type="number"
                min={0}
                // A board tile takes its value from the ladder, and editing it here would let a
                // column stop reading 100/200/300 (§8, O3).
                disabled={round.type === 'JEOPARDY'}
                defaultValue={question.points}
                onChange={(event) => points.push(Number(event.target.value))}
              />
            </div>
            <div className="w-28 space-y-2">
              <Label htmlFor="question-timer">{t('timer')}</Label>
              <Input
                id="question-timer"
                type="number"
                min={1}
                disabled={noTimer}
                defaultValue={
                  question.timerMs === null ? '' : Math.round(question.timerMs / 1000)
                }
                onChange={(event) => timer.push(Number(event.target.value) * 1000)}
              />
            </div>
            <div className="flex items-center gap-2 pb-2">
              <Checkbox
                id="question-no-timer"
                checked={noTimer}
                onCheckedChange={(checked) => {
                  const off = checked === true
                  setNoTimer(off)
                  // Null is "no timer"; zero is invalid (I12).
                  if (off) timer.push(null)
                }}
              />
              <Label htmlFor="question-no-timer">{t('noTimer')}</Label>
            </div>
          </div>
        )}

        {/* ── the method-specific section (§7.2) ── */}
        {method === 'FREE_TEXT' ? (
          <FreeTextSection question={question} onChanged={onChanged} />
        ) : null}
        {method === 'MULTIPLE_CHOICE' ? (
          <MultipleChoiceSection question={question} onChanged={onChanged} />
        ) : null}
        {method === 'BUZZER' ? (
          <FreeTextSection question={question} onChanged={onChanged} buzzer />
        ) : null}
        {method === 'DO' ? <DoSection question={question} onChanged={onChanged} /> : null}
        {method === 'KEYWORDS' ? (
          <KeywordSection question={question} onChanged={onChanged} />
        ) : null}

        <AttachmentList question={question} onChanged={onChanged} />

        <div className="space-y-2">
          <Label htmlFor="question-notes">{t('masterNotes')}</Label>
          {/*
            §7.1 — labelled with its **guarantee**, not just named. "Never shown to anyone else" is
            the whole reason a master will trust the field (PRD 1 §7 invariant 7).
          */}
          <p className="text-muted-foreground text-sm">{t('masterNotesHint')}</p>
          <Textarea
            id="question-notes"
            rows={2}
            defaultValue={question.masterNotes ?? ''}
            onChange={(event) => notes.push(event.target.value)}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          {/*
            §7.1 / O4 — the real PRD 4 renderer, scaled. It catches the two failures that are common
            and completely invisible on a laptop: a prompt that overflows at projector scale, and a
            dark image that disappears under projector contrast.
          */}
          <Button variant="secondary" size="sm" onClick={() => setPreviewing(true)}>
            <Monitor className="size-4" />
            {t('previewOnScreen')}
          </Button>
          <SaveIndicator status={notes.status} savedAt={notes.savedAt} />
        </div>

        <ScreenPreview
          open={previewing}
          question={question}
          points={question.points}
          onClose={() => setPreviewing(false)}
        />
      </div>
    </>
  )
}
