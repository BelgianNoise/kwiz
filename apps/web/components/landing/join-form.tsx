'use client'

import { isValidCode, normaliseCode } from '@kwiz/domain'
import { useTranslations } from 'next-intl'
import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRouter } from '@/i18n/navigation'

/**
 * PRD 2 §3's inline code field.
 *
 * **Normalised as conventions §2 says, because it is being typed by someone squinting at a
 * projector**: whitespace and hyphens go, it uppercases, and `O`/`I`/`L` become `0`/`1`/`1`. That
 * mapping is the whole reason the alphabet is Crockford Base32 rather than something invented.
 *
 * Validation happens here only to avoid a pointless navigation. Whether the code belongs to a live
 * game is the server's answer, on the page this leads to (PRD 5).
 */
export function JoinForm() {
  const t = useTranslations('landing.playing')
  const router = useRouter()
  const [code, setCode] = useState('')
  const [invalid, setInvalid] = useState(false)

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!isValidCode(code)) {
      setInvalid(true)
      return
    }
    router.push(`/play/${normaliseCode(code)}`)
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="join-code">{t('codeLabel')}</Label>
        <div className="flex gap-2">
          <Input
            id="join-code"
            value={code}
            onChange={(event) => {
              setCode(event.target.value)
              setInvalid(false)
            }}
            // The same reasoning as an answer input (CLAUDE.md §7): a phone keyboard "helpfully"
            // capitalising or correcting a game code turns a valid one into a wrong one.
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            maxLength={12}
            aria-invalid={invalid}
            aria-describedby={invalid ? 'join-code-error' : undefined}
            className="font-mono text-lg tracking-widest uppercase"
            placeholder="KW1Z0A"
          />
          <Button type="submit" size="lg">
            {t('join')}
          </Button>
        </div>
      </div>
      {invalid ? (
        <p id="join-code-error" role="alert" className="text-destructive text-sm">
          {t('invalid')}
        </p>
      ) : null}
    </form>
  )
}
