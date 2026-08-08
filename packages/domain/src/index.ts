/**
 * `@kwiz/domain` — the game rules as pure functions over an event list.
 *
 * **This package imports no database, no Next.js type, no `Request`, no socket and no
 * `process.env`** (CLAUDE.md §2.1). `.oxlintrc.json` fails the build on any of those rather than
 * trusting convention. `zod` is present and permitted: it is a pure library, and the event
 * catalogue's schemas are the boundary that guards the log.
 *
 * Purity is what makes D3's transport swap possible and what lets every test here be a literal
 * array with no mocks. If something needs a mock, it belongs in another package.
 *
 * **The event catalogue and the content-config schemas live here, not in `@kwiz/db`.** They are
 * domain vocabulary that the database merely persists, and `packages/domain` may not import from
 * `@kwiz/db` — so keeping them there would have forced a duplicate union, which is exactly the
 * drift the single-writer design exists to prevent.
 */

export * from './constants'
export * from './vocabulary'
export * from './content-config'
export * from './answers'
export * from './codes'
export * from './palette'
export * from './quiz'
export * from './late-team'
export * from './preflight'
export * from './question-state'
export * from './state'
export * from './reduce'
export * from './derive'
export * from './views'
export * from './errors'
export * from './notices'
export * from './commands'
export * from './decide'

export {
  GAME_EVENT_TYPES,
  gameEventPayloadSchemas,
  isGameEventType,
  type GameEvent,
  type GameEventPayload,
  type GameEventType,
} from './events/payload'

export { EventPayloadError, parseGameEvent, parseStoredEvent } from './events/parse'
