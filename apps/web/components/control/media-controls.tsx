'use client'

/*
 * `media-has-caption` is off in this file, and only this file.
 *
 * The rule protects a viewer who cannot hear the audio. **Nobody watches these elements**: they are
 * the master's transport controls for a clip the *room* hears through the venue's speakers (D27),
 * and the audience surface — where a caption would actually be read — is PRD 4's, which renders no
 * media element at all. A caption track we cannot author would be a `<track>` pointing at nothing.
 */
/* oxlint-disable jsx-a11y/media-has-caption */

import type { MediaRef } from '@kwiz/domain'
import { Pause, Play } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'

import { minuteSeconds } from '@/components/control/break-desk'
import { useControlKeys } from '@/components/control/keys'
import { Button } from '@/components/ui/button'

/**
 * PRD 3 §5.1 — **media playback is controlled here, never on the main screen.**
 *
 * The master has the scrub bar; the room has the speakers. Playback is always master-triggered
 * (D27), which is also PRD 1 §14's autoplay risk answered: a projector that autoplays is a projector
 * that plays the wrong thing at the wrong moment, and browsers block it half the time anyway.
 *
 * §12 — the master hears a failure on their own controls **before the room notices silence**, which
 * is what makes `[Skip this question]` a usable escape rather than a panic.
 */
export function MediaControls({
  media,
  onPlayback,
}: {
  media: MediaRef[]
  /**
   * PRD 4 §6.1 — mirror this transport to the room's equaliser and elapsed clock.
   *
   * The element stays here; only the *fact* that it is playing crosses over. Without this the
   * projector's equaliser animates whether or not anything is audible, which destroys the one
   * diagnostic §6.1 exists for: *"the equaliser going still is the 'no sound' signal."*
   */
  onPlayback: (mediaId: string, playing: boolean, positionMs: number) => void
}) {
  const t = useTranslations('control.question')
  const audible = media.filter((item) => item.kind !== 'IMAGE')

  if (audible.length === 0) {
    return (
      <div className="flex flex-wrap gap-2">
        {media.map((item) => (
          // eslint-disable-next-line @next/next/no-img-element -- a local, content-addressed file
          <img key={item.id} alt="" src={item.url} className="max-h-40 rounded-md" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs">{t('media')}</p>
      {audible.map((item) => (
        <MediaRow key={item.id} media={item} onPlayback={onPlayback} />
      ))}
    </div>
  )
}

function MediaRow({
  media,
  onPlayback,
}: {
  media: MediaRef
  onPlayback: (mediaId: string, playing: boolean, positionMs: number) => void
}) {
  const t = useTranslations('control.question')
  const element = useRef<HTMLMediaElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [failed, setFailed] = useState(false)

  /**
   * One mirror per play, pause or seek — **never on `timeupdate`**, which fires four times a second.
   *
   * The room derives its own elapsed time from an absolute instant (D52), so it needs telling when
   * playback *changes*, not where it has got to. Posting every tick would be exactly the polling D2
   * rules out, in the opposite direction.
   */
  const mirror = (next: boolean, atSeconds: number): void =>
    onPlayback(media.id, next, Math.round(atSeconds * 1000))

  const toggle = (): void => {
    const node = element.current
    if (!node) return
    if (node.paused) void node.play()
    else node.pause()
  }

  // §13 — `Space` plays and pauses. (It also passes a finale turn, but a finale question has no
  // attachments, so the two can never both be live.)
  useControlKeys((event) => {
    if (event.code !== 'Space') return false
    toggle()
    return true
  })

  const duration = media.durationMs === null ? null : media.durationMs / 1000

  return (
    <div className="flex items-center gap-3">
      <Button
        size="icon-sm"
        variant="outline"
        onClick={toggle}
        aria-label={playing ? t('pause') : t('play')}
      >
        {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
      </Button>

      {/* One ref for both, through a callback: `HTMLMediaElement` is what the controls above
          actually need, and it is the common supertype of the two tags. */}
      {media.kind === 'VIDEO' ? (
        <video
          ref={(node) => {
            element.current = node
          }}
          src={media.url}
          className="max-h-40 rounded-md"
          onError={() => setFailed(true)}
          onPause={(event) => {
            setPlaying(false)
            mirror(false, event.currentTarget.currentTime)
          }}
          onPlay={(event) => {
            setPlaying(true)
            mirror(true, event.currentTarget.currentTime)
          }}
          onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        />
      ) : (
        <audio
          ref={(node) => {
            element.current = node
          }}
          src={media.url}
          onError={() => setFailed(true)}
          onPause={(event) => {
            setPlaying(false)
            mirror(false, event.currentTarget.currentTime)
          }}
          onPlay={(event) => {
            setPlaying(true)
            mirror(true, event.currentTarget.currentTime)
          }}
          onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        />
      )}

      <input
        aria-label={media.url}
        className="min-w-0 flex-1"
        type="range"
        min={0}
        max={duration ?? 0}
        step={0.1}
        value={position}
        onChange={(event) => {
          const node = element.current
          if (!node) return
          const to = Number(event.target.value)
          node.currentTime = to
          // A scrub while playing moves the room's clock too. While paused it does not, because
          // nothing is running for it to be wrong about.
          if (!node.paused) mirror(true, to)
        }}
      />

      {/*
       * §12 — **the master sees the failure on their own controls before the room notices the
       * silence**, which is what makes `[Skip this question]` a usable escape rather than a panic.
       * The file is on this machine, so a failure here is a codec the browser will not decode —
       * exactly the case PRD 2 §7.1's upload-time playability check cannot always predict.
       */}
      {failed ? (
        <span className="text-destructive shrink-0 text-sm">{t('mediaFailed')}</span>
      ) : null}

      {/* `m:ss` — conventional for audio and video, and what every player the master has used shows
          (conventions §8.2). */}
      <span className="text-muted-foreground shrink-0 text-sm tabular-nums">
        {minuteSeconds(position)}
        {duration === null ? '' : ` / ${minuteSeconds(duration)}`}
      </span>
    </div>
  )
}
