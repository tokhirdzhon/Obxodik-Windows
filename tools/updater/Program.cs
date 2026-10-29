using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows.Forms;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string installer = args.Length > 0
            ? args[0]
            : Path.Combine(baseDir, "Obxodik-Setup-1.0.3.exe");
        string app = @"C:\Program Files\Obxodik\Obxodik.exe";
        string installDir = Path.GetDirectoryName(app);

        try
        {
            if (!File.Exists(installer))
                throw new FileNotFoundException("Не найден установщик: " + installer);
            if (!File.Exists(app))
                throw new FileNotFoundException("Не найден установленный Obxodik: " + app);

            StopProcess("Obxodik", installDir);
            StopProcess("winws", installDir);
            StopProcess("tgws-core", installDir);
            Thread.Sleep(800);

            var installInfo = new ProcessStartInfo(installer, "/S");
            installInfo.UseShellExecute = false;
            installInfo.WorkingDirectory = Path.GetDirectoryName(installer);
            installInfo.CreateNoWindow = true;

            using (Process installerProcess = Process.Start(installInfo))
            {
                installerProcess.WaitForExit();
                if (installerProcess.ExitCode != 0)
                    throw new Exception("Установщик завершился с кодом " + installerProcess.ExitCode);
            }

            if (!File.Exists(app))
                throw new FileNotFoundException("После обновления не найден " + app);

            var appInfo = new ProcessStartInfo(app);
            appInfo.UseShellExecute = true;
            appInfo.WorkingDirectory = installDir;
            Process.Start(appInfo);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "Не удалось обновить Obxodik:\n\n" + ex.Message,
                "Obxodik Update",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    private static void StopProcess(string name, string installDir)
    {
        foreach (Process process in Process.GetProcessesByName(name))
        {
            try
            {
                bool ours = true;
                try
                {
                    string path = process.MainModule.FileName;
                    ours = path.StartsWith(installDir, StringComparison.OrdinalIgnoreCase);
                }
                catch
                {
                    // If the path cannot be read, still stop known Obxodik process names.
                }

                if (!ours)
                    continue;

                process.Kill();
                process.WaitForExit(5000);
            }
            catch
            {
                // The process may have already exited.
            }
        }
    }
}
