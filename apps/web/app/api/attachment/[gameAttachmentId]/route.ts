import { findAttachmentFile } from '@kwiz/db'
import { fail } from '@kwiz/domain'

import { attachmentResponse } from '@/lib/server/attachments'
import { getRuntime, isDatabaseUsable } from '@/lib/server/runtime'

/**
 * `GET /api/attachment/:gameAttachmentId` (protocol §7.4) — the file, **with HTTP range support**
 * (D5) so audio and video can seek.
 *
 * The row gives the checksum; the checksum gives the path (data model §8). The id in the URL is the
 * *row's*, never the file's, which is what lets a template attachment and its game copies share one
 * file on disk while each keeps its own row.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ gameAttachmentId: string }> },
): Promise<Response> {
  const runtime = await getRuntime()
  // D14 — every other route refuses against a database with pending migrations; this one read
  // straight through to a raw query and was the one exception (P2 #8).
  if (!isDatabaseUsable(runtime)) {
    return Response.json(
      fail('DATABASE_MIGRATION_REQUIRED', 'the database has pending migrations'),
      { status: 503 },
    )
  }

  const { gameAttachmentId } = await params

  const file = findAttachmentFile(runtime.database, gameAttachmentId)
  if (!file) {
    return Response.json(
      fail('ATTACHMENT_NOT_FOUND', `no attachment ${gameAttachmentId}`),
      {
        status: 404,
      },
    )
  }

  return attachmentResponse(runtime.paths, file, request.headers.get('range'))
}
