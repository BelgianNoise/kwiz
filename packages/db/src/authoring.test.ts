import type { ActionResult } from '@kwiz/domain'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { insertTemplateAttachment } from './attachments'
import {
  createCategory,
  createQuestion,
  createQuiz,
  createRound,
  deleteAttachment,
  deleteRound,
  duplicateQuiz,
  listQuizzes,
  moveCategory,
  moveRound,
  setAcceptedAnswers,
  setAttachmentVisibility,
  setKeywords,
  setOptions,
  setValueLadder,
  updateQuestion,
} from './authoring'
import type { KwizDatabase } from './client'
import {
  ATTACHMENT_KEYS,
  CATEGORY_KEYS,
  KEYWORD_KEYS,
  OPTION_KEYS,
  pickShared,
  QUESTION_KEYS,
  ROUND_KEYS,
} from './instantiate'
import { loadQuizTree } from './quiz-tree'
import { attachment, question, quiz } from './schema'
import { freshTestDatabase } from './test-support'

/**
 * PRD 2's authoring rules, against a real database.
 *
 * The ones worth the most here are the constraints a master would otherwise discover by building
 * something invalid: the finale's single legal position (§6.1), the value ladder governing tiles
 * (§8, O3), and `wordLengths` being computed on write (I19) rather than in a payload filter.
 */

let database: KwizDatabase
let quizId: string

/** Narrows a result to its payload, failing here rather than as `undefined` three lines later. */
function unwrap<T>(result: ActionResult<T>): T {
  if (!result.ok || result.data === undefined) {
    throw new Error(`expected a result with data, got ${JSON.stringify(result)}`)
  }
  return result.data
}

const newQuiz = (name = 'Pub Quiz #4'): string =>
  unwrap(createQuiz(database, { name })).quizId

const addRound = (
  type: 'QUESTION_SET' | 'JEOPARDY' | 'DSMTW_FINALE',
  title: string,
): string => unwrap(createRound(database, quizId, { type, title })).roundId

const titles = (): string[] =>
  loadQuizTree(database, quizId)?.rounds.map((r) => r.title) ?? []

const positions = (): number[] =>
  loadQuizTree(database, quizId)?.rounds.map((r) => r.position) ?? []

beforeEach(() => {
  database = freshTestDatabase()
  quizId = newQuiz()
})

describe('rounds', () => {
  it('appends in order, with contiguous positions (I7)', () => {
    addRound('QUESTION_SET', 'Warm-up')
    addRound('QUESTION_SET', 'Music')

    expect(titles()).toEqual(['Warm-up', 'Music'])
    expect(positions()).toEqual([0, 1])
  })

  it('renumbers after a delete, so positions never gap', () => {
    addRound('QUESTION_SET', 'One')
    const middle = addRound('QUESTION_SET', 'Two')
    addRound('QUESTION_SET', 'Three')

    deleteRound(database, middle)

    expect(titles()).toEqual(['One', 'Three'])
    expect(positions()).toEqual([0, 1])
  })
})

