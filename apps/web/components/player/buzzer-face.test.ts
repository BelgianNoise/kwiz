import { describe, expect, it } from 'vitest'

import { buzzerFace } from '@/components/player/buzzer-face'

const ME = 'us'
const THEM = 'them'

const face = (over: Partial<Parameters<typeof buzzerFace>[0]> = {}) =>
  buzzerFace({
    lockedOut: false,
    live: true,
    holderTeamId: null,
    myTeamId: ME,
    tapped: false,
    ...over,
  })

describe('§8 what the buzzer shows', () => {
  it('is armed while the buzzers are live and nobody holds it', () => {
    expect(face()).toBe('ARMED')
  })

  it('is idle when the buzzers are not live and nobody holds it', () => {
    expect(face({ live: false })).toBe('IDLE')
  })

  it('says buzzed the moment we tap, before the server answers', () => {
    expect(face({ tapped: true })).toBe('BUZZED')
  })

  it('shows the lockout above everything else (D35)', () => {
    expect(face({ lockedOut: true, holderTeamId: ME, tapped: true })).toBe('LOCKED_OUT')
  })

  /*
   * The three the old component got wrong. Each is an ordinary game: any buzzer question with more
   * than two teams, or any team playing on the two phones D45 exists for.
   */
  describe('the server’s answer, not this device’s memory of tapping', () => {
    it('tells every device on the winning team it is in — including one that never tapped', () => {
      expect(face({ holderTeamId: ME, tapped: true, live: false })).toBe('WE_HAVE_IT')
      expect(face({ holderTeamId: ME, tapped: false, live: false })).toBe('WE_HAVE_IT')
    })

    it('tells a device that tapped and lost that it was beaten', () => {
      expect(face({ holderTeamId: THEM, tapped: true, live: false })).toBe('BEATEN')
    })

    it('tells a team that never buzzed who has it', () => {
      expect(face({ holderTeamId: THEM, tapped: false, live: false })).toBe('BEATEN')
    })
  })

  /**
   * D35's loop, walked as a team that is **not** the one buzzing. The old code left this team on a
   * static outcome screen for the rest of the question, because "who buzzed first" never went back
   * to `null` — so the mechanic that exists to give them a turn silently never did.
   */
  it('re-arms a bystander team after a denial reopens the buzzers', () => {
    // Another team buzzes and is being adjudicated.
    expect(face({ holderTeamId: THEM, live: false })).toBe('BEATEN')
    // Denied: the buzzers reopen and nobody holds it. Our button must come back.
    expect(face({ holderTeamId: null, live: true })).toBe('ARMED')
    // We buzz this time, and win it.
    expect(face({ holderTeamId: ME, live: false, tapped: true })).toBe('WE_HAVE_IT')
  })

  it('re-arms after a force-reopen too, which clears the lockout as well (D35 rule 5)', () => {
    expect(face({ lockedOut: true, live: false })).toBe('LOCKED_OUT')
    expect(face({ lockedOut: false, live: true, holderTeamId: null })).toBe('ARMED')
  })

  it('treats an absent holder the same as a null one — the field is optional on the wire', () => {
    expect(face({ holderTeamId: undefined })).toBe('ARMED')
  })
})
