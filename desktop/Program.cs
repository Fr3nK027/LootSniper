using System.Diagnostics;
using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace LootSniper.Desktop;

internal static class Program
{
    internal static readonly string LogPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LootSniper", "desktop.log");
    internal static void Log(string value) { try { Directory.CreateDirectory(Path.GetDirectoryName(LogPath)!); File.AppendAllText(LogPath, DateTime.Now.ToString("O") + " " + value + Environment.NewLine); } catch { } }
    [STAThread]
    private static void Main()
    {
        Log("Avvio processo desktop");
        using var singleInstance = new Mutex(true, "Local\\LootSniper.Desktop", out var firstInstance);
        if (!firstInstance)
        {
            MessageBox.Show("LootSniper è già aperto.", "LootSniper", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        Application.ThreadException += (_, e) => Log("Errore UI: " + e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Log("Errore processo: " + e.ExceptionObject);
        ApplicationConfiguration.Initialize();
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Log("Apro finestra principale");
        Application.Run(new MainWindow());
        Log("Chiusura processo desktop");
    }
}

internal sealed class MainWindow : Form
{
    private const string DashboardUrl = "http://127.0.0.1:8765/";
    private static readonly string AppRoot = FindAppRoot();
    private readonly WebView2 dashboard = new() { Dock = DockStyle.Fill };
    private readonly CancellationTokenSource lifetime = new();
    private readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(3) };
    private Process? server;
    private BrowserScanner? scanner;
    private static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web);

    public MainWindow()
    {
        Text = "LootSniper";
        MinimumSize = new Size(960, 640);
        Size = new Size(1440, 920);
        StartPosition = FormStartPosition.CenterScreen;
        Icon = new Icon(Path.Combine(AppRoot, "assets", "lootsniper.ico"));
        Controls.Add(dashboard);
        Shown += async (_, _) => await StartAsync();
        FormClosing += (_, _) => lifetime.Cancel();
        FormClosed += async (_, _) => await StopAsync();
    }

    private async Task StartAsync()
    {
        try
        {
            Program.Log("Inizializzazione finestra");
            await EnsureServerAsync(lifetime.Token);
            Program.Log("Server locale pronto");
            var profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LootSniper", "BrowserProfile");
            Directory.CreateDirectory(profile);
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: profile);
            await dashboard.EnsureCoreWebView2Async(environment);
            Program.Log("WebView2 pronto");
            ConfigureDashboard();
            scanner = new BrowserScanner(environment, PostToDashboardAsync);
            dashboard.Source = new Uri(DashboardUrl);
        }
        catch (Exception error)
        {
            Program.Log("Avvio non riuscito: " + error);
            MessageBox.Show("LootSniper non si è avviato.\n\n" + error.Message, "LootSniper", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    private void ConfigureDashboard()
    {
        var core = dashboard.CoreWebView2;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = true;
        core.Settings.IsStatusBarEnabled = false;
        core.NewWindowRequested += (_, eventArgs) =>
        {
            eventArgs.Handled = true;
            if (Uri.TryCreate(eventArgs.Uri, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps)
                _ = ShowMarketplaceAsync(uri);
        };
        core.NavigationStarting += (_, eventArgs) =>
        {
            if (!eventArgs.Uri.StartsWith(DashboardUrl, StringComparison.OrdinalIgnoreCase)) eventArgs.Cancel = true;
        };
        core.WebMessageReceived += async (_, eventArgs) =>
        {
            if (!eventArgs.Source.StartsWith(DashboardUrl, StringComparison.OrdinalIgnoreCase)) return;
            using var message = JsonDocument.Parse(eventArgs.WebMessageAsJson);
            if (message.RootElement.TryGetProperty("type", out var type) && type.GetString() == "dashboard-close-app")
            {
                BeginInvoke(Close); return;
            }
            if (scanner is null) return;
            await scanner.HandleMessageAsync(eventArgs.WebMessageAsJson);
        };
        core.ProcessFailed += (_, _) => BeginInvoke(async () => await dashboard.CoreWebView2.CallDevToolsProtocolMethodAsync("Page.reload", "{}"));
    }

    private async Task ShowMarketplaceAsync(Uri uri)
    {
        if (dashboard.CoreWebView2 is null) return;
        var window = new MarketplaceWindow(uri.Host);
        await window.WebView.EnsureCoreWebView2Async(dashboard.CoreWebView2.Environment);
        window.WebView.Source = uri;
        window.Show(this);
    }

    private async Task EnsureServerAsync(CancellationToken token)
    {
        if (await ServerReadyAsync()) return;
        var python = Path.Combine(AppRoot, ".runtime", "pythonw.exe");
        if (!File.Exists(python)) python = Path.Combine(AppRoot, ".runtime", "python.exe");
        var isolated = File.Exists(python);
        if (!isolated) python = "python.exe";
        server = Process.Start(new ProcessStartInfo
        {
            FileName = python,
            Arguments = (isolated ? "-I " : "") + "\"" + Path.Combine(AppRoot, "server.py") + "\" --auto-stop",
            WorkingDirectory = AppRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            RedirectStandardOutput = false,
            RedirectStandardError = false
        });
        if (server is null) throw new InvalidOperationException("Avvio del server locale non riuscito.");
        for (var attempt = 0; attempt < 50; attempt++)
        {
            token.ThrowIfCancellationRequested();
            if (await ServerReadyAsync()) return;
            if (server.HasExited) throw new InvalidOperationException("Il server locale si è arrestato durante l’avvio.");
            await Task.Delay(200, token);
        }
        throw new TimeoutException("Il server locale non risponde.");
    }

    private static string FindAppRoot()
    {
        if (File.Exists(Path.Combine(AppContext.BaseDirectory, "server.py"))) return AppContext.BaseDirectory;
        var development = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", ".."));
        return File.Exists(Path.Combine(development, "server.py")) ? development : AppContext.BaseDirectory;
    }

    private async Task<bool> ServerReadyAsync()
    {
        try
        {
            using var response = await http.GetAsync(DashboardUrl + "api/status");
            if (!response.IsSuccessStatusCode) return false;
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            return json.RootElement.TryGetProperty("version", out var version) && version.GetString() == "9.0";
        }
        catch { return false; }
    }

    private Task PostToDashboardAsync(object payload)
    {
        if (IsDisposed || dashboard.CoreWebView2 is null) return Task.CompletedTask;
        var json = JsonSerializer.Serialize(payload, WebJson);
        if (InvokeRequired)
        {
            var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            BeginInvoke(() => { try { dashboard.CoreWebView2.PostWebMessageAsJson(json); completion.SetResult(); } catch (Exception error) { completion.SetException(error); } });
            return completion.Task;
        }
        dashboard.CoreWebView2.PostWebMessageAsJson(json);
        return Task.CompletedTask;
    }

    private async Task StopAsync()
    {
        lifetime.Cancel();
        scanner?.Dispose();
        try
        {
            using var content = new StringContent("{}", Encoding.UTF8, "application/json");
            using var request = new HttpRequestMessage(HttpMethod.Post, DashboardUrl + "api/shutdown") { Content = content };
            request.Headers.Referrer = new Uri(DashboardUrl);
            request.Headers.Add("Origin", DashboardUrl.TrimEnd('/'));
            await http.SendAsync(request);
        }
        catch { }
        if (server is { HasExited: false })
        {
            try { if (!server.WaitForExit(2500)) server.Kill(true); } catch { }
        }
        http.Dispose(); lifetime.Dispose();
    }
}

internal sealed class BrowserScanner : IDisposable
{
    private static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web) { PropertyNameCaseInsensitive = true };
    private static readonly IReadOnlyDictionary<string, string[]> Hosts = new Dictionary<string, string[]>(StringComparer.Ordinal)
    {
        ["VINTED"] = ["vinted.it"], ["EBAY"] = ["ebay.it", "ebay.com"], ["SUBITO"] = ["subito.it"],
        ["WALLAPOP"] = ["wallapop.com"], ["AMAZON"] = ["amazon.it"], ["BACKMARKET"] = ["backmarket.it"],
        ["REFURBED"] = ["refurbed.it"], ["CEX"] = ["webuy.com"]
    };
    private readonly CoreWebView2Environment environment;
    private readonly Func<object, Task> post;
    private readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(15) };
    private CancellationTokenSource? scan;
    private ScanStatus status = new(false, "Pronto", 0, 0, 0);

    public BrowserScanner(CoreWebView2Environment environment, Func<object, Task> post)
    {
        this.environment = environment; this.post = post;
    }

    public async Task HandleMessageAsync(string raw)
    {
        string requestId = "";
        try
        {
            using var document = JsonDocument.Parse(raw);
            var root = document.RootElement;
            requestId = root.GetProperty("requestId").GetString() ?? "";
            var type = root.GetProperty("type").GetString();
            if (type == "dashboard-run-status")
            {
                await Reply(requestId, new { ok = true, running = status.Running, status }); return;
            }
            if (type == "dashboard-stop-current")
            {
                scan?.Cancel(); await Reply(requestId, new { ok = true }); return;
            }
            if (type != "dashboard-run-current") return;
            if (status.Running) { await Reply(requestId, new { ok = false, error = "Una ricerca è già in corso." }); return; }
            var sources = ParseSources(root.GetProperty("sources"));
            if (sources.Count == 0) { await Reply(requestId, new { ok = false, error = "Nessuna sorgente valida." }); return; }
            var deep = root.TryGetProperty("deepScan", out var deepElement) && deepElement.ValueKind == JsonValueKind.True;
            scan = new CancellationTokenSource();
            _ = RunAsync(sources, deep, scan.Token);
            await Reply(requestId, new { ok = true, engine = "WebView2" });
        }
        catch (Exception error) { if (requestId.Length > 0) await Reply(requestId, new { ok = false, error = error.Message }); }
    }

    private static List<Source> ParseSources(JsonElement values)
    {
        var result = new List<Source>();
        if (values.ValueKind != JsonValueKind.Array || values.GetArrayLength() > Hosts.Count) return result;
        foreach (var value in values.EnumerateArray())
        {
            var platform = value.TryGetProperty("platform", out var p) ? p.GetString() : null;
            var text = value.TryGetProperty("url", out var u) ? u.GetString() : null;
            if (platform is null || text is null || !Hosts.TryGetValue(platform, out var allowed) || !Uri.TryCreate(text, UriKind.Absolute, out var uri)
                || uri.Scheme != Uri.UriSchemeHttps || !allowed.Any(host => uri.Host.Equals(host, StringComparison.OrdinalIgnoreCase)
                    || uri.Host.EndsWith("." + host, StringComparison.OrdinalIgnoreCase))) return [];
            result.Add(new Source(platform, uri));
        }
        return result;
    }

    private async Task RunAsync(List<Source> sources, bool deep, CancellationToken token)
    {
        var imported = 0; var updated = 0; var failures = 0;
        status = new(true, "Avvio browser integrato…", 0, 0, 0);
        try
        {
            foreach (var source in sources)
            {
                var pages = deep ? 5 : 1;
                for (var page = 1; page <= pages; page++)
                {
                    token.ThrowIfCancellationRequested();
                    status = new(true, $"{source.Platform} · pagina {page}", imported, updated, failures);
                    var items = await ReadPageAsync(source with { Url = PageUrl(source.Url, source.Platform, page) }, token);
                    if (items.Count == 0) { if (page == 1) failures++; break; }
                    var saved = await ImportAsync(source.Platform, items, token);
                    imported += saved.Imported; updated += saved.Updated;
                    if (items.Count < 8) break;
                }
            }
            status = new(false, $"{imported} nuovi · {updated} aggiornati" + (failures > 0 ? $" · {failures} fonti da verificare" : ""), imported, updated, failures);
        }
        catch (OperationCanceledException) { status = new(false, "Ricerca interrotta", imported, updated, failures); }
        catch (Exception error) { status = new(false, "Errore: " + error.Message, imported, updated, failures + 1); }
    }

    private async Task<List<Listing>> ReadPageAsync(Source source, CancellationToken token)
    {
        using var window = new ScannerWindow();
        var web = window.WebView;
        window.Show(); window.Hide();
        await web.EnsureCoreWebView2Async(environment);
        web.CoreWebView2.Settings.AreDevToolsEnabled = false;
        web.CoreWebView2.Settings.IsStatusBarEnabled = false;
        web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        web.CoreWebView2.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.Image);
        web.CoreWebView2.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.Media);
        web.CoreWebView2.WebResourceRequested += (_, e) =>
        {
            if (e.ResourceContext is CoreWebView2WebResourceContext.Image or CoreWebView2WebResourceContext.Media)
                e.Response = environment.CreateWebResourceResponse(null, 204, "No Content", "");
        };
        var completed = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        web.NavigationCompleted += (_, e) => completed.TrySetResult(e.IsSuccess);
        web.Source = source.Url;
        await completed.Task.WaitAsync(TimeSpan.FromSeconds(25), token);
        await Task.Delay(1800, token);
        await web.ExecuteScriptAsync("window.scrollTo(0, Math.min(document.body.scrollHeight, 1800));");
        await Task.Delay(900, token);
        var script = "(() => {" + ScannerScript.Code + $"; return collectLootSniper(document, {JsonSerializer.Serialize(source.Platform)}); }})()";
        var raw = await web.ExecuteScriptAsync(script);
        return JsonSerializer.Deserialize<List<Listing>>(raw, WebJson) ?? [];
    }

