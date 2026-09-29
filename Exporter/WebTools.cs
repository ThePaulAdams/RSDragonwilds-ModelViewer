// Tools for hosting the viewer online (see deploy.ps1):
//   web  <export dir> <web dir> [--max 1024]   slim copy of the export: textures as WebP, at most --max px
//   sync <web dir> <site url> <token file>      upload what the site doesn't have yet
using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;
using SkiaSharp;

static class WebTools
{
    public static int Build(string[] args)
    {
        if (args.Length < 2) { Console.WriteLine("Usage: ModelExporter web <export dir> <web dir> [--max 1024]"); return 1; }
        var (src, dst) = (Path.GetFullPath(args[0]), Path.GetFullPath(args[1]));
        var max = args.Length > 3 && args[2] == "--max" ? int.Parse(args[3]) : 1024;
        var manifest = JsonNode.Parse(File.ReadAllText(Path.Combine(src, "models.json")))!;
        var models = manifest["Models"]!.AsArray();

        var copies = new List<string>();                        // files copied as they are (.glb, previews)
        var textures = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var m in models)
        {
            copies.Add(m!["File"]!.GetValue<string>());
            foreach (var mat in m["Materials"]?.AsArray() ?? [])
                foreach (var key in new[] { "BaseColor", "Normal" })
                    if (mat![key]?.GetValue<string>() is { } png)
                    {
                        textures.Add(png);
                        mat[key] = Path.ChangeExtension(png, ".webp");
                    }
        }
        var thumbs = Path.Combine(src, "thumbs");
        if (Directory.Exists(thumbs))
            copies.AddRange(Directory.EnumerateFiles(thumbs, "*.webp", SearchOption.AllDirectories)
                .Select(f => Path.GetRelativePath(src, f).Replace('\\', '/')));

        int copied = 0, converted = 0, failed = 0;
        foreach (var rel in copies)
        {
            var (from, to) = (Path.Combine(src, rel), Path.Combine(dst, rel));
            // .glb files are compressed in place afterwards (tools/compress-glb.mjs), so only copy new ones.
            if (!File.Exists(from) || (File.Exists(to) && (rel.EndsWith(".glb") || new FileInfo(to).Length == new FileInfo(from).Length))) continue;
            Directory.CreateDirectory(Path.GetDirectoryName(to)!);
            File.Copy(from, to, true);
            copied++;
        }
        Parallel.ForEach(textures, rel =>
        {
            var (from, to) = (Path.Combine(src, rel), Path.Combine(dst, Path.ChangeExtension(rel, ".webp")));
            if (!File.Exists(from) || File.Exists(to)) return;
            try
            {
                using var bmp = SKBitmap.Decode(from) ?? throw new Exception("could not decode");
                var scale = Math.Min(1.0, (double)max / Math.Max(bmp.Width, bmp.Height));
                using var sized = scale < 1
                    ? bmp.Resize(new SKImageInfo(Math.Max(1, (int)(bmp.Width * scale)), Math.Max(1, (int)(bmp.Height * scale))), SKFilterQuality.High)
                    : null;
                using var img = SKImage.FromBitmap(sized ?? bmp);
                using var data = img.Encode(SKEncodedImageFormat.Webp, 82) ?? throw new Exception("could not encode");
                Directory.CreateDirectory(Path.GetDirectoryName(to)!);
                File.WriteAllBytes(to + ".tmp", data.ToArray());
                File.Move(to + ".tmp", to, true);
                Interlocked.Increment(ref converted);
            }
            catch (Exception e)
            {
                if (Interlocked.Increment(ref failed) <= 5) Console.WriteLine($"  texture failed: {rel}: {e.Message}");
            }
        });
        Directory.CreateDirectory(dst);
        File.WriteAllText(Path.Combine(dst, "models.json"), manifest.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        var size = Directory.EnumerateFiles(dst, "*", SearchOption.AllDirectories).Sum(f => new FileInfo(f).Length);
        Console.WriteLine($"Web copy: {copied} file(s) copied, {converted} texture(s) converted, {failed} failed. {size / 1048576.0:F0} MB in {dst}");
        return 0;
    }

    public static async Task<int> Sync(string[] args)
    {
        if (args.Length < 3) { Console.WriteLine("Usage: ModelExporter sync <web dir> <site url> <token file>"); return 1; }
        var (dir, site) = (Path.GetFullPath(args[0]), args[1].TrimEnd('/'));
        var token = File.ReadAllText(args[2]).Trim();
        using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        // What the site already has: { "path": size }.
        var have = JsonSerializer.Deserialize<Dictionary<string, long>>(await http.GetStringAsync(site + "/_data/list")) ?? [];
        var local = Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories)
            .Select(f => (Rel: Path.GetRelativePath(dir, f).Replace('\\', '/'), Size: new FileInfo(f).Length))
            .ToList();
        // models.json goes last, so the site never lists models whose files aren't there yet.
        var todo = local.Where(f => f.Rel == "models.json" || !have.TryGetValue(f.Rel, out var s) || s != f.Size)
            .OrderBy(f => f.Rel == "models.json").ToList();
        var total = todo.Sum(f => f.Size);
        Console.WriteLine($"{todo.Count} of {local.Count} file(s) to upload ({total / 1048576.0:F0} MB).");

        long sent = 0; int done = 0, failed = 0;
        var errors = new ConcurrentBag<string>();
        async Task Put((string Rel, long Size) f)
        {
            var url = site + "/_data/file/" + string.Join('/', f.Rel.Split('/').Select(Uri.EscapeDataString));
            for (var attempt = 1; ; attempt++)
            {
                try
                {
                    using var body = new StreamContent(File.OpenRead(Path.Combine(dir, f.Rel)));
                    using var r = await http.PutAsync(url, body);
                    r.EnsureSuccessStatusCode();
                    break;
                }
                catch (Exception e) when (attempt < 4) { await Task.Delay(1000 * attempt); _ = e; }
                catch (Exception e) { Interlocked.Increment(ref failed); errors.Add($"{f.Rel}: {e.Message}"); return; }
            }
            Interlocked.Add(ref sent, f.Size);
            var n = Interlocked.Increment(ref done);
            if (n % 250 == 0) Console.WriteLine($"  {n}/{todo.Count} files, {sent / 1048576.0:F0}/{total / 1048576.0:F0} MB");
        }
        await Parallel.ForEachAsync(todo.Where(f => f.Rel != "models.json"), new ParallelOptions { MaxDegreeOfParallelism = 8 },
            async (f, _) => await Put(f));
        if (failed == 0) foreach (var f in todo.Where(f => f.Rel == "models.json")) await Put(f);
        foreach (var e in errors.Take(10)) Console.WriteLine($"  upload failed: {e}");
        Console.WriteLine($"Uploaded {done} file(s), {failed} failed.");
        return failed == 0 ? 0 : 4;
    }
}
