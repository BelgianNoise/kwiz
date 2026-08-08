/**
 * `@kwiz/export` — the export zip: writing, reading, manifest and validation (protocol §8).
 *
 * The zip and its manifest are wholly untrusted input, which is why `SCHEMA_VERSION_UNSUPPORTED`,
 * `CHECKSUM_MISMATCH` and `MANIFEST_INVALID` exist as typed errors (conventions §4) rather than one
 * generic import failure. A master learns *which* file is damaged, not that something went wrong.
 *
 * The zip library is **`fflate`**, added in slice 4 per agent-workflow §3.4: small, no dependencies
 * of its own, and synchronous in both directions, which suits a format read and written whole.
 */

export {
  exportFileName,
  manifestSchema,
  ATTACHMENT_DIR,
  GAMES_FILE,
  MANIFEST_FILE,
  QUIZ_FILE,
  type Manifest,
} from './manifest'

export {
  readExport,
  writeExport,
  type AttachmentBytes,
  type ExportInput,
  type ParsedExport,
} from './zip'

export { SCHEMA_VERSION } from './version'
