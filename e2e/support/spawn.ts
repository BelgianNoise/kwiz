import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * A server instance the test itself owns, for the two build-order slice 9 scenarios that must
 * not touch the shared one `playwright.config.ts` starts: **"wipe the data dir → import"** and
 * **"kill and restart the server mid-game."** Wiping or killing the shared server would take
 * every other worker's in-flight test down with it — these get their own port and their own
 * data directory instead, so they can run in parallel with everything else.
 *
 * Runs `next dev`'s CLI entry directly via `node`, not through `pnpm` or the platform's
 * `.CMD`/`.ps1` wrapper — one plain node process, so `stop()` has exactly one PID to kill rather
 * than a shell wrapping a shell wrapping the thing that actually holds the port.
 */
export interface SpawnedServer {
  url: string
  /** Resolves once `/en` answers 200. Throws on timeout, naming the last error seen. */
  waitReady(timeoutMs?: number): Promise<void>
  /** Kills the whole process tree and waits for exit — see the module doc for why. */
  stop(): Promise<void>
  readonly pid: number | undefined
}

export function spawnKwizServer(options: {
  port: number
  dataDir: string
  maxDevicesPerTeam?: number
}): SpawnedServer {
  const nextBin = resolve('apps/web/node_modules/next/dist/bin/next')
  if (!existsSync(nextBin)) {
    throw new Error(`fixture error: expected next's CLI entry at ${nextBin}`)
  }

  const child = spawn(process.execPath, [nextBin, 'dev', '-p', String(options.port)], {
    cwd: resolve('apps/web'),
    env: {
      ...process.env,
      PORT: String(options.port),
      KWIZ_DATA_DIR: options.dataDir,
      KWIZ_AUTO_MIGRATE: '1',
      KWIZ_MAX_DEVICES_PER_TEAM: String(options.maxDevicesPerTeam ?? 3),
    },
    windowsHide: true,
    // Only meaningful on POSIX — it makes this process its own group leader, so `killTree`
    // can take the whole group down with one call rather than only the direct child. Windows
    // has no equivalent concept; `taskkill /t` walks the OS's own parent-child records instead.
    detached: process.platform !== 'win32',
  })

  const output: string[] = []
  child.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()))
  child.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()))

  let exited = false
  child.once('exit', () => {
    exited = true
  })

  const url = `http://localhost:${options.port}`

  return {
    url,
    pid: child.pid,

    async waitReady(timeoutMs = 60_000) {
      const deadline = Date.now() + timeoutMs
      let lastError: unknown

      // Sequential on purpose, which is the opposite of the fan-out this rule guards against:
      // each attempt must see whether the *previous* one succeeded before trying again, and the
      // wait between them is the poll's own backoff.
      // oxlint-disable no-await-in-loop
      while (Date.now() < deadline) {
        if (exited) {
          throw new Error(
            `fixture error: spawned server exited before it was ready.\n${output.join('')}`,
          )
        }
        try {
          const response = await fetch(`${url}/en`)
          if (response.ok) return
        } catch (error) {
          lastError = error
        }
        await new Promise((r) => setTimeout(r, 250))
      }
      // oxlint-enable no-await-in-loop
      throw new Error(
        `fixture error: spawned server never became ready (${String(lastError)}).\n${output.join('')}`,
      )
    },

    async stop() {
      await killTree(child)
    },
  }
}

/**
 * Ends the whole tree, not just the direct child — `next dev` can hold worker processes of its
 * own, and a Windows orphan left holding the port is exactly the kind of flake build-order
 * slice 9's determinism rules exist to prevent.
 */
async function killTree(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null) return

  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'])
    } catch {
      // Already gone, or never started — either way there is nothing left to kill.
    }
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      try {
        child.kill('SIGKILL')
      } catch {
        // Same reasoning as the Windows branch.
      }
    }
  }

  await new Promise<void>((resolvePromise) => {
    if (child.exitCode !== null) {
      resolvePromise()
      return
    }
    child.once('exit', () => resolvePromise())
    // A dead-man's switch: if the exit event is somehow missed, do not hang the test forever.
    setTimeout(resolvePromise, 5_000)
  })
}
