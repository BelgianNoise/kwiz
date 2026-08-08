'use client'

import { AlertTriangle, Info } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
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
import { useRouter } from '@/i18n/navigation'
import { api } from '@/lib/client/api'
import type { ImportPreview } from '@/lib/server/transfer'

/**
 * PRD 2 §14.2 — the collision dialog.
 *
 * Everything here follows from one fact: **`Replace` deletes a master's work**, so the screen has to
 * make the safe choice obvious without hiding the destructive one.
 *
 * - **Compared by `updatedAt`, not by revision** (correcting D9). Autosaved editing increments a
 *   revision per keystroke, so `rev 7 vs rev 9` orders correctly and tells a human nothing.
 * - **The verdict is spelled out in words.** Two dates side by side still require the master to do
 *   the comparison, at speed, and getting it wrong is the irreversible direction.
 * - **`Import as a separate copy` is the default**, because it is the non-destructive option.
 * - **Replace states its cost**, including the game count.
 */
export function ImportDialog({
  file,
  preview,
  onClose,
}: {
  file: File
  preview: ImportPreview
  onClose: () => void
}) {
  const t = useTranslations('admin.import')
  const format = useFormatter()
  const router = useRouter()

  const [mode, setMode] = useState<'COPY' | 'REPLACE'>('COPY')
  const [busy, setBusy] = useState(false)

  const run = async (): Promise<void> => {
    setBusy(true)
    const result = await api.performImport(file, mode)
    setBusy(false)
    if (result.ok) {
      onClose()
      router.refresh()
    }
  }

  const when = (iso: string): string => format.dateTime(new Date(iso), 'medium')

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title', { name: preview.quiz.name })}</DialogTitle>
          <DialogDescription>
            {t('summary', {
              rounds: preview.counts.rounds,
              questions: preview.counts.questions,
            })}
          </DialogDescription>
        </DialogHeader>

        {/* §8.1's per-file reporting — "just send me the questions" must arrive as a known state. */}
        {preview.missingAttachments.length > 0 ? (
          <p className="text-muted-foreground flex items-start gap-2 text-sm">
            <Info className="mt-0.5 size-4 shrink-0" />
            {t('missingMedia', { count: preview.missingAttachments.length })}
          </p>
        ) : null}

        {preview.collision ? (
          <>
            <p className="text-destructive flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {t('collision')}
            </p>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-left">
                  <th className="font-normal">
                    <span className="sr-only">{t('field')}</span>
                  </th>
                  <th className="font-normal">{t('onThisMachine')}</th>
                  <th className="font-normal">{t('inThisFile')}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="text-muted-foreground pr-4">{t('edited')}</td>
                  <td>{when(preview.collision.localUpdatedAt)}</td>
                  <td>{when(preview.exportedAt)}</td>
                </tr>
                <tr>
                  <td className="text-muted-foreground pr-4">{t('rounds')}</td>
                  <td>
                    {t('roundsValue', {
                      rounds: preview.collision.localRounds,
                      questions: preview.collision.localQuestions,
                    })}
                  </td>
                  <td>
                    {t('roundsValue', {
                      rounds: preview.counts.rounds,
                      questions: preview.counts.questions,
                    })}
                  </td>
                </tr>
                <tr>
                  <td className="text-muted-foreground pr-4">{t('games')}</td>
                  <td>{t('gamesValue', { count: preview.collision.localGames })}</td>
                  <td>{t('gamesValue', { count: preview.counts.games })}</td>
                </tr>
              </tbody>
            </table>

            {/* The comparison, done for them. This is the sentence that prevents the wrong click. */}
            <p className="text-muted-foreground flex items-start gap-2 text-sm">
              <Info className="mt-0.5 size-4 shrink-0" />
              {preview.collision.olderThanLocal ? t('fileIsOlder') : t('fileIsNewer')}
            </p>

            <RadioGroup
              value={mode}
              onValueChange={(next) => setMode(next === 'REPLACE' ? 'REPLACE' : 'COPY')}
              className="gap-3"
            >
              <div className="flex items-start gap-3">
                <RadioGroupItem value="COPY" id="import-copy" className="mt-1" />
                <Label htmlFor="import-copy">{t('asCopy')}</Label>
              </div>
              <div className="flex items-start gap-3">
                <RadioGroupItem value="REPLACE" id="import-replace" className="mt-1" />
                <Label
                  htmlFor="import-replace"
                  className="flex flex-col items-start gap-1"
                >
                  <span>{t('replace')}</span>
                  <span className="text-destructive text-sm font-normal">
                    {t('replaceCost', { games: preview.collision.localGames })}
                  </span>
                </Label>
              </div>
            </RadioGroup>
          </>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant={mode === 'REPLACE' ? 'destructive' : 'default'}
            disabled={busy}
            onClick={() => {
              void run()
            }}
          >
            {mode === 'REPLACE' ? t('replace') : t('import')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
