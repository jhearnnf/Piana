# Puts a double-clickable Piana shortcut on the Desktop and in the Start Menu.
#
#   npm run shortcut
#
# The shortcut runs Piana.exe - the icon-stamped copy of the Electron binary
# that tools/make-exe.ps1 leaves in node_modules - against this source tree. No
# packaging step, so a rebuild shows up the next time you launch, and it is a
# GUI-subsystem binary, so double-clicking opens the app with no console window
# behind it.
#
# Pointing at Piana.exe rather than electron.exe is what fixes the taskbar:
# Windows reads a taskbar button's icon out of the running executable and
# ignores both the window icon and this shortcut's IconLocation.
#
# The IconLocation is that same Piana.exe rather than assets\icon.ico, so the
# shortcut and the taskbar button draw from one source. Naming the .ico works
# too, but the shell caches what it rasterises per icon path: re-running this
# after editing the icon leaves the shortcut on the previous rendering until
# the icon cache is rebuilt, whereas make-exe.ps1 rewrites the .exe each time
# and a changed .exe invalidates its own cache entry.
#
# Both shortcuts are also stamped with an AppUserModelID matching the one
# electron/main.cjs passes to app.setAppUserModelId, which is what ties a
# running window to its pinned button instead of leaving a second, loose one.

$ErrorActionPreference = 'Stop'

# Must match app.setAppUserModelId in electron/main.cjs.
$appId = 'com.jamespiana.piana'

$root = Split-Path -Parent $PSScriptRoot
$exe  = Join-Path $root 'node_modules\electron\dist\Piana.exe'
$icon = Join-Path $root 'assets\icon.ico'

if (-not (Test-Path $icon)) {
  throw "Icon not found at $icon - run 'npm run icon' first."
}

# The shortcut launches the built app, not the source. Without this the first
# double-click is an error dialog, which is a poor way to find out.
if (-not (Test-Path (Join-Path $root 'dist\index.html'))) {
  throw "No build found in $root\dist - run 'npm run build' first."
}

# Rebuilt every time: npm install and Electron upgrades both wipe the copy.
& (Join-Path $PSScriptRoot 'make-exe.ps1')

if (-not (Test-Path $exe)) {
  throw "Expected $exe to exist after make-exe.ps1."
}

# WScript.Shell writes a .lnk but has no way to set shell properties on it, so
# the AppUserModelID goes on afterwards through IPropertyStore. CShellLink hands
# that interface out directly - no need to touch IShellLink at all.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace Piana {
  [StructLayout(LayoutKind.Sequential)]
  public struct PropertyKey {
    public Guid fmtid;
    public uint pid;
    public PropertyKey(Guid id, uint p) { fmtid = id; pid = p; }
  }

  // Real PROPVARIANT is 24 bytes on x64; the vt lives at 0 and the union at 8
  // on both architectures. Oversizing is harmless, undersizing is not.
  [StructLayout(LayoutKind.Explicit, Size = 24)]
  public struct PropVariant {
    [FieldOffset(0)] public ushort vt;
    [FieldOffset(8)] public IntPtr pointer;
  }

  [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"),
   InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore {
    int GetCount(out uint count);
    int GetAt(uint index, out PropertyKey key);
    int GetValue(ref PropertyKey key, out PropVariant value);
    int SetValue(ref PropertyKey key, ref PropVariant value);
    int Commit();
  }

  [ComImport, Guid("0000010b-0000-0000-C000-000000000046"),
   InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPersistFile {
    int GetClassID(out Guid classId);
    int IsDirty();
    int Load([MarshalAs(UnmanagedType.LPWStr)] string file, uint mode);
    int Save([MarshalAs(UnmanagedType.LPWStr)] string file, [MarshalAs(UnmanagedType.Bool)] bool remember);
    int SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string file);
    int GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string file);
  }

  [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
  public class ShellLink { }

  public static class AppId {
    // PKEY_AppUserModel_ID
    static readonly Guid Format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
    const uint PropertyId = 5;
    const uint StgmReadWrite = 0x00000012;
    const ushort VtLpwstr = 31;

    [DllImport("ole32.dll")]
    static extern int PropVariantClear(ref PropVariant value);

    public static void Stamp(string linkPath, string appId) {
      object link = new ShellLink();
      ((IPersistFile)link).Load(linkPath, StgmReadWrite);

      IPropertyStore store = (IPropertyStore)link;
      PropertyKey key = new PropertyKey(Format, PropertyId);
      PropVariant value = new PropVariant();
      value.vt = VtLpwstr;
      value.pointer = Marshal.StringToCoTaskMemUni(appId);

      try {
        Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref value));
        Marshal.ThrowExceptionForHR(store.Commit());
      } finally {
        // SetValue copies the string, so the one we allocated is ours to free.
        PropVariantClear(ref value);
      }

      Marshal.ThrowExceptionForHR(((IPersistFile)link).Save(linkPath, true));
      Marshal.ReleaseComObject(link);
    }
  }
}
'@

$shell = New-Object -ComObject WScript.Shell

function Write-PianaShortcut([string]$Path) {
  $parent = Split-Path -Parent $Path
  if (-not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }

  $shortcut = $shell.CreateShortcut($Path)
  $shortcut.TargetPath       = $exe
  $shortcut.Arguments        = '"' + $root + '"'
  $shortcut.WorkingDirectory = $root
  $shortcut.IconLocation     = "$exe,0"
  $shortcut.Description      = 'Piana - a minimal Synthesia-style piano trainer'
  $shortcut.WindowStyle      = 1
  $shortcut.Save()

  [Piana.AppId]::Stamp($Path, $appId)
}

$desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Piana.lnk'
$programs = Join-Path ([Environment]::GetFolderPath('Programs')) 'Piana.lnk'
Write-PianaShortcut $desktop
Write-Output "Created $desktop"
Write-PianaShortcut $programs
Write-Output "Created $programs"
