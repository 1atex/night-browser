param([Parameter(Mandatory=$true)][string]$Package, [string]$Output = "test-artifacts")
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing, System.Windows.Forms, UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class NightWindowInfo {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left,top,right,bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Key { public Guid format; public uint id; }
  [StructLayout(LayoutKind.Explicit,Size=24)] public struct Value { [FieldOffset(0)] public ushort type; [FieldOffset(8)] public IntPtr text; }
  [ComImport,Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface Store { uint GetCount(); void GetAt(uint index,out Key key); void GetValue(ref Key key,out Value value); void SetValue(ref Key key,ref Value value); void Commit(); }
  [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr window,ref Guid iid,[MarshalAs(UnmanagedType.Interface)]out Store store);
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref Value value);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window,out Rect rect);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window,int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window,uint message,IntPtr wparam,IntPtr lparam);
  public static string Property(IntPtr window,uint id) {
    Guid iid=typeof(Store).GUID;Store store;
    Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(window,ref iid,out store));
    try {
      Key key=new Key {format=new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),id=id};Value value;
      store.GetValue(ref key,out value);
      try {return value.type==31 ? Marshal.PtrToStringUni(value.text) : "";} finally {PropVariantClear(ref value);}
    } finally {Marshal.ReleaseComObject(store);}
  }
}
'@
$source = (Resolve-Path $Package).Path
$outputPath = [IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Force $outputPath | Out-Null
$testRoot = Join-Path $env:RUNNER_TEMP ("Night обычный запуск " + [Guid]::NewGuid().ToString("N"))
Copy-Item $source $testRoot -Recurse
$launcher = Join-Path $testRoot "Night.exe"
$runtimeExe = Join-Path $testRoot "runtime/NightBrowser.exe"
$profilePath = Join-Path $testRoot "profile"
$runtime = Join-Path $testRoot "runtime"
$browser = $null
function Wait-Night {
  $deadline = [DateTime]::UtcNow.AddSeconds(50)
  do {
    $process = Get-Process NightBrowser -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $runtimeExe -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($process -and [NightWindowInfo]::Property($process.MainWindowHandle,5).StartsWith("Night.Browser.")) { return $process }
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Ordinary Night window did not start with its own identity"
}
function Close-Night($process) {
  $process.Refresh()
  [NightWindowInfo]::PostMessage($process.MainWindowHandle,0x10,[IntPtr]::Zero,[IntPtr]::Zero) | Out-Null
  if (-not $process.WaitForExit(20000)) { throw "Night did not close normally" }
}
try {
  Remove-Item Env:MOZ_HEADLESS,Env:MOZ_MARIONETTE,Env:MOZ_REMOTE_ALLOW_SYSTEM_ACCESS -ErrorAction SilentlyContinue
  $version = (Get-Item $runtimeExe).VersionInfo
  if ($version.ProductName -ne "Night Browser" -or $version.FileDescription -ne "Night Browser" -or $version.OriginalFilename -ne "NightBrowser.exe") { throw "Native executable has wrong identity: $($version | Out-String)" }
  if (Test-Path (Join-Path $runtime "firefox.exe")) { throw "Stock executable remains in the package" }
  if ((Get-AuthenticodeSignature $runtimeExe).Status -ne "NotSigned") { throw "Modified runtime carries an invalid upstream signature" }
  Start-Process $launcher
  $browser = Wait-Night
  Start-Sleep -Seconds 10
  $browser.Refresh()
  $window = $browser.MainWindowHandle
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  [NightWindowInfo]::ShowWindow($window,9) | Out-Null
  [NightWindowInfo]::SetWindowPos($window,[IntPtr]::Zero,0,0,[Math]::Min(1440,$bounds.Width),[Math]::Min(960,$bounds.Height),0x40) | Out-Null
  [NightWindowInfo]::SetForegroundWindow($window) | Out-Null
  Start-Sleep -Seconds 2
  $identity = [NightWindowInfo]::Property($window,5)
  $relaunch = [NightWindowInfo]::Property($window,2)
  $label = [NightWindowInfo]::Property($window,4)
  $icon = [NightWindowInfo]::Property($window,3)
  if ($relaunch -ne "`"$launcher`"" -or $label -ne "Night Browser" -or $icon -ne "$launcher,0") { throw "Taskbar relaunch metadata does not point to Night" }
  $element = [System.Windows.Automation.AutomationElement]::FromHandle($window)
  $names = @($element.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name } | Where-Object { $_ } | Select-Object -Unique)
  $foreign = @($names | Where-Object { $_ -match 'Firefox|Mozilla|[Pp]in.+taskbar|[Зз]акреп.+панел' })
  if ($foreign.Count) { throw "Foreign first-run UI: $($foreign -join ' | ')" }
  if ($browser.MainWindowTitle -notmatch 'Night') { throw "Window has no Night identity" }
  $rect = New-Object NightWindowInfo+Rect
  [NightWindowInfo]::GetWindowRect($window,[ref]$rect) | Out-Null
  $bitmap = New-Object System.Drawing.Bitmap(($rect.right-$rect.left),($rect.bottom-$rect.top))
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($rect.left,$rect.top,0,0,$bitmap.Size)
    $bitmap.Save((Join-Path $outputPath "night-first-launch.png"),[System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $graphics.Dispose();$bitmap.Dispose() }
  [System.Windows.Forms.SendKeys]::SendWait("^l")
  [System.Windows.Forms.SendKeys]::SendWait("about:preferences#appearance{ENTER}")
  Start-Sleep -Seconds 3
  $settingsNames = @([System.Windows.Automation.AutomationElement]::FromHandle($window).FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name } | Where-Object { $_ })
  if ($settingsNames -notcontains "Внешний вид") { throw "Ordinary settings navigation did not show Night settings" }
  $bitmap = New-Object System.Drawing.Bitmap(($rect.right-$rect.left),($rect.bottom-$rect.top))
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try { $graphics.CopyFromScreen($rect.left,$rect.top,0,0,$bitmap.Size);$bitmap.Save((Join-Path $outputPath "night-settings-ordinary.png"),[System.Drawing.Imaging.ImageFormat]::Png) } finally { $graphics.Dispose();$bitmap.Dispose() }
  [System.Windows.Forms.SendKeys]::SendWait("^l")
  [System.Windows.Forms.SendKeys]::SendWait("about:home{ENTER}")
  Start-Sleep -Seconds 1
  if (-not (Test-Path (Join-Path $testRoot "Night.lnk"))) { throw "Night shortcut was not created" }
  $firstPid = $browser.Id
  Close-Night $browser
  $browser = $null
  Start-Process (Join-Path $testRoot "Night.lnk")
  $browser = Wait-Night
  if ($browser.Id -eq $firstPid -or [NightWindowInfo]::Property($browser.MainWindowHandle,5) -ne $identity) { throw "Shortcut relaunch identity changed" }
  $command = (Get-CimInstance Win32_Process -Filter "ProcessId=$($browser.Id)").CommandLine
  if (-not $command.Contains($profilePath) -or -not $command.Contains("-app")) { throw "Shortcut relaunched the wrong profile or application" }
  [ordered]@{name=$version.ProductName;description=$version.FileDescription;originalFilename=$version.OriginalFilename;windowTitle=$browser.MainWindowTitle;appId=$identity;relaunch=$relaunch;taskbarLabel=$label;icon=$icon;shortcutRelaunch=$true;ordinaryLaunch=$true;visibleNames=$names} | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $outputPath "windows-identity.json") -Encoding utf8
  Write-Output "PASS: ordinary first launch without automation, native Night identity, no Firefox promotion, taskbar relaunch metadata and Unicode shortcut relaunch"
} catch {
  $_ | Out-String | Set-Content (Join-Path $outputPath "ordinary-launch-error.txt") -Encoding utf8
  Write-Output ($_ | Out-String)
  if ($browser) {
    $browser.Refresh()
    [ordered]@{label=$label;relaunch=$relaunch;icon=$icon;identity=$identity;title=$browser.MainWindowTitle;names=$names} | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $outputPath "ordinary-launch-state.json") -Encoding utf8
    try {
      $rect = New-Object NightWindowInfo+Rect
      [NightWindowInfo]::GetWindowRect($browser.MainWindowHandle,[ref]$rect) | Out-Null
      $bitmap = New-Object System.Drawing.Bitmap(($rect.right-$rect.left),($rect.bottom-$rect.top))
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try { $graphics.CopyFromScreen($rect.left,$rect.top,0,0,$bitmap.Size);$bitmap.Save((Join-Path $outputPath "ordinary-launch-failure.png"),[System.Drawing.Imaging.ImageFormat]::Png) } finally { $graphics.Dispose();$bitmap.Dispose() }
    } catch { Write-Output $_ }
  }
  throw
} finally {
  if ($browser -and -not $browser.HasExited) {
    $browser.Refresh()
    [NightWindowInfo]::PostMessage($browser.MainWindowHandle,0x10,[IntPtr]::Zero,[IntPtr]::Zero) | Out-Null
    $browser.WaitForExit(5000) | Out-Null
  }
  Get-Process NightBrowser -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $runtimeExe } | Stop-Process -Force -ErrorAction SilentlyContinue
  Remove-ItemProperty "HKCU:/Software/Mozilla/Night/TaskBarIDs" -Name $runtime -ErrorAction SilentlyContinue
  Remove-Item $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
