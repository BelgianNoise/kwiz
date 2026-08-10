'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { ConfirmDialog } from '@/components/admin/confirm-dialog'
import { advanceAction } from '@/components/control/advance'
import { usePrimaryAction, type ZoneProps } from '@/components/control/control-desk'
import { Button } from '@/components/ui/button'

/**
 * §3.1 priority 7 — *"nothing is wrong; the master decides the pace"*, as one button.
 *
 * The suggestion is the server's (protocol §5.4) and this only renders it, so the desk cannot form a
 * second opinion about what comes next. It is used from **every** zone that needs a way forward, not
 * only from `attention: ADVANCE`: the round-end sweep outranks `ADVANCE` and still has to be
 * escapable (§6.2).
 *
 * Two rules from PRD 3 are enforced here and nowhere else:
 *
 * - **`Enter` is bound to the suggested action — except when it ends the game.** §13 lists ending
 *   the game among the acts a stray keystroke must never reach, and the moment the suggestion
 *   becomes `FINISH` is the moment the master's advance reflex is strongest.
 * - **Ending the game asks first** (§1.1). It is one of exactly two acts on this surface that earn
 *   a dialog, because it is one of exactly two that cannot be undone.
 */
export function AdvanceButton({ view, api, run }: Omit<ZoneProps, 'gameId'>) {
  const t = useTranslations('control.question')
  const tf = useTranslations('control.frame')
  const [confirming, setConfirming] = useState(false)

  const action = advanceAction(view, api, run)

  // Deliberately `null` for the irreversible one: see the note above, and §13.
  usePrimaryAction(action && !action.irreversible ? action.call : null)

  if (!action) return null

  return (
    <>
      <Button
        size="lg"
        variant={action.irreversible ? 'outline' : 'default'}
        onClick={() => (action.irreversible ? setConfirming(true) : action.call())}
      >
        {t(action.label)}
      </Button>

      <ConfirmDialog
        open={confirming}
        title={tf('finishTitle')}
        body={tf('finishBody')}
        confirmLabel={tf('finish')}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          action.call()
          setConfirming(false)
        }}
      />
    </>
  )
}