describe('the finale is optional, and pinned last (§6.1, I20)', () => {
  it('inserts a new round *before* an existing finale', () => {
    addRound('QUESTION_SET', 'Warm-up')
    addRound('DSMTW_FINALE', 'Finale')
    addRound('QUESTION_SET', 'Music')

    // A master with a finished quiz adding one more ordinary round gets it in the right place
    // without thinking about it — add-then-drag would be a dead end, since the drag is refused.
    expect(titles()).toEqual(['Warm-up', 'Music', 'Finale'])
    expect(positions()).toEqual([0, 1, 2])
  })

  it('refuses a second finale', () => {
    addRound('DSMTW_FINALE', 'Finale')
    expect(
      createRound(database, quizId, { type: 'DSMTW_FINALE', title: 'Another' }),
    ).toMatchObject({ ok: false, error: 'VALIDATION_ERROR' })
  })

  it('refuses to move the finale, and refuses to move anything past it', () => {
    const first = addRound('QUESTION_SET', 'Warm-up')
    const finale = addRound('DSMTW_FINALE', 'Finale')

    expect(moveRound(database, finale, 'UP')).toMatchObject({ ok: false })
    // The keyboard route must refuse identically to the drag (§15.2), or it becomes a way around
    // the rule: `Alt+↓` on the round above the finale does nothing.
    expect(moveRound(database, first, 'DOWN')).toMatchObject({ ok: true })
    expect(titles()).toEqual(['Warm-up', 'Finale'])
  })

  it('lets ordinary rounds move around each other', () => {
    const first = addRound('QUESTION_SET', 'One')
    addRound('QUESTION_SET', 'Two')
    addRound('DSMTW_FINALE', 'Finale')

    moveRound(database, first, 'DOWN')
    expect(titles()).toEqual(['Two', 'One', 'Finale'])

    // …and off the end is a no-op rather than an error, because the UI offers the control anyway.
    expect(moveRound(database, first, 'DOWN')).toMatchObject({ ok: true })
    expect(titles()).toEqual(['Two', 'One', 'Finale'])
  })

  it('allows a finale again once the old one is deleted', () => {
    const finale = addRound('DSMTW_FINALE', 'Finale')
    deleteRound(database, finale)
    expect(
      createRound(database, quizId, { type: 'DSMTW_FINALE', title: 'New finale' }),
    ).toMatchObject({ ok: true })
  })
})

describe('questions', () => {
  it('inherits the round default, and a finale question arrives ready to fill in', () => {
    const roundId = addRound('QUESTION_SET', 'Warm-up')
    createQuestion(database, roundId)

    const asked = loadQuizTree(database, quizId)?.rounds[0]?.questions[0]
    expect(asked?.answerMethod).toBe('FREE_TEXT')
    // D6: the round's default cascades rather than being typed again per question.
    expect(asked?.points).toBe(10)

    const finaleId = addRound('DSMTW_FINALE', 'Finale')
    createQuestion(database, finaleId)
    const finaleQuestion = loadQuizTree(database, quizId)?.rounds[1]?.questions[0]
    expect(finaleQuestion?.answerMethod).toBe('KEYWORDS')
    // Five slots, always (I17, §9.1) — creating four and letting pre-flight complain would be
    // inventing a broken state on purpose.
    expect(finaleQuestion?.keywords).toHaveLength(5)
  })

  it('keeps data the new answer method cannot use (§7.1)', () => {
    const roundId = addRound('QUESTION_SET', 'Warm-up')
    const questionId = unwrap(createQuestion(database, roundId)).questionId

    setAcceptedAnswers(database, questionId, ['Radiohead', 'radiohead - kid a'])
    updateQuestion(database, questionId, { answerMethod: 'MULTIPLE_CHOICE' })
    setOptions(database, questionId, [
      { text: 'Radiohead', isCorrect: true },
      { text: 'Blur', isCorrect: false },
    ])
    updateQuestion(database, questionId, { answerMethod: 'FREE_TEXT' })

    // Flipping to multiple choice and back must not have destroyed the typed answers.
    const asked = loadQuizTree(database, quizId)?.rounds[0]?.questions[0]
    expect(asked?.acceptedAnswers).toEqual(['Radiohead', 'radiohead - kid a'])
    expect(asked?.options).toHaveLength(2)
  })

  it('refuses more than one correct option, and more than four (I4)', () => {
    const roundId = addRound('QUESTION_SET', 'Warm-up')
    const questionId = unwrap(createQuestion(database, roundId)).questionId

    expect(
      setOptions(database, questionId, [
        { text: 'a', isCorrect: true },
        { text: 'b', isCorrect: true },
      ]),
    ).toMatchObject({ ok: false })

    expect(
      setOptions(
        database,
        questionId,
        Array.from({ length: 5 }, (_, index) => ({
          text: `o${index}`,
          isCorrect: index === 0,
        })),
      ),
    ).toMatchObject({ ok: false })
  })

  it('drops blank accepted answers rather than storing them', () => {
    const roundId = addRound('QUESTION_SET', 'Warm-up')
    const questionId = unwrap(createQuestion(database, roundId)).questionId

    setAcceptedAnswers(database, questionId, ['Paris', '   ', 'Paris, France'])
    // `position = 0` is the canonical answer shown at reveal, so the list must stay contiguous.
    expect(
      loadQuizTree(database, quizId)?.rounds[0]?.questions[0]?.acceptedAnswers,
    ).toEqual(['Paris', 'Paris, France'])
  })
})

