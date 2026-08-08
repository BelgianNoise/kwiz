'use client'

import type { QuestionContent } from '@kwiz/domain'
import { X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/client/api'
import { useAutosave } from '@/lib/client/use-autosave'

/**
 * PRD 2 §7.2 — `FREE_TEXT`, and `BUZZER` with the same shape minus the alternatives.
 *
 * **The matching note is not decoration.** With matching at lowercase and trim only (D22), a master
 * who assumes fuzzy matching writes one answer and then spends the game hand-validating "The
 * Beatles" against "Beatles". Saying it here, where they can act on it, turns a live-game problem
 * into an authoring one — and `+ Add alternative` is the tool for it (D33).
 */
export function FreeTextSection({
  question,
  onChanged,
  buzzer = false,
}: {
  question: QuestionContent
  onChanged: () => void
  /** `BUZZER` never auto-matches: the answer is reference only, for the master (data model §4.5). */
  buzzer?: boolean
}) {
  const t = useTranslations('admin.question')

  /*
   * `{ key, text }` rather than a bare string array: an alternative can be deleted from the middle,
   * and with an index as the React key the inputs below it would inherit the wrong DOM node. The key
   * is local to this component and never sent anywhere — the server takes an ordered list of strings,
   * because `position = 0` is the canonical answer and that is all the order means.
   */
  const prefix = useId()
  const [answers, setAnswers] = useState<{ key: string; text: string }[]>(() =>
    (question.acceptedAnswers.length > 0 ? question.acceptedAnswers : ['']).map(
      (text, index) => ({ key: `${prefix}-${index}`, text }),
    ),
  )
  const [nextKey, setNextKey] = useState(answers.length)

  const save = useAutosave<string[]>((value) =>
    api.setAcceptedAnswers(question.id, value).then((result) => {
      onChanged()
      return result
    }),
  )

  const update = (next: { key: string; text: string }[]): void => {
    setAnswers(next)
    save.push(next.map((answer) => answer.text))
  }

  return (
    <section className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="accepted-0">{t('correctAnswer')}</Label>
        <Input
          id="accepted-0"
          value={answers[0]?.text ?? ''}
          onChange={(event) =>
            update([
              { key: answers[0]?.key ?? `${prefix}-0`, text: event.target.value },
              ...answers.slice(1),
            ])
          }
        />
      </div>

      {buzzer ? (
        <p className="text-muted-foreground text-sm">{t('buzzerNote')}</p>
      ) : (
        <>
          {answers.length > 1 ? (
            <div className="space-y-2">
              <Label>{t('alsoAccept')}</Label>
              {answers.slice(1).map((answer, offset) => (
                <div key={answer.key} className="flex gap-2">
                  <Input
                    value={answer.text}
                    aria-label={`${t('alsoAccept')} ${offset + 1}`}
                    onChange={(event) => {
                      const next = [...answers]
                      next[offset + 1] = { ...answer, text: event.target.value }
                      update(next)
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${t('alsoAccept')} ${offset + 1}`}
                    onClick={() => update(answers.filter((_, i) => i !== offset + 1))}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              update([...answers, { key: `${prefix}-${nextKey}`, text: '' }])
              setNextKey(nextKey + 1)
            }}
          >
            {t('addAlternative')}
          </Button>

          <p className="text-muted-foreground text-sm">{t('matchingNote')}</p>
        </>
      )}
    </section>
  )
}
