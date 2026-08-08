import { AlertTriangle } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Button } from '@/components/ui/button'
import { Link } from '@/i18n/navigation'

/**
 * PRD 2 §4's last bullet — *"if the address later becomes invalid (different wifi network, new DHCP
 * lease), the dashboard shows a warning banner with a re-pick action."*
 *
 * The saved address is shown rather than hidden behind "your network changed", because a master who
 * recognises `192.168.1.42` as last week's pub knows immediately what happened.
 *
 * A server component: it renders from a value the page already computed and has nothing to interact
 * with beyond a link, so shipping it to the client would buy nothing.
 */
export async function NetworkBanner({ address }: { address: string }) {
  const t = await getTranslations('admin.settings')

  return (
    <section className="border-destructive/40 flex flex-wrap items-center gap-3 rounded-xl border p-4">
      <AlertTriangle className="text-destructive size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{t('addressStale')}</p>
        <p className="text-muted-foreground font-mono text-sm">{address}</p>
      </div>
      <Button asChild variant="secondary" size="sm">
        <Link href="/admin/setup">{t('changeAddress')}</Link>
      </Button>
    </section>
  )
}
