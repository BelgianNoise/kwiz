import { NetworkPicker } from '@/components/admin/network-picker'
import { listAddresses } from '@/lib/server/network'
import { qrSvg } from '@/lib/server/qr'
import { getRuntime } from '@/lib/server/runtime'
import { readSettings } from '@/lib/server/settings'

/**
 * PRD 2 §4 / D10 — first-run network setup, and the same screen §16 links back to.
 *
 * The QR codes are built here, one per candidate address, because the alternative is a client that
 * cannot render one until a round trip completes. There are rarely more than eight addresses and a QR
 * code is microseconds; pre-rendering them all makes selecting a radio instant.
 */
export const dynamic = 'force-dynamic'

export default async function SetupPage() {
  const runtime = await getRuntime()
  const settings = readSettings(runtime.paths.dir)
  const addresses = listAddresses()

  const withQr = await Promise.all(
    addresses.map(async (entry) => ({
      ...entry,
      // Pointed at the probe, not at the landing page: this QR code exists to prove reachability, and
      // the address travels in the query string so the server knows which candidate was confirmed.
      qr: await qrSvg(
        `http://${entry.address}:${runtime.config.PORT}/probe?address=${entry.address}`,
      ),
    })),
  )

  return (
    <NetworkPicker
      addresses={withQr}
      port={runtime.config.PORT}
      selected={settings.networkAddress}
    />
  )
}
