'use client'

import {
  MAIN_SCREEN_COLOUR_SCHEMES,
  MAIN_SCREEN_TYPOGRAPHIES,
  type MainScreenColourScheme,
  type MainScreenTypography,
} from '@kwiz/domain'
import { Monitor } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { StageFrame } from '@/components/screen/stage-frame'
import { ThemeChrome } from '@/components/screen/theme-chrome'
import { WaitingStage } from '@/components/screen/waiting-stage'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

/** A predicate rather than an assertion: the radio hands back a bare string. */
const isColourScheme = (value: string): value is MainScreenColourScheme =>
  MAIN_SCREEN_COLOUR_SCHEMES.some((candidate) => candidate === value)
const isTypography = (value: string): value is MainScreenTypography =>
  MAIN_SCREEN_TYPOGRAPHIES.some((candidate) => candidate === value)

/**
 * PRD 4 §5.1 / D60 — the colour-scheme and typography pickers, shared by the quiz editor's default
 * (PRD 2 §6) and a game's own live override (PRD 2 §12). Two independent closed sets, never a
 * colour picker or a font list — that closedness is what keeps every combination pre-vetted against
 * the team palette (PRD 1 §9.3).
 *
 * `onChange` is deliberately the caller's job, not this component's: the quiz editor autosaves to
 * `api.updateQuiz`, a game overrides via `api.setMainScreenTheme`, and this component has no opinion
 * about which — it only renders the two closed sets and reports a patch.
 */
export function MainScreenThemePicker({
  quizName,
  colourScheme,
  typography,
  onChange,
}: {
  quizName: string
  colourScheme: MainScreenColourScheme
  typography: MainScreenTypography
  onChange: (patch: {
    colourScheme?: MainScreenColourScheme
    typography?: MainScreenTypography
  }) => void
}) {
  const t = useTranslations('admin.mainScreenTheme')
  const [previewing, setPreviewing] = useState(false)

  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-medium">{t('title')}</legend>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm">{t('colourScheme')}</p>
          <RadioGroup
            value={colourScheme}
            onValueChange={(next) => {
              if (isColourScheme(next)) onChange({ colourScheme: next })
            }}
            className="gap-2"
          >
            {MAIN_SCREEN_COLOUR_SCHEMES.map((candidate) => (
              <div key={candidate} className="flex items-center gap-3">
                <RadioGroupItem value={candidate} id={`main-colour-${candidate}`} />
                <Label htmlFor={`main-colour-${candidate}`}>
                  {t(`colourSchemes.${candidate}`)}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        <div className="space-y-2">
          <p className="text-muted-foreground text-sm">{t('typography')}</p>
          <RadioGroup
            value={typography}
            onValueChange={(next) => {
              if (isTypography(next)) onChange({ typography: next })
            }}
            className="gap-2"
          >
            {MAIN_SCREEN_TYPOGRAPHIES.map((candidate) => (
              <div key={candidate} className="flex items-center gap-3">
                <RadioGroupItem value={candidate} id={`main-font-${candidate}`} />
                <Label htmlFor={`main-font-${candidate}`}>
                  {t(`typographies.${candidate}`)}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>
      </div>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setPreviewing(true)}
      >
        <Monitor className="size-4" />
        {t('preview')}
      </Button>

      {/*
        PRD 2 §6 / §7.1 / O4 — the same renderer and the same reasoning: a preview drawn by a second,
        throwaway implementation would confirm the wrong thing. `WaitingStage` stands in for "which
        stage" here because it needs no question or team data to be honest about the theme, and it is
        the first thing the room actually sees.
      */}
      <Dialog open={previewing} onOpenChange={(next) => !next && setPreviewing(false)}>
        <DialogContent className="sm:max-w-[860px]">
          <DialogHeader>
            <DialogTitle>{t('previewTitle')}</DialogTitle>
            <DialogDescription>{t('previewBody')}</DialogDescription>
          </DialogHeader>

          <div data-main-theme={colourScheme} data-main-font={typography}>
            <StageFrame width={800}>
              <ThemeChrome colourScheme={colourScheme} />
              <WaitingStage
                quizName={quizName}
                code="PREVIEW"
                joinUrl="http://kwiz.local:3000"
                teams={[]}
                joinedTeamIds={[]}
                sound
              />
            </StageFrame>
          </div>
        </DialogContent>
      </Dialog>
    </fieldset>
  )
}
