'use client'

import type { TeamPublic } from '@kwiz/domain'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { Dot, HollowDot, JoinCode } from '@/components/screen/parts'

/**
 * PRD 4 §4 — `WAITING_FOR_PLAYERS`.
 *
 * On screen while the room fills, and it does real work: **getting twenty people onto the right URL.**
 * This is the first impression and also the only stage whose failure is silent — nobody joins, and the
 * master finds out when they try to start.
 */
export function WaitingStage({
  quizName,
  code,
  joinUrl,
  teams,
  joinedTeamIds,
  sound,
}: {
  quizName: string
  code: string
  joinUrl: string
  teams: TeamPublic[]
  joinedTeamIds: string[]
  sound: boolean
}) {
  const t = useTranslations('screen.waiting')
  const joined = new Set(joinedTeamIds)

  return (
    <section className="flex h-full w-full flex-col bg-neutral-950 text-neutral-50">
      <div className="flex min-h-0 flex-1 flex-col p-[5cqh]">
        <h1 className="text-center text-[10cqh] font-semibold">{quizName}</h1>

        {/*
          §4 — **the QR and the typed URL are equal partners.** Camera scanning fails often enough
          (old phones, cracked screens, bad light) that a text fallback is not optional, so neither is
          subordinate to the other in the layout.
        */}
        <div className="flex min-h-0 flex-1 items-center justify-center gap-[8cqh]">
          <Qr text={joinUrl} />

          <div className="flex flex-col gap-[2cqh]">
            <p className="text-[5cqh] text-neutral-400">{t('scanOrGoTo')}</p>
            {/* The address, at body scale: it is typed, not read at a glance. */}
            <p className="text-[6cqh] font-medium break-all">{displayUrl(joinUrl)}</p>
            <p className="pt-[2cqh] text-[5cqh] text-neutral-400">{t('andEnter')}</p>
            {/* §4 — the code is the largest element after the title. */}
            <JoinCode code={code} size={13} />
          </div>
        </div>

        <TeamList teams={teams} joined={joined} />
      </div>

      <SoundConfirmation ok={sound} />
    </section>
  )
}

/**
 * §4 — *"teams appear as they join, filled dot for joined, hollow for not. This is social pressure
 * that works: a table sees its name still hollow and does something about it."*
 *
 * **No count of how many are missing**, deliberately. The room can see. A number invites announcing
 * it, which pressures a table that is merely slow — and the master has the real figure on control.
 */
function TeamList({ teams, joined }: { teams: TeamPublic[]; joined: Set<string> }) {
  /*
   * §4's ladder, exactly as written: *"beyond ~12 teams it becomes a two-column grid, then names only
   * without dots."* Two rungs, not three — this had a `>12 → three columns` tier of its own invention
   * until the slice-6 review, which is reasonable at the 20-team envelope and simply is not the spec.
   */
  const columns = teams.length > 12 ? 2 : 1
  const dots = teams.length <= 18

  return (
    <ul
      className="grid shrink-0 justify-items-center gap-x-[4cqh] gap-y-[1cqh] text-[5cqh]"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {teams.map((team) => {
        const here = joined.has(team.id)
        return (
          <li
            key={team.id}
            className={`flex min-w-0 items-center gap-[1.5cqh] ${here ? '' : 'text-neutral-500'}`}
          >
            {dots ? (
              here ? (
                <Dot colour={team.colour} size={2.5} />
              ) : (
                <HollowDot colour={team.colour} size={2.5} />
              )
            ) : null}
            <span className="truncate">{team.name}</span>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * §4.1's verification. *"A master who is going to discover a muted projector should discover it while
 * the room is still filling, not during the music round."*
 *
 * The failure case is **the one place on this surface where a technical message is acceptable** (§4.1),
 * and the reason is stated there: the audience is still arriving, and the master needs it. Kept small
 * and low even so.
 */
function SoundConfirmation({ ok }: { ok: boolean }) {
  const t = useTranslations('screen.waiting')

  return (
    <p
      className={`px-[5cqh] pb-[3cqh] text-[4cqh] ${ok ? 'text-neutral-500' : 'text-orange-400'}`}
    >
      {ok ? `♪ ${t('soundReady')}` : t('soundFailed')}
    </p>
  )
}

/**
 * The address as a person has to type it — no scheme, no trailing slash.
 *
 * `kwiz.local:3000` is what §4's mock shows and what someone squinting at a projection can actually
 * transcribe; `http://kwiz.local:3000/` adds seven characters of noise and one of them is a slash
 * people forget.
 */
function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

/**
 * The QR as inline SVG, generated in the browser from the pushed `joinUrl`.
 *
 * Client-side rather than server-rendered because the code is **regenerable while `SETUP`** (data
 * model Q3) — which is exactly the status this stage is shown in. A QR baked in at page render would
 * keep pointing at the old code until someone reloaded the projector, and nobody reloads a projector.
 *
 * `qrcode` is already a dependency (slice 4, for PRD 2 §4's launch links); this is its browser entry.
 */
function Qr({ text }: { text: string }) {
  const [svg, setSvg] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void import('qrcode').then(async ({ toString: toSvg }) => {
      const markup = await toSvg(text, {
        type: 'svg',
        margin: 1,
        errorCorrectionLevel: 'M',
        // White modules on a dark stage would invert the code and stop scanning, so the quiet zone is
        // drawn light and the whole block sits on its own white plate below.
        color: { dark: '#0a0a0a', light: '#ffffff' },
      })
      if (live) setSvg(markup)
    })
    return () => {
      live = false
    }
  }, [text])

  return (
    <div className="size-[45cqh] shrink-0 rounded-[2cqh] bg-white p-[2cqh]">
      {svg === null ? null : (
        /*
          The SVG is generated here from a URL this server produced — not remote content — and there is
          no other way to inline a `qrcode` string. `[&>svg]` sizes it, since the library emits a fixed
          `width`/`height` pair.
        */
        <div
          className="size-full [&>svg]:size-full"
          // oxlint-disable-next-line no-danger
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </div>
  )
}
