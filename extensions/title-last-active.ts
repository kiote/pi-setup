// Adds the time of the last agent activity to the terminal title:
//   π - <session name> - <cwd> · 14:32        (today)
//   π - <session name> - <cwd> · Nov 2 14:32  (other days)
// Paints only while pi is idle, so the Orca spinner (orca-titlebar-spinner.ts) keeps
// the title during a run. Keeps the Orca "π - " prefix, so Orca still parses the state.
// Set PI_TITLE_LAST_ACTIVE=0 to turn it off.

import { spawn } from 'node:child_process'

const REPAINT_MS = 10000
// Why: the Orca spinner and pi itself repaint the title after agent_settled and
// session_start (stopAnimation, rebindCurrentSession). Paint after them.
const SETTLE_DELAY_MS = 400
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function formatTime(d: Date): string {
  const now = new Date()
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  return sameDay ? hm : `${MONTHS[d.getMonth()]} ${d.getDate()} ${hm}`
}

function lastEntryTime(ctx): Date | null {
  try {
    const entries = ctx.sessionManager.getEntries()
    for (let i = entries.length - 1; i >= 0; i--) {
      const t = Date.parse(entries[i]?.timestamp)
      if (!Number.isNaN(t)) return new Date(t)
    }
  } catch {}
  return null
}

export default function (pi) {
  if (process.env.PI_TITLE_LAST_ACTIVE === '0') return
  let lastActive: Date | null = null
  let ctxRef = null
  let promptDepth = 0
  let interval = null
  let pending = null
  let lastReported = ''

  // Why: herdr shows its own pane title, not the OSC title. Send the time as the pane
  // metadata token $last_active; config.toml [ui.sidebar.agents] rows show it.
  function reportHerdr() {
    const bin = process.env.HERDR_BIN_PATH
    const paneId = process.env.HERDR_PANE_ID
    if (process.env.HERDR_ENV !== '1' || !bin || !paneId || !lastActive) return
    const value = formatTime(lastActive)
    if (value === lastReported) return
    lastReported = value
    try {
      const child = spawn(bin, ['pane', 'report-metadata', paneId, '--source', 'user:pi-last-active', '--token', `last_active=${value}`], {
        stdio: 'ignore',
        windowsHide: true,
      })
      child.on('error', () => {})
      child.unref()
    } catch {}
  }

  function buildTitle(ctx): string {
    const dir = ctx.sessionManager?.getCwd?.() || process.cwd()
    const cwd = dir.split(/[\\/]/).filter(Boolean).at(-1) || dir
    const session = pi.getSessionName()
    const base = session ? `\u03c0 - ${session} - ${cwd}` : `\u03c0 - ${cwd}`
    return lastActive ? `${base} \u00b7 ${formatTime(lastActive)}` : base
  }

  // Why: ctx getters throw once the session is replaced, and process.cwd() throws when
  // the worktree is gone. A throw in a timer would end pi, so catch everything.
  function paint() {
    reportHerdr()
    const ctx = ctxRef
    if (!ctx || promptDepth > 0) return
    try {
      if (!ctx.hasUI || !ctx.isIdle()) return
      ctx.ui.setTitle(buildTitle(ctx))
    } catch {}
  }

  function paintSoon() {
    if (pending) clearTimeout(pending)
    pending = setTimeout(() => {
      pending = null
      paint()
    }, SETTLE_DELAY_MS)
    if (typeof pending.unref === 'function') pending.unref()
  }

  pi.on('session_start', async (_event, ctx) => {
    ctxRef = ctx
    promptDepth = 0
    lastActive = lastEntryTime(ctx)
    if (!interval) {
      interval = setInterval(paint, REPAINT_MS)
      if (typeof interval.unref === 'function') interval.unref()
    }
    paintSoon()
  })

  pi.on('agent_settled', async (_event, ctx) => {
    ctxRef = ctx
    lastActive = new Date()
    paintSoon()
  })

  // Why: older runtimes do not emit agent_settled. paint() checks isIdle().
  pi.on('agent_end', async (event, ctx) => {
    if (event?.willContinue === true) return
    ctxRef = ctx
    lastActive = new Date()
    paintSoon()
  })

  // Why: Orca shows "π ! ..." while a dialog waits for input. Do not paint over it.
  pi.on('ui_prompt_start', async () => {
    promptDepth++
  })

  pi.on('ui_prompt_end', async () => {
    if (promptDepth > 0) promptDepth--
    if (promptDepth === 0) paintSoon()
  })

  pi.on('session_shutdown', async () => {
    if (interval) clearInterval(interval)
    if (pending) clearTimeout(pending)
    interval = null
    pending = null
    ctxRef = null
  })
}
