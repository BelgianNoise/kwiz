import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import type { DataPaths } from '@kwiz/db'
import { fail, ok, type ActionResult, type AttachmentKind } from '@kwiz/domain'

/**
 * data model §8 — attachments, **content-addressed by SHA-256**.
 *
 * ```
 * ${KWIZ_DATA_DIR}/attachments/<sha256>.<ext>
 * ```
 *
 * Addressing by content rather than by row id is what makes per-game attachment rows free: a game
 * copy shares the file, identical uploads collapse, and GC is one query. It also makes the write
 * order safe — hash while streaming, then rename into place — so the failure mode is a stray file,
 * never a missing one.
 */

/** conventions §7 — the cheap first gate. Playability is verified in the browser (PRD 2 §7.1, O6). */
export const MIME_ALLOWLIST: Record<string, { kind: AttachmentKind; ext: string }> = {
  'image/jpeg': { kind: 'IMAGE', ext: 'jpg' },
  'image/png': { kind: 'IMAGE', ext: 'png' },
  'image/webp': { kind: 'IMAGE', ext: 'webp' },
  'image/gif': { kind: 'IMAGE', ext: 'gif' },
  'audio/mpeg': { kind: 'AUDIO', ext: 'mp3' },
  'audio/mp4': { kind: 'AUDIO', ext: 'm4a' },
  'audio/aac': { kind: 'AUDIO', ext: 'aac' },
  'audio/ogg': { kind: 'AUDIO', ext: 'ogg' },
  'audio/wav': { kind: 'AUDIO', ext: 'wav' },
  'video/mp4': { kind: 'VIDEO', ext: 'mp4' },
  'video/webm': { kind: 'VIDEO', ext: 'webm' },
}

/**
 * The type as read from the **bytes**, not from what the upload claimed.
 *
 * data model §4.7 requires `ext` to come from the detected type and never from the uploaded filename;
 * a declared `Content-Type` is no better than a filename, since both are the client's word for it.
 * Magic bytes are, so this sniffs the eleven allowlisted formats and refuses anything else.
 *
 * It deliberately cannot see a **codec** — an MP4 holding H.265 sniffs identically to one holding
 * H.264 — which is exactly why conventions §7 keeps in-browser playability verification.
 */
export function sniffMimeType(bytes: Uint8Array): string | undefined {
  const starts = (...signature: number[]): boolean =>
    signature.every((byte, index) => bytes[index] === byte)
  const ascii = (offset: number, text: string): boolean =>
    Array.from(text).every((char, index) => bytes[offset + index] === char.charCodeAt(0))

  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png'
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp'
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return 'audio/wav'
  if (starts(0x1a, 0x45, 0xdf, 0xa3)) return 'video/webm'
  if (ascii(0, 'OggS')) return 'audio/ogg'
  // ID3 tag, or a bare MPEG audio frame sync.
  if (ascii(0, 'ID3')) return 'audio/mpeg'
  if (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0) return 'audio/mpeg'
  if (ascii(4, 'ftyp')) {
    // The ISO base media brand distinguishes audio-only M4A from video MP4, and nothing else can.
    return ascii(8, 'M4A') ? 'audio/mp4' : 'video/mp4'
  }
  return undefined
}

export interface StoredAttachment {
  checksum: string
  ext: string
  kind: AttachmentKind
  mimeType: string
  sizeBytes: number
  /** False when the file was already on disk — an identical upload costs nothing (§8). */
  written: boolean
}

/**
 * Stores one upload, hashing **while** streaming.
 *
 * Reading a 50 MB file twice to hash it and then write it is the naive shape this avoids. The temp
 * file lives inside `KWIZ_DATA_DIR` rather than the OS temp directory so the rename stays on one
 * volume — it is only atomic when source and destination do (data model §8, PRD 1 §6.6).
 */
export async function storeAttachment(
  paths: DataPaths,
  source: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array> | Uint8Array,
  options: { originalName: string; maxBytes: number },
): Promise<ActionResult<StoredAttachment>> {
  await mkdir(paths.tmp, { recursive: true })
  await mkdir(paths.attachments, { recursive: true })

  const hash = createHash('sha256')
  const tempPath = join(paths.tmp, `${randomUUID()}.part`)
  const head = new Uint8Array(16)
  let headLength = 0
  let sizeBytes = 0
  let tooLarge = false

  /*
   * §8's algorithm exactly: stream to `tmp/<random>`, hashing on the way past, then rename into
   * place under the hash. Nothing is buffered — a 50 MB upload is never held in memory and never read
   * twice — and the temp name is random because the final one is not known until the last byte.
   */
  await pipeline(
    toIterable(source),
    async function* measure(chunks: AsyncIterable<Uint8Array>) {
      for await (const chunk of chunks) {
        sizeBytes += chunk.byteLength
        if (sizeBytes > options.maxBytes) {
          tooLarge = true
          return
        }
        hash.update(chunk)
        if (headLength < head.length) {
          const take = Math.min(head.length - headLength, chunk.byteLength)
          head.set(chunk.subarray(0, take), headLength)
          headLength += take
        }
        yield chunk
      }
    },
    createWriteStream(tempPath),
  )

  const discard = async (): Promise<void> => {
    await unlink(tempPath).catch(() => undefined)
  }

  if (tooLarge) {
    await discard()
    return fail(
      'ATTACHMENT_REJECTED',
      `${options.originalName} is larger than the ${Math.floor(options.maxBytes / 1_000_000)} MB limit`,
    )
  }

  const mimeType = sniffMimeType(head.subarray(0, headLength))
  const allowed = mimeType === undefined ? undefined : MIME_ALLOWLIST[mimeType]
  if (!mimeType || !allowed) {
    await discard()
    // Named rather than generic, because PRD 2 §7.1 requires the message to say what does work.
    return fail(
      'ATTACHMENT_REJECTED',
      `${options.originalName} is not an accepted image, audio or video file`,
      { accepted: Object.keys(MIME_ALLOWLIST) },
    )
  }

  const checksum = hash.digest('hex')
  const finalPath = join(
    /*turbopackIgnore: true*/ paths.attachments,
    `${checksum}.${allowed.ext}`,
  )

  const existing = await stat(/*turbopackIgnore: true*/ finalPath).catch(() => undefined)
  if (existing) {
    // Already stored: the same song used in three quizzes is one file on disk.
    await discard()
    return ok({
      checksum,
      ext: allowed.ext,
      kind: allowed.kind,
      mimeType,
      sizeBytes,
      written: false,
    })
  }

  try {
    await rename(tempPath, finalPath)
  } catch (error) {
    await discard()
    throw error
  }

  return ok({
    checksum,
    ext: allowed.ext,
    kind: allowed.kind,
    mimeType,
    sizeBytes,
    written: true,
  })
}

