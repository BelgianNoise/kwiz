/**
 * PRD 2 §7.1 / O6 — **playability is verified in the browser at upload time**, not inferred from a
 * file extension.
 *
 * ```
 * 1. hand the file to an off-screen media element
 * 2. wait for loadedmetadata → playable, and read the duration
 * 3. on error → reject before uploading, naming the formats that work
 * ```
 *
 * This tests the question that actually matters — *can a browser play this?* — rather than trusting
 * a MIME type. An `.mp4` carrying an exotic codec passes every extension check and then fails
 * silently in front of the room.
 *
 * **Two honest limits**, both worth stating rather than hiding:
 *
 * - It verifies playability in **the browser doing the upload**. If a master authors in one browser
 *   and projects from another, the guarantee does not transfer. In practice it is the same machine.
 * - **Pre-flight cannot re-check this** (§10): it runs server-side and can only re-hash the file. So
 *   this and the main-screen preview are the two things that confirm media works, and between them
 *   they cover it end to end.
 */
export interface PlayabilityResult {
  playable: boolean
  /** Milliseconds, for audio and video. `null` for an image, which has no duration. */
  durationMs: number | null
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export async function verifyPlayable(file: File): Promise<PlayabilityResult> {
  const url = URL.createObjectURL(file)
  try {
    if (IMAGE_TYPES.includes(file.type) || file.type.startsWith('image/')) {
      return { playable: await decodesAsImage(url), durationMs: null }
    }
    return await loadsAsMedia(url, file.type.startsWith('video/') ? 'video' : 'audio')
  } finally {
    // Always: an object URL held open keeps the whole file in memory, and a master uploading a
    // 40 MB video does this repeatedly.
    URL.revokeObjectURL(url)
  }
}

function decodesAsImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(true))
    image.addEventListener('error', () => resolve(false))
    image.src = url
  })
}

/**
 * A file that answers neither way inside this is treated as not playable.
 *
 * Browsers do not promise to fire `error` for every malformed file — a truncated container can leave
 * a media element sitting there indefinitely. Without a bound the promise never settles, and what a
 * master sees is an upload button that stays disabled and never explains itself. Ten seconds is far
 * beyond how long parsing metadata off a local disk takes, so reaching it means something is wrong.
 */
const METADATA_TIMEOUT_MS = 10_000

/**
 * `loadedmetadata` is the right signal rather than `canplay`: it fires once the browser has parsed
 * enough to know the format and the duration, which is exactly the question being asked, and it does
 * not wait for buffering.
 */
function loadsAsMedia(url: string, kind: 'audio' | 'video'): Promise<PlayabilityResult> {
  return new Promise((resolve) => {
    const element = document.createElement(kind)
    element.preload = 'metadata'

    let settled = false
    const done = (result: PlayabilityResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // Releases the decoder; without it a rejected 40 MB video stays attached to a detached element.
      element.removeAttribute('src')
      element.load()
      resolve(result)
    }

    const timer = setTimeout(
      () => done({ playable: false, durationMs: null }),
      METADATA_TIMEOUT_MS,
    )

    element.addEventListener('loadedmetadata', () => {
      done({
        playable: true,
        // An unknown or infinite duration is not a failure — some streams report it late — so it is
        // recorded as absent rather than as zero.
        durationMs: Number.isFinite(element.duration)
          ? Math.round(element.duration * 1000)
          : null,
      })
    })
    element.addEventListener('error', () => done({ playable: false, durationMs: null }))

    element.src = url
  })
}
