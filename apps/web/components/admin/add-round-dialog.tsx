'use client'

import { ROUND_TYPES, type RoundType } from '@kwiz/domain'
import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { api } from '@/lib/client/api'

/**
 * PRD 2 §6 — `+ Add round` asks only for **type and title**.
 *
 * Everything else has a default and is set in the round editor. A dialog demanding eight fields
 * before you can write a question is how authoring stalls.
 *
 * §6.1: once a finale exists the type picker **stops offering one, with a one-line reason** rather
 * than a silently missing option. The repository refuses it too — prevention is this dialog's job,
 * verification is pre-flight's, and an imported quiz never passed through either.
 */
/** A predicate rather than an assertion: the radio hands back a bare string. */
const isRoundType = (value: string): value is RoundType =>
  ROUND_TYPES.some((candidate) => candidate === value)

export function AddRoundDialog({
  open,
  quizId,
  hasFinale,
  onClose,
  onCreated,
}: {
  open: boolean
  quizId: string
  hasFinale: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const t = useTranslations('admin.quiz')
  const common = useTranslations('common')

  const titleRef = useRef<HTMLInputElement>(null)
  const [type, setType] = useState<RoundType>('QUESTION_SET')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  const create = async (): Promise<void> => {
    setBusy(true)
    const result = await api.createRound(quizId, { type, title: title.trim() })
    setBusy(false)
    if (result.ok) {
      setTitle('')
      setType('QUESTION_SET')
      onClose()
      onCreated()
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      {/*
        Focus goes to the title, not to the first radio: the type has a sensible default and the
        title is the one thing that must be typed. Done through Radix's own hook rather than
        `autoFocus`, which `jsx-a11y/no-autofocus` bans outright — inside a modal, moving focus in is
        expected behaviour, but the blanket attribute is not the way to ask for it.
      */}
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          titleRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('addRoundTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('roundTypeLabel')}</legend>
            <RadioGroup
              value={type}
              onValueChange={(next) => {
                if (isRoundType(next)) setType(next)
              }}
              className="gap-3"
            >
              {ROUND_TYPES.filter(
                // The reason is spelled out below rather than the option just vanishing.
                (candidate) => candidate !== 'DSMTW_FINALE' || !hasFinale,
              ).map((candidate) => (
                <div key={candidate} className="flex items-start gap-3">
                  <RadioGroupItem value={candidate} id={`round-type-${candidate}`} />
                  <div className="space-y-0.5">
                    <Label htmlFor={`round-type-${candidate}`}>
                      {t(`type.${candidate}`)}
                    </Label>
                    <p className="text-muted-foreground text-sm">
                      {t(`typeHint.${candidate}`)}
                    </p>
                  </div>
                </div>
              ))}
            </RadioGroup>
            {hasFinale ? (
              <p className="text-muted-foreground text-sm">{t('finaleExists')}</p>
            ) : null}
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="round-title">{t('roundTitleLabel')}</Label>
            <Input
              ref={titleRef}
              id="round-title"
              value={title}
              placeholder={t('roundTitlePlaceholder')}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && title.trim() !== '') void create()
              }}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {common('cancel')}
          </Button>
          <Button
            disabled={title.trim() === '' || busy}
            onClick={() => {
              void create()
            }}
          >
            {common('add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
