/**
 * `@kwiz/export` — the export zip: writing, reading, manifest and validation
 * (protocol §8).
 *
 * The zip and its manifest are wholly untrusted input, which is why
 * `SCHEMA_VERSION_UNSUPPORTED`, `CHECKSUM_MISMATCH` and `MANIFEST_INVALID` exist as typed
 * errors (conventions §4) rather than one generic import failure.
 *
 * **No zip library is chosen yet.** conventions §1's dependency table does not name one,
 * and slice 0 has no reason to pick — see the slice-0 entry in `slice-log.md`. Whoever
 * implements the format flags the addition per agent-workflow §3.4.
 *
 * The contents arrive in build-order slice 4.
 */
export {}
