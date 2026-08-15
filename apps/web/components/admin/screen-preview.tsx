'use client'

import type { MainScreenQuestion, QuestionContent } from '@kwiz/domain'
import { useTranslations } from 'next-intl'

import { QuestionStage } from '@/components/screen/question-stage'
import { StageFrame } from '@/components/screen/stage-frame'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * PRD 2 §7.1 / O4 — **`[Preview on main screen]`**.
 *
 * It opens the *real* PRD 4 renderer in a mock `OPEN` state, which is the whole point: a preview
 * drawn by a second implementation confirms the second implementation. `QuestionStage` here is the
 * same component slice 6's screen surface renders, and `StageFrame` gives it the projector's exact
 * proportions scaled down, so the two failures §7.1 names are both visible on a laptop:
 *
 * - **A long prompt overflowing at projector scale.** Invisible in an authoring textarea, obvious
 *   here, because the frame is 1920×1080 and the type scale is the real one.
 * - **A dark image disappearing under projector contrast.** Shown against the real dark stage rather
 *   than a white form.
 *
 * The mock view is a genuine `MainScreenQuestion` (protocol §5.2) rather than an invented shape, so
 * a field that changes there breaks this at compile time instead of drifting.
 */
export function ScreenPreview({
  question,
  points,
  open,
  onClose,
}: {
  question: QuestionContent
  /** The effective value — a board tile takes it from the ladder, not from the question row (O3). */
  points: number
  open: boolean
  onClose: () => void
}) {
  const t = useTranslations('admin.preview')

  /*
   * `OPEN` deliberately: it is the state the room spends the most time looking at, and the only one
   * where an overflowing prompt is a live problem. Nothing here reveals an answer — a preview that
   * showed the reveal state would be showing content the payload filters keep out of this view until
   * the master reveals it (protocol §6.2).
   */
  const view: MainScreenQuestion = {
    id: question.id,
    prompt: question.prompt,
    points,
    media: question.media.map((media) => ({
      id: media.id,
      kind: media.kind,
      url: `/api/attachment/${media.id}`,
      durationMs: media.durationMs,
    })),
    // A timer only if the question actually has one, since it occupies the top-right corner and
    // its absence changes how much room the prompt has.
    timer:
      question.timerMs === null
        ? null
        : {
            deadlineAt: Date.now() + question.timerMs,
            pausedAt: null,
            // Full, so the preview's ring is drawn at the start of the question — which is the
            // moment the preview is answering a question about.
            durationMs: question.timerMs,
          },
    state: 'OPEN',
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      {/* Wide enough that the scaled stage is big enough to judge, which is the point of opening it. */}
      <DialogContent className="sm:max-w-[900px]">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </DialogHeader>

        {/* 840 of 1920 — a hair over 43%, and every proportion inside is the projector's exactly. */}
        <StageFrame width={840}>
          <QuestionStage question={view} />
        </StageFrame>
      </DialogContent>
    </Dialog>
  )
}
