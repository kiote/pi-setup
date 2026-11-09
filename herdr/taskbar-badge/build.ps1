# Build hc-badge.exe with the .NET Framework 4.x C# compiler.
param([string]$Out = "$HOME\.local\bin\hc-badge.exe")
$ErrorActionPreference = 'Stop'
# The C# compiler is in the runtime folder of the .NET Framework that runs this script (Windows PowerShell 5.1).
$csc = Join-Path ([System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) 'csc.exe'
if (-not (Test-Path $csc)) { [Console]::Error.WriteLine("csc.exe not found: $csc"); exit 1 }
$src = Join-Path $PSScriptRoot 'hc-badge.cs'
$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
& $csc /nologo /optimize+ /target:winexe /r:System.Drawing.dll "/out:$Out" $src
if ($LASTEXITCODE -ne 0) { [Console]::Error.WriteLine("csc failed with exit code $LASTEXITCODE"); exit $LASTEXITCODE }
Write-Output "built $Out"
