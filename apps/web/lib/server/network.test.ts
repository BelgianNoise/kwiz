import { describe, expect, it } from 'vitest'

import {
  classify,
  describeInterfaces,
  isAddressStale,
  type RawInterface,
} from './network'

/**
 * PRD 2 §4 / D10. These are the cases that make a QR code dead, and every one of them is a real
 * adapter from a real laptop — a machine with Docker, WSL and a VPN is the normal case for the person
 * writing this, and the reason the screen exists at all.
 */
const iface = (name: string, address: string, internal = false): RawInterface => ({
  name,
  address,
  family: address.includes(':') ? 'IPv6' : 'IPv4',
  internal,
})

describe('classify', () => {
  it('accepts private IPv4 on a real adapter', () => {
    expect(classify('192.168.1.42', 'Wi-Fi')).toEqual({
      reachability: 'LIKELY',
      reason: 'PRIVATE',
    })
    expect(classify('10.13.37.5', 'eth0').reachability).toBe('LIKELY')
    expect(classify('172.16.4.1', 'eth0').reachability).toBe('LIKELY')
  })

  it('rejects loopback and link-local', () => {
    expect(classify('127.0.0.1', 'lo')).toEqual({
      reachability: 'UNUSABLE',
      reason: 'LOOPBACK',
    })
    expect(classify('::1', 'lo').reason).toBe('LOOPBACK')
    // A DHCP lease that never arrived. It looks like an address and routes nowhere.
    expect(classify('169.254.31.7', 'Wi-Fi')).toEqual({
      reachability: 'UNUSABLE',
      reason: 'LINK_LOCAL',
    })
    expect(classify('fe80::1c2d', 'Wi-Fi').reason).toBe('LINK_LOCAL')
  })

  /**
   * The case that motivates the whole screen: these are *private-range* addresses on adapters no
   * phone can route to, so an address-range check alone would offer them as equals to the wifi.
   */
  it('rejects private addresses that sit on virtual adapters', () => {
    expect(classify('172.17.0.1', 'docker0').reason).toBe('VIRTUAL')
    expect(classify('192.168.65.1', 'vEthernet (WSL (Hyper-V firewall))').reason).toBe(
      'VIRTUAL',
    )
    expect(classify('172.24.80.1', 'vEthernet (Default Switch)').reason).toBe('VIRTUAL')
    expect(classify('10.211.55.2', 'vmnet8').reason).toBe('VIRTUAL')
    expect(classify('100.104.2.9', 'tailscale0').reason).toBe('VIRTUAL')
  })

  /** A home router handing out IPv6 hands out exactly these. They are LAN addresses, not public ones. */
  it('treats an IPv6 unique local address as private', () => {
    expect(classify('fda8:8c61:3791:753d::1', 'Ethernet')).toEqual({
      reachability: 'LIKELY',
      reason: 'PRIVATE',
    })
    expect(classify('fc00::1', 'Ethernet').reason).toBe('PRIVATE')
    // Still link-local first: `fe80:` is not in `fc00::/7` and must not be swept up by a prefix test.
    expect(classify('fe80::1', 'Ethernet').reason).toBe('LINK_LOCAL')
  })

  it('marks a public address as unknown rather than unusable', () => {
    // A venue handing out routable addresses is unusual, not wrong — so it is offered, not hidden.
    expect(classify('81.82.83.84', 'eth0')).toEqual({
      reachability: 'UNKNOWN',
      reason: 'PUBLIC',
    })
  })
})

describe('describeInterfaces', () => {
  it('puts the answer first: likely IPv4 above everything else', () => {
    const ordered = describeInterfaces([
      iface('lo', '127.0.0.1', true),
      iface('docker0', '172.17.0.1'),
      iface('eth0', '81.82.83.84'),
      iface('Wi-Fi', 'fe80::1c2d'),
      iface('Wi-Fi', '192.168.1.42'),
    ])

    expect(ordered.map((entry) => entry.address)).toEqual([
      '192.168.1.42',
      '81.82.83.84',
      '127.0.0.1',
      '172.17.0.1',
      'fe80::1c2d',
    ])
  })

  it("trusts the OS's own internal flag over the adapter name", () => {
    // Named like a real adapter, flagged internal by the kernel. The flag wins.
    const [only] = describeInterfaces([iface('Ethernet 2', '10.0.0.1', true)])
    expect(only?.reason).toBe('LOOPBACK')
  })
})

describe('isAddressStale', () => {
  const current = describeInterfaces([iface('Wi-Fi', '192.168.1.42')])

  it('is stale when the saved address is on no adapter — a new pub, or a new lease', () => {
    expect(isAddressStale('192.168.4.20', current)).toBe(true)
  })

  it('is not stale while the address still exists', () => {
    expect(isAddressStale('192.168.1.42', current)).toBe(false)
  })
})
