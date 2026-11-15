using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Text.RegularExpressions;
using Microsoft.Win32;
using System.Runtime.InteropServices.ComTypes;

[assembly: AssemblyTitle("Night Browser")]
[assembly: AssemblyDescription("Night Browser")]
[assembly: AssemblyCompany("Night")]
[assembly: AssemblyProduct("Night Browser")]
[assembly: AssemblyVersion("0.15.0.0")]

internal static class Launcher
{
    private static readonly string Root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    private static readonly bool Installed = File.Exists(Path.Combine(Root, "installed.marker"));
    private static readonly string BaseDataRoot = Installed ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NightBrowser") : Root;
    private static string DataRoot = BaseDataRoot;
    private static string ProfileId = "default";
    private static string ProfileLabel = "Личный";
    private static readonly string LauncherPath = Path.Combine(Root, "Night.exe");
    private static readonly Guid AppKey = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
    private delegate bool WindowCallback(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(WindowCallback callback, IntPtr data);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
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
        return BaseIdentity() + (ProfileId == "default" ? "" : "." + ProfileId);
    }
    private static string BaseIdentity()
    {
        if (Installed) return "Night.Browser.Installed";
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
                Set(store, 2, Quote(LauncherPath) + " --profile-id " + ProfileId);
                Set(store, 3, LauncherPath + ",0");
                Set(store, 4, ProfileId == "default" ? "Night Browser" : "Night Browser · " + ProfileLabel);
                Set(store, 5, identity);
                store.Commit();
                found = true;
            }
            finally { Marshal.ReleaseComObject(store); }
            return true;
        }, IntPtr.Zero);
        return found;
    }
    private static bool Activate(string identity, string executable)
    {
        bool found = false;
        EnumWindows(delegate(IntPtr window, IntPtr unused)
        {
            if (!IsWindowVisible(window)) return true;
            var name = new StringBuilder(128);
            GetClassName(window, name, name.Capacity);
            if (name.ToString() != "MozillaWindowClass") return true;
            uint pid;
            GetWindowThreadProcessId(window, out pid);
            try
            {
                using (var owner = Process.GetProcessById((int)pid))
                    if (!string.Equals(owner.MainModule.FileName, executable, StringComparison.OrdinalIgnoreCase)) return true;
                IPropertyStore store;
                Guid iid = typeof(IPropertyStore).GUID;
                if (SHGetPropertyStoreForWindow(window, ref iid, out store) != 0) return true;
                try
                {
                    var key = new PropertyKey(5);
                    PropVariant value;
                    store.GetValue(ref key, out value);
                    try { found = value.type == 31 && Marshal.PtrToStringUni(value.pointer) == identity; }
                    finally { PropVariantClear(ref value); }
                }
                finally { Marshal.ReleaseComObject(store); }
                if (found)
                {
                    if (IsIconic(window)) ShowWindow(window, 9);
                    SetForegroundWindow(window);
                    return false;
                }
            }
            catch (Exception) { }
            return true;
        }, IntPtr.Zero);
        return found;
    }
    private static string ProfileRoot(string id)
    {
        if (!Regex.IsMatch(id ?? "", "^(default|[a-f0-9]{32})$")) throw new ArgumentException("Неизвестный профиль.");
        if (id == "default") return BaseDataRoot;
        string path = Path.Combine(BaseDataRoot, "profiles", id);
        string profile = Path.Combine(path, "profile");
        if (!File.Exists(Path.Combine(path, "night-profile.json")) || !Directory.Exists(profile))
            throw new DirectoryNotFoundException("Профиль не найден.");
        foreach (string directory in new[] { Path.GetDirectoryName(path), path, profile })
            if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) throw new IOException("Профиль не должен быть символической ссылкой.");
        return path;
    }
    private static string[] SelectProfile(string[] args)
    {
        var remaining = new List<string>();
        string selected = null;
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] != "--profile-id") { remaining.Add(args[i]); continue; }
            if (selected != null || ++i >= args.Length) throw new ArgumentException("Укажи профиль один раз.");
            selected = args[i];
        }
        if (selected == null)
        {
            try
            {
                string path = Path.Combine(BaseDataRoot, "night-active-profile");
                if (new FileInfo(path).Length > 64) throw new IOException();
                selected = File.ReadAllText(path).Trim();
                ProfileRoot(selected);
            }
            catch { selected = "default"; }
        }
        DataRoot = ProfileRoot(selected);
        ProfileId = selected;
        try
        {
            string path = Path.Combine(DataRoot, "night-profile.json");
            if (new FileInfo(path).Length < 16384)
            {
                var data = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(path));
                string label = data["name"] as string;
                if (!string.IsNullOrWhiteSpace(label) && label.Length <= 40) ProfileLabel = label;
            }
        }
        catch { }
        return remaining.ToArray();
    }
    private static void RememberProfile()
    {
        using (var gate = new Mutex(false, "Local\\" + BaseIdentity() + ".Profiles"))
        {
            try { if (!gate.WaitOne(5000)) return; }
            catch (AbandonedMutexException) { }
            string path = Path.Combine(BaseDataRoot, "night-active-profile"), temporary = path + ".tmp";
            try
            {
                File.WriteAllText(temporary, ProfileId, new UTF8Encoding(false));
                if (File.Exists(path)) File.Replace(temporary, path, null); else File.Move(temporary, path);
            }
            finally { gate.ReleaseMutex(); }
        }
    }
    private static string Quote(string value)
    {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value)
        {
            if (character == '\\') { slashes++; continue; }
            result.Append('\\', character == '\"' ? slashes * 2 + 1 : slashes);
            result.Append(character);
            slashes = 0;
        }
        result.Append('\\', slashes * 2);
        return result.Append('\"').ToString();
    }
    private static bool CacheIsCurrent(string profile, string executable)
    {
        try
        {
            var json = new JavaScriptSerializer();
            var build = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(Root, "BUILD.json")));
            var previous = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(profile, "night-runtime.json")));
            string revision = build["night_revision"] as string;
            return revision != null && revision.Length == 40 && revision == previous["revision"] as string &&
                string.Equals(executable, previous["application"] as string, StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            if (args.Length == 2 && args[0] == "--run-update") return UpdateRunner.Run(args[1]);
            AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling", false);
            AppContext.SetSwitch("Switch.System.IO.BlockLongPaths", false);
            Directory.CreateDirectory(BaseDataRoot);
            args = SelectProfile(args);
            if (args.Length == 2 && args[0] == "--join")
            {
                Uri invite;
                if (!Uri.TryCreate(args[1], UriKind.Absolute, out invite) || invite.Scheme != "night" || invite.Host != "join" || !Regex.IsMatch(invite.AbsolutePath, "^/[a-f0-9]{64}$") || invite.Query != "" || invite.Fragment != "" || invite.UserInfo != "" || !invite.IsDefaultPort)
                    throw new ArgumentException("Некорректное приглашение Night.");
                args = new[] { "--url", "https://browser.night-watchers.com/join" + invite.AbsolutePath };
            }
            Directory.CreateDirectory(DataRoot);
            string identity = Identity();
            if (args.Length == 1 && args[0] == "--default-browser")
            {
                Process.Start(new ProcessStartInfo("ms-settings:defaultapps") { UseShellExecute = true });
                return 0;
            }
            if (args.Length == 2 && args[0] == "--identity")
                return ApplyWindows(int.Parse(args[1]), identity) ? 0 : 2;
            if (args.Length == 3 && args[0] == "--copy-zen")
                return ProfileImport.Copy(DataRoot, args[1], args[2], Root);
            if (args.Length == 2 && args[0] == "--finish-import")
            {
                try { using (var previous = Process.GetProcessById(int.Parse(args[1]))) if (!previous.WaitForExit(60000)) return 2; }
                catch (ArgumentException) { }
            }
            using (var gate = new Mutex(false, "Local\\" + identity + ".Import"))
            {
                try { if (!gate.WaitOne(10000)) throw new IOException("Другой запуск Night ещё завершает импорт."); }
                catch (AbandonedMutexException) { }
                try { ProfileImport.Apply(DataRoot); }
                finally { gate.ReleaseMutex(); }
            }
            if (args.Length == 1 && args[0] == "--apply-import") return 0;
            string runtime = Path.Combine(Root, "runtime");
            string executable = Path.Combine(runtime, "NightBrowser.exe");
            string application = Path.Combine(runtime, "browser", "application.ini");
            string profile = Path.Combine(DataRoot, "profile");
            if (!File.Exists(executable) || !File.Exists(application))
                throw new FileNotFoundException("Распакуй архив целиком перед запуском Night.");
            Directory.CreateDirectory(profile);
            using (var skeleton = Registry.CurrentUser.CreateSubKey("Software\\Mozilla\\Firefox\\PreXULSkeletonUISettings"))
                skeleton.SetValue(executable + "|Enabled", 0, RegistryValueKind.DWord);
            using (var key = Registry.CurrentUser.CreateSubKey("Software\\Mozilla\\Night\\TaskBarIDs"))
                key.SetValue(runtime, identity, RegistryValueKind.String);
            if (!Installed && ProfileId == "default") Shortcut(identity);
            var start = new ProcessStartInfo(executable)
            {
                Arguments = "-app \"" + application + "\" -profile \"" + profile + "\"",
                WorkingDirectory = runtime,
                UseShellExecute = false
            };
            if (!CacheIsCurrent(profile, executable))
            {
                start.Arguments += " -purgecaches";
                if (File.Exists(Path.Combine(profile, "night-runtime.json")))
                    File.WriteAllText(Path.Combine(profile, "night-update-completed.json"), "{\"completed\":true}", new UTF8Encoding(false));
            }
            if (args.Length == 2 && args[0] == "--url")
            {
                Uri target;
                if (!Uri.TryCreate(args[1], UriKind.Absolute, out target) || !(target.Scheme == "http" || target.Scheme == "https" || target.Scheme == "file"))
                    throw new ArgumentException("Некорректный адрес страницы.");
                start.Arguments += " -url " + Quote(target.AbsoluteUri);
            }
            start.EnvironmentVariables["MOZ_APP_REMOTINGNAME"] = ProfileId == "default" ? "night-browser" : "night-browser-" + ProfileId;
            using (var gate = new Mutex(false, "Local\\" + identity + ".Launch"))
            {
                try { if (!gate.WaitOne(45000)) throw new IOException("Профиль ещё запускается."); }
                catch (AbandonedMutexException) { }
                try
                {
                    if (args.Length == 0 && Environment.GetEnvironmentVariable("MOZ_HEADLESS") != "1" && Activate(identity, executable)) { RememberProfile(); return 0; }
                    using (var process = Process.Start(start))
                    {
                        for (int attempt = 0; attempt < 120 && !process.HasExited && Environment.GetEnvironmentVariable("MOZ_HEADLESS") != "1"; attempt++)
                        {
                            if (ApplyWindows(process.Id, identity)) break;
                            Thread.Sleep(250);
                        }
                        if (process.HasExited && process.ExitCode != 0) return process.ExitCode;
                    }
                    RememberProfile();
                }
                finally { gate.ReleaseMutex(); }
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
