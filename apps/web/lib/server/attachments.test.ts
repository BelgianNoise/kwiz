import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { dataPaths, type DataPaths } from '@kwiz/db'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  attachmentResponse,
  parseRange,
  reclaimSpace,
  sniffMimeType,
  storageStats,
  storeAttachment,
} from './attachments'

/**
 * data model §8 — content addressing — and D5's range support.
 *
 * Against a **real temp directory**: the properties under test are a hash, a filename and an atomic
 * rename, none of which a mocked filesystem would exercise.
 */

let paths: DataPaths

beforeEach(async () => {
  paths = dataPaths(await mkdtemp(join(tmpdir(), 'kwiz-attachments-')))
})

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8, 9,
])
const MP3 = Uint8Array.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 9, 9, 9, 9, 9, 9, 9])

describe('sniffing the type from the bytes', () => {
  it('recognises the allowlisted formats, and refuses anything it cannot name', () => {
    expect(sniffMimeType(PNG)).toBe('image/png')
    expect(sniffMimeType(MP3)).toBe('audio/mpeg')
    expect(sniffMimeType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffMimeType(ascii('RIFF____WEBP'))).toBe('image/webp')
    expect(sniffMimeType(ascii('RIFF____WAVE'))).toBe('audio/wav')
    expect(sniffMimeType(ascii('____ftypM4A '))).toBe('audio/mp4')
    expect(sniffMimeType(ascii('____ftypisom'))).toBe('video/mp4')
    expect(sniffMimeType(ascii('OggS'))).toBe('audio/ogg')

    // A PDF renamed to `.png` with `Content-Type: image/png` — which is why the *bytes* decide
    // (data model §4.7).
    expect(sniffMimeType(ascii('%PDF-1.7'))).toBeUndefined()
  })
})

describe('storing an upload', () => {
  it('names the file by its hash and the detected extension', async () => {
    const result = await storeAttachment(paths, PNG, {
      originalName: 'x.jpg',
      maxBytes: 1_000,
    })
    expect(result.ok).toBe(true)
    if (!result.ok || !result.data) throw new Error('expected a stored file')

    // The extension comes from the sniffed type, not from the `.jpg` the uploader claimed.
    expect(result.data.ext).toBe('png')
    expect(result.data.kind).toBe('IMAGE')
    expect(result.data.sizeBytes).toBe(PNG.byteLength)
    expect(result.data.written).toBe(true)

    const stored = await readdir(paths.attachments)
    expect(stored).toEqual([`${result.data.checksum}.png`])
    expect(await readFile(join(paths.attachments, stored[0] ?? ''))).toEqual(
      Buffer.from(PNG),
    )
    // The staging file is gone, so a `tmp/` full of `.part` files means something failed silently.
    expect(await readdir(paths.tmp)).toEqual([])
  })

  it('collapses an identical upload onto the one file', async () => {
    const first = await storeAttachment(paths, PNG, {
      originalName: 'a.png',
      maxBytes: 1_000,
    })
    const second = await storeAttachment(paths, PNG, {
      originalName: 'b.png',
      maxBytes: 1_000,
    })
    if (!first.ok || !second.ok || !first.data || !second.data)
      throw new Error('expected two')

    expect(second.data.checksum).toBe(first.data.checksum)
    // The same song used in three quizzes is stored once (§8), which is what makes copying a game
    // with 2 GB of video cost nothing.
    expect(second.data.written).toBe(false)
    expect(await readdir(paths.attachments)).toHaveLength(1)
  })

  it('refuses a file over the limit and leaves nothing behind', async () => {
    const result = await storeAttachment(paths, PNG, {
      originalName: 'big.png',
      maxBytes: 8,
    })
    expect(result).toMatchObject({ ok: false, error: 'ATTACHMENT_REJECTED' })
    expect(await readdir(paths.attachments)).toEqual([])
    expect(await readdir(paths.tmp)).toEqual([])
  })

  it('refuses a type outside the allowlist, naming what does work', async () => {
    const result = await storeAttachment(paths, ascii('%PDF-1.7 and then some'), {
      originalName: 'rules.pdf',
      maxBytes: 1_000,
    })
    expect(result).toMatchObject({ ok: false, error: 'ATTACHMENT_REJECTED' })
    if (result.ok) throw new Error('expected a refusal')
    // The message has to say what *does* work (PRD 2 §7.1), so the allowlist travels with it.
    expect(result.detail).toEqual({
      accepted: expect.arrayContaining(['image/png', 'audio/mpeg', 'video/mp4']),
    })
    expect(await readdir(paths.attachments)).toEqual([])
  })

  it('accepts a stream, hashing it on the way past', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(PNG.subarray(0, 4))
        controller.enqueue(PNG.subarray(4))
        controller.close()
      },
    })

    const streamed = await storeAttachment(paths, stream, {
      originalName: 'x.png',
      maxBytes: 1_000,
    })
    const buffered = await storeAttachment(paths, PNG, {
      originalName: 'x.png',
      maxBytes: 1_000,
    })
    if (!streamed.ok || !buffered.ok) throw new Error('expected both')
    // Chunk boundaries must not change the hash — including one that splits the magic bytes.
    expect(streamed.data?.checksum).toBe(buffered.data?.checksum)
  })
})

