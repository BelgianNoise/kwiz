'use client'

import type { QuestionContent } from '@kwiz/domain'
import { Check, FileAudio, FileVideo, Image as ImageIcon, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/client/api'
import { formatBytes } from '@/lib/client/format'
import { verifyPlayable } from '@/lib/client/verify-playable'

/**
 * PRD 2 §7.1's attachment list, and the O6 upload flow.
 *
 * **Nothing is uploaded until the browser has played it.** The rejection message names the formats
 * that work, because "unsupported file" tells a master nothing they can act on — and there is
 * deliberately **no transcoding** (§7.1): bundling ffmpeg to re-encode a pub quiz's media is a large
 * per-platform dependency and a whole class of failure states, for a problem a master solves by
 * exporting differently.
 */
export function AttachmentList({
  question,
  onChanged,
}: {
  question: QuestionContent
  onChanged: () => void
}) {
  const t = useTranslations('admin.question')
  const errors = useTranslations('errors')
  const input = useRef<HTMLInputElement>(null)

  const [checking, setChecking] = useState(false)
  const [rejected, setRejected] = useState<string | undefined>()

  const upload = async (file: File): Promise<void> => {
    setRejected(undefined)
    setChecking(true)

    const verdict = await verifyPlayable(file)
    if (!verdict.playable) {
      setChecking(false)
      // The one thing a master can act on: which formats do work (conventions §7).
      setRejected(errors('ATTACHMENT_REJECTED'))
      return
    }

    const result = await api.uploadAttachment(question.id, file)
    setChecking(false)
    if (result.ok) onChanged()
    else setRejected(errors('ATTACHMENT_REJECTED'))
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>{t('attachments')}</Label>
        <Button variant="secondary" size="sm" onClick={() => input.current?.click()}>
          {t('addAttachment')}
        </Button>
        <input
          ref={input}
          type="file"
          className="hidden"
          // The cheap first gate (conventions §7); the real one is `verifyPlayable` above.
          accept="image/jpeg,image/png,image/webp,image/gif,audio/mpeg,audio/mp4,audio/aac,audio/ogg,audio/wav,video/mp4,video/webm"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void upload(file)
          }}
        />
      </div>

      {checking ? <p className="text-muted-foreground text-sm">{t('checking')}</p> : null}
      {rejected ? (
        <p role="alert" className="text-destructive text-sm">
          {rejected}
        </p>
      ) : null}

      {/* §15.2 — the fifth designed empty state. The button above is the action; this says why. */}
      {question.media.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('emptyAttachments')}</p>
      ) : (
        <ul className="divide-border border-border divide-y rounded-lg border">
          {question.media.map((media) => (
            <li key={media.id} className="flex items-center gap-3 p-3">
              <span className="text-muted-foreground" aria-hidden>
                {media.kind === 'IMAGE' ? (
                  <ImageIcon className="size-4" />
                ) : media.kind === 'VIDEO' ? (
                  <FileVideo className="size-4" />
                ) : (
                  <FileAudio className="size-4" />
                )}
              </span>

              {/* §7.1's row: the master's own filename, its size, and how long it runs. */}
              <span className="min-w-0 flex-1 text-sm">
                <span className="block truncate">{media.originalName}</span>
                <span className="text-muted-foreground block text-xs">
                  {formatBytes(media.sizeBytes)}
                  {media.durationMs === null
                    ? ''
                    : ` · ${formatDuration(media.durationMs)}`}
                </span>
              </span>

              {/*
                §7.1's `▶`. Playability was verified at upload (O6), but that was a headless media
                element — this is the master hearing the clip is the *right* clip, which no automatic
                check can answer. `preload="none"` so opening a question with four tracks does not
                fetch four files.
              */}
              {media.kind === 'AUDIO' ? (
                /*
                  No `<track>`: this is the master privately checking a clip is the *right* clip, not
                  media presenting information to an audience. A caption track would have to be
                  invented, and an empty one claims captions exist where none do.
                */
                // oxlint-disable-next-line jsx-a11y/media-has-caption
                <audio
                  controls
                  preload="none"
                  src={`/api/attachment/${media.id}`}
                  className="h-8"
                />
              ) : null}

              <span className="text-muted-foreground flex items-center gap-1 text-sm">
                <Check className="size-3" />
                {t('playable')}
              </span>

              {/*
                D27 / I3 — only an image can be pushed to phones. Audio and video are main-screen
                only, and not configurable: twenty phones playing the same song a fraction of a
                second apart is the failure that rule prevents.
              */}
              {media.kind === 'IMAGE' ? (
                <span className="flex items-center gap-2">
                  <Checkbox
                    id={`show-${media.id}`}
                    defaultChecked={media.showOnPlayerDevices}
                    onCheckedChange={(checked) => {
                      void api
                        .setAttachmentVisibility(media.id, checked === true)
                        .then(onChanged)
                    }}
                  />
                  <Label htmlFor={`show-${media.id}`} className="text-sm font-normal">
                    {t('showOnPlayers')}
                  </Label>
                </span>
              ) : null}

              <Button
                variant="ghost"
                size="icon"
                aria-label={t('deleteAttachment')}
                onClick={() => {
                  void api.deleteAttachment(media.id).then(onChanged)
                }}
              >
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {question.media.some((media) => media.kind === 'IMAGE') ? (
        <p className="text-muted-foreground text-sm">{t('showOnPlayersHint')}</p>
      ) : null}
    </section>
  )
}

/** conventions §8.2 — media duration is `m:ss`, the convention every player a master has used. */
function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
