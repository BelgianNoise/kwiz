'use client'

import { Check, ChevronRight, Wifi, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useRouter } from '@/i18n/navigation'
import { api } from '@/lib/client/api'
import type { NetworkAddress } from '@/lib/server/network'

export interface AddressOption extends NetworkAddress {
  /** Pre-rendered server-side, so selecting a radio shows a scannable code with no round trip. */
  qr: string
}

/**
 * PRD 2 §4 — *"which address should players use?"*
 *
 * This screen exists because guessing is worse than asking (D10): a laptop has wifi, ethernet, a VPN
 * and two container bridges, and the wrong pick produces a QR code that resolves to nothing with no
 * error anywhere. The verdicts beside each address are inference; the probe is proof, and the layout
 * pushes toward the probe rather than treating the list as the answer.
 */
export function NetworkPicker({
  addresses,
  port,
  selected,
}: {
  addresses: AddressOption[]
  port: number
  selected: string | null
}) {
  const t = useTranslations('setup')
  const router = useRouter()

  // Defaults to the first `LIKELY` candidate, which on an ordinary laptop is the right answer — the
  // screen still asks, but it does not make the master hunt for it.
  const [address, setAddress] = useState(
    selected ?? addresses.find((entry) => entry.reachability === 'LIKELY')?.address ?? '',
  )
  const [testing, setTesting] = useState(false)
  const [reached, setReached] = useState(false)
  const [saving, setSaving] = useState(false)

  const chosen = addresses.find((entry) => entry.address === address)

  /**
   * Polls while the test is open. A phone takes as long as it takes to unlock, find the camera and
   * focus, so this keeps going until it is switched off rather than timing out on a guess.
   */
  useEffect(() => {
    if (!testing || !address) return undefined

    const tick = async (): Promise<void> => {
      const result = await api.probeStatus(address)
      if (result.ok && result.data?.reached) {
        setReached(true)
        setTesting(false)
      }
    }

    const timer = setInterval(() => void tick(), 1000)
    return () => clearInterval(timer)
  }, [testing, address])

  const save = async (): Promise<void> => {
    setSaving(true)
    const result = await api.chooseAddress(address)
    setSaving(false)
    if (result.ok) router.push('/admin')
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 p-6 sm:p-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t('heading')}</h1>
        <p className="text-muted-foreground text-sm">{t('body')}</p>
      </header>

      {addresses.length === 0 ? (
        <p className="text-destructive text-sm">{t('noAddresses')}</p>
      ) : (
        <RadioGroup
          value={address}
          onValueChange={(next) => {
            setAddress(next)
            // A verdict belongs to the address it was obtained for. Carrying it across would let a
            // confirmed wifi address vouch for the Docker bridge picked after it.
            setReached(false)
            setTesting(false)
          }}
          className="gap-1"
        >
          {addresses.map((entry) => (
            <div
              key={`${entry.name}-${entry.address}`}
              className="hover:bg-muted/50 flex items-center gap-3 rounded-lg px-2 py-2"
            >
              <RadioGroupItem value={entry.address} id={`address-${entry.address}`} />
              <Label
                htmlFor={`address-${entry.address}`}
                className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 font-normal"
              >
                <span className="font-mono tabular-nums">{entry.address}</span>
                <span className="text-muted-foreground text-sm">{entry.name}</span>
                <span
                  className={
                    entry.reachability === 'LIKELY'
                      ? 'text-primary ml-auto flex items-center gap-1 text-sm'
                      : entry.reachability === 'UNKNOWN'
                        ? 'text-muted-foreground ml-auto flex items-center gap-1 text-sm'
                        : 'text-destructive ml-auto flex items-center gap-1 text-sm'
                  }
                >
                  {entry.reachability === 'LIKELY' ? (
                    <Check className="size-4" />
                  ) : entry.reachability === 'UNUSABLE' ? (
                    <X className="size-4" />
                  ) : null}
                  {t(`reason.${entry.reason}`)}
                </span>
              </Label>
            </div>
          ))}
        </RadioGroup>
      )}

      {chosen ? (
        <section className="border-border space-y-4 rounded-xl border p-4">
          <p className="font-mono text-sm">
            http://{chosen.address}:{port}
          </p>

          {/* §4's highest-value control: it turns the riskiest assumption into a verified fact. */}
          {reached ? (
            <p className="text-primary flex items-center gap-2 text-sm">
              <Check className="size-4" />
              {t('probe.confirmed')}
            </p>
          ) : testing ? (
            <div className="flex flex-col items-center gap-3">
              <p className="text-muted-foreground text-sm">{t('probe.waiting')}</p>
              {/*
                The QR code is trusted markup: it is `qrcode`'s own SVG output for a string this
                server built, never anything a user supplied.
              */}
              <div
                className="[&_svg]:size-48 [&_svg]:rounded-lg [&_svg]:bg-white [&_svg]:p-2"
                // oxlint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: chosen.qr }}
              />
              <Button variant="ghost" size="sm" onClick={() => setTesting(false)}>
                {t('probe.cancel')}
              </Button>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => setTesting(true)}>
              <Wifi className="size-4" />
              {t('probe.start')}
            </Button>
          )}
        </section>
      ) : null}

      <footer className="flex justify-end">
        <Button
          disabled={saving || address === ''}
          onClick={() => {
            void save()
          }}
        >
          {t('continue')}
          <ChevronRight className="size-4" />
        </Button>
      </footer>
    </main>
  )
}
