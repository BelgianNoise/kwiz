/**
 * conventions §2 — game codes.
 *
 * **Crockford Base32**, chosen because it is an existing documented standard designed for humans
 * reading a code off a projector and re-typing it on a phone — so the normalisation rules come with
 * it rather than being invented. `I` and `L` are excluded (confusable with `1`), `O` (with `0`), and
 * `U`, which Crockford drops to reduce accidental obscenity. Convenient here, since codes are
 * projected in front of an audience.
 */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const CODE_LENGTH = 6

/**
 * Normalisation on entry, in conventions §2's order: strip whitespace and hyphens → uppercase →
 * map the confusable characters onto the ones in the alphabet.
 *
 * Deliberately forgiving in one direction only: `l2-3o4 5` becomes `123045`, but a character outside
 * the alphabet survives normalisation so {@link isValidCode} can reject it rather than having it
 * silently dropped into a code that happens to be valid.
 */
export function normaliseCode(input: string): string {
  return input
    .replaceAll(/[\s-]+/g, '')
    .toUpperCase()
    .replaceAll('O', '0')
    .replaceAll('I', '1')
    .replaceAll('L', '1')
}

export function isValidCode(input: string): boolean {
  const code = normaliseCode(input)
  return (
    code.length === CODE_LENGTH &&
    // `Array.from`, not a spread: identical semantics, and no `no-misused-spread` suppression
    // next to the function every join depends on (conventions §8 makes the same choice).
    Array.from(code).every((char) => CODE_ALPHABET.includes(char))
  )
}

/**
 * A code from caller-supplied random bytes.
 *
 * The **bytes come from a CSPRNG the caller owns** — `node:crypto` on the server — rather than from
 * inside this function, which keeps the package pure and makes the mapping testable with a literal
 * array. Not for secrecy: uniform distribution is the point, so collisions stay as rare as
 * `32^6 = 1,073,741,824` implies (uniqueness itself is the partial unique index's job, data model
 * §6.1).
 *
 * `256 % 32 === 0`, so the modulo introduces no bias — one byte per character, no rejection loop.
 */
export function codeFromBytes(bytes: Uint8Array): string {
  if (bytes.length < CODE_LENGTH) {
    throw new Error(`codeFromBytes needs at least ${CODE_LENGTH} bytes`)
  }
  let code = ''
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[(bytes[index] ?? 0) % CODE_ALPHABET.length]
  }
  return code
}
