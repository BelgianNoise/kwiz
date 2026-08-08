import { z } from 'zod'

/**
 * `manifest.json` (protocol §8.1) — **the first thing read and the first thing that can refuse.**
 *
 * A zip is wholly untrusted input (conventions §10.1). Everything here exists so that a bad file
 * fails with a sentence a master can act on rather than a stack trace: a newer format is refused by
 * name, a truncated file is caught by the counts, and a damaged attachment is reported *per file* so
 * the message can be "the audio for question 12 is damaged" instead of "import failed".
 */
export const manifestSchema = z.object({
  schemaVersion: z.number().int().positive(),
  exportedAt: z.string(),
  quiz: z.object({
    id: z.string(),
    name: z.string(),
    revision: z.number().int(),
  }),
  includesGames: z.boolean(),
  counts: z.object({
    rounds: z.number().int().nonnegative(),
    questions: z.number().int().nonnegative(),
    attachments: z.number().int().nonnegative(),
    games: z.number().int().nonnegative(),
  }),
  attachments: z.array(
    z.object({
      checksum: z.string(),
      ext: z.string(),
      sizeBytes: z.number().int().nonnegative(),
    }),
  ),
})

export type Manifest = z.infer<typeof manifestSchema>

export const MANIFEST_FILE = 'manifest.json'
export const QUIZ_FILE = 'quiz.json'
export const GAMES_FILE = 'games.json'
export const ATTACHMENT_DIR = 'attachments/'

/**
 * `kwiz-export-<quizName>-<timestamp>.zip` (protocol §8).
 *
 * The name is sanitised rather than trusted: a quiz called `Round 1/2` would otherwise propose a
 * path, and a browser download or a shell that interprets it is not a risk worth taking for a
 * filename. Everything outside a conservative set collapses to `-`.
 */
export function exportFileName(quizName: string, exportedAt: Date): string {
  const safe =
    quizName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'quiz'
  const stamp = exportedAt.toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return `kwiz-export-${safe}-${stamp}.zip`
}
