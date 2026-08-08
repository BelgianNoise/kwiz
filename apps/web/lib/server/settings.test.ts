import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import { joinUrl, readSettings, updateSettings } from './settings'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kwiz-settings-'))
})

describe('readSettings', () => {
  it('is the first-run state when the file is absent', () => {
    expect(readSettings(dir)).toEqual({ networkAddress: null, muteSounds: false })
  })

  /**
   * A corrupt settings file must route to §4's picker, not crash the dashboard — the screen a master
   * lands on before every quiz night is not the place to surface a JSON parse error.
   */
  it('falls back to first-run defaults when the file is unparseable', () => {
    writeFileSync(join(dir, 'settings.json'), '{ this is not json', 'utf8')
    expect(readSettings(dir).networkAddress).toBeNull()
  })

  it('falls back when the file is valid JSON of the wrong shape', () => {
    writeFileSync(join(dir, 'settings.json'), '{"networkAddress": 42}', 'utf8')
    expect(readSettings(dir).networkAddress).toBeNull()
  })
})

describe('updateSettings', () => {
  /** The bug this prevents: muting sounds and losing the address that took a QR-code test to confirm. */
  it('merges rather than replaces, so one setting cannot blank another', () => {
    updateSettings(dir, { networkAddress: '192.168.1.42' })
    updateSettings(dir, { muteSounds: true })

    expect(readSettings(dir)).toEqual({
      networkAddress: '192.168.1.42',
      muteSounds: true,
    })
  })
})

describe('joinUrl', () => {
  it('is absolute once an address is chosen', () => {
    expect(
      joinUrl({ networkAddress: '192.168.1.42', muteSounds: false }, 3000, 'YN3PQS'),
    ).toBe('http://192.168.1.42:3000/play/YN3PQS')
  })

  /**
   * §4 — never a guess. A relative URL still works for whoever is already on the page; a fabricated
   * origin produces a QR code that looks authoritative and resolves to nothing.
   */
  it('stays relative until then', () => {
    expect(joinUrl({ networkAddress: null, muteSounds: false }, 3000, 'YN3PQS')).toBe(
      '/play/YN3PQS',
    )
  })
})
