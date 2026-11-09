# hc-badge

Sets a dot overlay on the herdr-app taskbar button (Windows, `ITaskbarList3.SetOverlayIcon`): orange for `blocked`, green for `done`.

Build: `powershell -File build.ps1 [-Out <path>]` (Windows PowerShell 5.1 only, not `pwsh`; default `$HOME\.local\bin\hc-badge.exe`; uses .NET Framework 4.x `csc.exe`).

Usage: `hc-badge blocked <n>` | `hc-badge done <n>` | `hc-badge off` (`<n>` >= 1, used in the accessibility text of the overlay).

Exit codes: 0 ok, 1 bad arguments, 2 no visible herdr-app window, 3 taskbar call failed.
It is a window app (no console flash), so PowerShell does not wait for it. To read the exit code by hand:
`(Start-Process hc-badge -ArgumentList off -Wait -PassThru).ExitCode`.
`HC_BADGE_PROCESS` overrides the target process name (for tests).
