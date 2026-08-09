'use client'

import type { MasterControlView } from '@kwiz/domain'
import { Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { AddTeamDialog } from '@/components/admin/add-team-dialog'
import { Button } from '@/components/ui/button'

/**
 * PRD 3 §4's `[+ Add team]`, and PRD 2 §11.2's requirement that it exist on **master control** at
 * **every status** — not only on the config surface.
 *
 * It reuses PRD 2's dialog rather than growing a second one: a table walking in mid-round is the
 * same event whichever screen the master happens to be looking at, and the numbers it shows
 * (`missedSoFar`) are the entire reason that dialog is justified at all. Two dialogs would drift,
 * and the one that drifted would be the one used in a noisy room.
 *
 * Two entry points, one component: the pre-game team list (§4), where the master is while people
 * arrive, and the right rail, which is where teams live once the game is running.
 */
export function AddTeamButton({
  gameId,
  view,
  size = 'default',
}: {
  gameId: string
  view: MasterControlView
  size?: 'default' | 'sm'
}) {
  const common = useTranslations('common')
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button size={size} variant="outline" onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        {common('add')}
      </Button>

      <AddTeamDialog
        gameId={gameId}
        open={open}
        teamCount={view.teams.length}
        takenColours={view.teams.map((team) => team.colour)}
        // Computed server-side and carried on the view. `null` in `SETUP`, where nothing has been
        // missed and the dialog drops that section entirely.
        missed={view.missed}
        round={view.round ? { number: view.round.number, total: view.round.total } : null}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