describe('finale keywords', () => {
  it('stores the word shape on write (I19, D53)', () => {
    const finaleId = addRound('DSMTW_FINALE', 'Finale')
    const questionId = unwrap(createQuestion(database, finaleId)).questionId

    setKeywords(database, questionId, [
      'i like cows',
      'Thriller',
      '324 metres',
      'Bad!',
      '',
    ])

    const keywords = loadQuizTree(database, quizId)?.rounds[0]?.questions[0]?.keywords
    expect(keywords?.map((k) => k.wordLengths)).toEqual([
      [1, 4, 4],
      [8],
      [3, 6],
      // Punctuation counts as part of its word: the tile must not be narrower than the reveal.
      [4],
      // An empty slot still needs a valid shape; the question is incomplete, not malformed.
      [1],
    ])
  })

  it('insists on exactly five (I17)', () => {
    const finaleId = addRound('DSMTW_FINALE', 'Finale')
    const questionId = unwrap(createQuestion(database, finaleId)).questionId

    expect(setKeywords(database, questionId, ['one', 'two'])).toMatchObject({ ok: false })
  })
})

describe('the Jeopardy board', () => {
  it('re-values a whole row when the ladder changes (§8, O3)', () => {
    const roundId = addRound('JEOPARDY', 'Board')
    const category = unwrap(createCategory(database, roundId, 'Film')).categoryId

    // Three tiles down one column, all authored at the same value — which the ladder then governs.
    for (const row of [0, 1, 2]) {
      createQuestion(database, roundId, { categoryId: category, points: 100 + row })
    }

    setValueLadder(database, roundId, [200, 400, 600])

    // A column that does not read 200/400/600 looks broken to a room that knows the game.
    const tiles = database.db
      .select({ points: question.points })
      .from(question)
      .where(eq(question.roundId, roundId))
      .orderBy(question.position)
      .all()
    expect(tiles.map((tile) => tile.points)).toEqual([200, 400, 600])
  })

  it('refuses a ladder that is not positive whole numbers, or a non-Jeopardy round', () => {
    const board = addRound('JEOPARDY', 'Board')
    expect(setValueLadder(database, board, [])).toMatchObject({ ok: false })
    expect(setValueLadder(database, board, [100, 0])).toMatchObject({ ok: false })
    expect(setValueLadder(database, board, [100, -5])).toMatchObject({ ok: false })

    const ordinary = addRound('QUESTION_SET', 'Warm-up')
    expect(setValueLadder(database, ordinary, [100])).toMatchObject({ ok: false })
  })
})

