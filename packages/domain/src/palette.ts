/**
 * conventions §3 — the curated team palette.
 *
 * Stored as **resolved hex** on `game_team.colour` (data model §6.2), never as an index, so a future
 * edit to this list can never recolour a game that has already been played.
 *
 * Validated against the dark main-screen background (PRD 4 §2.2), which is the hardest case: a
 * projector crushing contrast at ten metres.
 */
export interface PaletteColour {
  /** Never shown alone — colour is always paired with the team name (PRD 1 §9.5). */
  name: string
  hex: string
}

export const TEAM_PALETTE: readonly PaletteColour[] = [
  { name: 'Red', hex: '#EF4444' },
  { name: 'Orange', hex: '#F97316' },
  { name: 'Amber', hex: '#FBBF24' },
  { name: 'Lime', hex: '#A3E635' },
  { name: 'Emerald', hex: '#34D399' },
  { name: 'Cyan', hex: '#22D3EE' },
  { name: 'Blue', hex: '#60A5FA' },
  { name: 'Indigo', hex: '#818CF8' },
  { name: 'Violet', hex: '#A78BFA' },
  { name: 'Fuchsia', hex: '#E879F9' },
  { name: 'Rose', hex: '#FB7185' },
  { name: 'Slate', hex: '#CBD5E1' },
] as const

/**
 * conventions §3.1 — auto-assignment **walks the hue wheel, not the list**.
 *
 * A four-team game gets red / cyan / amber / violet, which is unmistakable from across a room;
 * walking the list in order would give red / orange / amber / lime, which is not.
 */
const ASSIGNMENT_ORDER = [
  'Red',
  'Cyan',
  'Amber',
  'Violet',
  'Emerald',
  'Fuchsia',
  'Blue',
  'Orange',
  'Lime',
  'Indigo',
  'Rose',
  'Slate',
] as const

export const PALETTE_BY_ASSIGNMENT: readonly PaletteColour[] = ASSIGNMENT_ORDER.map(
  (name) => {
    const colour = TEAM_PALETTE.find((candidate) => candidate.name === name)
    // Unreachable unless the two lists drift, which is exactly what this catches.
    if (!colour) throw new Error(`palette has no colour named ${name}`)
    return colour
  },
)

/**
 * The colour for the nth team a master adds.
 *
 * **Wraps above twelve, deliberately.** Twelve mutually distinguishable colours is close to the
 * practical ceiling and PRD 1 §2.1 allows twenty teams, so colours repeat — which is acceptable only
 * because colour is never the sole identifier (conventions §3.2). Two teams sharing one is a
 * legibility annoyance, not an ambiguity.
 */
export function assignedColour(index: number): string {
  const colour = PALETTE_BY_ASSIGNMENT[index % PALETTE_BY_ASSIGNMENT.length]
  return colour?.hex ?? '#EF4444'
}

/** Whether a colour is one a team is already using — marked in the picker, never disabled (§11). */
export function isColourTaken(hex: string, taken: readonly string[]): boolean {
  return taken.some((candidate) => candidate.toUpperCase() === hex.toUpperCase())
}
