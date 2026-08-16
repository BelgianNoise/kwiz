'use client'

/**
 * PRD 5 §2.3 — **the device token, and where it lives.**
 *
 * *"Reopening the URL resumes — same team, same state, nothing to re-enter. This is what makes an
 * accidental tab close, a browser crash or a phone restart a non-event."*
 *
 * `localStorage` rather than a session cookie, because a session cookie does not survive the phone
 * being restarted — which is exactly the case this exists for. Private browsing is the known
 * exception, and there the player simply picks their team again (§2.3).
 *
 * **Keyed by game**, not globally: a phone that played last week's quiz and this week's holds two
 * tokens, and the one for the game being opened is the one that resumes. A single key would make
 * every new game a forced re-pick, or worse, resume the wrong one.
 *
 * The token is **continuity, not authentication** (PRD 1 §4). Nothing here is a secret, which is why
 * a failed read is answered by asking the player to pick a team rather than by any kind of error.
 */

const key = (gameId: string): string => `kwiz.device.${gameId}`

export function readDeviceToken(gameId: string): string | null {
  try {
    return localStorage.getItem(key(gameId))
  } catch {
    // Storage can be unavailable — private modes, a locked-down browser. Not knowing the token is
    // the same situation as never having joined, and that path already works.
    return null
  }
}

export function storeDeviceToken(gameId: string, token: string): void {
  try {
    localStorage.setItem(key(gameId), token)
  } catch {
    /*
     * The device plays fine for as long as the tab stays open — the token is held in memory by the
     * page that just joined. What is lost is *resume*, and there is nothing useful to say about that
     * to a player mid-quiz. §14's "leave this quiz" still works, because it clears what it can.
     */
  }
}

/** §14's `Leave this quiz` — the one deliberate way to sever this device's link to a game. */
export function clearDeviceToken(gameId: string): void {
  try {
    localStorage.removeItem(key(gameId))
  } catch {
    // Nothing stored, nothing to clear.
  }
}
