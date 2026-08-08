'use client'

import type { QuestionContent } from '@kwiz/domain'
import { X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { api } from '@/lib/client/api'
import { useAutosave } from '@/lib/client/use-autosave'

interface DraftOption {
  /**
   * Local to this component, never sent. An option can be deleted from the middle and the radio
   * selection moves with it, so an index as the React key would hand the wrong DOM node — and the
   * wrong checked state — to the option below.
   */
  key: string
  text: string
  isCorrect: boolean
}

/**
 * PRD 2 §7.2 — `MULTIPLE_CHOICE`.
 *
 * **The radio group is what makes "exactly one correct" structural rather than validated** (I4).
 * A set of checkboxes plus a validation message would let a master save two correct options and
 * discover it at pre-flight; a radio cannot express that state at all.
 */
export function MultipleChoiceSection({
  question,
  onChanged,
}: {
  question: QuestionContent
  onChanged: () => void
}) {
  const t = useTranslations('admin.question')

  const prefix = useId()
  const [options, setOptions] = useState<DraftOption[]>(() =>
    question.options.length > 0
      ? question.options.map((option, index) => ({
          key: `${prefix}-${index}`,
          text: option.text,
          isCorrect: option.isCorrect,
        }))
      : [
          { key: `${prefix}-0`, text: '', isCorrect: true },
          { key: `${prefix}-1`, text: '', isCorrect: false },
        ],
  )
  const [nextKey, setNextKey] = useState(options.length)

  const save = useAutosave<DraftOption[]>((value) =>
    api
      .setOptions(
        question.id,
        value.map((option) => ({ text: option.text, isCorrect: option.isCorrect })),
      )
      .then((result) => {
        onChanged()
        return result
      }),
  )

  const update = (next: DraftOption[]): void => {
    setOptions(next)
    save.push(next)
  }

  const correctIndex = options.findIndex((option) => option.isCorrect)

  return (
    <section className="space-y-3">
      <div>
        <Label>{t('options')}</Label>
        <p className="text-muted-foreground text-sm">{t('optionsHint')}</p>
      </div>

      <RadioGroup
        value={String(correctIndex)}
        onValueChange={(next) => {
          const picked = Number(next)
          update(
            options.map((option, index) => ({ ...option, isCorrect: index === picked })),
          )
        }}
        className="gap-2"
      >
        {options.map((option, index) => (
          <div key={option.key} className="flex items-center gap-2">
            <RadioGroupItem
              value={String(index)}
              id={`option-correct-${index}`}
              aria-label={`${t('correctAnswer')} ${index + 1}`}
            />
            <Input
              value={option.text}
              aria-label={`${t('options')} ${index + 1}`}
              onChange={(event) => {
                const next = [...options]
                next[index] = { ...option, text: event.target.value }
                update(next)
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              // Two is the floor (I4): one option is not a choice.
              disabled={options.length <= 2}
              aria-label={`${t('options')} ${index + 1}`}
              onClick={() => {
                const next = options.filter((_, i) => i !== index)
                // Removing the correct one has to leave a correct one behind.
                if (!next.some((candidate) => candidate.isCorrect) && next[0]) {
                  next[0] = { ...next[0], isCorrect: true }
                }
                update(next)
              }}
            >
              <X className="size-4" />
            </Button>
          </div>
        ))}
      </RadioGroup>

      {options.length < 4 ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            update([
              ...options,
              { key: `${prefix}-${nextKey}`, text: '', isCorrect: false },
            ])
            setNextKey(nextKey + 1)
          }}
        >
          {t('addOption')}
        </Button>
      ) : null}
    </section>
  )
}
