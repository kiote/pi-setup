<#
.SYNOPSIS
  Put the content of a file on the Windows clipboard, or check the clipboard.

.DESCRIPTION
  -Mode set   : Put the file text on the clipboard. Plain text only (default).
  -Mode set -Html : The file is an HTML fragment. Put CF_HTML plus a plain-text
                fallback on the clipboard. Use only when the user asks for HTML.
  -Mode check : Read the clipboard and compare it with the file. Run this in a
                NEW powershell process after the set process has exited.
                Prints one line "OK ..." (exit 0) or "FAIL ..." (exit 1).
                Never prints the clipboard content.

.EXAMPLE
  powershell -NoProfile -STA -ExecutionPolicy Bypass -File clip.ps1 -Mode set -Path C:\tmp\answer.txt
  powershell -NoProfile -STA -ExecutionPolicy Bypass -File clip.ps1 -Mode check -Path C:\tmp\answer.txt
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('set', 'check')][string]$Mode,
  [Parameter(Mandatory = $true)][string]$Path,
  [switch]$Html
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

if ([System.Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') {
  Write-Output 'FAIL run powershell with -STA'; exit 1
}
if (-not (Test-Path -LiteralPath $Path)) { Write-Output "FAIL no file: $Path"; exit 1 }

$utf8 = New-Object System.Text.UTF8Encoding($false)
$body = [System.IO.File]::ReadAllText((Resolve-Path -LiteralPath $Path).ProviderPath, $utf8)

function Get-PlainFromHtml([string]$h) {
  $t = $h -replace '<br\s*/?>', "`n" -replace '</(p|div|h[1-6]|tr|li)>', "`n" -replace '</t[dh]>', ' | ' -replace '<[^>]+>', ''
  return ($t -replace '&nbsp;', ' ' -replace '&quot;', '"' -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&')
}
function Norm([string]$s) { if ($null -eq $s) { return '' }; return ($s -replace "`r`n", "`n").TrimEnd() }

if ($Mode -eq 'set') {
  if (-not $Html) {
    if ([string]::IsNullOrEmpty($body)) { Write-Output 'FAIL file is empty'; exit 1 }
    # Plain text only. No HTML, no RTF.
    [System.Windows.Forms.Clipboard]::SetText($body, [System.Windows.Forms.TextDataFormat]::UnicodeText)
    Write-Output ("SET plain chars=" + $body.Length)
    exit 0
  }
  # CF_HTML with byte offsets (UTF-8), passed as a MemoryStream so that
  # .NET Framework does not re-encode it. Copy=$true keeps the data after exit.
  $pre = '<html><head><meta charset="utf-8"></head><body><!--StartFragment-->'
  $post = '<!--EndFragment--></body></html>'
  $hdr = "Version:0.9`r`nStartHTML:{0:D10}`r`nEndHTML:{1:D10}`r`nStartFragment:{2:D10}`r`nEndFragment:{3:D10}`r`n"
  $hl = $utf8.GetByteCount(($hdr -f 0, 0, 0, 0))
  $sf = $hl + $utf8.GetByteCount($pre); $ef = $sf + $utf8.GetByteCount($body); $eh = $ef + $utf8.GetByteCount($post)
  $cf = ($hdr -f $hl, $eh, $sf, $ef) + $pre + $body + $post
  $ms = New-Object System.IO.MemoryStream(, $utf8.GetBytes($cf + [char]0))
  $d = New-Object System.Windows.Forms.DataObject
  $d.SetData('HTML Format', $ms)
  $d.SetData([System.Windows.Forms.DataFormats]::UnicodeText, (Get-PlainFromHtml $body))
  [System.Windows.Forms.Clipboard]::SetDataObject($d, $true, 5, 200)
  Write-Output ("SET html bytes=" + $utf8.GetByteCount($cf))
  exit 0
}

# check
$o = [System.Windows.Forms.Clipboard]::GetDataObject()
$formats = if ($o) { $o.GetFormats() } else { @() }
$hasHtml = $formats -contains 'HTML Format'
$text = [System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::UnicodeText)
$fmt = ($formats | Where-Object { $_ -in @('UnicodeText', 'Text', 'HTML Format', 'Rich Text Format') }) -join ','

if ([string]::IsNullOrEmpty($text)) { Write-Output "FAIL clipboard text is empty formats=$fmt"; exit 1 }
if (-not $Html) {
  if ($hasHtml) { Write-Output "FAIL clipboard has HTML but plain text was asked formats=$fmt"; exit 1 }
  if ((Norm $text) -ne (Norm $body)) {
    Write-Output ("FAIL text differs from file clip=" + (Norm $text).Length + " file=" + (Norm $body).Length); exit 1
  }
  Write-Output ("OK plain chars=" + $text.Length + " formats=$fmt"); exit 0
}
if (-not $hasHtml) { Write-Output "FAIL no HTML Format on clipboard formats=$fmt"; exit 1 }
$h = $o.GetData('HTML Format')
if ($h -is [System.IO.Stream]) { $h = (New-Object System.IO.StreamReader($h, $utf8)).ReadToEnd() }
if ($h -notmatch 'StartFragment') { Write-Output 'FAIL HTML Format has no fragment'; exit 1 }
Write-Output ("OK html chars=" + $h.Length + " text chars=" + $text.Length + " formats=$fmt"); exit 0
