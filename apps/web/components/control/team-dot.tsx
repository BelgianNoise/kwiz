import { cn } from '@/lib/utils'

/**
 * PRD 1 §9.5 — **a team colour is always paired with the team name**, never the sole identifier.
 *
 * One component so that rule survives the twenty places this surface shows a team. The colour is an
 * inline style because it is a stored hex from the curated palette (conventions §3), not a semantic
 * token: it identifies a team, and it is the only place in this app where a literal colour is right.
 */
export function TeamDot({ colour, className }: { colour: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('border-border size-3 shrink-0 rounded-full border', className)}
      style={{ backgroundColor: colour }}
    />
  )
}
