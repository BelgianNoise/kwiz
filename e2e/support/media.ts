import { deflateSync } from 'node:zlib'

/**
 * Bytes for the two attachments scenario 1 uploads through the real file input.
 *
 * **Synthesised, not checked in**: a binary fixture in git rots invisibly, while these two
 * functions fail loudly the moment their format math is wrong — and both formats are ones a
 * browser decodes natively, which is the whole bar `verifyPlayable` sets (PRD 2 §7.1).
 */

/**
 * A valid PNG: 8-byte signature, IHDR, one IDAT of a single black pixel, IEND. Built from the
 * chunk specification rather than a base64 literal so the CRCs are provably correct — a wrong
 * CRC is rejected by Chromium's decoder and would fail the upload for an unrelated reason.
 */
export function pngBytes(width = 4, height = 4): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.writeUInt8(8, 8) // bit depth
  ihdr.writeUInt8(2, 9) // colour type: truecolour RGB

  // Each scanline is prefixed with a filter byte (0 = none).
  const raw = Buffer.alloc((width * 3 + 1) * height)
  const idat = deflateSync(raw)

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed), 0)
  return Buffer.concat([length, typed, crc])
}

let crcTable: number[] | undefined

function crc32(bytes: Buffer): number {
  crcTable ??= Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c
  })
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * A valid WAV: 44-byte RIFF header plus half a second of near-silence, 8 kHz mono 16-bit PCM.
 * Chromium fires `loadedmetadata` on it, which is everything O6's upload gate asks.
 */
export function wavBytes(durationMs = 500): Buffer {
  const sampleRate = 8000
  const samples = Math.round((sampleRate * durationMs) / 1000)
  const data = Buffer.alloc(samples * 2)
  // One quiet sine cycle set — true digital silence decodes fine, but a wave makes the file
  // non-degenerate if anyone ever listens to it.
  for (let i = 0; i < samples; i++) {
    data.writeInt16LE(Math.round(Math.sin(i / 10) * 2000), i * 2)
  }

  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16) // fmt chunk size
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28) // byte rate
  header.writeUInt16LE(2, 32) // block align
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)

  return Buffer.concat([header, data])
}
