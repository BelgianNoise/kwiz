/**
 * `@kwiz/export` — the export zip: writing, reading, manifest and validation
 * (protocol §8).
 *
 * The zip and its manifest are wholly untrusted input, which is why
 * `SCHEMA_VERSION_UNSUPPORTED`, `CHECKSUM_MISMATCH` and `MANIFEST_INVALID` exist as typed
 * errors (conventions §4) rather than one generic import failure.
 *
 * The zip library is **`fflate`**, added in slice 4 per agent-workflow §3.4: it is small, has no
 * dependencies of its own, and does synchronous in-memory zip in both directions — which suits a
 * format whose largest member is already on disk as a file we stream separately.
 */

/**
 * The export format version, written to `manifest.json` and **checked before anything else** on
 * import (protocol §8.1).
 *
 * It lives here rather than in `@kwiz/db` because it versions the *file format*, not the database:
 * a migration that adds a column changes neither, and a change to what `quiz.json` contains changes
 * this even if no table moved. Bumping it makes older builds refuse the file with
 * `SCHEMA_VERSION_UNSUPPORTED` rather than import half of it.
 */
export const SCHEMA_VERSION = 1