/**
 * The three shapes an upload arrives in: a `File`'s web stream from a route, an async iterable, or a
 * plain buffer from a test. Normalised once here rather than at each call site.
 */
function toIterable(
  source: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array> | Uint8Array,
): AsyncIterable<Uint8Array> {
  if (source instanceof Uint8Array) {
    return (async function* single() {
      yield source
    })()
  }
  if (source instanceof ReadableStream) {
    // `Readable.fromWeb` is typed against Node's own web-stream declarations; at runtime this is
    // the very object it wants.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return Readable.fromWeb(source as Parameters<typeof Readable.fromWeb>[0])
  }
  return source
}

/*
 * The five `turbopackIgnore` comments below are Turbopack's sanctioned opt-out from tracing a
 * dynamic filesystem path (its warning names them). Every one of these paths *is* dynamic by
 * design: the data directory is `KWIZ_DATA_DIR` (PRD 1 §6.8) and the filename is a content hash
 * (data model §8), so neither can be statically scoped. Without the opt-out Turbopack traces the
 * whole project into the server output — and the build emits warnings, which slice 0's checklist
 * does not allow.
 */

// ─── serving ───

export interface ByteRange {
  start: number
  end: number
}

/**
 * `Range: bytes=…` per RFC 9110, for the three forms a browser actually sends.
 *
 * **Required, not an optimisation** (D5): Safari will not seek — and in some versions will not play —
 * audio or video from a server that ignores ranges, and a music round that cannot be scrubbed is a
 * broken round. `null` means serve the whole file; `'unsatisfiable'` must become a 416.
 */
export function parseRange(
  header: string | null,
  sizeBytes: number,
): ByteRange | null | 'unsatisfiable' {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null

  const [, rawStart = '', rawEnd = ''] = match
  if (rawStart === '' && rawEnd === '') return null

  // `bytes=-500` is the *last* 500 bytes, not a range starting at zero.
  if (rawStart === '') {
    const length = Number(rawEnd)
    if (length <= 0) return 'unsatisfiable'
    return { start: Math.max(0, sizeBytes - length), end: sizeBytes - 1 }
  }

  const start = Number(rawStart)
  if (start >= sizeBytes) return 'unsatisfiable'
  const end = rawEnd === '' ? sizeBytes - 1 : Math.min(Number(rawEnd), sizeBytes - 1)
  if (end < start) return 'unsatisfiable'
  return { start, end }
}

/** A `200` or a `206` over the content-addressed file, with the headers a media element needs. */
export async function attachmentResponse(
  paths: DataPaths,
  file: { checksum: string; ext: string; mimeType: string },
  rangeHeader: string | null,
): Promise<Response> {
  const path = join(
    /*turbopackIgnore: true*/ paths.attachments,
    `${file.checksum}.${file.ext}`,
  )
  const info = await stat(/*turbopackIgnore: true*/ path).catch(() => undefined)
  if (!info) {
    // The row exists and the file does not — recoverable, and what PRD 2's pre-flight checks for.
    return Response.json(
      fail('ATTACHMENT_NOT_FOUND', 'the file for this attachment is missing'),
      {
        status: 404,
      },
    )
  }

  const headers: Record<string, string> = {
    'Content-Type': file.mimeType,
    // Content-addressed, so the bytes behind a checksum can never change: cache them hard. This is
    // also what keeps a 40 MB video off the wire twice in one round.
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Accept-Ranges': 'bytes',
  }

  const range = parseRange(rangeHeader, info.size)
  if (range === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: { ...headers, 'Content-Range': `bytes */${info.size}` },
    })
  }

  if (range === null) {
    return new Response(streamOf(path), {
      status: 200,
      headers: { ...headers, 'Content-Length': String(info.size) },
    })
  }

  return new Response(streamOf(path, range), {
    status: 206,
    headers: {
      ...headers,
      'Content-Range': `bytes ${range.start}-${range.end}/${info.size}`,
      'Content-Length': String(range.end - range.start + 1),
    },
  })
}

function streamOf(path: string, range?: ByteRange): ReadableStream<Uint8Array> {
  const node = createReadStream(
    path,
    range ? { start: range.start, end: range.end } : undefined,
  )
  // `Readable.toWeb` is typed against Node's own ReadableStream generic; the runtime object is the
  // DOM stream `Response` wants.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return Readable.toWeb(node) as ReadableStream<Uint8Array>
}
