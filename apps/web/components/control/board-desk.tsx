'use client'

import { ChevronDown } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { ZoneProps } from '@/components/control/control-desk'
import { digitIndex, useControlKeys } from '@/components/control/keys'
import { TeamDot } from '@/components/control/team-dot'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

/**
 * PRD 3 §9 — the Jeopardy board.
 *
 * **The master picks the tile** (D16), so the board here is an input device rather than a display.
 * Tile prompts are readable on hover and focus, master-only: the master needs to know what is behind
 * a tile when a team asks *"what's left in Music?"*, and to sanity-check before committing.
 *
 * Opening a tile runs §7's buzzer flow, since every tile is a buzzer question (D34).
 */
export function BoardDesk({
  view,
  api,
  run,
  tiedTeamIds,
}: ZoneProps & { tiedTeamIds: string[] }) {
  const t = useTranslations('control.jeopardy')
  const board = view.board
  const tied = view.teams.filter((team) => tiedTeamIds.includes(team.id))

  // §13 — `1`–`9` picks a team, which here is the tie-break and the override.
  useControlKeys((event) => {
    const index = digitIndex(event)
    const team = index === null ? undefined : tied[index]
    if (!team) return false
    run(() => api.assignPicker(team.id, 'TIE_BREAK'))
    return true
  })

  if (!board) return null

  const picker = view.teams.find((team) => team.id === board.currentPickerTeamId)

  return (
    <section className="mx-auto max-w-5xl space-y-5">
      {/* D30 — the lowest-score rule ties, and the board is stalled until the master says who. */}
      {tied.length > 1 ? (
        <div className="space-y-2">
          <h1 className="text-xl font-medium">{t('tieTitle')}</h1>
          <div className="flex flex-wrap gap-2">
            {tied.map((team, index) => (
              <Button
                key={team.id}
                variant="outline"
                onClick={() => run(() => api.assignPicker(team.id, 'TIE_BREAK'))}
              >
                <span className="text-muted-foreground text-xs tabular-nums">
                  {index + 1}
                </span>
                <TeamDot colour={team.colour} />
                {team.name}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <h1 className="flex items-center gap-2 text-xl font-medium">
            {picker ? (
              <>
                <TeamDot colour={picker.colour} className="size-4" />
                {t('picks', { team: picker.name })}
              </>
            ) : (
              t('nobodyPicks')
            )}
          </h1>

          {/* Override is one click away, not buried: house rules vary, and the rule will
              sometimes be wrong (D30). */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                {t('change')}
                <ChevronDown aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {view.teams.map((team) => (
                <DropdownMenuItem
                  key={team.id}
                  onSelect={() => run(() => api.assignPicker(team.id, 'MASTER_OVERRIDE'))}
                >
                  <TeamDot colour={team.colour} />
                  {team.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <div
        className="grid gap-2"
        style={{
          gridTemplateColumns: `repeat(${board.categories.length}, minmax(0, 1fr))`,
        }}
      >
        {board.categories.map((category) => (
          <h2
            key={category.id}
            className="truncate border-b pb-1 text-center font-medium"
          >
            {category.name}
          </h2>
        ))}

        {board.categories.map((category) => (
          <ul key={category.id} className="space-y-2">
            {board.tiles
              .filter((tile) => tile.categoryId === category.id)
              .map((tile) => (
                <li key={tile.id}>
                  <button
                    type="button"
                    disabled={tile.used || view.status !== 'LIVE'}
                    title={tile.prompt}
                    onClick={() => run(() => api.openQuestion(tile.id))}
                    className={cn(
                      'w-full rounded-md border px-2 py-3 text-center tabular-nums',
                      tile.used
                        ? 'text-muted-foreground border-dashed'
                        : 'hover:bg-accent text-lg',
                    )}
                  >
                    {tile.used ? t('played') : tile.points}
                  </button>
                </li>
              ))}
          </ul>
        ))}
      </div>

      <p className="text-muted-foreground text-sm">{t('hint')}</p>
    </section>
  )
}
