import fs from 'node:fs'

const files = ['e2e/specs/authoring.spec.ts', 'e2e/specs/legibility.spec.ts']

// Double-encoded sequences (UTF-8 read as Windows-1252, sometimes twice), mapped back to the
// characters the source originally held.
const map = [
  [/Ã¢â‚¬â€œ/g, '–'],
  [/Ã¢â‚¬â€/g, '”'],
  [/Ã¢â‚¬â€˜/g, '‘'],
  [/Ã¢â‚¬â„¢/g, '’'],
  [/Ã¢â‚¬Å“/g, '“'],
  [/Ã¢â‚¬Â¦/g, '…'],
  [/Ã¢â‚¬Â/g, '…'],
  [/Ã¢â‚¬â€/g, '—'],
  [/Ã‚Â§/g, '§'],
  [/Ãƒâ€”/g, '×'],
  [/Ã¢Å“â€œ/g, '✓'],
  [/ÃƒÂ©/g, 'é'],
  [/ÃƒÂ«/g, 'ë'],
]

for (const f of files) {
  let s = fs.readFileSync(f, 'utf8')
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
  s = s.replace(/\r\n/g, '\n')
  for (const [re, to] of map) s = s.replace(re, to)
  const rest = s.match(/Ã[\u0080-\u00ff]/g)
  if (rest) console.log(f, 'RESIDUAL', rest.length, [...new Set(rest)].join(' '))
  fs.writeFileSync(f, s)
}
console.log('done')
