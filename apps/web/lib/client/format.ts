/**
 * A byte count as a human-readable size.
 *
 * **Not through the messages module**: this is a number with an SI unit, identical in both locales,
 * and routing it through i18n would invite someone to "translate" `MB`.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`

  const units = ['kB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }

  // One decimal below 10, none above: `4.2 MB` is useful, `4.2 GB` is useful, `847.3 MB` is noise.
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit] ?? 'TB'}`
}
