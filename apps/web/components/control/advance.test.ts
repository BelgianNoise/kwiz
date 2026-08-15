import type {
  AdvanceSuggestion,
  MasterControlView,
  MasterQuestionDetail,
} from '@kwiz/domain'
import { describe, expect, it } from 'vitest'

import { control } from '@/lib/client/api'

import { advanceAction } from './advance'

/**
 * PRD 3 §1.1 and §13 meet in one place: the advance button.
 *
 * §13 lists ending the game among the acts a stray keystroke must never reach, and §1.1 exempts it
 * from the surface's no-dialogs rule precisely because it cannot be undone. Both were violated by
 * the first implementation — `FINISH` came back from the same generic path as `LOCK` and `REVEAL`,
 * so one click ended the game and `Enter` ended it without one.
 *
 * `advanceAction` is where that distinction now lives, and it is a pure mapping from a view to a
 * label plus a flag. **No mocks:** the real typed client is passed in, and none of its methods is
 * ever reached, because deciding what to offer must not call anything — every assertion here is
 * about the shape returned, not about what invoking it would do.
 */

const api = control('game-under-test')
const run = (): void => {
  throw new Error('advanceAction must not run a command while deciding what to offer')
}

const question = (state: MasterQuestionDetail['state']): MasterQuestionDetail => ({
  gameQuestionId: 'q1',
  prompt: 'P',
  answerMethod: 'FREE_TEXT',
  points: 10,
  state,
  timer: null,
  masterNotes: null,
  acceptedAnswers: ['yes'],
  media: [],
  teamAnswers: [],
})

const view = (over: Partial<MasterControlView>): MasterControlView => ({
  code: 'K',
  joinUrl: '',
  status: 'LIVE',
  teams: [],
  round: { id: 'r1', title: 'R', type: 'QUESTION_SET', number: 1, total: 2 },
  nextRoundId: 'r2',
  advance: null,
  attention: { kind: 'NONE' },
  question: null,
  timeline: [],
  adjustments: [],
  break: null,
  scoreboardShown: false,
  controlScreens: 1,
  finaleRanking: null,
  finishedTab: 'RESULT',
  missed: null,
  pendingValidationCount: 0,
  ...over,
})

describe('advanceAction', () => {
  it('marks FINISH irreversible and nothing else', () => {
    const finish = advanceAction(view({ advance: 'FINISH' }), api, run)
    expect(finish?.label).toBe('finishGame')
    expect(finish?.irreversible).toBe(true)

    const reversible: {
      advance: AdvanceSuggestion
      state: MasterQuestionDetail['state']
    }[] = [
      { advance: 'LOCK', state: 'OPEN' },
      { advance: 'REVEAL', state: 'LOCKED' },
      { advance: 'NEXT_ROUND', state: 'SCORED' },
    ]

    for (const { advance, state } of reversible) {
      const action = advanceAction(view({ advance, question: question(state) }), api, run)
      expect(action, advance).not.toBeNull()
      expect(action?.irreversible, advance).toBeUndefined()
    }
  })

  /**
   * The round-boundary dead end. `timeline` is the current round, and the sweep can be about an
   * earlier one — so with no unplayed question left in this round there was nothing to offer, and
   * the master was stuck on a screen §6.2 promises they never will be.
   */
  it('offers the next round when the current one has no unplayed question left', () => {
    const action = advanceAction(view({ advance: 'NEXT_ROUND', timeline: [] }), api, run)
    expect(action?.label).toBe('nextRound')
  })

  it('offers nothing at all once the game is over', () => {
    const over = view({ status: 'FINISHED', advance: 'FINISH' })
    expect(advanceAction(over, api, run)).toBeNull()
  })
})
