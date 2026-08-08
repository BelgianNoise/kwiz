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
  const [size, setSize] = useState<{ bytes: number; attachments: number } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return undefined

    let current = true
    const scope = {
      includeGames,
      includeAttachments,
      ...(onlyGameId ? { onlyGameId } : {}),
    }
    void api.exportSize(quizId, scope).then((result) => {
      // The dialog may have closed, or the options changed again, while this was in flight.
      if (current && result.ok && result.data) setSize(result.data)
    })
    return () => {
      current = false
    }
  }, [open, quizId, includeGames, includeAttachments, onlyGameId])

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
              <span>{t('quizOnly')}</span>
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
                <span>{t('withGames', { count: games })}</span>
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
