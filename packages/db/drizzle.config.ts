import { defineConfig } from 'drizzle-kit'

/**
 * Generation only — `drizzle-kit` never touches a live database here. Migrations are plain
 * SQL, committed, and forward-only (D14, data model §11); applying them is `./src/migrate.ts`,
 * which prompts rather than migrating silently.
 *
 * No `dbCredentials`: the path comes from `KWIZ_DATA_DIR` at runtime through `@kwiz/config`,
 * and `process.env` may not be read anywhere else (PRD 1 §6.8).
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema/index.ts',
  out: './migrations',
  strict: true,
  verbose: true,
})
