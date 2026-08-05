import { describe, expect, it } from 'vitest'

import { ConfigError, parseConfig } from './index'

/**
 * conventions §10.1 lists env config as one of two places zod validation is easy to skip.
 * These are the cases PRD 1 §6.8 calls out by name.
 */
describe('parseConfig', () => {
  it('applies every default on an empty environment', () => {
    expect(parseConfig({})).toEqual({
      PORT: 3000,
      KWIZ_DATA_DIR: './data',
      KWIZ_MAX_DEVICES_PER_TEAM: 3,
      KWIZ_AUTO_MIGRATE: false,
      KWIZ_MAX_UPLOAD_MB: 50,
    })
  })

  it('reads supplied values', () => {
    const config = parseConfig({
      PORT: '8080',
      KWIZ_DATA_DIR: '/srv/kwiz',
      KWIZ_MAX_DEVICES_PER_TEAM: '1',
      KWIZ_AUTO_MIGRATE: '1',
      KWIZ_MAX_UPLOAD_MB: '250',
    })
    expect(config.PORT).toBe(8080)
    expect(config.KWIZ_DATA_DIR).toBe('/srv/kwiz')
    expect(config.KWIZ_MAX_DEVICES_PER_TEAM).toBe(1)
    expect(config.KWIZ_AUTO_MIGRATE).toBe(true)
    expect(config.KWIZ_MAX_UPLOAD_MB).toBe(250)
  })

  // The example PRD 1 §6.8 gives: this must stop the server, not become NaN and
  // silently admit unlimited devices.
  it('rejects a non-numeric device cap rather than yielding NaN', () => {
    expect(() => parseConfig({ KWIZ_MAX_DEVICES_PER_TEAM: 'abc' })).toThrow(ConfigError)
  })

  it('names the offending variable and quotes what it was given', () => {
    expect(() => parseConfig({ KWIZ_MAX_DEVICES_PER_TEAM: 'abc' })).toThrow(
      /KWIZ_MAX_DEVICES_PER_TEAM.*received "abc"/s,
    )
  })

  it('reports every failure at once, not one per restart', () => {
    try {
      parseConfig({ PORT: 'x', KWIZ_MAX_UPLOAD_MB: 'y' })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as ConfigError).message).toContain('PORT')
      expect((error as ConfigError).message).toContain('KWIZ_MAX_UPLOAD_MB')
    }
  })

  it('rejects a fractional or out-of-range port', () => {
    expect(() => parseConfig({ PORT: '3000.5' })).toThrow(ConfigError)
    expect(() => parseConfig({ PORT: '0' })).toThrow(ConfigError)
    expect(() => parseConfig({ PORT: '70000' })).toThrow(ConfigError)
  })

  it('rejects a device cap below 1, which would admit no devices at all', () => {
    expect(() => parseConfig({ KWIZ_MAX_DEVICES_PER_TEAM: '0' })).toThrow(ConfigError)
  })

  describe('KWIZ_AUTO_MIGRATE', () => {
    it('treats unset and empty as false', () => {
      expect(parseConfig({}).KWIZ_AUTO_MIGRATE).toBe(false)
      expect(parseConfig({ KWIZ_AUTO_MIGRATE: '' }).KWIZ_AUTO_MIGRATE).toBe(false)
    })

    it.each(['1', 'true', 'TRUE', 'yes', 'on', ' true '])(
      'accepts %o as true',
      (value) => {
        expect(parseConfig({ KWIZ_AUTO_MIGRATE: value }).KWIZ_AUTO_MIGRATE).toBe(true)
      },
    )

    it.each(['0', 'false', 'no', 'off'])('accepts %o as false', (value) => {
      expect(parseConfig({ KWIZ_AUTO_MIGRATE: value }).KWIZ_AUTO_MIGRATE).toBe(false)
    })

    // A typo must not quietly mean false: on a headless run PRD 1 §6.7 then refuses to
    // start, and the cause is invisible.
    it('rejects a typo rather than silently meaning false', () => {
      expect(() => parseConfig({ KWIZ_AUTO_MIGRATE: 'ture' })).toThrow(ConfigError)
    })
  })

  it('ignores unrelated environment variables', () => {
    expect(parseConfig({ PATH: '/usr/bin', HOME: '/home/x' }).PORT).toBe(3000)
  })
})
