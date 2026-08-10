'use client'

import { AlertTriangle, Check, SkipForward } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import type { ZoneProps } from '@/components/control/control-desk'
import { useControlKeys } from '@/components/control/keys'
import { cn } from '@/lib/utils'

/**
 * PRD 3 §2.1 — the timeline. `Q1✓ Q2✓ Q3✓ [Q4] Q5 Q6⚠ Q7`.
 *
 * It answers *"where are we?"* and *"what did I skip?"* without navigating anywhere, which is why it
 * is a fixed region rather than a screen.
 *
 * **Clicking a past question navigates the timeline only — it never reopens anything.** Questions
 * are never re-opened for answers (§9.2), and the distinction has to be visually obvious or a master
 * will reopen one by accident in front of a room. So the cursor is a *reading* position: it moves a
 * highlight and shows that question's prompt, and the only thing it can ever cause is opening a
 * question that has not been played yet.
 */
export function Timeline({ view, api, run }: ZoneProps) {
  const t = useTranslations('control.timeline')
  const tq = useTranslations('control.question')
  const [cursor, setCursor] = useState<string | null>(null)

  const current = view.question?.gameQuestionId ?? null

  // Following the game is the default; the cursor is something the master opts into and which
  // resets the moment the game moves on, so it can never be silently stale.
  useEffect(() => setCursor(null), [current])

  const entries = view.timeline
  const focusedId = cursor ?? current
  const focused = entries.find((entry) => entry.gameQuestionId === focusedId)

  // §13 — `←`/`→` move along the timeline, read-only.
  useControlKeys((event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return false
    if (entries.length === 0) return false

    const index = entries.findIndex((entry) => entry.gameQuestionId === focusedId)
    const from = index === -1 ? 0 : index
    const next = event.key === 'ArrowLeft' ? from - 1 : from + 1
    const target = entries[Math.min(Math.max(next, 0), entries.length - 1)]
    if (target) setCursor(target.gameQuestionId)
    return true
  })

  if (entries.length === 0) return null

  return (
    <section className="flex items-center gap-3 px-4 py-2 text-sm">
      <span className="text-muted-foreground shrink-0">{t('label')}</span>

      <ol className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {entries.map((entry, index) => {
          const isCurrent = entry.gameQuestionId === current
          const isFocused = entry.gameQuestionId === focusedId
          const done =
            entry.state === 'REVEALED' ||
            entry.state === 'SCORED' ||
            entry.state === 'LOCKED'

          return (
            <li key={entry.gameQuestionId}>
              <button
                type="button"
                aria-current={isCurrent ? 'step' : undefined}
                onClick={() => setCursor(entry.gameQuestionId)}
                /*
                 * The markers below are icons, so the state has to be said in words somewhere or
                 * the whole strip reads as "Q1 Q2 Q3" to anything that is not a pair of eyes.
                 */
                title={entry.prompt}
                aria-label={`${entry.prompt} — ${t(`state.${entry.state}`)}${
                  entry.failsPreflight ? ` — ${t('preflight')}` : ''
                }`}
                className={cn(
                  'flex items-center gap-1 rounded-md border px-2 py-1 whitespace-nowrap',
                  isFocused ? 'border-foreground' : 'border-transparent',
                  isCurrent && 'bg-accent font-medium',
                  !isCurrent && entry.state === 'PENDING' && 'text-muted-foreground',
                )}
              >
                <span>Q{index + 1}</span>
                {done ? <Check aria-hidden className="size-3" /> : null}
                {entry.state === 'SKIPPED' ? (
                  <SkipForward aria-hidden className="size-3" />
                ) : null}
                {/* PRD 2 §10's ⚠ — the master already chose to play it anyway. */}
                {entry.failsPreflight ? (
                  <AlertTriangle aria-hidden className="text-destructive size-3" />
                ) : null}
              </button>
            </li>
          )
        })}
      </ol>

      {/*
       * What the cursor is pointing at. The prompt only — a past question's *answers* are PRD 2
       * §13's review grid, which is a REST read over an unbounded set (§1.1) and belongs to the
       * screen built for it, not to a strip at the bottom of a live desk.
       */}
      {focused ? (
        <span className="text-muted-foreground max-w-[40%] min-w-0 shrink-0 truncate">
          {focused.gameQuestionId === current ? `${t('current')} · ` : ''}
          {focused.prompt}
        </span>
      ) : null}

      {/* The only action the timeline can cause: starting a question that has not been played. */}
      {focused && focused.state === 'PENDING' && view.status === 'LIVE' ? (
        <button
          type="button"
          className="text-primary shrink-0 underline-offset-4 hover:underline"
          onClick={() => run(() => api.openQuestion(focused.gameQuestionId))}
        >
          {tq('openNext')}
        </button>
      ) : null}
    </section>
  )
}
