/**
 * `@kwiz/db` — Drizzle schema, migrations and repositories.
 *
 * Three groups of tables with different mutability rules (data model §2): template
 * (mutable), game-copy (write-once), play (event-sourced + projections). They are not
 * interchangeable and must not be mixed.
 *
 * The play half has exactly one writer — `appendAndProject()` — which appends to
 * `game_event` and updates the projection in the same transaction (CLAUDE.md §2.2). If you
 * find yourself wanting to `UPDATE game_answer`, the change you want is an event.
 *
 * `better-sqlite3` and `drizzle-orm` are declared here in slice 0 so the scaffold's
 * install actually exercises conventions §1.1 — a dependency added in slice 1 would move
 * that risk to the slice least able to absorb it.
 *
 * The schema arrives in build-order slice 1.
 */
export {}
