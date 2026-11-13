using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

internal static class ProfileImport
{
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };
    private static readonly HashSet<string> Excluded = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
        "parent.lock", "lock", ".parentlock", "cache2", "startupCache", "shader-cache", "thumbnails",
        "crashes", "minidumps", "datareporting", "safebrowsing", "chrome", "zen-themes", "user.js",
        "compatibility.ini", "addonStartup.json.lz4", "xulstore.json", "sessionCheckpoints.json"
    };
    private static void Write(string path, object value)
    {
        string temporary = path + ".tmp";
        File.WriteAllText(temporary, Json.Serialize(value), new UTF8Encoding(false));
        if (File.Exists(path)) File.Delete(path);
        File.Move(temporary, path);
    }
    private static string Child(string root, string name, string prefix)
    {
        if (!Regex.IsMatch(name ?? "", "^" + prefix + "[a-f0-9]{32}$")) throw new IOException("Некорректный путь импорта.");
        return Path.Combine(root, name);
    }
    private static void Regular(string path)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new IOException("Импорт не следует по символическим ссылкам. Выбери обычную папку профиля.");
    }
    private static bool Contains(string parent, string child)
    {
        return child.Equals(parent, StringComparison.OrdinalIgnoreCase) || child.StartsWith(parent.TrimEnd('\\', '/') + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
    }
    public static int Copy(string root, string source, string stageName)
    {
        string stage = Child(root, stageName, "import-stage-");
        string report = stage + ".json";
        long bytes = 0;
        int files = 0;
        try
        {
            source = Path.GetFullPath(source).TrimEnd('\\', '/');
            if (Contains(root, source) || Contains(source, root)) throw new IOException("Выбери профиль Zen вне папки Night.");
            Regular(source);
            if (!File.Exists(Path.Combine(source, "prefs.js")) || !File.Exists(Path.Combine(source, "places.sqlite")))
                throw new IOException("В папке нет профиля браузера: нужны prefs.js и places.sqlite.");
            if (Directory.Exists(stage)) throw new IOException("Папка импорта уже существует.");
            using (var profileLock = new FileStream(Path.Combine(source, "parent.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None))
            {
                Directory.CreateDirectory(stage);
                var pending = new Stack<KeyValuePair<string, string>>();
                pending.Push(new KeyValuePair<string, string>(source, stage));
                while (pending.Count != 0)
                {
                    var directory = pending.Pop();
                    foreach (string path in Directory.EnumerateFileSystemEntries(directory.Key))
                    {
                        string name = Path.GetFileName(path);
                        if (directory.Key == source && Excluded.Contains(name)) continue;
                        Regular(path);
                        string target = Path.Combine(directory.Value, name);
                        if (Directory.Exists(path))
                        {
                            Directory.CreateDirectory(target);
                            pending.Push(new KeyValuePair<string, string>(path, target));
                        }
                        else
                        {
                            File.Copy(path, target, false);
                            bytes += new FileInfo(target).Length;
                            files++;
                            if (files % 100 == 0) Write(report, new { status = "copying", files, bytes });
                        }
                    }
                }
            }
            Write(report, new { status = "copied", files, bytes });
            return 0;
        }
        catch (Exception error)
        {
            try { if (Directory.Exists(stage)) Directory.Delete(stage, true); } catch { }
            Write(report, new { status = "error", message = "Не удалось скопировать профиль. Закрой Zen и проверь свободное место и доступ к папке. " + error.Message });
            return 1;
        }
    }
    public static bool Apply(string root)
    {
        string journal = Path.Combine(root, "night-import.json");
        if (!File.Exists(journal)) return false;
        var plan = Json.Deserialize<Dictionary<string, string>>(File.ReadAllText(journal));
        string stage = Child(root, plan["stage"], "import-stage-");
        string backup = Child(root, plan["backup"], "profile-backup-");
        string profile = Path.Combine(root, "profile");
        string ready = Path.Combine(stage, "night-import-ready.json");
        if (!Directory.Exists(stage))
        {
            string completed = Path.Combine(profile, "night-import-ready.json");
            if (File.Exists(completed) && File.ReadAllText(completed).Trim() == plan["stage"])
            {
                File.Delete(journal);
                return true;
            }
            throw new IOException("Копия для импорта отсутствует. Текущий профиль не изменён.");
        }
        Regular(stage);
        if (!File.Exists(ready) || File.ReadAllText(ready).Trim() != plan["stage"])
            throw new IOException("Импорт ещё не готов. Текущий профиль не изменён.");
        if (Directory.Exists(profile))
        {
            Regular(profile);
            try { using (var profileLock = new FileStream(Path.Combine(profile, "parent.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None)) { } }
            catch (IOException) { return false; }
            if (Directory.Exists(backup)) throw new IOException("Резервная копия уже существует; профиль сохранён без изменений.");
            Directory.Move(profile, backup);
        }
        try
        {
            Directory.Move(stage, profile);
            File.Delete(journal);
        }
        catch
        {
            if (!Directory.Exists(profile) && Directory.Exists(backup)) Directory.Move(backup, profile);
            throw;
        }
        return true;
    }
}
