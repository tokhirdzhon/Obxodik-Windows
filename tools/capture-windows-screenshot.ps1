Add-Type @'
using System;
using System.Runtime.InteropServices;
public class ObxodikShot {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr h);
}
'@

$p = Get-Process Obxodik -ErrorAction SilentlyContinue |
     Where-Object { $_.MainWindowHandle -ne 0 } |
     Select-Object -First 1
if (-not $p) { throw "Obxodik window not found" }
$h = $p.MainWindowHandle

$fg = [ObxodikShot]::GetForegroundWindow()
$fpid = 0
[ObxodikShot]::GetWindowThreadProcessId($fg, [ref]$fpid) | Out-Null
$tid = [ObxodikShot]::GetCurrentThreadId()
[ObxodikShot]::AttachThreadInput($tid, $fpid, $true) | Out-Null
[ObxodikShot]::ShowWindow($h, 9) | Out-Null
[ObxodikShot]::SetWindowPos($h, [IntPtr](-1), 0, 0, 0, 0, 0x0043) | Out-Null
[ObxodikShot]::BringWindowToTop($h) | Out-Null
[ObxodikShot]::SetForegroundWindow($h) | Out-Null
[ObxodikShot]::SetFocus($h) | Out-Null
[ObxodikShot]::AttachThreadInput($tid, $fpid, $false) | Out-Null
Start-Sleep -Seconds 3

$r = New-Object ObxodikShot+RECT
[ObxodikShot]::GetWindowRect($h, [ref]$r) | Out-Null
Add-Type -AssemblyName System.Drawing
$w = $r.Right - $r.Left
$hh = $r.Bottom - $r.Top
$bmp = New-Object System.Drawing.Bitmap($w, $hh)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size($w, $hh)))
$dir = Join-Path $PSScriptRoot "..\docs"
New-Item -ItemType Directory -Force $dir | Out-Null
$bmp.Save((Join-Path $dir "screenshot.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
[ObxodikShot]::SetWindowPos($h, [IntPtr](-2), 0, 0, 0, 0, 0x0043) | Out-Null
