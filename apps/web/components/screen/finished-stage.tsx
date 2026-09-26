'use client'

import type { MainScreenView } from '@kwiz/domain'
import { useTranslations } from 'next-intl'

import { Provisional } from '@/components/screen/leaderboard-stage'
import { Dot, Standings } from '@/components/screen/parts'
import type { Teams } from '@/components/screen/stage'

type FinishedView = Extract<MainScreenView['stage'], { kind: 'FINISHED' }>

/**
 * PRD 4 §10.2 — `FINISHED`.
 *
 * **The winner gets a dedicated moment before the full standings**: name at maximum scale, in team
 * colour, then the leaderboard settles in beneath. On a tie for first, both names share it — D32 all the
 * way to the end.
 *
 * The final leaderboard then **stays up indefinitely**. People photograph it, and the screen has nothing
 * better to do.
 */
export function FinishedStage({ stage, teams }: { stage: FinishedView; teams: Teams }) {
  // A game out of a finale is ranked by survival, not points (D51), so the winner comes from a
  // different list — and the two lists genuinely disagree, which is the whole reason for two tabs.
  const winners =
    stage.finale === null
      ? stage.standings.filter((standing) => standing.rank === 1).map((s) => s.teamId)
      : stage.finale.filter((row) => row.rank === 1).map((row) => row.teamId)

  return (
    <section className="flex h-full w-full flex-col p-[5cqh] text-neutral-50">
      <Winners teamIds={winners} teams={teams} />

      {stage.finale === null ? (
        <div className="flex min-h-0 flex-1 items-center py-[2cqh]">
          <Standings standings={stage.standings} teams={teams} />
        </div>
      ) : (
        <FinaleResult stage={stage} teams={teams} />
      )}

      <Provisional provisional={stage.provisional} />
    </section>
  )
}

/** §10.2 — *"name at maximum scale, in team colour"*, shared on a tie. */
function Winners({ teamIds, teams }: { teamIds: string[]; teams: Teams }) {
  // Two names at maximum scale do not fit, so a shared first place steps down a size rather than
  // overflowing — §2.3: nothing on this screen scrolls, and nothing is clipped.
  const size = teamIds.length > 1 ? 11 : 16

  return (
    <div className="flex shrink-0 flex-col items-center gap-[1cqh]">
      {teamIds.map((teamId) => {
        const team = teams.get(teamId)
        return (
          <div key={teamId} className="flex items-center gap-[3cqh]">
            <Dot colour={team?.colour ?? '#737373'} size={size * 0.45} />
            <span
              className="main-display leading-none uppercase"
              style={{ fontSize: `${size}cqh` }}
            >
              {team?.name}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * §10.2's two tabs after a `DSMTW_FINALE` (D51).
 *
 * **The tabs are on the projected screen but switched from control**, since this surface has no controls
 * (§2.3). So the inactive one is drawn as a label rather than as something clickable — it is a *state
 * indicator*, and drawing it as a button would be the first piece of chrome on this screen.
 */
function FinaleResult({ stage, teams }: { stage: FinishedView; teams: Teams }) {
  const t = useTranslations('screen.finished')
  const rows = stage.finale ?? []

  return (
    <>
      <div className="flex shrink-0 justify-center gap-[4cqh] pt-[2cqh] text-[4.5cqh]">
        <Tab label={t('tabResult')} active={stage.tab === 'RESULT'} />
        <Tab label={t('tabPoints')} active={stage.tab === 'POINTS'} />
      </div>

      <div className="flex min-h-0 flex-1 items-center py-[2cqh]">
        {stage.tab === 'POINTS' ? (
          /*
           * §10.2 — *"`POINTS` shows the pre-finale totals — the leaderboard as it stood when points
           * were converted. Often the team that scored highest is **not** the one that won, which is
           * worth letting the room see."* No movement arrows: this standing is final and nothing has
           * moved since.
           */
          <Standings standings={stage.standings} teams={teams} movement={false} />
        ) : (
          <ol className="w-full text-[5.5cqh]">
            {rows.map((row, index) => {
              const team = teams.get(row.teamId)
              // §10.2 — *"non-finalists sit below the finalists"*, so the rule goes where the list
              // stops being about the finale.
              const firstNonFinalist =
                !row.finalist && (rows[index - 1]?.finalist ?? false)

              return (
                <li
                  key={row.teamId}
                  className={`flex items-center gap-[2cqh] py-[0.5cqh] ${
                    firstNonFinalist
                      ? 'mt-[1.5cqh] border-t-[0.3cqh] border-neutral-800 pt-[2cqh]'
                      : ''
                  }`}
                >
                  <span className="w-[5cqh] shrink-0 text-right text-neutral-400 tabular-nums">
                    {row.rank}
                  </span>
                  <Dot colour={team?.colour ?? '#737373'} size={3} />
                  <span className="min-w-0 flex-1 truncate">{team?.name}</span>
                  <Outcome row={row} />
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </>
  )
}

function Tab({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={
        active
          ? 'border-b-[0.5cqh] border-neutral-100 pb-[0.5cqh] font-semibold tracking-widest uppercase'
          : 'pb-[0.5cqh] tracking-widest text-neutral-600 uppercase'
      }
    >
      {label}
    </span>
  )
}

/**
 * The right-hand column of §10.2's `RESULT` tab: what happened to this team.
 *
 * Three different statements, and they must read as three different things — *"labelled so nobody reads
 * their position as an elimination"*:
 *
 * - a survivor, with the seconds they had left, because *"won with 41 seconds left is the story"*
 * - an eliminated finalist, with the wall-clock instant they went out (conventions §8.2's `HH:mm`)
 * - a non-finalist, who did not play it at all
 */
function Outcome({ row }: { row: NonNullable<FinishedView['finale']>[number] }) {
  const t = useTranslations('screen.finished')

  if (!row.finalist) {
    return <span className="shrink-0 text-neutral-500">{t('didNotPlay')}</span>
  }

  if (row.eliminatedAt === null) {
    return (
      <span className="shrink-0 font-semibold text-emerald-400">
        {row.secondsLeft === null
          ? t('survived')
          : t('survivedWith', { seconds: Math.max(0, Math.round(row.secondsLeft)) })}
      </span>
    )
  }

  return (
    <span className="shrink-0 text-neutral-400 tabular-nums">
      {t('outAt', { at: wallClock(row.eliminatedAt) })}
    </span>
  )
}

/**
 * `HH:mm` — conventions §8.2's format for an elimination instant, and the third of the three duration
 * formats this surface uses. It is a *time of night*, not a duration: `21:14` is what someone
 * reconstructing the round's story reads, which is why it is not the finale's whole seconds.
 */
function wallClock(at: number): string {
  const when = new Date(at)
  return `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`
}
