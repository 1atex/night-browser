using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Collections.Generic;

internal static class UpdateRunner
{
    public static int Run(string planPath)
    {
        try
        {
            var plan = new JavaScriptSerializer().Deserialize<Dictionary<string, string>>(File.ReadAllText(planPath));
            string root = Path.GetFullPath(plan["root"]);
            string setup = Path.GetFullPath(plan["setup"]);
            if (!File.Exists(Path.Combine(root, "installed.marker"))) throw new IOException("Обновление доступно для установленной версии Night.");
            string actual;
            using (var hash = SHA256.Create()) using (var stream = File.OpenRead(setup))
                actual = BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
            if (actual != plan["sha256"]) throw new IOException("Контрольная сумма обновления не совпала.");
            string executable = Path.Combine(root, "runtime", "NightBrowser.exe");
            var deadline = DateTime.UtcNow.AddSeconds(120);
            bool running;
            bool requested = false;
            do
            {
                running = false;
                foreach (var process in Process.GetProcessesByName("NightBrowser")) using (process)
                {
                    try
                    {
                        if (!string.Equals(process.MainModule.FileName, executable, StringComparison.OrdinalIgnoreCase)) continue;
                        running = true;
                        if (!requested) process.CloseMainWindow();
                    }
                    catch (System.ComponentModel.Win32Exception) { throw new IOException("Не удалось проверить закрытие Night."); }
                    catch (InvalidOperationException) { }
                }
                requested = true;
                if (running) Thread.Sleep(500);
            } while (running && DateTime.UtcNow < deadline);
            if (running) throw new IOException("Обновление отменено: окна Night не закрыты. Заверши работу со страницами и повтори попытку.");
            using (var setupProcess = Process.Start(new ProcessStartInfo(setup) {UseShellExecute = false, Arguments = "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /NOCLOSEAPPLICATIONS /DIR=\"" + root + "\""}))
            {
                setupProcess.WaitForExit();
                if (setupProcess.ExitCode != 0) throw new IOException("Установщик не завершил обновление. Код: " + setupProcess.ExitCode);
            }
            if (!System.Text.RegularExpressions.Regex.IsMatch(plan["profile"], "^(default|[a-f0-9]{32})$")) throw new IOException("Неизвестный профиль.");
            string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NightBrowser");
            string profile = plan["profile"] == "default" ? Path.Combine(data, "profile") : Path.Combine(data, "profiles", plan["profile"], "profile");
            File.WriteAllText(Path.Combine(profile, "night-update-completed.json"), "{\"completed\":true}", new UTF8Encoding(false));
            Process.Start(new ProcessStartInfo(Path.Combine(root, "Night.exe")) {UseShellExecute = false, Arguments = "--profile-id " + plan["profile"]});
            File.Delete(setup);
            File.Delete(planPath);
            return 0;
        }
        catch (Exception error)
        {
            System.Windows.Forms.MessageBox.Show(error.Message, "Обновление Night", System.Windows.Forms.MessageBoxButtons.OK, System.Windows.Forms.MessageBoxIcon.Error);
            return 1;
        }
    }
}
