using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;
using System.Runtime.InteropServices.ComTypes;

[assembly: AssemblyTitle("Night Browser")]
[assembly: AssemblyDescription("Night Browser")]
[assembly: AssemblyCompany("Night")]
[assembly: AssemblyProduct("Night Browser")]
[assembly: AssemblyVersion("0.5.2.0")]

internal static class Launcher
{
    private static readonly string Root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    private static readonly string LauncherPath = Path.Combine(Root, "Night.exe");
    private static readonly Guid AppKey = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
    private delegate bool WindowCallback(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(WindowCallback callback, IntPtr data);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder value, int length);
    [DllImport("shell32.dll")] private static extern int SHGetPropertyStoreForWindow(IntPtr window, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);
    [DllImport("ole32.dll")] private static extern int PropVariantClear(ref PropVariant value);

    [StructLayout(LayoutKind.Sequential)] private struct PropertyKey { public Guid format; public uint id; public PropertyKey(uint key) { format = AppKey; id = key; } }
    [StructLayout(LayoutKind.Explicit, Size = 24)] private struct PropVariant { [FieldOffset(0)] public ushort type; [FieldOffset(8)] public IntPtr pointer; }
    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        uint GetCount();
        void GetAt(uint index, out PropertyKey key);
        void GetValue(ref PropertyKey key, out PropVariant value);
        void SetValue(ref PropertyKey key, ref PropVariant value);
        void Commit();
    }
    [ComImport, Guid("00021401-0000-0000-C000-000000000046")] private class ShellLink { }
    [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellLink
    {
        void GetPath(StringBuilder path, int size, IntPtr find, uint flags);
        void GetIDList(out IntPtr list);
        void SetIDList(IntPtr list);
        void GetDescription(StringBuilder description, int size);
        void SetDescription(string description);
        void GetWorkingDirectory(StringBuilder directory, int size);
        void SetWorkingDirectory(string directory);
        void GetArguments(StringBuilder arguments, int size);
        void SetArguments(string arguments);
        void GetHotkey(out short hotkey);
        void SetHotkey(short hotkey);
        void GetShowCmd(out int command);
        void SetShowCmd(int command);
        void GetIconLocation(StringBuilder path, int size, out int index);
        void SetIconLocation(string path, int index);
        void SetRelativePath(string path, uint reserved);
        void Resolve(IntPtr window, uint flags);
        void SetPath(string path);
    }
    private static string Identity()
    {
        using (var hash = SHA256.Create())
            return "Night.Browser." + BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(Root.ToLowerInvariant())), 0, 8).Replace("-", "");
    }
    private static void Set(IPropertyStore store, uint id, string text)
    {
        var key = new PropertyKey(id);
        var value = new PropVariant { type = 31, pointer = Marshal.StringToCoTaskMemUni(text) };
        try { store.SetValue(ref key, ref value); }
        finally { PropVariantClear(ref value); }
    }
    private static void Shortcut(string identity)
    {
        object instance = new ShellLink();
        try
        {
            var link = (IShellLink)instance;
            link.SetPath(LauncherPath);
            link.SetWorkingDirectory(Root);
            link.SetDescription("Night Browser");
            link.SetIconLocation(LauncherPath, 0);
            link.SetShowCmd(1);
            var store = (IPropertyStore)instance;
            Set(store, 5, identity);
            store.Commit();
            ((IPersistFile)instance).Save(Path.Combine(Root, "Night.lnk"), true);
        }
        finally { Marshal.ReleaseComObject(instance); }
    }
    private static bool ApplyWindows(int pid, string identity)
    {
        bool found = false;
        EnumWindows(delegate(IntPtr window, IntPtr unused)
        {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner != pid || !IsWindowVisible(window)) return true;
            var name = new StringBuilder(128);
            GetClassName(window, name, name.Capacity);
            if (name.ToString() != "MozillaWindowClass") return true;
            IPropertyStore store;
            Guid iid = typeof(IPropertyStore).GUID;
            if (SHGetPropertyStoreForWindow(window, ref iid, out store) != 0) return true;
            try
            {
                Set(store, 2, "\"" + LauncherPath + "\"");
                Set(store, 3, LauncherPath + ",0");
                Set(store, 4, "Night Browser");
                Set(store, 5, identity);
                store.Commit();
                found = true;
            }
            finally { Marshal.ReleaseComObject(store); }
            return true;
        }, IntPtr.Zero);
        return found;
    }
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling", false);
            AppContext.SetSwitch("Switch.System.IO.BlockLongPaths", false);
            string identity = Identity();
            if (args.Length == 2 && args[0] == "--identity")
                return ApplyWindows(int.Parse(args[1]), identity) ? 0 : 2;
            if (args.Length == 3 && args[0] == "--copy-zen")
                return ProfileImport.Copy(Root, args[1], args[2]);
            if (args.Length == 2 && args[0] == "--finish-import")
            {
                try { using (var previous = Process.GetProcessById(int.Parse(args[1]))) if (!previous.WaitForExit(60000)) return 2; }
                catch (ArgumentException) { }
            }
            using (var gate = new Mutex(false, "Local\\" + identity + ".Import"))
            {
                try { if (!gate.WaitOne(10000)) throw new IOException("Другой запуск Night ещё завершает импорт."); }
                catch (AbandonedMutexException) { }
                try { ProfileImport.Apply(Root); }
                finally { gate.ReleaseMutex(); }
            }
            if (args.Length == 1 && args[0] == "--apply-import") return 0;
            string runtime = Path.Combine(Root, "runtime");
            string executable = Path.Combine(runtime, "NightBrowser.exe");
            string application = Path.Combine(runtime, "browser", "application.ini");
            string profile = Path.Combine(Root, "profile");
            if (!File.Exists(executable) || !File.Exists(application))
                throw new FileNotFoundException("Распакуй архив целиком перед запуском Night.");
            Directory.CreateDirectory(profile);
            using (var key = Registry.CurrentUser.CreateSubKey("Software\\Mozilla\\Night\\TaskBarIDs"))
                key.SetValue(runtime, identity, RegistryValueKind.String);
            Shortcut(identity);
            var start = new ProcessStartInfo(executable)
            {
                Arguments = "-app \"" + application + "\" -profile \"" + profile + "\"",
                WorkingDirectory = runtime,
                UseShellExecute = false
            };
            start.EnvironmentVariables["MOZ_APP_REMOTINGNAME"] = "night-browser";
            using (var process = Process.Start(start))
            {
                for (int attempt = 0; attempt < 120 && !process.HasExited && Environment.GetEnvironmentVariable("MOZ_HEADLESS") != "1"; attempt++)
                {
                    if (ApplyWindows(process.Id, identity)) break;
                    Thread.Sleep(250);
                }
            }
            return 0;
        }
        catch (Exception error)
        {
            if (args.Length == 0 || args[0] == "--finish-import") MessageBox.Show(error.Message, "Night Browser", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
