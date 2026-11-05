// Tells herdr-app (herdr-core, the `hc` CLI) which pi session file runs in its terminal, so that herdr
// can show the exact session of each herdr-app terminal:
//   hc label <HC_TERMINAL_ID> pi.session=<session file>
// herdr-core gives each terminal HC_TERMINAL_ID, but it does not know the pi session (the standalone herdr gets it
// from herdr-agent-state.ts). Runs only inside a herdr-app terminal, in TUI mode, and only when the file changes
// (session start, /new, /resume, and each prompt). Set PI_HC_SESSION_LABEL=0 to turn it off.

import { execFile } from 'node:child_process'
import path from 'node:path'

const HC = process.env.HC_EXE ||
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'herdr-core', 'hc.exe')

export default function (pi) {
  const terminal = process.env.HC_TERMINAL_ID
  if (!terminal || process.env.PI_HC_SESSION_LABEL === '0') return
  let sent: string | undefined

  function report(ctx) {
    if (ctx?.mode !== 'tui') return
    let file: string | undefined
    try {
      file = ctx?.sessionManager?.getSessionFile?.()
    } catch {}
    if (typeof file !== 'string' || !file || file === sent) return
    sent = file
    // fire and forget: a failed label must not disturb the session
    execFile(HC, ['label', terminal, `pi.session=${file}`], { timeout: 10000, windowsHide: true }, (err) => {
      if (err) sent = undefined // try again at the next prompt
    })
  }

  pi.on('session_start', (_event, ctx) => report(ctx))
  pi.on('agent_start', (_event, ctx) => report(ctx))
}
