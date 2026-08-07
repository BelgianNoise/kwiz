import { insertTemplateAttachment } from '@kwiz/db'
import { fail, ok } from '@kwiz/domain'

import { storeAttachment } from '@/lib/server/attachments'
import { actionResponse } from '@/lib/server/http'
import { getRuntime, isDatabaseUsable } from '@/lib/server/runtime'

/**
 * `POST /api/attachments` — upload one file and attach it to a **template** question.
 *
 * Not in protocol §7's catalogue, which lists the reads (§7.4) and the play-half actions (§7.1–2) but
 * no upload endpoint; PRD 2 §7.1 describes the UI without naming a route. Defined here because
 * build-order slice 3 owns "attachment upload … and serving", and written into protocol §7.5 in the
 * same change rather than left as an undocumented surface.
 *
 * Multipart, because that is what a file input sends. The interesting work is in
 * `lib/server/attachments.ts`: hash while streaming, sniff the real type from the bytes, atomic
 * rename into `attachments/<sha256>.<ext>`.
 */
export async function POST(request: Request): Promise<Response> {
  const server = await getRuntime()
  if (!isDatabaseUsable(server)) {
    return actionResponse(
      fail('DATABASE_MIGRATION_REQUIRED', 'the database has pending migrations'),
    )
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return actionResponse(fail('VALIDATION_ERROR', 'expected a multipart form'))
  }

  const file = form.get('file')
  const questionId = form.get('questionId')
  if (!(file instanceof File) || typeof questionId !== 'string') {
    return actionResponse(
      fail('VALIDATION_ERROR', 'expected a `file` part and a `questionId` field'),
    )
  }

  const stored = await storeAttachment(server.paths, file.stream(), {
    originalName: file.name,
    maxBytes: server.config.KWIZ_MAX_UPLOAD_MB * 1_000_000,
  })
  if (!stored.ok) return actionResponse(stored)
  const data = stored.data
  if (!data) return actionResponse(fail('ATTACHMENT_REJECTED', 'nothing was stored'))

  /*
   * The row is written **after** the file. Content addressing is what makes that ordering safe: a
   * file with no row is an orphan the reconciliation pass sweeps, while a row with no file would be a
   * question that cannot be played (data model §8).
   */
  const id = insertTemplateAttachment(server.database, {
    questionId,
    kind: data.kind,
    mimeType: data.mimeType,
    originalName: file.name,
    ext: data.ext,
    sizeBytes: data.sizeBytes,
    checksum: data.checksum,
  })
  if (!id) return actionResponse(fail('VALIDATION_ERROR', `no question ${questionId}`))

  return actionResponse(
    ok({
      id,
      kind: data.kind,
      mimeType: data.mimeType,
      sizeBytes: data.sizeBytes,
      checksum: data.checksum,
      // `false` means an identical file was already on disk — the same song in three quizzes is
      // stored once (data model §8).
      stored: data.written,
      url: `/api/attachment/${id}`,
    }),
  )
}
