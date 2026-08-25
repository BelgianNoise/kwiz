import { expect, test, type Page } from '@playwright/test'

import { testDb } from '../support/db'
import { en, fill, pastFirstRun } from '../support/flows'
import { pngBytes, wavBytes } from '../support/media'
import { addFreeText, addUnanswered, newQuestionSetRound, newQuiz } from '../support/quiz'

/**
 * Build-order slice 9, **Authoring & portability** ” scenarios 1, 2 and 4.
 *
 * These are the exception to the suite's third determinism rule: here the authoring UI *is* what
 * is under test, so quizzes are built through it rather than around it. Scenario 3 ” export,
 * wipe, import ” lives in `portability.spec.ts`, because it owns a server of its own and would
 * otherwise hold this file's worker for the length of two server boots.
 */

const a = en.admin
const common = en.common

/** The dashboard's quiz rows, by name ” every scenario here starts or ends by counting these. */
function quizRow(page: Page, name: string) {
  return page.getByRole('listitem').filter({ hasText: name })
}

/**
 * Creates a quiz through the dashboard dialog and waits for the editor it opens. Returns to the
 * caller on `/admin/quizzes/:id`, so every scenario starts from where a master actually is.
 */
async function createQuizThroughUi(page: Page, name: string): Promise<void> {
  await page.goto('/en/admin')
  await pastFirstRun(page)
  await page.getByRole('button', { name: a.dashboard.newQuiz }).click()
  await page.getByLabel(a.dashboard.newQuizLabel).fill(name)
  await page.getByRole('dialog').getByRole('button', { name: common.create }).click()
  await expect(page).toHaveURL(/\/admin\/quizzes\/[0-9a-f-]+$/)
}

/** Adds one round through §6's type-and-title-only dialog. */
async function addRound(
  page: Page,
  type: keyof typeof a.quiz.type,
  title: string,
): Promise<void> {
  await page.getByRole('button', { name: a.quiz.addRound }).click()
  await page.getByRole('radio', { name: a.quiz.type[type] }).check()
  await page.getByLabel(a.quiz.roundTitleLabel).fill(title)
  await page.getByRole('dialog').getByRole('button', { name: common.add }).click()
  await expect(quizRow(page, title)).toBeVisible()
}

/**
 * Fills one board tile through the shared question sheet, and does not move on until the tile
 * itself says it is ready.
 *
 * **The persistence gate is load-bearing, not decorative.** Every field in the sheet autosaves
 * on a ~600 ms debounce (`use-autosave`), and its cleanup *cancels* a save still pending when the
 * sheet unmounts ” so a test that fills and Escapes too fast silently loses the answer. The wait
 * is therefore on the server (same discipline as `expectPersisted` above), and the tile's own ✓
 * is the visible confirmation of exactly that round trip.
 */
async function fillTile(
  page: Page,
  cell: ReturnType<Page['locator']>,
  quizId: string,
  prompt: string,
  answer: string,
): Promise<void> {
  await cell.click()
  const sheet = page.getByRole('dialog')
  // A click can land while a refresh is replacing the grid; the sheet proves which node won.
  await expect(sheet).toBeVisible({ timeout: 10_000 })
  await sheet.getByLabel(a.question.prompt).fill(prompt)
  await sheet.getByLabel(a.question.correctAnswer).fill(answer)
  await expect
    .poll(
      async () => {
        try {
          const response = await page.request.get(`/api/quizzes/${quizId}`)
          const parsed = (await response.json()) as {
            data?: {
              rounds: { questions: { prompt: string; acceptedAnswers: string[] }[] }[]
            }
          }
          return (parsed.data?.rounds ?? []).some((round) =>
            round.questions.some(
              (question) =>
                question.prompt === prompt && question.acceptedAnswers[0] === answer,
            ),
          )
        } catch {
          return false
        }
      },
      { timeout: 30_000, message: `tile "${prompt}" saved` },
    )
    .toBe(true)
  await sheet.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(cell.locator('.lucide-check')).toBeVisible({ timeout: 15_000 })
}

