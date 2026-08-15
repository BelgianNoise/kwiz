'use client'

/**
 * PRD 4 §13's sound, and §4.1's arming of it.
 *
 * **Two sounds and nothing else** — a buzz and the timer expiring. Both mark an instant that nothing
 * visual can mark for someone looking at their phone (§1.1). No reveal sting, no round fanfare, no
 * correct/incorrect chime: a venue usually has its own atmosphere, decorative audio competes with it,
 * and it is the first thing a master asks to switch off.
 *
 * **Synthesised, not sampled.** *"Short and unbranded — a tone, not a jingle. This screen is in
 * someone else's pub."* A pair of oscillators says exactly that, and it keeps two binary assets out of
 * a repo whose whole deployment story is one laptop.
 *
 * `AudioContext` also *is* §4.1's arming: browsers create it suspended without a gesture, and
 * `resume()` inside a click is what actually unlocks later programmatic playback. So the same call
 * that arms is the one that can report whether arming worked — which is what §4.1's `♪ sound ready`
 * confirmation needs. A master who is going to discover a muted projector should discover it while
 * the room is still filling, not during the music round.
 */

let context: AudioContext | null = null

/**
 * PRD 2 §16's `Mute all quiz sounds`, mirrored from the pushed view.
 *
 * **Held in a module rather than passed down**, because the two callers are an effect inside a timer
 * and an effect inside a buzz list — threading a boolean through both would put a mute check in two
 * components whose job is neither. `MainScreenView.soundMuted` is the source; this is just where the
 * last value pushed lands.
 *
 * Setting it on every view is what makes the toggle work mid-quiz, which is §16's whole justification
 * for having it at all: *"hunting for OS volume mid-quiz is not acceptable."*
 */
let muted = false

export function setSoundMuted(next: boolean): void {
  muted = next
}

function isMuted(): boolean {
  return muted
}

/**
 * Unlock audio inside a user gesture. Returns whether the room will actually hear anything.
 *
 * A `false` is reported to the master rather than swallowed (§4.1): this is the one place on this
 * surface where a technical message is acceptable, because the audience is still arriving.
 */
export async function armSound(): Promise<boolean> {
  if (isMuted()) {
    // Nothing to arm, and nothing wrong. The master chose this in settings.
    return true
  }

  try {
    context ??= new AudioContext()
    /*
     * Raced against a deadline rather than simply awaited. A `resume()` that never settles would
     * leave §4.1's screen stuck on "click anywhere" with the room watching, and **there is no other
     * way out of that screen** — so a hang reports "not ready", which is both the honest answer and
     * one the master can act on by clicking again.
     */
    if (context.state === 'suspended')
      await withDeadline(context.resume(), ARM_TIMEOUT_MS)
    return context.state === 'running'
  } catch {
    return false
  }
}

/** Long enough that a slow audio device still arms, short enough that nobody in the room notices. */
const ARM_TIMEOUT_MS = 1_000

function withDeadline(promise: Promise<void>, ms: number): Promise<void> {
  return Promise.race([promise, new Promise<void>((resolve) => setTimeout(resolve, ms))])
}

/**
 * One short tone. Shaped with a gain ramp because an oscillator started and stopped raw clicks
 * audibly at the edges, which at projector volume is worse than the tone itself.
 */
function tone(frequency: number, seconds: number, type: OscillatorType): void {
  if (isMuted() || !context || context.state !== 'running') return

  const at = context.currentTime
  const oscillator = context.createOscillator()
  const gain = context.createGain()

  oscillator.type = type
  oscillator.frequency.value = frequency
  gain.gain.setValueAtTime(0, at)
  gain.gain.linearRampToValueAtTime(0.25, at + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.001, at + seconds)

  oscillator.connect(gain).connect(context.destination)
  oscillator.start(at)
  oscillator.stop(at + seconds)
}

/** A team buzzed. Marks an instant; nothing visual replaces a sound for *"right now"*. */
export function playBuzz(): void {
  tone(660, 0.18, 'square')
}

/** The countdown hit zero. Answers are closing, and the ring alone is missed by anyone not looking up. */
export function playTimerExpiry(): void {
  tone(440, 0.12, 'sine')
  // A second, lower note a moment later, so it is distinguishable from a buzz across a noisy room
  // without becoming a jingle.
  setTimeout(() => tone(330, 0.22, 'sine'), 140)
}
