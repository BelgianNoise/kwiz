import fs from 'node:fs'

const files = ['e2e/specs/authoring.spec.ts', 'e2e/specs/legibility.spec.ts']

// Triple-encoded box-drawing dividers (`──`, U+2500) from the original comment decorations.
for (const f of files) {
  let s = fs.readFileSync(f, 'utf8')
  const before = (s.match(/Ã/g) || []).length
  // `─` = E2 94 80; each mangling pass turns it into â"€, then Ã¢â€"â‚¬, etc.
  s = s.replace(/ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“/g, '──')
  s = s.replace(/ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â/g, '──')
  s = s.replace(/Ã¢â‚¬â€/g, '──')
  s = s.replace(/Ã¢â€”â‚¬/g, '─')
  s = s.replace(/Ã¢â€"/g, '─')
  fs.writeFileSync(f, s)
  console.log(f, 'non-ascii Ã pairs:', before, '->', (s.match(/Ã/g) || []).length)
}
