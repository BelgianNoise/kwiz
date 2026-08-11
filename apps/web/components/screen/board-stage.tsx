'use client'

import type { MainScreenView } from '@kwiz/domain'
import { useTranslations } from 'next-intl'

import { Dot } from '@/components/screen/parts'
import type { Teams } from '@/components/screen/stage'

type BoardStageView = Extract<MainScreenView['stage'], { kind: 'JEOPARDY_BOARD' }>

/**
 * PRD 4 §9 — `JEOPARDY_BOARD`, shown between tiles.
 *
 * **Tile prompts never appear on this screen** until a tile is opened, and that is not enforced here:
 * the payload simply does not carry them (PRD 1 §7 invariant 5, protocol §5.2's `BoardView`). There is
 * nothing to leak because there is nothing to render.
 */
export function BoardStage({ stage, teams }: { stage: BoardStageView; teams: Teams }) {
  const t = useTranslations('screen.board')
  const { categories, tiles } = stage.board

  /*
   * The value ladder, derived from the tiles themselves rather than read from the round's config.
   *
   * Uneven columns are legal (data model §4.3) — a category may skip a value — so a row is "every
   * distinct value on the board", ascending, and a category with no tile at that value renders short.
   * §9: *"uneven columns render as short columns. No filler."*
   */
  const values = [...new Set(tiles.map((tile) => tile.points))].sort((a, b) => a - b)
  const picker = stage.currentPickerTeamId
    ? teams.get(stage.currentPickerTeamId)
    : undefined

  return (
    <section className="flex h-full w-full flex-col bg-neutral-950 p-[5cqh] text-neutral-50">
      {/*
        §9 — **the current picker is stated at the top in their colour** (D30). It is the only
        instruction the room needs, and it prevents the "whose turn is it?" pause. Colour is paired with
        the name, always (PRD 1 §9.5).
      */}
      <p className="flex shrink-0 items-center gap-[2cqh] text-[6cqh] font-semibold">
        {picker ? (
          <>
            <Dot colour={picker.colour} size={4} />
            {t('picks', { team: picker.name })}
          </>
        ) : (
          // No picker assigned yet — the master is about to break a tie (PRD 3 §9). The room is told
          // nothing rather than told a wrong name.
          <span className="text-neutral-500">{t('choosing')}</span>
        )}
      </p>

      <div
        className="grid min-h-0 flex-1 gap-[1.5cqh] pt-[3cqh]"
        style={{ gridTemplateColumns: `repeat(${categories.length}, minmax(0, 1fr))` }}
      >
        {categories.map((category) => (
          <div key={category.id} className="flex min-w-0 flex-col gap-[1.5cqh]">
            {/*
              §9 — *"category names are smaller and set in caps"*, and **must fit without truncation**:
              at 5 categories each column is ~18% of width, which is why PRD 2 §10's pre-flight warns on
              names too long for here. Wrapping rather than truncating, because a clipped category name
              is a question the room cannot answer.
            */}
            <p className="h-[9cqh] text-center text-[3.6cqh] leading-tight font-semibold tracking-wider break-words text-neutral-400 uppercase">
              {category.name}
            </p>

            {values.map((value) => {
              const tile = tiles.find(
                (candidate) =>
                  candidate.categoryId === category.id && candidate.points === value,
              )
              return (
                <div
                  key={`${category.id}-${value}`}
                  className="flex min-h-0 flex-1 items-center justify-center rounded-[1cqh] bg-neutral-900"
                >
                  {tile === undefined ? null : tile.used ? (
                    /*
                     * §9 — **used tiles become `—`, not blank.** A blank cell reads as a rendering fault
                     * from 10 m; a dash reads as spent. A category that never had this value renders
                     * genuinely empty above, which is a different thing and looks like one.
                     */
                    <span className="text-[7cqh] text-neutral-700">—</span>
                  ) : (
                    // §9 — values are the largest element, since that is what teams call out
                    // ("Music for 300").
                    <span className="text-[9cqh] font-semibold tabular-nums">
                      {value}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </section>
  )
}
