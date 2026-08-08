import type { MainScreenQuestion } from '@kwiz/domain'

/**
 * PRD 4 §6 — **five named layouts and a deterministic resolver**, not a general layout engine. Five
 * cases can be designed, reviewed and tested; a general system cannot.
 *
 * Kept apart from the component that renders them because it is a *rule*: it is what a master
 * authors against, and the property that makes it authorable is that the same attachments always
 * resolve the same way. Prompt length is deliberately not an input — a layout that changed because
 * someone edited a word would be impossible to plan around.
 */
export type QuestionLayout = 'TEXT' | 'HERO' | 'GRID' | 'AUDIO' | 'SPLIT'

/**
 * Only **visible** attachments count. Audio and video never reach player devices (D27) but are all
 * visible here, so this uses the screen's own visibility rules rather than the player's.
 */
export function resolveLayout(media: MainScreenQuestion['media']): QuestionLayout {
  const images = media.filter((item) => item.kind === 'IMAGE')
  const videos = media.filter((item) => item.kind === 'VIDEO')
  const audio = media.filter((item) => item.kind === 'AUDIO')
  const visual = images.length + videos.length

  if (audio.length > 0 && visual > 0) return 'SPLIT'
  if (audio.length > 0) return 'AUDIO'
  if (visual === 0) return 'TEXT'
  if (visual === 1) return 'HERO'
  if (visual <= 4) return 'GRID'
  // More than four visuals is past what §6 designs a grid for, so it falls to the split shape.
  return 'SPLIT'
}
