// Shows a static working indicator (one frame) when pi runs in a herdr-core terminal (SPEC v0.5).
//
// Why: herdr-app on a VM without a GPU draws each terminal change on the CPU. Pi's default working
// indicator redraws the terminal every 80 ms, so every working pi on screen costs window draws.
// With one frame, the pi-tui Loader starts no animation timer; the working state stays visible.
//
// Runs only when HC_TERMINAL_ID is set. Otherwise it registers nothing.

export default function (pi) {
  if (!process.env.HC_TERMINAL_ID) return

  pi.on('session_start', async (_event, ctx) => {
    if (!ctx.hasUI) return
    ctx.ui.setWorkingIndicator({ frames: [ctx.ui.theme.fg('accent', '●')] })
  })
}
