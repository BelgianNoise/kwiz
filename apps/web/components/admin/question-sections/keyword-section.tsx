'use client'

import { wordLengths, type QuestionContent } from '@kwiz/domain'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/client/api'
import { useAutosave } from '@/lib/client/use-autosave'

/** Exactly five, always (I17). */
const SLOTS = [0, 1, 2, 3, 4]

/**
 * PRD 2 §9.1 — the keyword sheet.
 *
 * Two things here are the whole point:
 *
 * - **Five slots, always rendered.** Not an add/remove list: the count is fixed (I17), so five slots
 *   with the empty one flagged is clearer than a list that can be the wrong length.
 * - **The word shape is echoed back as you type.** This is what the room will see (D53), and it
 *   changes authoring decisions — a master may pick `"iron"` over `"wrought iron"` once they realise
 *   how much a two-word shape gives away. It is computed with `wordLengths` from `@kwiz/domain`, the
 *   same function that stores the shape on write, so the echo cannot disagree with the projector.
 */
export function KeywordSection({
  question,
  onChanged,
}: {
  question: QuestionContent
  onChanged: () => void
}) {
  const t = useTranslations('admin.question')

  const [keywords, setKeywords] = useState<string[]>(
    SLOTS.map((slot) => question.keywords[slot]?.text ?? ''),
  )

  const save = useAutosave<string[]>((value) =>
    api.setKeywords(question.id, value).then((result) => {
      onChanged()
      return result
    }),
  )

  const update = (slot: number, text: string): void => {
    const next = [...keywords]
    next[slot] = text
    setKeywords(next)
    save.push(next)
  }

  return (
    <section className="space-y-3">
      <div>
        <Label>{t('keywords')}</Label>
        <p className="text-muted-foreground text-sm">{t('keywordsHint')}</p>
      </div>

      <ol className="space-y-2">
        {SLOTS.map((slot) => {
          const text = keywords[slot] ?? ''
          const shape = text.trim() === '' ? [] : wordLengths(text)

          return (
            <li key={slot} className="flex items-center gap-3">
              <span className="text-muted-foreground w-4 text-sm tabular-nums">
                {slot + 1}
              </span>
              <Input
                value={text}
                aria-label={`${t('keywords')} ${slot + 1}`}
                onChange={(event) => update(slot, event.target.value)}
              />
              {/*
                The echo. Word count plus the letters per word, which is exactly what a blurred tile
                shows the room — "wrought iron" reads as 7 and 4.
              */}
              <span className="text-muted-foreground w-32 shrink-0 text-sm">
                {shape.length === 0 ? (
                  <span className="text-destructive">{t('keywordRequired')}</span>
                ) : (
                  <>
                    {t('wordShape', { count: shape.length })}
                    <span className="ml-2 font-mono">{shape.join('·')}</span>
                  </>
                )}
              </span>
            </li>
          )
        })}
      </ol>

      <p className="text-muted-foreground text-sm">{t('keywordShapeNote')}</p>
    </section>
  )
}