describe('range requests (D5)', () => {
  it('parses the three forms a browser sends', () => {
    expect(parseRange(null, 100)).toBeNull()
    expect(parseRange('bytes=0-49', 100)).toEqual({ start: 0, end: 49 })
    // Open-ended: everything from here on.
    expect(parseRange('bytes=50-', 100)).toEqual({ start: 50, end: 99 })
    // Suffix: the *last* 20 bytes, not the first 20 — the form used to read a media file's trailer.
    expect(parseRange('bytes=-20', 100)).toEqual({ start: 80, end: 99 })
    // Clamped rather than refused, per RFC 9110.
    expect(parseRange('bytes=90-200', 100)).toEqual({ start: 90, end: 99 })
  })

  it('rejects a range that cannot be satisfied, and ignores one it cannot read', () => {
    expect(parseRange('bytes=100-120', 100)).toBe('unsatisfiable')
    expect(parseRange('bytes=60-40', 100)).toBe('unsatisfiable')
    // Multipart ranges and junk both fall back to the whole file rather than to an error.
    expect(parseRange('bytes=0-10,20-30', 100)).toBeNull()
    expect(parseRange('items=0-10', 100)).toBeNull()
  })

  it('serves 200, 206 and 416 with the headers a media element needs', async () => {
    const stored = await storeAttachment(paths, MP3, {
      originalName: 'clip.mp3',
      maxBytes: 1_000,
    })
    if (!stored.ok || !stored.data) throw new Error('expected a stored file')
    const file = { checksum: stored.data.checksum, ext: 'mp3', mimeType: 'audio/mpeg' }

    const whole = await attachmentResponse(paths, file, null)
    expect(whole.status).toBe(200)
    // Without this, Safari will not seek — and in some versions will not play at all.
    expect(whole.headers.get('accept-ranges')).toBe('bytes')
    expect(whole.headers.get('content-length')).toBe(String(MP3.byteLength))

    const partial = await attachmentResponse(paths, file, 'bytes=4-8')
    expect(partial.status).toBe(206)
    expect(partial.headers.get('content-range')).toBe(`bytes 4-8/${MP3.byteLength}`)
    expect(partial.headers.get('content-length')).toBe('5')
    expect(new Uint8Array(await partial.arrayBuffer())).toEqual(MP3.subarray(4, 9))

    const beyond = await attachmentResponse(paths, file, 'bytes=999-')
    expect(beyond.status).toBe(416)
    expect(beyond.headers.get('content-range')).toBe(`bytes */${MP3.byteLength}`)
  })

  it('answers 404 when the row exists and the file does not', async () => {
    const response = await attachmentResponse(
      paths,
      { checksum: 'deadbeef', ext: 'mp3', mimeType: 'audio/mpeg' },
      null,
    )
    expect(response.status).toBe(404)
    // Recoverable, and what PRD 2's pre-flight is for — content addressing makes this the failure
    // direction that happens, rather than a file with no row.
    expect(await response.json()).toMatchObject({ error: 'ATTACHMENT_NOT_FOUND' })
  })
})

/**
 * data model §8's reconciliation, surfaced as PRD 2 §16's `Reclaim space`.
 *
 * This is the one function in the app that deletes a master's files, so the case that matters is not
 * "does it free space" but **"does it ever free the wrong thing"**. The referenced set it is given is
 * the union of both attachment tables precisely so a template row deleted while a game still plays
 * its file cannot strand that game — and the assertion below is that rule, stated as a test.
 */
describe('reclaiming space', () => {
  const upload = (bytes: Uint8Array) =>
    storeAttachment(paths, bytes, { originalName: 'x.png', maxBytes: 1024 })

  it('deletes only files no row references, and reports what it freed', async () => {
    const kept = await upload(PNG)
    const orphan = await upload(
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]),
    )
    if (!kept.ok || !orphan.ok || !kept.data || !orphan.data)
      throw new Error('upload failed')

    const result = await reclaimSpace(paths, new Set([kept.data.checksum]))

    expect(result.removed).toBe(1)
    expect(result.bytes).toBeGreaterThan(0)
    expect(await readdir(paths.attachments)).toEqual([`${kept.data.checksum}.png`])
  })

  it('is a no-op when every file is referenced', async () => {
    const stored = await upload(PNG)
    if (!stored.ok || !stored.data) throw new Error('upload failed')

    expect(await reclaimSpace(paths, new Set([stored.data.checksum]))).toEqual({
      removed: 0,
      bytes: 0,
    })
    expect(await readdir(paths.attachments)).toHaveLength(1)
  })

  /**
   * §16 shows the reclaimable total *before* offering the button, so the two must agree: a master told
   * "2 unused files" and then given "removed 5" has been lied to about their own disk.
   */
  it('agrees with what storageStats offered to reclaim', async () => {
    const kept = await upload(PNG)
    await upload(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7]))
    if (!kept.ok || !kept.data) throw new Error('upload failed')

    const referenced = new Set([kept.data.checksum])
    const before = await storageStats(paths, referenced)
    const result = await reclaimSpace(paths, referenced)

    expect(before.attachmentCount).toBe(2)
    expect(result.removed).toBe(before.orphanCount)
    expect(result.bytes).toBe(before.orphanBytes)
  })
})

/** `_` stands in for a byte the sniffer does not look at. */
function ascii(text: string): Uint8Array {
  return Uint8Array.from(Array.from(text).map((char) => char.charCodeAt(0)))
}
