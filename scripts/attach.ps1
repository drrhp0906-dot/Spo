# Freewave wallpaper attachment fallback.
#
# Used by main/wallpaper.js when koffi cannot load user32 (missing prebuilt
# binary, antivirus quarantine, ...). Performs the classic Progman/WorkerW
# trick: broadcast 0x052C to Progman, find the empty WorkerW below the
# desktop-icon layer, then reparent the given window into it.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File attach.ps1
#            <hwnd> attach <width> <height>
#            <hwnd> detach
# Protocol: prints exactly one line starting with "OK" or "FAIL".

param(
  [Parameter(Position = 0)][long]$Hwnd = 0,
  [Parameter(Position = 1)][ValidateSet('attach', 'detach')][string]$Mode = 'attach',
  [Parameter(Position = 2)][int]$Width = 0,
  [Parameter(Position = 3)][int]$Height = 0
)

$ErrorActionPreference = 'Stop'

$signature = @'
using System;
using System.Runtime.InteropServices;

public static class FreewaveShell
{
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindowW(string cls, string title);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindowExW(IntPtr parent, IntPtr after, string cls, string title);

    [DllImport("user32.dll")]
    public static extern IntPtr SendMessageTimeoutW(IntPtr hwnd, uint msg, IntPtr wp, IntPtr lp, uint flags, uint timeout, out IntPtr result);

    [DllImport("user32.dll")]
    public static extern IntPtr SetParent(IntPtr child, IntPtr newParent);

    [DllImport("user32.dll")]
    public static extern IntPtr GetParent(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern int MapWindowPoints(IntPtr from, IntPtr to, ref POINT pt, uint count);

    [DllImport("user32.dll")]
    public static extern int ShowWindow(IntPtr hwnd, int cmd);

    [DllImport("user32.dll")]
    public static extern int SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr64(IntPtr hwnd, int idx);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern int GetWindowLong32(IntPtr hwnd, int idx);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    private static extern IntPtr SetWindowLongPtr64(IntPtr hwnd, int idx, IntPtr value);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongW")]
    private static extern int SetWindowLong32(IntPtr hwnd, int idx, int value);

    public static long GetStyle(IntPtr hwnd, int idx)
    {
        return IntPtr.Size == 8 ? GetWindowLongPtr64(hwnd, idx).ToInt64() : (long)GetWindowLong32(hwnd, idx);
    }

    public static void SetStyle(IntPtr hwnd, int idx, long value)
    {
        if (IntPtr.Size == 8) SetWindowLongPtr64(hwnd, idx, new IntPtr(value));
        else SetWindowLong32(hwnd, idx, (int)value);
    }
}
'@

function Write-Result([string]$line) { Write-Output $line }

try {
  Add-Type -TypeDefinition $signature

  if ($Hwnd -le 0) { Write-Result 'FAIL invalid hwnd'; exit 0 }

  $h = [IntPtr]$Hwnd
  $GWL_STYLE = -16
  $WS_CHILD = [long]0x40000000
  $WS_VISIBLE = [long]0x10000000
  $WS_POPUP = [long]0x80000000
  $WS_OVERLAPPEDGROUP = [long]0x00CF0000

  if ($Mode -eq 'detach') {
    $style = [FreewaveShell]::GetStyle($h, $GWL_STYLE)
    $style = (($style -band (-bnot $WS_CHILD)) -bor $WS_POPUP -bor $WS_VISIBLE)
    [FreewaveShell]::SetStyle($h, $GWL_STYLE, $style)
    [FreewaveShell]::SetParent($h, [IntPtr]::Zero) | Out-Null
    Write-Result 'OK'
    exit 0
  }

  $progman = [FreewaveShell]::FindWindowW('Progman', $null)
  if ($progman -eq [IntPtr]::Zero) { Write-Result 'FAIL Progman not found'; exit 0 }

  $msgResult = [IntPtr]::Zero
  [FreewaveShell]::SendMessageTimeoutW($progman, 0x052C, [IntPtr]::Zero, [IntPtr]::Zero, 2, 1000, [ref]$msgResult) | Out-Null
  Start-Sleep -Milliseconds 150

  # Find the empty WorkerW that sits below the desktop-icon layer.
  $target = [IntPtr]::Zero
  $firstWorker = [IntPtr]::Zero
  $defviewHost = [IntPtr]::Zero
  $prev = [IntPtr]::Zero
  for ($i = 0; $i -lt 64; $i++) {
    $w = [FreewaveShell]::FindWindowExW([IntPtr]::Zero, $prev, 'WorkerW', $null)
    if ($w -eq [IntPtr]::Zero) { break }
    $prev = $w
    if ($firstWorker -eq [IntPtr]::Zero) { $firstWorker = $w }
    if ($defviewHost -eq [IntPtr]::Zero) {
      $dv = [FreewaveShell]::FindWindowExW($w, [IntPtr]::Zero, 'SHELLDLL_DefView', $null)
      if ($dv -ne [IntPtr]::Zero) { $defviewHost = $w }
    }
  }
  if ($defviewHost -ne [IntPtr]::Zero) {
    $next = [FreewaveShell]::FindWindowExW([IntPtr]::Zero, $defviewHost, 'WorkerW', $null)
    if ($next -ne [IntPtr]::Zero) { $target = $next }
  }
  if ($target -eq [IntPtr]::Zero) {
    # Some shells keep the icon list under Progman itself.
    $dvP = [FreewaveShell]::FindWindowExW($progman, [IntPtr]::Zero, 'SHELLDLL_DefView', $null)
    if ($dvP -ne [IntPtr]::Zero) {
      $next = [FreewaveShell]::FindWindowExW([IntPtr]::Zero, $progman, 'WorkerW', $null)
      if ($next -ne [IntPtr]::Zero) { $target = $next }
    }
  }
  if ($target -eq [IntPtr]::Zero) { $target = $firstWorker }
  if ($target -eq [IntPtr]::Zero) { Write-Result 'FAIL WorkerW not found'; exit 0 }

  # Turn the Electron window into a child of the WorkerW.
  $style = [FreewaveShell]::GetStyle($h, $GWL_STYLE)
  $style = (($style -band (-bnot $WS_POPUP) -band (-bnot $WS_OVERLAPPEDGROUP)) -bor $WS_CHILD -bor $WS_VISIBLE)
  [FreewaveShell]::SetStyle($h, $GWL_STYLE, $style)
  [FreewaveShell]::SetParent($h, $target) | Out-Null

  $actual = [FreewaveShell]::GetParent($h)
  if ($actual -ne $target) { Write-Result 'FAIL SetParent failed'; exit 0 }

  # Position inside the WorkerW client area: map the primary monitor's
  # top-left corner from screen coordinates into parent coordinates.
  $pt = New-Object FreewaveShell+POINT
  $pt.X = 0
  $pt.Y = 0
  [FreewaveShell]::MapWindowPoints([IntPtr]::Zero, $target, [ref]$pt, 1) | Out-Null
  [FreewaveShell]::SetWindowPos($h, [IntPtr]::Zero, $pt.X, $pt.Y, $Width, $Height, 0x0044) | Out-Null
  [FreewaveShell]::ShowWindow($h, 5) | Out-Null

  Write-Result 'OK'
} catch {
  Write-Result ('FAIL ' + $_.Exception.Message)
}
