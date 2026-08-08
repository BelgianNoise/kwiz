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

/**
 * PRD 4 §2.2's dark stage — the background every team colour is actually seen against.
 *
 * A projector crushes contrast and washes out light backgrounds, so the main screen is dark text-on-
 * dark by design. That makes "is this colour legible?" a question with one concrete answer rather
 * than a matter of taste.
 */
const STAGE_BACKGROUND = '#0A0A0A'

function relativeLuminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

/** WCAG's ratio, against the stage background rather than against white. */
export function contrastOnStage(hex: string): number {
  const colour = relativeLuminance(hex)
  const background = relativeLuminance(STAGE_BACKGROUND)
  const [lighter, darker] =
    colour > background ? [colour, background] : [background, colour]
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * The floor a custom colour has to clear, and **the floor every curated colour already clears** —
 * `palette.test.ts` asserts exactly that, so this number cannot drift away from the palette it
 * describes.
 *
 * 4.5 rather than PRD 4 §2.2's 7:1, because a team colour is not body copy: it appears as a swatch
 * and as large hero text (§2.1's 12–20vh), where WCAG's own threshold is lower. The curated palette's
 * darkest entry sits at 5.26, so 4.5 admits everything the palette guarantees and still rejects the
 * navy-on-black that free choice reliably produces.
 */
export const MIN_TEAM_CONTRAST = 4.5

/**
 * PRD 2 §11 allows a custom colour beside the palette. This is what stops that from being a way to
 * make a team invisible: the choice is offered, and a bad one is **warned about rather than
 * blocked** — a master may have a reason, and it is their room.
 */
export function isLegibleOnStage(hex: string): boolean {
  return contrastOnStage(hex) >= MIN_TEAM_CONTRAST
}

/** `#abc` and `#AABBCC` both arrive from a colour input; storage is always resolved 6-digit hex. */
export function normaliseHex(value: string): string | undefined {
  const trimmed = value.trim().toUpperCase()
  const short = /^#([0-9A-F])([0-9A-F])([0-9A-F])$/.exec(trimmed)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  return /^#[0-9A-F]{6}$/.test(trimmed) ? trimmed : undefined
}
