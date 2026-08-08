/**
 * One process-wide value, whatever Next decides to do with our modules.
 *
 * **Next evaluates `lib/server/*` twice** — once in the server-component layer and once in the
 * route-handler layer — so a plain module-level `const map = new Map()` produces *two* maps: a page
 * writes to one and an API route reads the other. That is not a theoretical concern here; it is
 * exactly how PRD 2 §4's probe first failed, with the phone reaching the machine and the setup screen
 * never noticing. Booting the database logged `[kwiz] database up to date` twice, which is what made
 * it visible.
 *
 * In dev it buys a second thing: HMR discards module state on every edit, so without this a saved
 * file would silently drop every SSE subscriber and reopen SQLite.
 *
 * Keyed by an explicit string rather than by module identity, because module identity is the thing
 * that is unreliable. Keys are namespaced so a second app in the same process cannot collide.
 */
const REGISTRY = Symbol.for('kwiz.singletons')

interface Store {
  [REGISTRY]?: Map<string, unknown>
}

function store(): Map<string, unknown> {
  const host = globalThis as Store
  host[REGISTRY] ??= new Map<string, unknown>()
  return host[REGISTRY]
}

/**
 * `create` runs at most once per key for the life of the process.
 *
 * Note what this does *not* do: it never re-runs `create` when the stored value is falsy, so a
 * singleton that is legitimately `null` or `0` stays that one value.
 */
export function singleton<T>(key: string, create: () => T): T {
  const values = store()
  if (!values.has(key)) values.set(key, create())
  // The cast is the one unavoidable place: a heterogeneous map cannot be typed per key, and every
  // caller owns its key. Confining it here is the reason this module exists rather than the pattern
  // being repeated at four call sites.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return values.get(key) as T
}

/** Tests only: module-level state otherwise leaks between cases in the same worker. */
export function clearSingleton(key: string): void {
  store().delete(key)
}
