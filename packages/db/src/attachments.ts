import type { AttachmentKind } from '@kwiz/domain'
import { eq, sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import type { KwizDatabase } from './client'
import { attachment, gameAttachment, question } from './schema'

/**
 * Attachment **rows**. The bytes are content-addressed on disk and belong to the app layer, which is
 * the only place that may touch a filesystem (data model §8).
 *
 * These live here rather than in a route so `apps/web` needs no ORM dependency of its own — the same
 * reason `packages/domain` may not import Drizzle. A query in a route handler is how a schema detail
 * ends up in three places.
 */

export interface AttachmentFile {
  checksum: string
  ext: string
  mimeType: string
}

/**
 * The file behind an attachment id, **game copy first, then template**.
 *
 * The URL carries the *row's* id, never the file's, which is what lets a template attachment and each
 * of its game copies keep separate rows over one shared file. The template fallback is what makes
 * authoring able to preview a file it has just uploaded: a game copy does not exist until a game does.
 */
export function findAttachmentFile(
  database: KwizDatabase,
  attachmentId: string,
): AttachmentFile | undefined {
  const columns = {
    checksum: gameAttachment.checksum,
    ext: gameAttachment.ext,
    mimeType: gameAttachment.mimeType,
  }

  return (
    database.db
      .select(columns)
      .from(gameAttachment)
      .where(eq(gameAttachment.id, attachmentId))
      .get() ??
    database.db
      .select({
        checksum: attachment.checksum,
        ext: attachment.ext,
        mimeType: attachment.mimeType,
      })
      .from(attachment)
      .where(eq(attachment.id, attachmentId))
      .get()
  )
}

export interface NewAttachment {
  questionId: string
  kind: AttachmentKind
  mimeType: string
  /** Display metadata only. It never touches the on-disk path (data model §4.7). */
  originalName: string
  /** Derived from the **detected** type, never from the uploaded filename. */
  ext: string
  sizeBytes: number
  checksum: string
}

/** Appends to the end of the question's media list — `position` is explicit, never insertion order. */
export function insertTemplateAttachment(
  database: KwizDatabase,
  row: NewAttachment,
): string | undefined {
  const target = database.db
    .select({ id: question.id })
    .from(question)
    .where(eq(question.id, row.questionId))
    .get()
  if (!target) return undefined

  const position =
    database.db
      .select({ next: sql<number>`coalesce(max(${attachment.position}), -1) + 1` })
      .from(attachment)
      .where(eq(attachment.questionId, row.questionId))
      .get()?.next ?? 0

  const id = uuidv7()
  database.db
    .insert(attachment)
    .values({
      id,
      ...row,
      position,
      // Audio and video are main-screen-only and not configurable (D27, I3), so only an image can
      // ever carry this. Off by default; PRD 2's editor is what turns it on.
      showOnPlayerDevices: false,
    })
    .run()

  return id
}
