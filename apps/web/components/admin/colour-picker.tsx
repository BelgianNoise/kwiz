'use client'

import { isColourTaken, isLegibleOnStage, normaliseHex, TEAM_PALETTE } from '@kwiz/domain'
import { AlertTriangle } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/**
 * PRD 1 §9.3's palette, plus PRD 2 §11's custom option.
 *
 * - **Taken colours are marked, not disabled.** The palette's job is to make the first several teams
 *   mutually unmistakable, not to police the rest — and beyond that a master may want a near-match
 *   on purpose. Colour is never the sole identifier anyway (PRD 1 §9.5).
 * - **The custom option warns instead of refusing.** §11 asks for it, and the reason the palette
 *   exists is that free choice reliably produces a team nobody can read from the back of the room.
 *   Both of those are true, so the escape hatch is offered *with* the consequence stated. It is the
 *   master's room.
 *
 * One component rather than one per screen: game setup and the mid-game dialog were carrying
 * near-identical copies, which is exactly how the custom option ends up existing in one of them.
 */
export function ColourPicker({
  colour,
  taken,
  onPick,
}: {
  colour: string
  /** The other teams' colours, so this one's own is not reported as taken. */
  taken: string[]
  onPick: (colour: string) => void
}) {
  const t = useTranslations('admin.setup')

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('colour')}
          className="border-border size-9 shrink-0 rounded-full border"
          style={{ backgroundColor: colour }}
        />
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3">
        <ul className="grid grid-cols-4 gap-2">
          {TEAM_PALETTE.map((entry) => (
            <li key={entry.hex}>
              <button
                type="button"
                className="flex w-full flex-col items-center gap-1"
                onClick={() => onPick(entry.hex)}
              >
                <span
                  className="border-border size-8 rounded-full border"
                  style={{ backgroundColor: entry.hex }}
                />
                <span className="text-muted-foreground text-[10px] leading-none">
                  {isColourTaken(entry.hex, taken) ? t('colourTaken') : entry.name}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="border-border space-y-2 border-t pt-3">
          <Label htmlFor="colour-custom" className="text-sm font-normal">
            {t('customColour')}
          </Label>
          <input
            id="colour-custom"
            type="color"
            value={colour}
            className="border-border h-9 w-full cursor-pointer rounded border bg-transparent"
            onChange={(event) => {
              // The native input always yields `#rrggbb`, but normalising keeps this the one place
              // that decides what a stored colour looks like.
              const hex = normaliseHex(event.target.value)
              if (hex) onPick(hex)
            }}
          />
          {/* Stated, not enforced — see the note above. */}
          {isLegibleOnStage(colour) ? null : (
            <p className="text-destructive flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {t('colourTooDark')}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
