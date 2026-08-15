import type { MediaPlayback } from '@kwiz/domain'

/**
 * PRD 4 §6.1's audio presence — **the master's transport, mirrored to the room.**
 *
 * §6.1 asks for an elapsed clock that counts up and an equaliser whose *going still* is the "no sound"
 * signal. Both need to know whether anything is playing. But the `<audio>` element is on the master's
 * desk and stays there (PRD 3 §5.1: *"media playback is controlled here, never on the main screen —
 * the master has the scrub bar; the room has the speakers"*), so the screen has no way to find out on
 * its own.
 *
 * **Ephemeral, not an event**, and the reasoning is protocol §4's own: *"if a fact is derivable, it is
 * not an event"* — and its converse, that a thing which is neither a game fact nor derivable does not
 * belong in the log either. Where a track is up to is not a game fact: it decides no score, survives no
 * useful replay, and would write a log row per play, pause and scrub. `MasterControlView.controlScreens`
 * established the same shape one slice earlier, and this is deliberately the second member of that very
 * short list rather than a new pattern.
 *
 * What it costs: a server restart mid-song loses the position. The master's own browser keeps playing —
 * the element is theirs — so the room hears music while the equaliser is still, for as long as it takes
 * them to touch the transport. That is the honest failure of the cheap option, and it is recoverable by
 * one click on a control the master already has in front of them.
 */
const playback = new Map<string, MediaPlayback>()

export function setPlayback(gameId: string, next: MediaPlayback): void {
  playback.set(gameId, next)
}

export function getPlayback(gameId: string): MediaPlayback | null {
  return playback.get(gameId) ?? null
}

/**
 * Forget a game's transport state.
 *
 * Called when a question opens, so a mirror from the previous question cannot animate an equaliser over
 * silence. The payload filter *also* drops a mirror naming another question's media — belt and braces
 * on purpose, because the two guards fail differently: this one misses if a route forgets to call it,
 * and that one misses if two questions ever share an attachment id, which content-addressed storage
 * makes entirely possible.
 */
export function clearPlayback(gameId: string): void {
  playback.delete(gameId)
}
