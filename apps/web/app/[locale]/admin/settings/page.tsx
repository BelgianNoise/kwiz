import { referencedChecksums } from '@kwiz/db'
import { SCHEMA_VERSION } from '@kwiz/export'

import { SettingsScreen } from '@/components/admin/settings-screen'
import { storageStats } from '@/lib/server/attachments'
import { isAddressStale } from '@/lib/server/network'
import { getRuntime } from '@/lib/server/runtime'
import { readSettings } from '@/lib/server/settings'

/** PRD 2 §16 — *"small and boring on purpose."* */
export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const runtime = await getRuntime()
  const settings = readSettings(runtime.paths.dir)

  return (
    <SettingsScreen
      network={{
        address: settings.networkAddress,
        port: runtime.config.PORT,
        stale:
          settings.networkAddress !== null && isAddressStale(settings.networkAddress),
      }}
      muted={settings.muteSounds}
      storage={await storageStats(runtime.paths, referencedChecksums(runtime.database))}
      about={{
        schemaVersion: SCHEMA_VERSION,
        migration: runtime.migration.kind,
      }}
    />
  )
}
