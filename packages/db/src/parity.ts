import { getTableColumns, type Table } from 'drizzle-orm'

import {
  gameAcceptedAnswer,
  gameAttachment,
  gameJeopardyCategory,
  gameQuestion,
  gameQuestionKeyword,
  gameQuestionOption,
  gameRound,
} from './schema/game-copy'
import {
  acceptedAnswerColumns,
  attachmentColumns,
  categoryColumns,
  keywordColumns,
  optionColumns,
  questionColumns,
  roundColumns,
} from './schema/shared'
import {
  acceptedAnswer,
  attachment,
  jeopardyCategory,
  question,
  questionKeyword,
  questionOption,
  round,
} from './schema/template'

/**
 * data model §7.2 — **the column-parity guard.**
 *
 * The one real failure mode of the shared-factory design: someone adds a column to
 * `questionColumns()` and the *copy function* doesn't carry it, so every game created afterwards
 * silently loses that field. Silent, and only discovered when a master notices a question they
 * wrote is missing something in a game they already played.
 *
 * §3's factories make the *schema* side safe — both tables get the column automatically. This
 * checks that they really did, and gives the copy function a single list to spread rather than a
 * hand-written field list to forget one from.
 */
export interface SharedColumnGroup {
  name: string
  /** The property names the factory contributes, which both tables must carry. */
  shared: string[]
  template: Table
  gameCopy: Table
}

const columnNames = (factory: () => Record<string, unknown>): string[] =>
  Object.keys(factory()).sort()

export const SHARED_COLUMN_GROUPS: SharedColumnGroup[] = [
  {
    name: 'roundColumns',
    shared: columnNames(roundColumns),
    template: round,
    gameCopy: gameRound,
  },
  {
    name: 'categoryColumns',
    shared: columnNames(categoryColumns),
    template: jeopardyCategory,
    gameCopy: gameJeopardyCategory,
  },
  {
    name: 'questionColumns',
    shared: columnNames(questionColumns),
    template: question,
    gameCopy: gameQuestion,
  },
  {
    name: 'acceptedAnswerColumns',
    shared: columnNames(acceptedAnswerColumns),
    template: acceptedAnswer,
    gameCopy: gameAcceptedAnswer,
  },
  {
    name: 'optionColumns',
    shared: columnNames(optionColumns),
    template: questionOption,
    gameCopy: gameQuestionOption,
  },
  {
    name: 'keywordColumns',
    shared: columnNames(keywordColumns),
    template: questionKeyword,
    gameCopy: gameQuestionKeyword,
  },
  {
    name: 'attachmentColumns',
    shared: columnNames(attachmentColumns),
    template: attachment,
    gameCopy: gameAttachment,
  },
]

export interface ParityMismatch {
  group: string
  column: string
  missingFrom: 'template' | 'gameCopy'
}

/**
 * Every shared column absent from either side of a pair. An empty array is the healthy state.
 *
 * Reflects over the built tables rather than reading source, so it fails for the real reason —
 * the column is not on the table — rather than because a regex missed it.
 */
export function sharedColumnParity(
  groups: SharedColumnGroup[] = SHARED_COLUMN_GROUPS,
): ParityMismatch[] {
  const mismatches: ParityMismatch[] = []

  for (const group of groups) {
    const template = new Set(Object.keys(getTableColumns(group.template)))
    const gameCopy = new Set(Object.keys(getTableColumns(group.gameCopy)))

    for (const column of group.shared) {
      if (!template.has(column)) {
        mismatches.push({ group: group.name, column, missingFrom: 'template' })
      }
      if (!gameCopy.has(column)) {
        mismatches.push({ group: group.name, column, missingFrom: 'gameCopy' })
      }
    }
  }

  return mismatches
}
