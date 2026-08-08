import { referencedChecksums } from '@kwiz/db'
import { fail, ok, type ActionResult } from '@kwiz/domain'
import { z } from 'zod'

import { reclaimSpace } from './attachments'
import { listAddresses } from './network'
import type { Runtime } from './runtime'
import { updateSettings } from './settings'

/**
 * PRD 2 §4 and §16's mutations — the third and last route table (protocol §7.1, PRD 1 §6.9).
 *
 * Three actions, kept apart from `runAuthoring` because they change **this machine**, not any quiz:
 * two of them do not touch the database at all, and the third deletes files rather than rows. Folding
 * them into the authoring table would put "delete files from disk" next to "rename a round".
 */
export interface SettingsInput {
  runtime: Runtime
  segments: string[]
  body: unknown
}

const chooseAddressSchema = z.object({ address: z.string().min(1) })
const muteSchema = z.object({ muted: z.boolean() })

export function runSettings(input: SettingsInput): Promise<ActionResult<unknown>> {
  const path = input.segments.join('/')

  switch (path) {
    case 'network/choose':
      return Promise.resolve(chooseAddress(input))
    case 'sound/mute':
      return Promise.resolve(setMute(input))
    case 'storage/reclaim':
      return reclaim(input)
    default:
      return Promise.resolve(fail('VALIDATION_ERROR', `no settings action at ${path}`))
  }
}

/**
 * §4 — the chosen address must be one the machine actually has.
 *
 * Validated against the live interface list rather than a format check, because the failure this
 * guards is not a typo: it is a *stale* choice, saved on one wifi network and replayed on another. A
 * plausible-looking address that no adapter carries produces exactly the dead QR code §4 exists to
 * prevent, so it is refused here rather than saved and warned about later.
 *
 * An `UNUSABLE` address is still allowed through — §4 marks it, it does not forbid it, and a master
 * testing the flow on `127.0.0.1` from the laptop's own browser is a legitimate thing to do.
 */
function chooseAddress(input: SettingsInput): ActionResult<{ address: string }> {
  const parsed = chooseAddressSchema.safeParse(input.body)
  if (!parsed.success) return fail('VALIDATION_ERROR', 'an address is required')

  const known = listAddresses().some((entry) => entry.address === parsed.data.address)
  if (!known) {
    return fail(
      'VALIDATION_ERROR',
      'that address is not on any interface of this machine',
    )
  }

  updateSettings(input.runtime.paths.dir, { networkAddress: parsed.data.address })
  return ok({ address: parsed.data.address })
}

function setMute(input: SettingsInput): ActionResult<{ muted: boolean }> {
  const parsed = muteSchema.safeParse(input.body)
  if (!parsed.success) return fail('VALIDATION_ERROR', 'muted must be a boolean')

  const next = updateSettings(input.runtime.paths.dir, { muteSounds: parsed.data.muted })
  return ok({ muted: next.muteSounds })
}

/**
 * §16's `Reclaim space`, over data model §8's rule: a file survives if **either** table still
 * references its checksum.
 *
 * The referenced set is read immediately before the sweep and inside no transaction, which is safe in
 * the one direction that matters — a row inserted while the sweep runs points at a file that was
 * already on disk and already referenced, so it cannot be the file being deleted. The reverse race,
 * a row deleted mid-sweep, just leaves its file for the next pass.
 */
async function reclaim(
  input: SettingsInput,
): Promise<ActionResult<{ removed: number; bytes: number }>> {
  const referenced = referencedChecksums(input.runtime.database)
  return ok(await reclaimSpace(input.runtime.paths, referenced))
}