describe('the quiz itself', () => {
  it('bumps revision and updatedAt on any descendant change (§14.2)', () => {
    const before = database.db.select().from(quiz).where(eq(quiz.id, quizId)).get()

    const roundId = addRound('QUESTION_SET', 'Warm-up')
    createQuestion(database, roundId, {}, new Date(before!.updatedAt.getTime() + 1_000))

    const after = database.db.select().from(quiz).where(eq(quiz.id, quizId)).get()
    // A schema cannot express "a descendant changed", so the repository does it — and the import
    // collision dialog compares exactly this.
    expect(after!.revision).toBeGreaterThan(before!.revision)
    expect(after!.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime())
  })

  it('duplicates the whole tree with new ids, sharing attachment files by checksum', () => {
    const roundId = addRound('QUESTION_SET', 'Warm-up')
    const questionId = unwrap(createQuestion(database, roundId)).questionId
    setAcceptedAnswers(database, questionId, ['Paris'])
    updateQuestion(database, questionId, { prompt: 'Capital of France?' })

    const copyId = unwrap(duplicateQuiz(database, quizId)).quizId
    const copy = loadQuizTree(database, copyId)

    expect(copy?.name).toBe('Pub Quiz #4 (copy)')
    expect(copy?.rounds[0]?.questions[0]?.prompt).toBe('Capital of France?')
    expect(copy?.rounds[0]?.questions[0]?.acceptedAnswers).toEqual(['Paris'])
    // New ids throughout, so the copy can be edited without touching the original.
    expect(copy?.rounds[0]?.id).not.toBe(roundId)
    expect(copy?.rounds[0]?.questions[0]?.id).not.toBe(questionId)
  })

  /**
   * The completeness guarantee data model §7.2 asks for, restated as a behavioural test rather
   * than trusted to the implementation alone: **every** shared column — one representative row per
   * group, each field set to something distinctive — survives `duplicateQuiz` unchanged.
   *
   * `duplicateQuiz` moves these columns via `pickShared`/the same key lists `instantiate.ts`'s
   * template→game-copy path uses (data model §7's other copy), rather than a hand-written field
   * list of its own — which is what let a column added to a shared factory be silently missing
   * from a duplicated quiz's rows before. This test protects the *behaviour*, so it still catches
   * a regression if that ever reverts to a hand-written list.
   */
  it('carries every shared column of every copied row, not a hand-picked subset', () => {
    // A JEOPARDY round exercises the category group, and its default BUZZER question carries an
    // attachment — left as BUZZER rather than switched, since a tile's method is D34's fixed fact.
    const boardRoundId = addRound('JEOPARDY', 'Board Round')
    const categoryId = unwrap(
      createCategory(database, boardRoundId, 'Distinctive Category'),
    ).categoryId
    const tileId = unwrap(
      createQuestion(database, boardRoundId, { categoryId, points: 150 }),
    ).questionId
    updateQuestion(database, tileId, {
      prompt: 'A distinctive prompt',
      timerMs: 45_000,
      masterNotes: 'A distinctive note',
    })
    const attachmentId = insertTemplateAttachment(database, {
      questionId: tileId,
      kind: 'IMAGE',
      mimeType: 'image/png',
      originalName: 'distinctive.png',
      ext: 'png',
      sizeBytes: 123_456,
      checksum: 'a'.repeat(64),
    })
    if (!attachmentId) throw new Error('expected an attachment id')
    setAttachmentVisibility(database, attachmentId, true)

    // A QUESTION_SET round exercises the options group, which JEOPARDY's fixed BUZZER cannot.
    const mcRoundId = addRound('QUESTION_SET', 'MC Round')
    const mcQuestionId = unwrap(createQuestion(database, mcRoundId)).questionId
    updateQuestion(database, mcQuestionId, { answerMethod: 'MULTIPLE_CHOICE' })
    setOptions(database, mcQuestionId, [
      { text: 'Option Alpha', isCorrect: true },
      { text: 'Option Beta', isCorrect: false },
    ])

    const finaleRoundId = addRound('DSMTW_FINALE', 'Finale')
    const finaleQuestionId = unwrap(createQuestion(database, finaleRoundId)).questionId
    setKeywords(database, finaleQuestionId, [
      'a distinctive keyword',
      'two',
      'three',
      'four',
      'five',
    ])

    const copyId = unwrap(duplicateQuiz(database, quizId)).quizId

    // Read every group's rows on both sides by their tree shape, matched by title/type rather than
    // id — new ids are the whole point of a duplicate, so they cannot be the match key here.
    const rowsFor = (targetQuizId: string) => {
      const tree = loadQuizTree(database, targetQuizId)
      const board = tree?.rounds.find((r) => r.title === 'Board Round')
      const mcRound = tree?.rounds.find((r) => r.title === 'MC Round')
      const finale = tree?.rounds.find((r) => r.type === 'DSMTW_FINALE')
      return {
        round: board,
        category: board?.categories[0],
        question: board?.questions[0],
        attachment: board?.questions[0]?.media[0],
        option: mcRound?.questions[0]?.options[0],
        keyword: finale?.questions[0]?.keywords[0],
      }
    }

    const source = rowsFor(quizId)
    const copy = rowsFor(copyId)

    expect(source.round).toBeDefined()
    expect(pickShared(copy.round!, ROUND_KEYS)).toEqual(
      pickShared(source.round!, ROUND_KEYS),
    )
    expect(pickShared(copy.category!, CATEGORY_KEYS)).toEqual(
      pickShared(source.category!, CATEGORY_KEYS),
    )
    expect(pickShared(copy.question!, QUESTION_KEYS)).toEqual(
      pickShared(source.question!, QUESTION_KEYS),
    )
    expect(pickShared(copy.option!, OPTION_KEYS)).toEqual(
      pickShared(source.option!, OPTION_KEYS),
    )
    expect(pickShared(copy.keyword!, KEYWORD_KEYS)).toEqual(
      pickShared(source.keyword!, KEYWORD_KEYS),
    )
    // `ATTACHMENT_KEYS` includes `checksum`/`mimeType`/`ext`, which `MediaContent` (the tree shape)
    // deliberately does not carry (packages/domain) — those three are excluded here for the same
    // reason `copyAttachments` reads the raw row rather than the tree, and are covered instead by
    // the checksum-sharing assertion below.
    const mediaKeys = [
      'position',
      'kind',
      'durationMs',
      'showOnPlayerDevices',
      'originalName',
      'sizeBytes',
    ] as const satisfies readonly (typeof ATTACHMENT_KEYS)[number][]
    expect(pickShared(copy.attachment!, mediaKeys)).toEqual(
      pickShared(source.attachment!, mediaKeys),
    )
    // The one column intentionally excluded from `MediaContent` that still has to match: the file
    // is shared by content hash, which is the entire reason duplicating a quiz with 2 GB of video
    // costs nothing (data model §8).
    const rawChecksum = (id: string) =>
      database.db
        .select({ checksum: attachment.checksum })
        .from(attachment)
        .where(eq(attachment.id, id))
        .get()?.checksum
    expect(rawChecksum(copy.attachment!.id)).toBe(rawChecksum(source.attachment!.id))
  })

  it('lists what the dashboard shows, newest first', () => {
    const roundId = addRound('QUESTION_SET', 'Warm-up')
    createQuestion(database, roundId)
    createQuestion(database, roundId)
    newQuiz('Christmas Special')

    const listed = listQuizzes(database)
    expect(listed.map((entry) => entry.name)).toEqual([
      'Christmas Special',
      'Pub Quiz #4',
    ])
    expect(listed.find((entry) => entry.name === 'Pub Quiz #4')).toMatchObject({
      rounds: 1,
      questions: 2,
    })
  })
})