    private async Task<ImportResult> ImportAsync(string platform, List<Listing> items, CancellationToken token)
    {
        var body = JsonSerializer.Serialize(new { platform, items }, WebJson);
        using var response = await http.PostAsync("http://127.0.0.1:8765/api/import", new StringContent(body, Encoding.UTF8, "application/json"), token);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(token));
        return new ImportResult(json.RootElement.GetProperty("imported").GetInt32(), json.RootElement.GetProperty("updated").GetInt32());
    }

    private async Task Reply(string requestId, object result) => await post(new { source = "lootsniper-desktop", requestId, result });

    private static Uri PageUrl(Uri input, string platform, int page)
    {
        if (page <= 1 || platform == "WALLAPOP") return input;
        var parameter = platform switch { "EBAY" => "_pgn", "SUBITO" => "o", "CEX" => "page", _ => "page" };
        var builder = new UriBuilder(input);
        var query = System.Web.HttpUtility.ParseQueryString(builder.Query);
        query[parameter] = page.ToString(); builder.Query = query.ToString(); return builder.Uri;
    }

    public void Dispose() { scan?.Cancel(); scan?.Dispose(); http.Dispose(); }
    private sealed record Source(string Platform, Uri Url);
    private sealed record ImportResult(int Imported, int Updated);
    private sealed record ScanStatus(bool Running, string Message, int Imported, int Updated, int Failures);
    private sealed record Listing(string Platform, string Title, string Price, string Url, string Details, string Image);
}

