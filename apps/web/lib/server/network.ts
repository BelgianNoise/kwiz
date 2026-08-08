import { networkInterfaces } from 'node:os'

/**
 * PRD 2 §4 / D10 — which of this laptop's addresses can a phone actually reach?
 *
 * This is **the single most likely way a first-time setup fails**, and it fails silently: the master
 * gets a QR code, the room scans it, nothing loads, and there is no error anywhere to explain it. A
 * developer laptop routinely has eight addresses and only one of them works.
 *
 * The classification below is deliberately *advisory*. It cannot be authoritative — only a phone
 * actually reaching the machine can prove reachability, which is why §4 pairs this list with a probe
 * (`[Test with my phone]`). What it can do is stop `172.17.0.1` from being offered as an equal
 * candidate beside `192.168.1.42`, so the obvious choice is also the one that works.
 */
export type Reachability =
  /** A private-range address on a real adapter — what a phone on the same wifi should use. */
  | 'LIKELY'
  /** Routable but unusual here: a public address, or a private one on a virtual adapter. */
  | 'UNKNOWN'
  /** Cannot work from another device: loopback, link-local, or a known virtual bridge. */
  | 'UNUSABLE'

export interface NetworkAddress {
  address: string
  /** The OS interface name, e.g. `Wi-Fi`, `eth0`, `docker0`. */
  name: string
  family: 'IPv4' | 'IPv6'
  reachability: Reachability
  /** Why it was classified this way — shown verbatim beside the radio, so it must be a message key. */
  reason: 'PRIVATE' | 'PUBLIC' | 'VIRTUAL' | 'LOOPBACK' | 'LINK_LOCAL'
}

/**
 * Interface-name fragments that mean "this adapter does not carry the LAN".
 *
 * Matched on the name rather than the address range because the ranges overlap with real ones: WSL
 * and Hyper-V hand out ordinary `172.x` and `192.168.x` addresses that no phone can route to. The
 * list is lowercase-compared and matches on substring, since Windows names adapters
 * `vEthernet (WSL (Hyper-V firewall))` and macOS uses `bridge100`.
 */
const VIRTUAL_FRAGMENTS = [
  'docker',
  'veth',
  'vethernet',
  'vmnet',
  'vboxnet',
  'virbr',
  'wsl',
  'hyper-v',
  'bridge',
  'tailscale',
  'zerotier',
  'utun',
  'tun',
  'tap',
  'ppp',
  'loopback',
  'pseudo-interface',
]

function isVirtual(name: string): boolean {
  const lower = name.toLowerCase()
  return VIRTUAL_FRAGMENTS.some((fragment) => lower.includes(fragment))
}

/** RFC 1918 plus the RFC 6598 carrier range, which behaves like a private one for our purposes. */
function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  const [a, b] = parts
  if (parts.length !== 4 || a === undefined || b === undefined) return false
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

function isLinkLocal(address: string): boolean {
  return address.startsWith('169.254.') || address.toLowerCase().startsWith('fe80:')
}

/**
 * `fc00::/7` — IPv6's unique local addresses, the direct equivalent of RFC 1918.
 *
 * Worth its own check because the first hextet is where the range lives: every ULA begins `fc` or
 * `fd`, and a home router that hands out IPv6 hands out exactly these. Treating one as "public" is
 * both wrong and unhelpful — it is precisely a LAN address, which is what this screen is looking for.
 */
function isUniqueLocalIPv6(address: string): boolean {
  const lower = address.toLowerCase()
  return lower.startsWith('fc') || lower.startsWith('fd')
}

function isLoopback(address: string): boolean {
  return address.startsWith('127.') || address === '::1'
}

/** Pure so it can be tested against a literal interface list rather than whatever this laptop has. */
export function classify(
  address: string,
  interfaceName: string,
): { reachability: Reachability; reason: NetworkAddress['reason'] } {
  if (isLoopback(address)) return { reachability: 'UNUSABLE', reason: 'LOOPBACK' }
  // Checked before the virtual-name test: a link-local address is unusable whatever it sits on.
  if (isLinkLocal(address)) return { reachability: 'UNUSABLE', reason: 'LINK_LOCAL' }
  if (isVirtual(interfaceName)) return { reachability: 'UNUSABLE', reason: 'VIRTUAL' }
  if (isPrivateIPv4(address) || isUniqueLocalIPv6(address)) {
    return { reachability: 'LIKELY', reason: 'PRIVATE' }
  }
  // A public address on a real adapter is not wrong — a venue may hand out routable addresses — but
  // it is unusual enough that offering it as the obvious choice would be misleading.
  return { reachability: 'UNKNOWN', reason: 'PUBLIC' }
}

export interface RawInterface {
  name: string
  address: string
  family: 'IPv4' | 'IPv6'
  internal: boolean
}

/**
 * Also pure, and separate from `listAddresses` so the ordering is testable.
 *
 * `LIKELY` first, then IPv4 before IPv6: a master scanning this list should find the answer at the
 * top, and an IPv6 address is never the one they want to read aloud.
 */
export function describeInterfaces(raw: RawInterface[]): NetworkAddress[] {
  return raw
    .map((entry) => ({
      address: entry.address,
      name: entry.name,
      family: entry.family,
      // `internal` is the OS's own loopback flag; trust it over our string matching.
      ...(entry.internal
        ? ({ reachability: 'UNUSABLE', reason: 'LOOPBACK' } as const)
        : classify(entry.address, entry.name)),
    }))
    .sort((a, b) => {
      const rank = (entry: NetworkAddress): number =>
        (entry.reachability === 'LIKELY' ? 0 : entry.reachability === 'UNKNOWN' ? 1 : 2) *
          2 +
        (entry.family === 'IPv4' ? 0 : 1)
      return rank(a) - rank(b) || a.address.localeCompare(b.address)
    })
}

/** The impure edge: everything above it takes a list, so only this one line needs the machine. */
export function listAddresses(): NetworkAddress[] {
  const raw: RawInterface[] = Object.entries(networkInterfaces()).flatMap(
    ([name, entries]) =>
      (entries ?? []).map((entry) => ({
        name,
        address: entry.address,
        family: entry.family === 'IPv6' ? ('IPv6' as const) : ('IPv4' as const),
        internal: entry.internal,
      })),
  )
  return describeInterfaces(raw)
}

/**
 * §4's last bullet — *"if the address later becomes invalid (different wifi network, new DHCP lease)"*.
 *
 * Compared against the machine's **current** addresses rather than pinged, because a saved address
 * that no longer exists on any adapter is unambiguously stale, and that is the case worth a banner.
 * An address that still exists but has stopped being routable is what the probe is for.
 */
export function isAddressStale(saved: string, current = listAddresses()): boolean {
  return !current.some((entry) => entry.address === saved)
}