describe('jeopardy categories', () => {
  /**
   * §8 — column order is what the room reads left to right, so it is authored rather than incidental.
   * A swap with the neighbour, because `position` is explicit and contiguous (I7).
   */
  it('moves a column left and right, and no-ops at the ends', () => {
    const roundId = addRound('JEOPARDY', 'Board')

    const names = ['Geography', 'Film', 'Music']
    const ids = names.map(
      (name) => unwrap(createCategory(database, roundId, name)).categoryId,
    )

    const order = (): string[] =>
      loadQuizTree(database, quizId)
        ?.rounds.find((r) => r.id === roundId)
        ?.categories.map((category) => category.name) ?? []

    expect(order()).toEqual(names)

    moveCategory(database, ids[2] ?? '', 'LEFT')
    expect(order()).toEqual(['Geography', 'Music', 'Film'])

    moveCategory(database, ids[2] ?? '', 'RIGHT')
    expect(order()).toEqual(names)

    // Off the end is a no-op rather than an error — the UI offers the control at the ends anyway.
    expect(moveCategory(database, ids[0] ?? '', 'LEFT')).toMatchObject({ ok: true })
    expect(order()).toEqual(names)
  })
})

/**
 * Code review — `setAttachmentVisibility` and `deleteAttachment` were exercised only
 * incidentally, as one step inside a much bigger `duplicateQuiz` test, never on their own terms.
 */
