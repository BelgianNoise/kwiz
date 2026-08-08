'use client'

import {
  doConfigSchema,
  DO_SCORING_MODES,
  TIE_PAYOUTS,
  type DoConfig,
  type QuestionContent,
} from '@kwiz/domain'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { api } from '@/lib/client/api'

/**
 * PRD 2 §7.2 — `DO`, the only answer method with settings (D24).
 *
 * The per-team note earns its place: **`points` doubling as the per-team maximum is genuinely
 * non-obvious**, and a master wanting "rate out of 10" needs to know the field they are looking for
 * is `Points`, further up the sheet.
 */
export function DoSection({
  question,
  onChanged,
}: {
  question: QuestionContent
  onChanged: () => void
}) {
  const t = useTranslations('admin.question')

  const parsed = doConfigSchema.safeParse(question.config)
  const [config, setConfig] = useState<DoConfig>(
    parsed.success ? parsed.data : { scoringMode: 'WINNER_TAKES_ALL', tiePayout: 'FULL' },
  )

  const update = (next: DoConfig): void => {
    setConfig(next)
    void api.updateQuestion(question.id, { config: next }).then(onChanged)
  }

  return (
    <section className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">{t('scoring')}</legend>
        <RadioGroup
          value={config.scoringMode}
          onValueChange={(next) => {
            const mode = DO_SCORING_MODES.find((candidate) => candidate === next)
            if (mode) update({ ...config, scoringMode: mode })
          }}
          className="gap-2"
        >
          {DO_SCORING_MODES.map((mode) => (
            <div key={mode} className="flex items-center gap-2">
              <RadioGroupItem value={mode} id={`do-mode-${mode}`} />
              <Label htmlFor={`do-mode-${mode}`}>{t(`scoringMode.${mode}`)}</Label>
            </div>
          ))}
        </RadioGroup>
      </fieldset>

      {config.scoringMode === 'WINNER_TAKES_ALL' ? (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">{t('tiePayout')}</legend>
          <RadioGroup
            value={config.tiePayout}
            onValueChange={(next) => {
              const payout = TIE_PAYOUTS.find((candidate) => candidate === next)
              if (payout) update({ ...config, tiePayout: payout })
            }}
            className="gap-2"
          >
            {TIE_PAYOUTS.map((payout) => (
              <div key={payout} className="flex items-center gap-2">
                <RadioGroupItem value={payout} id={`do-payout-${payout}`} />
                <Label htmlFor={`do-payout-${payout}`}>{t(`payout.${payout}`)}</Label>
              </div>
            ))}
          </RadioGroup>
        </fieldset>
      ) : (
        <p className="text-muted-foreground text-sm">
          {t('perTeamNote', { points: question.points })}
        </p>
      )}
    </section>
  )
}
