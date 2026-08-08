/**
 * The export format version, written to `manifest.json` and **checked before anything else** on
 * import (protocol §8.1).
 *
 * It versions the *file format*, not the database: a migration that adds a column changes neither,
 * and a change to what `quiz.json` contains changes this even if no table moved. Bumping it makes
 * older builds refuse the file with `SCHEMA_VERSION_UNSUPPORTED` rather than import half of it.
 */
export const SCHEMA_VERSION = 1
