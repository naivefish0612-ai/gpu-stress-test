using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace GpuStressTestLauncher
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new LauncherForm());
        }
    }

    internal sealed class LauncherForm : Form
    {
        private readonly LocalServer server = new LocalServer();
        private readonly Label statusLabel = new Label();
        private readonly Label urlLabel = new Label();
        private readonly Label browserLabel = new Label();
        private readonly Button openButton = new Button();
        private readonly Button exitButton = new Button();
        private string chromeProfileDir;

        public LauncherForm()
        {
            Text = "GPU Stress Test";
            Width = 520;
            Height = 238;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;

            var titleLabel = new Label();
            titleLabel.Text = "GPU Stress Test Launcher";
            titleLabel.Left = 20;
            titleLabel.Top = 18;
            titleLabel.Width = 460;
            titleLabel.Height = 28;
            titleLabel.Font = new System.Drawing.Font(Font.FontFamily, 13.0f, System.Drawing.FontStyle.Bold);

            statusLabel.Text = "Starting local server...";
            statusLabel.Left = 20;
            statusLabel.Top = 58;
            statusLabel.Width = 460;
            statusLabel.Height = 24;

            urlLabel.Text = "";
            urlLabel.Left = 20;
            urlLabel.Top = 86;
            urlLabel.Width = 460;
            urlLabel.Height = 24;

            browserLabel.Text = "";
            browserLabel.Left = 20;
            browserLabel.Top = 114;
            browserLabel.Width = 460;
            browserLabel.Height = 24;

            openButton.Text = "Open Test Page";
            openButton.Left = 20;
            openButton.Top = 150;
            openButton.Width = 150;
            openButton.Height = 32;
            openButton.Enabled = false;
            openButton.Click += delegate { OpenTestPage(); };

            exitButton.Text = "Stop and Exit";
            exitButton.Left = 186;
            exitButton.Top = 150;
            exitButton.Width = 150;
            exitButton.Height = 32;
            exitButton.Click += delegate { Close(); };

            Controls.Add(titleLabel);
            Controls.Add(statusLabel);
            Controls.Add(urlLabel);
            Controls.Add(browserLabel);
            Controls.Add(openButton);
            Controls.Add(exitButton);

            Load += delegate { StartServer(); };
            FormClosing += delegate
            {
                server.Stop();
                CleanupChromeProfile();
            };
        }

        private void StartServer()
        {
            try
            {
                server.Start();
                statusLabel.Text = "Local server is running.";
                urlLabel.Text = server.Url;
                openButton.Enabled = true;
                OpenTestPage();
            }
            catch (Exception ex)
            {
                statusLabel.Text = "Failed to start local server.";
                MessageBox.Show(this, ex.Message, "GPU Stress Test", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void OpenTestPage()
        {
            if (String.IsNullOrEmpty(server.Url))
            {
                return;
            }

            try
            {
                string chromePath = FindChrome();
                if (!String.IsNullOrEmpty(chromePath))
                {
                    ApplyHighPerformanceGpuPreference(chromePath);
                    StartChromeHighPerformance(chromePath);
                    browserLabel.Text = "Opened Chrome with Windows high-performance GPU preference.";
                    return;
                }

                OpenDefaultBrowser();
                browserLabel.Text = "Chrome not found. Opened the default browser.";
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, ex.Message, "Open browser failed", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void OpenDefaultBrowser()
        {
            var startInfo = new ProcessStartInfo();
            startInfo.FileName = server.Url;
            startInfo.UseShellExecute = true;
            Process.Start(startInfo);
        }

        private void StartChromeHighPerformance(string chromePath)
        {
            if (String.IsNullOrEmpty(chromeProfileDir))
            {
                chromeProfileDir = Path.Combine(
                    Path.GetTempPath(),
                    "GPUStressTest-Chrome-" + Process.GetCurrentProcess().Id.ToString());
                Directory.CreateDirectory(chromeProfileDir);
            }

            var startInfo = new ProcessStartInfo();
            startInfo.FileName = chromePath;
            startInfo.UseShellExecute = false;
            startInfo.Arguments =
                "--user-data-dir=\"" + chromeProfileDir + "\" " +
                "--no-first-run " +
                "--new-window " +
                "--force-high-performance-gpu " +
                "--use-webgpu-power-preference=default-high-performance " +
                "--ignore-gpu-blocklist " +
                "\"" + server.Url + "\"";
            Process.Start(startInfo);
        }

        private static string FindChrome()
        {
            string[] candidates = new string[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google\\Chrome\\Application\\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google\\Chrome\\Application\\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft\\Edge\\Application\\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft\\Edge\\Application\\msedge.exe")
            };

            foreach (string candidate in candidates)
            {
                if (File.Exists(candidate))
                {
                    return candidate;
                }
            }

            return null;
        }

        private static void ApplyHighPerformanceGpuPreference(string browserPath)
        {
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\DirectX\UserGpuPreferences"))
            {
                if (key != null)
                {
                    key.SetValue(browserPath, "GpuPreference=2;", RegistryValueKind.String);
                }
            }
        }

        private void CleanupChromeProfile()
        {
            if (String.IsNullOrEmpty(chromeProfileDir))
            {
                return;
            }

            try
            {
                Directory.Delete(chromeProfileDir, true);
            }
            catch
            {
            }
        }
    }

    internal sealed class LocalServer
    {
        private readonly Dictionary<string, Asset> assets = new Dictionary<string, Asset>(StringComparer.OrdinalIgnoreCase)
        {
            { "/index.html", new Asset("index.html", "text/html; charset=utf-8") },
            { "/app.js", new Asset("app.js", "text/javascript; charset=utf-8") },
            { "/styles.css", new Asset("styles.css", "text/css; charset=utf-8") }
        };

        private TcpListener listener;
        private Thread thread;
        private volatile bool running;

        public string Url { get; private set; }

        public void Start()
        {
            if (running)
            {
                return;
            }

            Exception lastError = null;
            for (int port = 4173; port <= 4210; port++)
            {
                try
                {
                    listener = new TcpListener(IPAddress.Parse("127.0.0.1"), port);
                    listener.Start();
                    Url = "http://127.0.0.1:" + port + "/";
                    running = true;
                    thread = new Thread(ListenLoop);
                    thread.IsBackground = true;
                    thread.Start();
                    return;
                }
                catch (Exception ex)
                {
                    lastError = ex;
                    if (listener != null)
                    {
                        listener.Stop();
                        listener = null;
                    }
                }
            }

            throw new InvalidOperationException("No available local port between 4173 and 4210.", lastError);
        }

        public void Stop()
        {
            running = false;
            if (listener != null)
            {
                try { listener.Stop(); } catch { }
                listener = null;
            }
        }

        private void ListenLoop()
        {
            while (running)
            {
                try
                {
                    TcpClient client = listener.AcceptTcpClient();
                    ThreadPool.QueueUserWorkItem(delegate { HandleClient(client); });
                }
                catch
                {
                    if (running)
                    {
                        Thread.Sleep(100);
                    }
                }
            }
        }

        private void HandleClient(TcpClient client)
        {
            using (client)
            {
                try
                {
                    client.ReceiveTimeout = 5000;
                    client.SendTimeout = 5000;
                    NetworkStream stream = client.GetStream();
                    var reader = new StreamReader(stream, Encoding.ASCII);
                    string requestLine = reader.ReadLine();
                    if (String.IsNullOrEmpty(requestLine))
                    {
                        return;
                    }

                    string line;
                    while (!String.IsNullOrEmpty(line = reader.ReadLine()))
                    {
                    }

                    string[] parts = requestLine.Split(' ');
                    if (parts.Length < 2)
                    {
                        WriteText(stream, 400, "Bad request");
                        return;
                    }

                    string method = parts[0].ToUpperInvariant();
                    if (method != "GET" && method != "HEAD")
                    {
                        WriteText(stream, 405, "Method not allowed");
                        return;
                    }

                    string requestPath = NormalizePath(parts[1]);
                    if (requestPath == null)
                    {
                        WriteText(stream, 403, "Forbidden");
                        return;
                    }

                    if (requestPath == "/")
                    {
                        requestPath = "/index.html";
                    }

                    Asset asset;
                    if (!assets.TryGetValue(requestPath, out asset))
                    {
                        WriteText(stream, 404, "Not found");
                        return;
                    }

                    byte[] body = ReadResource(asset.ResourceName);
                    WriteResponse(stream, 200, asset.ContentType, body, method == "HEAD");
                }
                catch
                {
                }
            }
        }

        private static string NormalizePath(string rawTarget)
        {
            string target = rawTarget;
            int queryIndex = target.IndexOf('?');
            if (queryIndex >= 0)
            {
                target = target.Substring(0, queryIndex);
            }

            if (!target.StartsWith("/", StringComparison.Ordinal))
            {
                return null;
            }

            target = Uri.UnescapeDataString(target).Replace('\\', '/');
            if (target.IndexOf("..", StringComparison.Ordinal) >= 0)
            {
                return null;
            }

            return target;
        }

        private static byte[] ReadResource(string name)
        {
            Assembly assembly = Assembly.GetExecutingAssembly();
            using (Stream stream = assembly.GetManifestResourceStream(name))
            {
                if (stream == null)
                {
                    throw new FileNotFoundException("Embedded resource was not found: " + name);
                }

                using (var memory = new MemoryStream())
                {
                    stream.CopyTo(memory);
                    return memory.ToArray();
                }
            }
        }

        private static void WriteText(NetworkStream stream, int statusCode, string text)
        {
            byte[] body = Encoding.UTF8.GetBytes(text);
            WriteResponse(stream, statusCode, "text/plain; charset=utf-8", body, false);
        }

        private static void WriteResponse(NetworkStream stream, int statusCode, string contentType, byte[] body, bool headerOnly)
        {
            string statusText = StatusText(statusCode);
            string headers =
                "HTTP/1.1 " + statusCode + " " + statusText + "\r\n" +
                "Content-Type: " + contentType + "\r\n" +
                "Content-Length: " + body.Length + "\r\n" +
                "Cache-Control: no-store\r\n" +
                "Cross-Origin-Opener-Policy: same-origin\r\n" +
                "Cross-Origin-Embedder-Policy: require-corp\r\n" +
                "Connection: close\r\n\r\n";

            byte[] headerBytes = Encoding.ASCII.GetBytes(headers);
            stream.Write(headerBytes, 0, headerBytes.Length);
            if (!headerOnly)
            {
                stream.Write(body, 0, body.Length);
            }
        }

        private static string StatusText(int statusCode)
        {
            switch (statusCode)
            {
                case 200:
                    return "OK";
                case 400:
                    return "Bad Request";
                case 403:
                    return "Forbidden";
                case 404:
                    return "Not Found";
                case 405:
                    return "Method Not Allowed";
                default:
                    return "Error";
            }
        }
    }

    internal sealed class Asset
    {
        public Asset(string resourceName, string contentType)
        {
            ResourceName = resourceName;
            ContentType = contentType;
        }

        public string ResourceName { get; private set; }
        public string ContentType { get; private set; }
    }
}
