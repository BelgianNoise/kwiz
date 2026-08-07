/**
 * `@kwiz/db` — Drizzle schema, migrations and the one writer.
 *
 * Three groups of tables with different mutability rules (data model §1): template (mutable),
 * game-copy (write-once, I16), play (event-sourced + projections). They are not interchangeable
 * and must not be mixed.
 *
 * The play half has exactly one writer — {@link appendAndProject} — which appends to
 * `game_event` and updates the projections in the same transaction (CLAUDE.md §2.2). If you
 * find yourself wanting to `UPDATE game_answer`, the change you want is an event.
 */

export * from './schema'

export {
  applyPragmas,
  closeDatabase,
  dataPaths,
  getDatabase,
  openDatabase,
  type DataPaths,
  type KwizDatabase,
  type KwizDb,
  type KwizSchema,
  type KwizTx,
} from './client'

/*
 * The event catalogue and the content-config schemas live in `@kwiz/domain` — they are domain
 * vocabulary that this package merely persists, and `packages/domain` may not import from here
 * (CLAUDE.md §2.1, enforced by lint). Import them from `@kwiz/domain` directly.
 */

export { appendAndProject, latestSeq, readLog, type AppendResult } from './append'

export { applyProjection, recomputeScore } from './projections'

export { loadGameContent } from './content'

export {
  findAttachmentFile,
  insertTemplateAttachment,
  type AttachmentFile,
  type NewAttachment,
} from './attachments'

export {
  deleteDraft,
  deleteQuestionDrafts,
  questionDrafts,
  saveDraft,
  teamDrafts,
} from './drafts'

export {
  findDeviceByToken,
  findGame,
  findJoinableGameByCode,
  generateUnusedCode,
  touchDevice,
  JOINABLE_STATUSES,
  type GameRow,
} from './games'

export {
  createGameFromQuiz,
  resyncGame,
  type CreatedGame,
  type CreateGameOptions,
  type NewTeam,
} from './instantiate'

export { bootDatabase, describeOutcome, migrationsFolder, type BootResult } from './boot'

export {
  backupDatabase,
  isFreshDatabase,
  migrateAtBoot,
  MigrationConsentUnavailableError,
  pendingMigrations,
  type BootMigrationOptions,
  type MigrationOutcome,
  type PendingMigration,
} from './migrate'

export { SHARED_COLUMN_GROUPS, sharedColumnParity, type ParityMismatch } from './parity'
