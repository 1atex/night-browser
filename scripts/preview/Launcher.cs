using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("Night Browser Preview")]
[assembly: AssemblyProduct("Night Browser")]
[assembly: AssemblyVersion("0.2.0.0")]

internal static class Launcher
{
    [STAThread]
    private static int Main()
    {
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string runtime = Path.Combine(root, "runtime");
            string executable = Path.Combine(runtime, "firefox.exe");
            string application = Path.Combine(runtime, "browser", "application.ini");
            string profile = Path.Combine(root, "profile");
            if (!File.Exists(executable) || !File.Exists(application))
                throw new FileNotFoundException("Распакуй архив целиком перед запуском Night.");
            Directory.CreateDirectory(profile);
            var start = new ProcessStartInfo(executable)
            {
                Arguments = "-app \"" + application + "\" -no-remote -profile \"" + profile + "\"",
                WorkingDirectory = runtime,
                UseShellExecute = false
            };
            start.EnvironmentVariables["MOZ_APP_REMOTINGNAME"] = "night-preview";
            Process.Start(start);
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Night Browser", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
