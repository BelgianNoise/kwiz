'use client'

import {
  isQuestionReady,
  jeopardyRoundConfigSchema,
  type QuestionContent,
  type QuizContent,
  type RoundContent,
} from '@kwiz/domain'
import { AlertTriangle, Check, ChevronLeft, MoreHorizontal, Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { ConfirmDialog } from '@/components/admin/confirm-dialog'
import { QuestionSheet } from '@/components/admin/question-sheet'
import { RoundDefaults } from '@/components/admin/round-defaults'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Link, useRouter } from '@/i18n/navigation'
import { api } from '@/lib/client/api'

/**
 * PRD 2 §8 — the board is authored **as a board**.
 *
 * A list of questions with category and value fields would let a master build something that looks
 * wrong on the projector without ever noticing. So: a grid, empty cells as `+` buttons, and the
 * value ladder governing the values.
 *
 * **The ladder governs and tiles cannot deviate** (O3). Editing it re-values the whole row, which is
 * what a master means when they change it — a column that does not read 100/200/300 looks broken to a
 * room that knows the game. The schema permits per-tile values, so this can be opened up later
 * without a migration.
 */
export function BoardBuilder({
  quiz,
  round,
}: {
  quiz: QuizContent
  round: RoundContent
}) {
  const t = useTranslations('admin.board')
  const common = useTranslations('common')
  const router = useRouter()

  const parsed = jeopardyRoundConfigSchema.safeParse(round.config)
  const ladder = parsed.success ? parsed.data.valueLadder : [100, 200, 300, 400, 500]

  const [openTile, setOpenTile] = useState<QuestionContent | undefined>()
  const [addingCategory, setAddingCategory] = useState(false)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | undefined>()
  const [deletingCategory, setDeletingCategory] = useState<
    { id: string; name: string; tiles: number } | undefined
  >()
  const [name, setName] = useState('')

  const refresh = (): void => router.refresh()

  const tilesIn = (categoryId: string): QuestionContent[] =>
    round.questions.filter((question) => question.categoryId === categoryId)

  const addTile = async (categoryId: string, row: number): Promise<void> => {
    const result = await api.createQuestion(round.id, {
      categoryId,
      // From the ladder, never typed (O3). A tile below the last rung keeps that rung.
      points: ladder[Math.min(row, ladder.length - 1)] ?? 0,
    })
    if (result.ok) refresh()
  }

  const tallest = Math.max(
    0,
    ...round.categories.map((category) => tilesIn(category.id).length),
  )
  const emptyTiles = round.categories.reduce(
    (total, category) => total + Math.max(0, tallest - tilesIn(category.id).length),
    0,
  )
  const incomplete = round.questions.filter(
    (question) => !isQuestionReady(question, round),
  )

  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-8 p-6 sm:p-10">
      <header className="flex items-center justify-between gap-4">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/admin/quizzes/${quiz.id}`}>
            <ChevronLeft className="size-4" />
            {common('back')}
          </Link>
        </Button>
      </header>

      <RoundDefaults round={round} onChanged={refresh} />

      <ValueLadder roundId={round.id} ladder={ladder} onChanged={refresh} />

      {round.categories.length === 0 ? (
        <div className="border-border text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
          {t('emptyBoard')}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div
            className="grid min-w-fit gap-2"
            style={{
              gridTemplateColumns: `repeat(${round.categories.length}, minmax(9rem, 1fr))`,
            }}
          >
            {round.categories.map((category) => (
              <div key={category.id} className="flex items-center justify-between gap-1">
                <span className="truncate text-sm font-semibold uppercase">
                  {category.name}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={category.name}>
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() =>
                        setRenaming({ id: category.id, name: category.name })
                      }
                    >
                      {t('renameCategory')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() =>
                        setDeletingCategory({
                          id: category.id,
                          name: category.name,
                          tiles: tilesIn(category.id).length,
                        })
                      }
                    >
                      {common('delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}

            {/*
              One row per ladder rung, so the grid a master fills in is the grid the room sees.

              The row index **is** the identity here — rung 0 is rung 0, and rungs are only appended,
              never spliced out of the middle — so an index key is the correct one rather than a
              convenient one.
            */}
            {ladder.map((value, row) => (
              <FragmentRow
                // oxlint-disable-next-line react/no-array-index-key
                key={row}
                categories={round.categories}
                row={row}
                value={value}
                tilesIn={tilesIn}
                round={round}
                onOpen={setOpenTile}
                onAdd={(categoryId) => {
                  void addTile(categoryId, row)
                }}
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <p className="text-muted-foreground text-sm">
          {t('everyTileBuzzer')}
          {emptyTiles > 0 || incomplete.length > 0 ? (
            <span className="text-destructive ml-2">
              {emptyTiles > 0 ? t('emptyTiles', { count: emptyTiles }) : ''}
              {emptyTiles > 0 && incomplete.length > 0 ? ' · ' : ''}
              {incomplete.length > 0
                ? t('incompleteTiles', { count: incomplete.length })
                : ''}
            </span>
          ) : null}
        </p>
        <Button variant="secondary" onClick={() => setAddingCategory(true)}>
          {t('addCategory')}
        </Button>
      </div>

      {/* Clicking a tile opens the **same** sheet as §7.1, with the method stated as a fact (D34). */}
      <QuestionSheet
        round={round}
        question={openTile}
        index={round.questions.findIndex((question) => question.id === openTile?.id)}
        total={round.questions.length}
        onClose={() => setOpenTile(undefined)}
        onStep={(delta) => {
          const current = round.questions.findIndex(
            (question) => question.id === openTile?.id,
          )
          setOpenTile(round.questions[current + delta] ?? openTile)
        }}
        onChanged={refresh}
      />

      <Dialog open={addingCategory} onOpenChange={setAddingCategory}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('addCategory')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="category-name">{t('categoryName')}</Label>
            <Input
              id="category-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddingCategory(false)}>
              {common('cancel')}
            </Button>
            <Button
              disabled={name.trim() === ''}
              onClick={() => {
                const value = name.trim()
                setName('')
                setAddingCategory(false)
                void api.createCategory(round.id, value).then(refresh)
              }}
            >
              {common('add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renaming !== undefined} onOpenChange={() => setRenaming(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('renameCategory')}</DialogTitle>
          </DialogHeader>
          <Input
            value={renaming?.name ?? ''}
            aria-label={t('categoryName')}
            onChange={(event) =>
              setRenaming((current) =>
                current ? { ...current, name: event.target.value } : current,
              )
            }
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenaming(undefined)}>
              {common('cancel')}
            </Button>
            <Button
              onClick={() => {
                const target = renaming
                setRenaming(undefined)
                if (target) void api.renameCategory(target.id, target.name).then(refresh)
              }}
            >
              {common('rename')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* §8 — deleting a column takes its tiles, and the confirmation says how many. */}
      <ConfirmDialog
        open={deletingCategory !== undefined}
        title={t('deleteCategoryTitle', { name: deletingCategory?.name ?? '' })}
        body={t('deleteCategoryBody', { count: deletingCategory?.tiles ?? 0 })}
        confirmLabel={common('delete')}
        onCancel={() => setDeletingCategory(undefined)}
        onConfirm={() => {
          const target = deletingCategory
          setDeletingCategory(undefined)
          if (target) void api.deleteCategory(target.id).then(refresh)
        }}
      />
    </main>
  )
}

/** One row of the board. Empty cells are `+` buttons, because a board is filled in, not configured. */
function FragmentRow({
  categories,
  row,
  value,
  tilesIn,
  round,
  onOpen,
  onAdd,
}: {
  categories: RoundContent['categories']
  row: number
  value: number
  tilesIn: (categoryId: string) => QuestionContent[]
  round: RoundContent
  onOpen: (question: QuestionContent) => void
  onAdd: (categoryId: string) => void
}) {
  const t = useTranslations('admin.board')

  return (
    <>
      {categories.map((category) => {
        const tile = tilesIn(category.id)[row]
        if (!tile) {
          return (
            <button
              key={`${category.id}-${row}`}
              type="button"
              aria-label={`${t('addTile')} ${category.name} ${value}`}
              className="border-border text-muted-foreground hover:border-foreground/40 flex h-16 items-center justify-center rounded-lg border border-dashed"
              onClick={() => onAdd(category.id)}
            >
              <Plus className="size-4" />
            </button>
          )
        }

        const ready = isQuestionReady(tile, round)
        return (
          <button
            key={tile.id}
            type="button"
            className="bg-card border-border hover:border-foreground/40 flex h-16 items-center justify-between rounded-lg border px-3 text-left"
            onClick={() => onOpen(tile)}
          >
            <span className="text-lg font-semibold tabular-nums">{tile.points}</span>
            <span className={ready ? 'text-muted-foreground' : 'text-destructive'}>
              {ready ? (
                <Check className="size-4" />
              ) : (
                <AlertTriangle className="size-4" />
              )}
            </span>
          </button>
        )
      })}
    </>
  )
}

/** §8 — the ladder, and the one control that re-values every tile in a row. */
function ValueLadder({
  roundId,
  ladder,
  onChanged,
}: {
  roundId: string
  ladder: number[]
  onChanged: () => void
}) {
  const t = useTranslations('admin.board')
  const [values, setValues] = useState(ladder)

  const commit = (next: number[]): void => {
    setValues(next)
    if (next.every((value) => Number.isInteger(value) && value > 0)) {
      void api.setValueLadder(roundId, next).then(onChanged)
    }
  }

  return (
    <section className="flex flex-wrap items-end gap-2">
      <div className="space-y-2">
        <Label>{t('valueLadder')}</Label>
        <div className="flex gap-2">
          {/* Same reasoning as the rows above: a rung's identity is its position. */}
          {values.map((value, index) => (
            <Input
              // oxlint-disable-next-line react/no-array-index-key
              key={index}
              type="number"
              min={1}
              value={value}
              aria-label={`${t('valueLadder')} ${index + 1}`}
              className="w-20"
              onChange={(event) => {
                const next = [...values]
                next[index] = Number(event.target.value)
                commit(next)
              }}
            />
          ))}
        </div>
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => commit([...values, (values.at(-1) ?? 0) + 100])}
      >
        {t('addRow')}
      </Button>
    </section>
  )
}
