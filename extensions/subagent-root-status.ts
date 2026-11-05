// Keeps the root OSC 7501 program status at "working" while background subagent runs are active.
//
// Why: pi reports only the root record (working during a turn, then done/idle/error). pi-subagents
// reports each background run as a separate child record (`subagents/<run>`). herdr-app shows its
// spinner from the root record only, so after the parent turn settles it shows "done" although
// background runs still work. This extension writes the root record as "working" while the parent is
// idle and at least one background run is running or queued. When the last run ends, it writes the
// resting status that pi reported (done, idle, or error).
//
// Runs only in a herdr-app terminal (HC_TERMINAL_ID), or anywhere with PI_SUBAGENT_ROOT_STATUS=1.
// Turn it off with PI_SUBAGENT_ROOT_STATUS=0 or PI_PROGRAM_STATUS=0.

import { randomUUID } from 'node:crypto'

const RPC_REQUEST = 'subagents:rpc:v1:request'
const RPC_REPLY = 'subagents:rpc:v1:reply:'
const JOB_EVENTS = ['subagent:jobs-changed', 'subagent:async-started', 'subagent:async-complete', 'subagent:child-status']
// Why: pi writes its own root status after agent_settled and after a dialog closes. Write after it.
const REFRESH_DELAY_MS = 250
// Why: pi can overwrite the root record without an event that we see (for example idle compaction).
const REASSERT_MS = 5000
const RPC_TIMEOUT_MS = 5000

type Resting = { state: 'done' | 'idle' | 'error'; message?: string }

function encode(state: string, message?: string): string {
  const pairs = [`state=${state}`, 'app=pi']
  const text = (message ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim()
  if (text) pairs.push(`msg=${Buffer.from(text, 'utf8').toString('base64')}`)
  return `\x1b]7501;${pairs.join(':')}\x1b\\`
}

export default function (pi) {
  const flag = process.env.PI_SUBAGENT_ROOT_STATUS
  if (flag === '0' || process.env.PI_PROGRAM_STATUS === '0') return
  if (!process.env.HC_TERMINAL_ID && flag !== '1') return

  let enabled = false
  let parentIdle = true
  let promptDepth = 0
  let jobsActive = false
  let overriding = false
  let resting: Resting = { state: 'done' }
  let lastError: string | undefined
  let refreshTimer = null
  let reassertTimer = null
  let refreshing = false
  let refreshAgain = false

  function sessionName(): string | undefined {
    try {
      return pi.getSessionName() || undefined
    } catch {
      return undefined
    }
  }

  function write(data: string) {
    try {
      process.stdout.write(data)
    } catch {}
  }

  function writeWorking() {
    const name = sessionName()
    write(encode('working', name ? `${name} (subagents)` : 'Subagents running'))
  }

  function writeResting() {
    const message = resting.state === 'done' ? sessionName() : resting.message
    write(encode(resting.state, message))
  }

  function stopReassert() {
    if (reassertTimer) clearInterval(reassertTimer)
    reassertTimer = null
  }

  function apply() {
    const want = enabled && parentIdle && promptDepth === 0 && jobsActive
    if (want) {
      writeWorking()
      overriding = true
      if (!reassertTimer) {
        reassertTimer = setInterval(() => {
          if (overriding) writeWorking()
        }, REASSERT_MS)
        reassertTimer.unref?.()
      }
      return
    }
    stopReassert()
    if (!overriding) return
    overriding = false
    // Why: when a turn starts or a dialog opens, pi writes its own status. Restore only while idle.
    if (enabled && parentIdle && promptDepth === 0) writeResting()
  }

  function requestStatus(): Promise<any> {
    return new Promise((resolve) => {
      const requestId = randomUUID()
      let off = null
      const timer = setTimeout(() => {
        off?.()
        resolve(undefined)
      }, RPC_TIMEOUT_MS)
      timer.unref?.()
      off = pi.events.on(`${RPC_REPLY}${requestId}`, (reply) => {
        clearTimeout(timer)
        off?.()
        resolve(reply)
      })
      pi.events.emit(RPC_REQUEST, { version: 1, requestId, method: 'status', params: {} })
    })
  }

  async function refresh() {
    if (refreshing) {
      refreshAgain = true
      return
    }
    refreshing = true
    try {
      const reply = await requestStatus()
      if (reply?.success) {
        const runs = reply.data?.asyncSnapshot?.runs ?? []
        jobsActive = runs.some((run) => run?.state === 'running' || run?.state === 'queued')
        apply()
      }
    } catch {
    } finally {
      refreshing = false
      if (refreshAgain) {
        refreshAgain = false
        refreshSoon()
      }
    }
  }

  function refreshSoon() {
    if (!enabled || refreshTimer) return
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      void refresh()
    }, REFRESH_DELAY_MS)
    refreshTimer.unref?.()
  }

  for (const name of JOB_EVENTS) pi.events.on(name, () => refreshSoon())
  // Why: pi-subagents can load after this extension. Read the status when its RPC is ready.
  pi.events.on('subagents:rpc:v1:ready', () => refreshSoon())

  pi.on('session_start', async (_event, ctx) => {
    // Why: only the interactive parent owns the terminal. Child and print sessions have no TTY.
    enabled = ctx?.mode === 'tui' && ctx?.hasUI === true && process.stdout.isTTY === true
    overriding = false
    promptDepth = 0
    jobsActive = false
    resting = { state: 'idle' }
    stopReassert()
    try {
      parentIdle = ctx?.isIdle?.() !== false
    } catch {
      parentIdle = true
    }
    refreshSoon()
  })

  pi.on('agent_start', async () => {
    parentIdle = false
    lastError = undefined
    // Why: pi writes "working" itself during a turn. Stop the reassert timer.
    overriding = false
    stopReassert()
  })

  pi.on('message_end', async (event) => {
    const message = event?.message
    if (message?.role !== 'assistant') return
    lastError = message.stopReason === 'error'
      ? (String(message.errorMessage ?? '').split(/\r?\n/, 1)[0].trim() || 'Error')
      : undefined
  })

  pi.on('agent_settled', async (event) => {
    parentIdle = true
    resting = event?.aborted ? { state: 'idle' } : lastError ? { state: 'error', message: lastError } : { state: 'done' }
    // Why: the job list can be old. refresh() reads it again and then calls apply(), after pi wrote its status.
    refreshSoon()
  })

  pi.on('ui_prompt_start', async () => {
    promptDepth++
    overriding = false
    stopReassert()
  })

  pi.on('ui_prompt_end', async () => {
    if (promptDepth > 0) promptDepth--
    if (promptDepth === 0) refreshSoon()
  })

  pi.on('session_shutdown', async () => {
    if (refreshTimer) clearTimeout(refreshTimer)
    stopReassert()
    refreshTimer = null
    enabled = false
    overriding = false
  })
}
