import {
  applyEvent,
  reduce,
  type GameContent,
  type GameState,
  type LoggedEvent,
} from '@kwiz/domain'

/**
 * PRD 1 §6.4 — the live projection: **`Map<gameId, GameState>`**, loaded lazily by replaying that
 * game's events on first access after boot, and evictable when a game finishes and nobody is
 * watching. Five concurrent games cost five projections; a hundred finished games cost nothing.
 *
 * **There is no "the current game"** (CLAUDE.md §2.4). Every method takes a `gameId`; nothing here
 * resolves the most recent or the only active one, and a game's state is only ever reachable through
 * its own id.
 *
 * The loaders are injected rather than imported. Not for indirection's sake: it keeps this module
 * free of `@kwiz/db` so the registry's behaviour — lazy load, incremental fold, eviction, isolation —
 * is testable with a literal event list, which is the same reason `packages/domain` is pure.
 */
export interface RegistryLoaders {
  /** The game-copy subtree (data model §5). `undefined` means there is no such game. */
  loadContent(gameId: string): GameContent | undefined
  /** The game's log, in order, from `afterSeq` exclusive. */
  readLog(gameId: string, afterSeq: number): LoggedEvent[]
}

export interface GameRegistry {
  /** Loads by replay on first access. `undefined` only when the game does not exist. */
  get(gameId: string): GameState | undefined
  /**
   * Folds everything appended since the state's `seq` — an **incremental** fold, not a re-replay.
   * Returns the resulting state, or `undefined` if the game was never loaded.
   */
  catchUp(gameId: string): GameState | undefined
  /** Drops a game from memory. It reloads by replay on the next access, which is D4's whole point. */
  evict(gameId: string): void
  /** Evicts only if the game is over — the condition PRD 1 §6.4 states. */
  evictIfFinished(gameId: string, hasSubscribers: boolean): boolean
  loaded(): string[]
}

export function createGameRegistry(loaders: RegistryLoaders): GameRegistry {
  const games = new Map<string, GameState>()

  const load = (gameId: string): GameState | undefined => {
    const content = loaders.loadContent(gameId)
    if (!content) return undefined
    const state = reduce(content, loaders.readLog(gameId, 0))
    games.set(gameId, state)
    return state
  }

  return {
    get(gameId) {
      return games.get(gameId) ?? load(gameId)
    },

    catchUp(gameId) {
      const state = games.get(gameId)
      if (!state) return load(gameId)

      // `applyEvent` mutates the state this module owns, which is what makes catching up O(new
      // events) rather than O(the whole log). `reduce` is the same fold from an empty state, so a
      // restart and a catch-up cannot disagree — that equivalence is what `replay.test.ts` asserts.
      for (const entry of loaders.readLog(gameId, state.seq)) applyEvent(state, entry)
      return state
    },

    evict(gameId) {
      games.delete(gameId)
    },

    evictIfFinished(gameId, hasSubscribers) {
      const state = games.get(gameId)
      if (!state || hasSubscribers) return false
      if (state.status !== 'FINISHED' && state.status !== 'ABANDONED') return false
      games.delete(gameId)
      return true
    },

    loaded() {
      return [...games.keys()]
    },
  }
}