describe('attachments', () => {
  const addAttachment = (
    over: Partial<Parameters<typeof insertTemplateAttachment>[1]> = {},
  ): string => {
    const roundId = addRound('QUESTION_SET', 'Round')
    const questionId = unwrap(createQuestion(database, roundId)).questionId
    const id = insertTemplateAttachment(database, {
      questionId,
      kind: 'IMAGE',
      mimeType: 'image/png',
      originalName: 'photo.png',
      ext: 'png',
      sizeBytes: 1_024,
      checksum: 'a'.repeat(64),
      ...over,
    })
    if (!id) throw new Error('expected an attachment id')
    return id
  }

  describe('setAttachmentVisibility', () => {
    it('toggles an image on and off', () => {
      const id = addAttachment()
      expect(setAttachmentVisibility(database, id, true)).toMatchObject({ ok: true })
      expect(
        database.db.select().from(attachment).where(eq(attachment.id, id)).get()
          ?.showOnPlayerDevices,
      ).toBe(true)

      expect(setAttachmentVisibility(database, id, false)).toMatchObject({ ok: true })
      expect(
        database.db.select().from(attachment).where(eq(attachment.id, id)).get()
          ?.showOnPlayerDevices,
      ).toBe(false)
    })

    it('refuses to show audio on player devices (D27, I3)', () => {
      const id = addAttachment({
        kind: 'AUDIO',
        mimeType: 'audio/mpeg',
        originalName: 'clip.mp3',
        ext: 'mp3',
      })
      expect(setAttachmentVisibility(database, id, true)).toMatchObject({
        ok: false,
        error: 'VALIDATION_ERROR',
      })
      // Turning it back off is never the refused direction.
      expect(setAttachmentVisibility(database, id, false)).toMatchObject({ ok: true })
    })

    it('refuses to show video on player devices (D27, I3)', () => {
      const id = addAttachment({
        kind: 'VIDEO',
        mimeType: 'video/mp4',
        originalName: 'clip.mp4',
        ext: 'mp4',
      })
      expect(setAttachmentVisibility(database, id, true)).toMatchObject({
        ok: false,
        error: 'VALIDATION_ERROR',
      })
    })

    it('refuses an unknown attachment', () => {
      expect(setAttachmentVisibility(database, 'nope', true)).toMatchObject({
        ok: false,
        error: 'VALIDATION_ERROR',
      })
    })
  })

  describe('deleteAttachment', () => {
    it('removes the row', () => {
      const id = addAttachment()
      expect(deleteAttachment(database, id)).toMatchObject({ ok: true })
      expect(
        database.db.select().from(attachment).where(eq(attachment.id, id)).all(),
      ).toHaveLength(0)
    })

    it('is a no-op rather than an error for an attachment that is already gone', () => {
      expect(deleteAttachment(database, 'nope')).toMatchObject({ ok: true })
    })

    it('touches the quiz, so autosave and revision tracking see the change', () => {
      const id = addAttachment()
      const before = database.db
        .select()
        .from(quiz)
        .where(eq(quiz.id, quizId))
        .get()?.revision
      deleteAttachment(database, id)
      const after = database.db
        .select()
        .from(quiz)
        .where(eq(quiz.id, quizId))
        .get()?.revision
      expect(after).toBeGreaterThan(before ?? 0)
    })
  })
})
