import fs from 'node:fs'

const files = ['e2e/specs/authoring.spec.ts', 'e2e/specs/legibility.spec.ts']

// The remaining `Ã¢` pairs are triple-encoded em/en-dashes (— read as â€", then mangled once
// more). Same repair, one layer deeper.
for (const f of files) {
  let s = fs.readFileSync(f, 'utf8')
  const before = (s.match(/Ã¢/g) || []).length
  s = s.replace(/ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦/g, '…')
  s = s.replace(/Ã¢â‚¬â€/g, '”')
  s = s.replace(/Ã¢â‚¬â€œ/g, '–')
  s = s.replace(/Ã¢â‚¬â€/g, '—')
  s = s.replace(/Ã¢â‚¬â€/g, '—')
  s = s.replace(/Ã¢â‚¬â€œ/g, '–')
  s = s.replace(/Ã¢â€¬"/g, '—')
  s = s.replace(/Ã¢â€¬Å"/g, '“')
  s = s.replace(/Ã¢â€¬/g, '—')
  fs.writeFileSync(f, s)
  console.log(f, 'repaired', before, '->', (s.match(/Ã¢/g) || []).length)
}
