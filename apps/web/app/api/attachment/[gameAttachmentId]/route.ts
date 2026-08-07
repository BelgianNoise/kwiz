import { findAttachmentFile } from '@kwiz/db'
import { fail } from '@kwiz/domain'

import { attachmentResponse } from '@/lib/server/attachments'
import { getRuntime } from '@/lib/server/runtime'

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