internal sealed class ScannerWindow : Form
{
    public WebView2 WebView { get; } = new() { Dock = DockStyle.Fill };
    public ScannerWindow() { ShowInTaskbar = false; FormBorderStyle = FormBorderStyle.None; Opacity = 0; Size = new Size(1100, 800); Controls.Add(WebView); }
}

internal sealed class MarketplaceWindow : Form
{
    public WebView2 WebView { get; } = new() { Dock = DockStyle.Fill };
    public MarketplaceWindow(string marketplace)
    {
        Text = "LootSniper · " + marketplace;
        ShowInTaskbar = true; StartPosition = FormStartPosition.CenterParent; Size = new Size(1180, 820); MinimumSize = new Size(760, 520);
        Controls.Add(WebView);
    }
}

internal static class ScannerScript
{
    public const string Code = """
function collectLootSniper(doc, platform) {
  const host = location.hostname.replace(/^www\./, '');
  const rules = {
    EBAY: {links:'a[href*="/itm/"]', cards:'.s-item,[data-view="mi:1686"]'},
    VINTED: {links:'a[href*="/items/"]', cards:'[data-testid*="grid-item"],article,.feed-grid__item'},
    SUBITO: {links:'a[href*=".htm"]', cards:'[data-testid*="item-card"],article,[class*="ItemCard"]'},
    WALLAPOP: {links:'a[href*="/item/"]', cards:'article,[class*="ItemCard"],[class*="item-card"]'},
    AMAZON: {links:'a[href*="/dp/"],a[href*="/gp/product/"]', cards:'[data-component-type="s-search-result"]'},
    BACKMARKET: {links:'a[href*="/p/"]', cards:'article,[data-qa*="product"],li'},
    REFURBED: {links:'a[href*="/p/"]', cards:'article,[data-testid*="product"],[class*="product-card"]'},
    CEX: {links:'a[href*="/product-detail"]', cards:'article,[class*="product"],li'}
  };
  const rule = rules[platform]; if (!rule) return [];
  const allowed = {EBAY:['ebay.it','ebay.com'],VINTED:['vinted.it'],SUBITO:['subito.it'],WALLAPOP:['wallapop.com'],AMAZON:['amazon.it'],BACKMARKET:['backmarket.it'],REFURBED:['refurbed.it'],CEX:['webuy.com']}[platform];
  const clean = value => String(value || '').replace(/\s+/g,' ').trim();
  const safe = value => { try { const u=new URL(value,location.href); return u.protocol==='https:' && allowed.some(d=>u.hostname===d||u.hostname.endsWith('.'+d)) ? u.href : ''; } catch{return '';} };
  const text = node => clean(node?.innerText || node?.textContent);
  const pricePattern = /(?:€|EUR)\s*\d[\d., ]*|\d[\d., ]*\s*(?:€|EUR)/i;
  const candidates = new Set(doc.querySelectorAll(rule.cards));
  for (const link of doc.querySelectorAll(rule.links)) { const card=link.closest('article,li,[data-component-type="s-search-result"],[data-testid*="item"],[class*="card"],[class*="Card"],[class*="product"],[class*="Product"]'); if(card)candidates.add(card); }
  const found=new Map();
  for(const card of candidates){
    const link=card.querySelector(rule.links); const url=safe(link?.getAttribute('href')); if(!url||found.has(url))continue;
    const all=text(card); const price=(all.match(pricePattern)||[])[0]||'';
    const title=clean(card.querySelector('h2,h3,h4,[data-testid*="title"],[class*="title"],[class*="name"]')?.textContent || link?.getAttribute('title') || link?.getAttribute('aria-label') || card.querySelector('img')?.alt);
    if(!title||!price)continue;
    const image=card.querySelector('img');
    found.set(url,{platform,title:title.slice(0,500),price,url,details:all.slice(0,6000),image:safe(image?.currentSrc||image?.src||image?.getAttribute('data-src'))});
    if(found.size>=500)break;
  }
  return [...found.values()];
}
""";
}
