import { useTranslations } from 'next-intl'

import { JoinForm } from '@/components/landing/join-form'
import { LanguageSwitcher } from '@/components/language-switcher'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { Link } from '@/i18n/navigation'

/**
 * PRD 2 §3 — the landing page, and the only page a guest and a master both see.
 *
 * It has one job: get each of them into the right place with no reading.
 *
 * **The player side is larger and first**, in DOM order as well as visually. On any given night one
 * person hosts and twenty play, and the layout should reflect that ratio. The code field is inline
 * so a player never needs a second tap to start typing.
 *
 * Deliberately absent: any list of recent games or quizzes. This is a public screen in a room full
 * of strangers, and it shows nothing about what is on this machine.
 */
export default function LandingPage() {
  const t = useTranslations('landing')

  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-10 p-6 sm:p-10">
      <header className="flex items-center justify-between">
        <span className="text-2xl font-semibold tracking-tight">Kwiz</span>
        <div className="flex items-center gap-3">
          {/* Prominent here, per PRD 1 §9.4: this is where a player picks their language. */}
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>

      <div className="grid flex-1 content-center gap-6 sm:grid-cols-5">
        <section className="bg-card text-card-foreground border-border flex flex-col justify-center gap-5 rounded-xl border p-8 sm:col-span-3">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight">
              {t('playing.title')}
            </h1>
            <p className="text-muted-foreground">{t('playing.detail')}</p>
          </div>
          <JoinForm />
        </section>

        <section className="bg-muted/30 border-border flex flex-col justify-center gap-4 rounded-xl border p-8 sm:col-span-2">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold tracking-tight">{t('hosting.title')}</h2>
            <p className="text-muted-foreground text-sm">{t('hosting.detail')}</p>
          </div>
          <Button asChild variant="secondary" className="self-start">
            <Link href="/admin">{t('hosting.open')}</Link>
          </Button>
        </section>
      </div>
    </main>
  )
}
