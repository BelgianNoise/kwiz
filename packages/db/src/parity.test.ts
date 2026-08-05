import { describe, expect, it } from 'vitest'

import { SHARED_COLUMN_GROUPS, sharedColumnParity } from './parity'
import { gameQuestion } from './schema/game-copy'
import { question, quiz } from './schema/template'

/**
 * data model §7.2. **This test is the only thing standing between a routine schema change and
 * silent data loss in games**, so it is in PRD 1 §11.1's must-test set.
 */
describe('shared column parity (data model §7.2)', () => {
  it('holds for every template / game-copy pair', () => {
    expect(sharedColumnParity()).toEqual([])
  })

  it('covers all seven pairs that share a factory (§3)', () => {
    expect(SHARED_COLUMN_GROUPS.map((g) => g.name).sort()).toEqual([
      'acceptedAnswerColumns',
      'attachmentColumns',
      'categoryColumns',
      'keywordColumns',
      'optionColumns',
      'questionColumns',
      'roundColumns',
    ])
  })

  it('checks a non-trivial number of columns, not an empty list', () => {
    const total = SHARED_COLUMN_GROUPS.reduce((n, g) => n + g.shared.length, 0)
    expect(total).toBeGreaterThan(30)
  })

  /**
   * The guard has to *fail* when parity breaks, or it is decoration. `quiz` stands in for a
   * game-copy table that never received the shared columns, which is exactly the shape of the
   * failure §7.2 describes.
   */
  it('reports a column missing from the game-copy side', () => {
    const mismatches = sharedColumnParity([
      {
        name: 'questionColumns',
        shared: ['prompt', 'answerMethod'],
        template: question,
        gameCopy: quiz,
      },
    ])

    expect(mismatches).toEqual([
      { group: 'questionColumns', column: 'prompt', missingFrom: 'gameCopy' },
      { group: 'questionColumns', column: 'answerMethod', missingFrom: 'gameCopy' },
    ])
  })

  it('reports a column missing from the template side', () => {
    expect(
      sharedColumnParity([
        {
          name: 'questionColumns',
          shared: ['gameId'],
          template: question,
          gameCopy: gameQuestion,
        },
      ]),
    ).toEqual([{ group: 'questionColumns', column: 'gameId', missingFrom: 'template' }])
  })
})
