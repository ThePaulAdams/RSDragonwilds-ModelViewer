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
        // Grid previews are re-encoded small (128px, quality 60); they only ever show as thumbnails.
        var thumbs = Path.Combine(src, "thumbs");
        var previews = Directory.Exists(thumbs)
            ? Directory.EnumerateFiles(thumbs, "*.webp", SearchOption.AllDirectories).Select(f => Path.GetRelativePath(src, f).Replace('\\', '/')).ToList()
            : [];

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
        var jobs = textures.Select(rel => (Rel: rel, Out: Path.ChangeExtension(rel, ".webp"), Max: max, Quality: 82))
            .Concat(previews.Select(rel => (Rel: rel, Out: "thumbs-small" + rel["thumbs".Length..], Max: 128, Quality: 60)));
        Parallel.ForEach(jobs, job =>
        {
            var (rel, from, to) = (job.Rel, Path.Combine(src, job.Rel), Path.Combine(dst, job.Out));
            if (!File.Exists(from) || File.Exists(to)) return;
            try
            {
                using var bmp = SKBitmap.Decode(from) ?? throw new Exception("could not decode");
                var scale = Math.Min(1.0, (double)job.Max / Math.Max(bmp.Width, bmp.Height));
                using var sized = scale < 1
                    ? bmp.Resize(new SKImageInfo(Math.Max(1, (int)(bmp.Width * scale)), Math.Max(1, (int)(bmp.Height * scale))), SKFilterQuality.High)
                    : null;
                using var img = SKImage.FromBitmap(sized ?? bmp);
                using var data = img.Encode(SKEncodedImageFormat.Webp, job.Quality) ?? throw new Exception("could not encode");
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

    // icons <render.webp> <out dir>: site icons from a transparent render (tools/render-icon.html).
    public static int Icons(string[] args)
    {
        if (args.Length < 2) { Console.WriteLine("Usage: ModelExporter icons <render.webp> <out dir>"); return 1; }
        using var src = SKBitmap.Decode(args[0]) ?? throw new Exception("could not decode " + args[0]);
        Directory.CreateDirectory(args[1]);
        // Crop to the visible pixels, then centre on a square with a little margin.
        int x0 = src.Width, y0 = src.Height, x1 = -1, y1 = -1;
        for (var y = 0; y < src.Height; y++)
            for (var x = 0; x < src.Width; x++)
                if (src.GetPixel(x, y).Alpha > 8) { x0 = Math.Min(x0, x); y0 = Math.Min(y0, y); x1 = Math.Max(x1, x); y1 = Math.Max(y1, y); }
        if (x1 < 0) throw new Exception("the render is empty");
        var side = (int)(Math.Max(x1 - x0, y1 - y0) * 1.06) + 1;
        using var square = new SKBitmap(side, side, SKColorType.Rgba8888, SKAlphaType.Premul);
        using (var c = new SKCanvas(square))
        {
            c.Clear(SKColors.Transparent);
            var crop = new SKRect(x0, y0, x1 + 1, y1 + 1);
            c.DrawBitmap(src, crop, SKRect.Create((side - crop.Width) / 2, (side - crop.Height) / 2, crop.Width, crop.Height));
        }
        byte[] Png(int size, SKColor? background = null)
        {
            using var surface = SKSurface.Create(new SKImageInfo(size, size, SKColorType.Rgba8888, SKAlphaType.Premul));
            surface.Canvas.Clear(background ?? SKColors.Transparent);
            var inset = background == null ? 0 : size * 0.08f;   // touch icons get a little breathing room
            using var paint = new SKPaint { FilterQuality = SKFilterQuality.High, IsAntialias = true };
            surface.Canvas.DrawBitmap(square, SKRect.Create(inset, inset, size - 2 * inset, size - 2 * inset), paint);
            using var img = surface.Snapshot();
            return img.Encode(SKEncodedImageFormat.Png, 100).ToArray();
        }
        var bg = new SKColor(0x14, 0x16, 0x1a);
        File.WriteAllBytes(Path.Combine(args[1], "favicon-32.png"), Png(32));
        File.WriteAllBytes(Path.Combine(args[1], "apple-touch-icon.png"), Png(180, bg));
        File.WriteAllBytes(Path.Combine(args[1], "icon-192.png"), Png(192, bg));
        File.WriteAllBytes(Path.Combine(args[1], "icon-512.png"), Png(512, bg));
        // .ico holding PNG images (16, 32, 48).
        var images = new[] { 16, 32, 48 }.Select(s => (Size: s, Data: Png(s))).ToList();
        using var ico = new BinaryWriter(File.Create(Path.Combine(args[1], "favicon.ico")));
        ico.Write((short)0); ico.Write((short)1); ico.Write((short)images.Count);
        var offset = 6 + 16 * images.Count;
        foreach (var (size, data) in images)
        {
            ico.Write((byte)size); ico.Write((byte)size); ico.Write((byte)0); ico.Write((byte)0);
            ico.Write((short)1); ico.Write((short)32); ico.Write(data.Length); ico.Write(offset);
            offset += data.Length;
        }
        foreach (var (_, data) in images) ico.Write(data);

        // 1200x630 share image for link previews (Discord, social sites).
        using (var surface = SKSurface.Create(new SKImageInfo(1200, 630)))
        {
            var c = surface.Canvas;
            using (var bgPaint = new SKPaint { Shader = SKShader.CreateLinearGradient(new SKPoint(0, 0), new SKPoint(1200, 630),
                       [new SKColor(0x1c, 0x20, 0x29), new SKColor(0x0f, 0x11, 0x15)], SKShaderTileMode.Clamp) })
                c.DrawRect(0, 0, 1200, 630, bgPaint);
            using (var paint = new SKPaint { FilterQuality = SKFilterQuality.High, IsAntialias = true })
                c.DrawBitmap(square, SKRect.Create(660, 65, 500, 500), paint);
            using var title = new SKPaint { Color = new SKColor(0xe0, 0xb6, 0x4a), IsAntialias = true, TextSize = 104,
                Typeface = SKTypeface.FromFamilyName("Segoe UI", SKFontStyle.Bold) };
            using var text = new SKPaint { Color = new SKColor(0xe6, 0xe6, 0xe6), IsAntialias = true, TextSize = 40,
                Typeface = SKTypeface.FromFamilyName("Segoe UI") };
            using var small = new SKPaint { Color = new SKColor(0x9a, 0xa3, 0xae), IsAntialias = true, TextSize = 26,
                Typeface = SKTypeface.FromFamilyName("Segoe UI") };
            c.DrawText("Ashenfallen", 70, 270, title);
            c.DrawText("Browse 3,600+ 3D models from", 72, 345, text);
            c.DrawText("RuneScape: Dragonwilds", 72, 395, text);
            c.DrawText("Fan-made. Not affiliated with Jagex.", 72, 540, small);
            using var img = surface.Snapshot();
            File.WriteAllBytes(Path.Combine(args[1], "og.png"), img.Encode(SKEncodedImageFormat.Png, 100).ToArray());
        }
        Console.WriteLine($"Icons written to {args[1]}");
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
