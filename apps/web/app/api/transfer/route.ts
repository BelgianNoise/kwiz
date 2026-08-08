import { randomBytes } from 'node:crypto'

import { fail } from '@kwiz/domain'
import { z } from 'zod'

import { actionResponse, readJsonBody, UNPARSEABLE } from '@/lib/server/http'
import { getRuntime, isDatabaseUsable } from '@/lib/server/runtime'
import {
  exportQuiz,
  exportSize,
  inspectImport,
  performImport,
} from '@/lib/server/transfer'

/**
 * PRD 2 §14 — export and import.
 *
 * Not on the `/api/authoring/*` table, because two of these four do not return JSON at all: an export
 * is a zip download and an import is a multipart upload. Folding a binary response into the
 * `ActionResult` envelope would mean base64 in a JSON body, which for a 500 MB video is not a trade
 * worth making for uniformity.
 */
export const dynamic = 'force-dynamic'

const optionsSchema = z.object({
  quizId: z.string().min(1),
  includeGames: z.boolean().default(false),
  includeAttachments: z.boolean().default(true),
  /** §14.1 — narrows the export to one game. Implies `includeGames`, since that is the ask. */
  onlyGameId: z.string().min(1).optional(),
  /** `size` answers §14.1's dialog; `download` returns the zip itself. */
  intent: z.enum(['size', 'download']).default('size'),
})

const importSchema = z.object({ mode: z.enum(['COPY', 'REPLACE']).default('COPY') })

export async function POST(request: Request): Promise<Response> {
  const runtime = await getRuntime()
  if (!isDatabaseUsable(runtime)) {
    return actionResponse(
      fail('DATABASE_MIGRATION_REQUIRED', 'the database has pending migrations'),
    )
  }

  const contentType = request.headers.get('content-type') ?? ''

  // ─── import: a zip arrives as multipart, because that is what a file input and a drop send ───
  if (contentType.startsWith('multipart/form-data')) {
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return actionResponse(fail('VALIDATION_ERROR', 'no file in the request'))
    }

    const parsed = importSchema.safeParse({ mode: form.get('mode') ?? undefined })
    if (!parsed.success)
      return actionResponse(fail('VALIDATION_ERROR', 'unknown import mode'))

    const bytes = new Uint8Array(await file.arrayBuffer())

    /*
     * §14.2 — `inspect` validates and previews without writing anything, which is what makes the
     * collision dialog honest: the master is shown both sides *before* a choice that may delete
     * their local copy.
     */
    if (form.get('intent') === 'inspect') {
      return actionResponse(inspectImport(runtime, bytes))
    }

    return actionResponse(
      await performImport(runtime, bytes, parsed.data.mode, (size) => randomBytes(size)),
    )
  }

  // ─── export ───
  const body = await readJsonBody(request)
  if (body === UNPARSEABLE) {
    return actionResponse(fail('VALIDATION_ERROR', 'the request body is not JSON'))
  }

  const options = optionsSchema.safeParse(body)
  if (!options.success)
    return actionResponse(fail('VALIDATION_ERROR', 'a quizId is required'))

  if (options.data.intent === 'size') {
    return actionResponse(exportSize(runtime, options.data.quizId, options.data))
  }

  const zip = await exportQuiz(runtime, options.data.quizId, options.data)
  if (!zip.ok || !zip.data) return actionResponse(zip)

  /*
   * `Response` types its body against the DOM's `BodyInit`, which does not name Node's `Uint8Array`
   * even though it is exactly what the runtime wants. A `Blob` is the honest way to say "these bytes"
   * without asserting a lie.
   */
  return new Response(new Blob([new Uint8Array(zip.data.bytes)]), {
    headers: {
      'content-type': 'application/zip',
      // The name is sanitised in `exportFileName`, so nothing user-supplied reaches this header raw.
      'content-disposition': `attachment; filename="${zip.data.fileName}"`,
      'content-length': String(zip.data.bytes.byteLength),
    },
  })
}
