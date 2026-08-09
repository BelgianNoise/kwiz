'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { api } from '@/lib/client/api'
import { formatBytes } from '@/lib/client/format'

/**
 * PRD 2 §14.1.
 *
 * **Sizes are computed, not estimated** — the whole reason this is a dialog rather than a menu item.
 * A master copying a night onto a USB stick wants to know before they start, and the numbers move
 * with the checkboxes because that is the decision being made.
 *
 * Unticking attachments is a supported way to use this, not a degraded one: it produces a zip that
 * imports with clearly-marked missing media (protocol §8.1), which is what makes "just send me the
 * questions" work at all.
 */
export function ExportDialog({
  quizId,
  quizName,
  games,
  onlyGameId,
  open,
  onClose,
}: {
  quizId: string
  quizName: string
  games: number
  /**
   * §14.1's "Export this game" — narrows to one game. With it set, the quiz-only option is not
   * offered: the master asked for a game, and an export without it would be a different thing.
   */
  onlyGameId?: string
  open: boolean
  onClose: () => void
}) {
  const t = useTranslations('admin.export')

  const [includeGames, setIncludeGames] = useState(onlyGameId !== undefined)
  const [includeAttachments, setIncludeAttachments] = useState(true)
  type Size = { bytes: number; attachments: number } | null
  const [sizeQuizOnly, setSizeQuizOnly] = useState<Size>(null)
  const [sizeWithGames, setSizeWithGames] = useState<Size>(null)
  const [busy, setBusy] = useState(false)

  /*
   * §14.1's mockup shows `~4 MB` beside **both** scope rows at once, not only the one currently
   * selected — the whole point of showing size is comparing before choosing, and a master can't
   * compare a number they can only see one side of. Both are computed with the current
   * `includeAttachments`, which is the one option that isn't itself a choice between these two.
   *
   * With `onlyGameId` set there is no scope choice at all (§14.1's "Export this game" already
   * made it) — one fetch, for the one shape that will actually be exported.
   */
  useEffect(() => {
    if (!open) return undefined

    let current = true

    if (onlyGameId !== undefined) {
      void api
        .exportSize(quizId, { includeGames: true, includeAttachments, onlyGameId })
        .then((result) => {
          if (current && result.ok && result.data) setSizeWithGames(result.data)
        })
      return () => {
        current = false
      }
    }

    void api
      .exportSize(quizId, { includeGames: false, includeAttachments })
      .then((result) => {
        if (current && result.ok && result.data) setSizeQuizOnly(result.data)
      })
    if (games > 0) {
      void api
        .exportSize(quizId, { includeGames: true, includeAttachments })
        .then((result) => {
          if (current && result.ok && result.data) setSizeWithGames(result.data)
        })
    }
    return () => {
      current = false
    }
  }, [open, quizId, includeAttachments, onlyGameId, games])

  // The scope actually selected — what the attachments checkbox's own count/size describes.
  const size = includeGames ? sizeWithGames : sizeQuizOnly

  const download = async (): Promise<void> => {
    setBusy(true)
    const result = await api.downloadExport(quizId, {
      includeGames,
      includeAttachments,
      ...(onlyGameId ? { onlyGameId } : {}),
    })
    setBusy(false)
    if (result.ok) onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title', { name: quizName })}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </DialogHeader>

        {/* With a game named, there is no scope to choose — the menu item already chose it. */}
        <RadioGroup
          value={includeGames ? 'WITH_GAMES' : 'QUIZ_ONLY'}
          onValueChange={(next) => setIncludeGames(next === 'WITH_GAMES')}
          className="gap-3"
        >
          <div className={onlyGameId === undefined ? 'flex items-start gap-3' : 'hidden'}>
            <RadioGroupItem value="QUIZ_ONLY" id="export-quiz-only" className="mt-1" />
            <Label htmlFor="export-quiz-only" className="flex flex-col items-start gap-1">
              <span className="flex items-baseline gap-2">
                <span>{t('quizOnly')}</span>
                {/* §14.1's mockup: a size beside *each* row, not only the selected one — the
                    comparison is the point. */}
                {sizeQuizOnly ? (
                  // Not through the messages module (matching `formatBytes`'s own rule): an SI
                  // byte count is identical in both locales.
                  <span className="text-muted-foreground text-xs">
                    {formatBytes(sizeQuizOnly.bytes)}
                  </span>
                ) : null}
              </span>
              <span className="text-muted-foreground text-sm font-normal">
                {t('quizOnlyHint')}
              </span>
            </Label>
          </div>
          {/* Offered only when there is history to take — an empty option is a question with no answer. */}
          {games > 0 && onlyGameId === undefined ? (
            <div className="flex items-start gap-3">
              <RadioGroupItem
                value="WITH_GAMES"
                id="export-with-games"
                className="mt-1"
              />
              <Label
                htmlFor="export-with-games"
                className="flex flex-col items-start gap-1"
              >
                <span className="flex items-baseline gap-2">
                  <span>{t('withGames', { count: games })}</span>
                  {sizeWithGames ? (
                    <span className="text-muted-foreground text-xs">
                      {formatBytes(sizeWithGames.bytes)}
                    </span>
                  ) : null}
                </span>
                <span className="text-muted-foreground text-sm font-normal">
                  {t('withGamesHint')}
                </span>
              </Label>
            </div>
          ) : null}
        </RadioGroup>

        <div className="flex items-center gap-3">
          <Checkbox
            id="export-attachments"
            checked={includeAttachments}
            onCheckedChange={(next) => setIncludeAttachments(next === true)}
          />
          <Label htmlFor="export-attachments">
            {size
              ? t('includeAttachments', {
                  count: size.attachments,
                  size: formatBytes(size.bytes),
                })
              : t('includeAttachmentsPlain')}
          </Label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              void download()
            }}
          >
            {t('export')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