/**
 * Scenario 1 ” *"Author a quiz with all four answer methods, an image and an audio attachment,
 * and a 5×5 Jeopardy round."*
 *
 * The whole of PRD 2 in one journey, which is the point: a master does not experience the editor
 * as separate features, they walk it once from an empty dashboard to a playable quiz. Every answer
 * method gets its §7.2 section exercised, both attachment kinds go through O6's real upload gate,
 * and the board is built as a board ” five columns filled cell by cell.
 */
test('1 ” a whole quiz authored through the UI', async ({ page }) => {
  test.setTimeout(120_000)

  await createQuizThroughUi(page, 'E2E Authored')
  const quizId = new URL(page.url()).pathname.split('/').at(-1)!
  await addRound(page, 'QUESTION_SET', 'General')

  /*
   * **Waiting for the server, not for the sheet.** Every field autosaves on a ~600 ms debounce,
   * and only the prompt's indicator is visible ” so "did it save?" is read from the quiz API,
   * which is also what makes stepping to the next question safe: closing the sheet cancels a
   * pending debounce, and a cancelled save is a silently wrong fixture.
   */
  const serverQuiz = async (): Promise<{
    rounds: {
      questions: {
        prompt: string
        answerMethod: string
        acceptedAnswers: string[]
        options: { text: string; isCorrect: boolean }[]
        config: Record<string, unknown>
        media: unknown[]
      }[]
    }[]
  }> => {
    const response = await page.request.get(`/api/quizzes/${quizId}`)
    const parsed = (await response.json()) as { data?: unknown }
    // The envelope is `{ ok, data }` ” the predicates read the quiz itself, not the wrapper.
    return (parsed.data ?? null) as Awaited<ReturnType<typeof serverQuiz>>
  }
  const expectPersisted = async (
    description: string,
    predicate: (quiz: Awaited<ReturnType<typeof serverQuiz>>) => boolean,
  ): Promise<void> => {
    await expect
      .poll(
        async () => {
          try {
            return predicate(await serverQuiz())
          } catch {
            return false
          }
        },
        { timeout: 15_000, message: description },
      )
      .toBe(true)
  }

  // --  the round: one question per answer method
  await quizRow(page, 'General').getByRole('link', { name: a.quiz.openRound }).click()

  await page.getByRole('button', { name: a.round.addQuestion }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()

  // Q1 ” free text, with both attachments on it.
  await sheet.getByLabel(a.question.prompt).fill('Capital of France?')
  await sheet.getByLabel(a.question.correctAnswer).fill('paris')

  const fileInput = sheet.locator('input[type="file"]')
  await fileInput.setInputFiles({
    name: 'poster.png',
    mimeType: 'image/png',
    buffer: pngBytes(),
  })
  // The audio file passes the same gate ” decoded by a real media element before upload (O6).
  await fileInput.setInputFiles({
    name: 'theme.wav',
    mimeType: 'audio/wav',
    buffer: wavBytes(),
  })
  await expect(sheet.getByText('theme.wav')).toBeVisible()
  // Both rows carry the ✓-with-words verdict of O6's in-browser check.
  await expect(sheet.getByText(a.question.playable)).toHaveCount(2)
  await expectPersisted('q1 prompt and answer saved', (quiz) => {
    const q = quiz.rounds[0]?.questions[0]
    return q?.prompt === 'Capital of France?' && q.acceptedAnswers[0] === 'paris'
  })
  await expectPersisted('q1 has both attachments', (quiz) => {
    return quiz.rounds[0]?.questions[0]?.media.length === 2
  })
  // The sheet is modal: it has to close before the list header's own controls are reachable.
  await sheet.press('Escape')
  await expect(sheet).toBeHidden()

  // Q2 ” multiple choice: exactly one correct option, chosen structurally (I4).
  await page.getByRole('button', { name: a.round.addQuestion }).click()
  await sheet.getByLabel(a.question.prompt).fill('Which is a fruit?')
  await sheet.getByRole('radio', { name: a.question.method.MULTIPLE_CHOICE }).check()
  await expect(
    sheet.getByRole('radio', { name: `${a.question.correctAnswer} 1` }),
  ).toBeVisible()
  // The delete button beside each input shares its accessible name, so the field is addressed
  // as the textbox it is.
  await sheet.getByRole('textbox', { name: `${a.question.options} 1` }).fill('Tomato')
  await sheet.getByRole('textbox', { name: `${a.question.options} 2` }).fill('Anvil')
  await sheet.getByLabel(`${a.question.correctAnswer} 1`).check()
  await expectPersisted('q2 saved as multiple choice', (quiz) => {
    const q = quiz.rounds[0]?.questions[1]
    return (
      q?.prompt === 'Which is a fruit?' &&
      q.answerMethod === 'MULTIPLE_CHOICE' &&
      q.options.length === 2 &&
      q.options[0]?.text === 'Tomato' &&
      q.options[0]?.isCorrect === true &&
      q.options[1]?.text === 'Anvil' &&
      q.options[1]?.isCorrect === false
    )
  })
  await sheet.press('Escape')
  await expect(sheet).toBeHidden()

  // Q3 ” buzzer: same answer shape, minus the alternatives (§7.2).
  await page.getByRole('button', { name: a.round.addQuestion }).click()
  await sheet.getByLabel(a.question.prompt).fill('Name this tune')
  await sheet.getByRole('radio', { name: a.question.method.BUZZER }).check()
  await expect(sheet.getByText(a.question.buzzerNote)).toBeVisible()
  await sheet.getByLabel(a.question.correctAnswer).fill('creep')
  await expectPersisted('q3 saved as buzzer', (quiz) => {
    const q = quiz.rounds[0]?.questions[2]
    return (
      q?.prompt === 'Name this tune' &&
      q.answerMethod === 'BUZZER' &&
      q.acceptedAnswers[0] === 'creep'
    )
  })
  await sheet.press('Escape')
  await expect(sheet).toBeHidden()

  // Q4 ” do / challenge: scoring arrives with defaults stated as controls (D24).
  await page.getByRole('button', { name: a.round.addQuestion }).click()
  await sheet.getByLabel(a.question.prompt).fill('Build the tallest tower')
  await sheet.getByRole('radio', { name: a.question.method.DO }).check()
  await expect(
    sheet.getByRole('radio', { name: a.question.scoringMode.WINNER_TAKES_ALL }),
  ).toBeChecked()
  await expectPersisted('q4 saved as do', (quiz) => {
    const q = quiz.rounds[0]?.questions[3]
    return (
      q?.prompt === 'Build the tallest tower' &&
      q.answerMethod === 'DO' &&
      q.config['scoringMode'] === 'WINNER_TAKES_ALL'
    )
  })

  await sheet.press('Escape')
  await expect(sheet).toBeHidden()

  // All four rows read ready - nothing left half-typed (section 7's readiness markers). The
  // predicates above each include the prompt: Escape cancels a save still inside the debounce
  // window, and a cancelled prompt save leaves an incomplete row that can never turn Ready.
  // CI caught exactly that for Q4.
  for (const prompt of [
    'Capital of France?',
    'Which is a fruit?',
    'Name this tune',
    'Build the tallest tower',
  ]) {
    await expect(quizRow(page, prompt).getByLabel(a.round.ready)).toBeVisible({
      timeout: 15_000,
    })
  }

  // --  the board: five categories, twenty-five tiles, filled as a grid
  await page.getByRole('link', { name: a.round.backToQuiz }).click()
  await addRound(page, 'JEOPARDY', 'Board')
  await quizRow(page, 'Board').getByRole('link', { name: a.quiz.openRound }).click()

  for (const category of ['Geography', 'Film', 'Music', 'Sport', 'Random']) {
    // Retried as one unit: under load the create POST can be refused by the database
    // (`createCategory`'s result is intentionally fire-and-forget in the UI), and the only
    // observable "it worked" is the column header existing.
    await expect(async () => {
      const exists = await page
        .locator('main')
        .getByText(category, { exact: true })
        .isVisible()
        .catch(() => false)
      if (!exists) {
        await page.getByRole('button', { name: a.board.addCategory }).click()
        await page.getByLabel(a.board.categoryName).fill(category)
        await page.getByRole('dialog').getByRole('button', { name: common.add }).click()
        await expect(
          page.locator('main').getByText(category, { exact: true }),
        ).toBeVisible({
          timeout: 2_000,
        })
      }
    }).toPass({ timeout: 30_000 })
  }

  // The default ladder is already 100–500, so the board is 5×5 the moment the columns exist.
  // Cells are addressed by position ” column order is category order, row order is ladder order ”
  // because that is how the grid itself is laid out (§8).
  const cells = page.locator('.grid.min-w-fit > button')
  for (const [column, category] of [
    'Geography',
    'Film',
    'Music',
    'Sport',
    'Random',
  ].entries()) {
    for (const [row, value] of [100, 200, 300, 400, 500].entries()) {
      const plus = page.getByRole('button', {
        name: `${a.board.addTile} ${category} ${value}`,
      })
      const cell = cells.nth(row * 5 + column)
      /*
       * The click and the refresh it causes race each other: a refresh from the *previous*
       * tile's save can re-render the grid mid-click, the dispatched click lands on a detached
       * node, and no tile is created. So click-and-verify as one retried unit ” if the `+` is
       * still there after a beat, click it again.
       */
      await expect(async () => {
        if (await plus.isVisible().catch(() => false)) await plus.click()
        await expect(cell).not.toHaveClass(/border-dashed/, { timeout: 2_000 })
      }).toPass({ timeout: 20_000 })
      await fillTile(
        page,
        cell,
        quizId,
        `${category} for ${value}`,
        `${category}-${value}`,
      )
    }
  }

  // A full, ready board has no `+` cells and no warning counters (§8).
  await expect(page.getByRole('button', { name: /^Add a tile/ })).toHaveCount(0)
  await expect(page.locator('.text-destructive')).toHaveCount(0)

  // Back on the quiz: both rounds listed with their computed totals (§6).
  // The board page's back link is the generic `Back`, not the round editor's `Quiz`.
  await page.getByRole('link', { name: common.back }).click()
  await expect(quizRow(page, 'General')).toContainText('4 questions')
  await expect(quizRow(page, 'Board')).toContainText('25 questions')
})

/**
 * Scenario 2 ” *"Pre-flight catches a deliberately broken question; fixing it clears the error."*
 *
 * The broken question is broken the most ordinary way: written but never given a correct answer.
 * Pre-flight's job is to find that *before* the room does (§10), and every finding links to where
 * it lives ” `[Fix]` is a single click back to the round.
 */
test('2 ” pre-flight catches a missing correct answer, and fixing it clears the error', async ({
  page,
}) => {
  const db = testDb()
  const quizId = newQuiz(db, 'Preflight Demo')
  const roundId = newQuestionSetRound(db, quizId, 'Round one')
  addUnanswered(db, roundId, 'Capital of Portugal?')

  await page.goto(`/en/admin/quizzes/${quizId}/play`)

  // The report names the problem in words, at the place it belongs to (§10).
  await expect(
    page.getByRole('heading', {
      name: fill(a.preflight.heading, { name: 'Preflight Demo' }),
    }),
  ).toBeVisible()
  const problem = page.getByText(a.preflight.code.NO_ACCEPTED_ANSWER)
  await expect(problem).toBeVisible()

  // `[Fix]` goes to the round; the question row opens the sheet.
  await page.getByRole('link', { name: a.preflight.fix }).first().click()
  await quizRow(page, 'Capital of Portugal?').first().click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  await sheet.getByLabel(a.question.correctAnswer).fill('lisbon')
  // The save is debounced and invisible in the sheet (only the prompt has an indicator), so the
  // wait is on the server: the finding must actually be gone before the trip back to Check.
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/quizzes/${quizId}`)
        const { data } = (await response.json()) as {
          data: { rounds: { questions: { acceptedAnswers: string[] }[] }[] }
        }
        return data.rounds[0]?.questions[0]?.acceptedAnswers[0] === 'lisbon'
      },
      { timeout: 15_000 },
    )
    .toBe(true)
  await sheet.press('Escape')

  // Back through Check: the error is gone, and the healthy line says what was verified.
  await page.goto(`/en/admin/quizzes/${quizId}/play`)
  await expect(page.getByText(a.preflight.code.NO_ACCEPTED_ANSWER)).toBeHidden()
  await expect(page.getByRole('button', { name: a.preflight.setUpGame })).toBeVisible()
})

/**
 * Scenario 4 ” *"Import collision offers Replace / Import-as-copy, and each does what it says."*
 *
 * Both halves matter. Replace must actually replace ” proven by a local edit the file does not
 * contain, which reverts. Import-as-copy must leave both quizzes standing.
 */
test('4 ” Replace overwrites the local copy; import-as-copy keeps both', async ({
  page,
}) => {
  test.setTimeout(90_000)

  const db = testDb()
  const quizId = newQuiz(db, 'Collision Course')
  const roundId = newQuestionSetRound(db, quizId, 'Round one')
  addFreeText(db, roundId, 'Capital of France?', ['paris'])

  await page.goto(`/en/admin/quizzes/${quizId}`)

  // Export first, while the description is still empty ” then edit locally, so file and machine
  // disagree in exactly one observable field.
  await page.getByRole('button', { name: 'Collision Course' }).click()
  await page.getByRole('menuitem', { name: a.dashboard.export }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: a.export.export })).toBeEnabled()
  const zip = page.waitForEvent('download')
  await dialog.getByRole('button', { name: a.export.export }).click()
  const path = await (await zip).path()

  await page.getByLabel(a.quiz.description).fill('a local edit the file never had')
  // Autosave debounces ~600 ms; waiting on the saved indicator beats sleeping (rule 3).
  // The quiz *name* field is the one whose indicator the header shows, so nudge it instead of
  // guessing which field the indicator is watching.
  await expect(page.getByText(common.saved)).toBeVisible({ timeout: 10_000 })

  // --  Replace
  await importZip(page, path)
  await chooseImportMode(page, 'replace')
  // Still one quiz ” replace deletes, it does not add.
  await expect(quizRow(page, 'Collision Course')).toHaveCount(1)
  // …and the local edit is gone: the field now holds what the file held, nothing.
  // (The dashboard row's Open is a *button* ” it routes client-side rather than navigating.)
  await quizRow(page, 'Collision Course')
    .first()
    .getByRole('button', { name: a.dashboard.open })
    .click()
  await expect(page.getByLabel(a.quiz.description)).toHaveValue('')

  // --  Import as a copy
  await page.goto('/en/admin')
  await importZip(page, path)
  await chooseImportMode(page, 'copy')
  // Two quizzes, same identity, both real.
  await expect(quizRow(page, 'Collision Course')).toHaveCount(2)
})

/** Opens §14.2's flow from the dashboard button with a downloaded export.
 *
 * The hidden file input carries the same accessible name as the button that opens it, so the
 * button is addressed by its own component marker (`data-slot`) rather than by role ” strict
 * mode is right to refuse a locator that cannot tell the chooser from its trigger.
 */
async function importZip(page: Page, path: string): Promise<void> {
  await page.goto('/en/admin')
  await pastFirstRun(page)
  await page
    .locator(`main button[data-slot="button"]`, { hasText: a.import.importButton })
    .click()
  await page.locator('input[type="file"]').setInputFiles(path)
}

/**
 * The collision dialog's three radios, by the choice they represent. The dialog itself is
 * asserted along the way ” the comparison table and the older/newer verdict are part of what
 * scenario 4 is about, not noise around it.
 */
async function chooseImportMode(page: Page, mode: 'replace' | 'copy'): Promise<void> {
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(a.import.collision)).toBeVisible()
  await expect(
    dialog.getByText(a.import.fileIsOlder).or(dialog.getByText(a.import.fileIsNewer)),
  ).toBeVisible()

  if (mode === 'replace') {
    await dialog.getByLabel(a.import.replace).check()
    await dialog.getByRole('button', { name: a.import.replace }).click()
  } else {
    await dialog.getByLabel(a.import.asCopy).check()
    await dialog.getByRole('button', { name: a.import.import }).click()
  }
  await expect(dialog).toBeHidden({ timeout: 15_000 })
}
