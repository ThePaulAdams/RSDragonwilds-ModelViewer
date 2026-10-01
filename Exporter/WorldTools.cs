// Exports the game world around the player's bases for the base builder:
//   world/terrain/<x>_<y>.bin  landscape heights, one file per landscape component (uint16, little endian)
//   world/terrain.json         where each terrain tile sits
//   world/objects/<ix>_<iy>.json  the world's static meshes (rocks, trees, ruins...) in 256 m squares
//   world/meshes.json          the mesh paths those files refer to by number
// Heights come from the landscape's compressed heightmap storage (UE 5.6): per mip, big-endian int16 deltas
// in row order starting at 32768, followed by edge normals we don't need.
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Component.Landscape;
using CUE4Parse.UE4.Assets.Exports.Component.StaticMesh;
using System.Text.RegularExpressions;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Objects.UObject;
using Newtonsoft.Json;

public static class WorldTools
{
    // "RSDragonwilds/Content/Art/X.X" or "/Game/Art/X.X" -> "/Game/Art/X.X"; plugins -> "/<Plugin>/...".
    static string GamePath(string path)
    {
        path = path.Replace('\\', '/');
        if (!path.StartsWith('/'))
        {
            var m = Regex.Match(path, @"^(?:.*/)?([^/]+)/Content/(.+)$");
            path = m.Success ? (m.Groups[1].Value == "RSDragonwilds" ? "/Game/" : "/" + m.Groups[1].Value + "/") + m.Groups[2].Value : "/" + path;
        }
        if (!Regex.IsMatch(path, @"\.[^/]+$")) path += "." + path[(path.LastIndexOf('/') + 1)..];
        return path;
    }

    // world <paks> <usmap> <out dir> [mip]
    public static int Run(string[] a)
    {
        var p = PieceTools.Open(a[0], a[1]);
        var outDir = Path.Combine(a[2], "world");
        var mip = a.Length > 3 ? int.Parse(a[3]) : 1;
        Directory.CreateDirectory(Path.Combine(outDir, "terrain"));
        // The persistent level (always-loaded landscape) plus every streaming cell.
        var cells = p.Files.Values.Where(f => f.Extension == "umap" && f.Path.Contains("Maps/World/L_World", StringComparison.OrdinalIgnoreCase)
            && (f.Path.Contains("/_Generated_/", StringComparison.OrdinalIgnoreCase) || f.Name.Equals("L_World.umap", StringComparison.OrdinalIgnoreCase))).ToList();
        Console.WriteLine($"{cells.Count} world cells");
        var tiles = new List<object>();
        int done = 0;

        // Only meshes the viewer has exported can be drawn, so keep just those (keyed by game path, lower case).
        var known = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var manifest = Path.Combine(a[2], "models.json");
        if (File.Exists(manifest))
            foreach (var m in Newtonsoft.Json.Linq.JObject.Parse(File.ReadAllText(manifest))["Models"]!)
                known.Add(GamePath((string)m["ObjectPath"]!));
        Console.WriteLine($"{known.Count} exported meshes to match against");
        const double Square = 25600;   // cm per objects file
        var meshIds = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var squares = new Dictionary<string, List<double[]>>();
        int placed = 0, skipped = 0;
        void Add(string mesh, FTransform t)
        {
            if (!known.Contains(mesh)) { skipped++; return; }
            if (!meshIds.TryGetValue(mesh, out var id)) meshIds[mesh] = id = meshIds.Count;
            var key = $"{Math.Floor(t.Translation.X / Square)}_{Math.Floor(t.Translation.Y / Square)}";
            if (!squares.TryGetValue(key, out var list)) squares[key] = list = new();
            var q = t.Rotation; var sc = t.Scale3D;
            // mesh, x, y, z (cm), quaternion, scale x y z
            list.Add(new[] { id, Math.Round(t.Translation.X), Math.Round(t.Translation.Y), Math.Round(t.Translation.Z),
                Math.Round(q.X, 4), Math.Round(q.Y, 4), Math.Round(q.Z, 4), Math.Round(q.W, 4),
                Math.Round(sc.X, 3), Math.Round(sc.Y, 3), Math.Round(sc.Z, 3) });
            placed++;
        }
        foreach (var f in cells)
        {
            if (++done % 200 == 0) Console.WriteLine($"  {done}/{cells.Count} cells, {tiles.Count} terrain tiles");
            List<UObject> ex;
            try { ex = p.LoadPackage(f.Path).GetExports().ToList(); } catch { continue; }
            foreach (var e in ex)
            {
                if (e is not UStaticMeshComponent smc) continue;
                // Skip far-distance stand-ins (HLOD) and spline meshes (bent along roads/fences; can't be drawn rigid).
                if (e.ExportType.Contains("HLOD") || e.ExportType.Contains("Spline") || (e.Outer?.Name.Text ?? "").Contains("HLOD")) continue;
                try
                {
                    var mesh = smc.GetStaticMesh()?.ResolvedObject?.GetPathName();
                    if (string.IsNullOrEmpty(mesh)) continue;
                    var world = smc.GetAbsoluteTransform();
                    if (smc is UInstancedStaticMeshComponent ism)
                    {
                        foreach (var inst in ism.GetInstances() ?? []) Add(mesh, inst.TransformData * world);
                    }
                    else Add(mesh, world);
                }
                catch { }
            }
            var comps = ex.Where(e => e.ExportType == "LandscapeComponent").ToList();
            if (comps.Count == 0) continue;
            var storage = ex.OfType<ULandscapeTextureStorageProviderFactory>().ToList();
            foreach (var c in comps)
            {
                try
                {
                    var quads = c.GetOrDefault<int>("ComponentSizeQuads");
                    var bias = c.GetOrDefault<FVector4>("HeightmapScaleBias");
                    var tex = c.GetOrDefault<FPackageIndex>("HeightmapTexture");
                    var texObj = tex?.ResolvedObject?.Load();
                    var store = texObj == null ? null : storage.FirstOrDefault(s => s.Outer != null && s.Outer.GetPathName() == texObj.GetPathName());
                    if (store == null || store.Mips.Length <= mip) { Console.WriteLine($"  no height storage in {f.Name}"); continue; }
                    // Where the component sits: its parent (the proxy's root) plus its own offset.
                    var parent = c.GetOrDefault<FPackageIndex>("AttachParent")?.ResolvedObject?.Load();
                    var loc = parent?.GetOrDefault<FVector>("RelativeLocation") ?? new FVector(0, 0, 0);
                    var scale = parent?.GetOrDefault("RelativeScale3D", new FVector(1, 1, 1)) ?? new FVector(1, 1, 1);
                    var rel = c.GetOrDefault<FVector>("RelativeLocation");
                    loc += new FVector(rel.X * scale.X, rel.Y * scale.Y, rel.Z * scale.Z);

                    var m = store.Mips[mip];
                    var data = m.BulkData.Data ?? throw new Exception("no bulk data");
                    int size = m.SizeX, n = size * m.SizeY;
                    var heights = new ushort[n];
                    int prev = 32768;
                    for (int i = 0; i < n; i++)
                    {
                        prev = (prev + (short)((data[i * 2] << 8) | data[i * 2 + 1])) & 0xffff;
                        heights[i] = (ushort)prev;
                    }
                    // The component's part of the texture (usually all of it).
                    int verts = (quads >> mip) + 1;
                    int ox = (int)Math.Round(bias.Z * store.Mips[0].SizeX) >> mip, oy = (int)Math.Round(bias.W * store.Mips[0].SizeY) >> mip;
                    var outBytes = new byte[verts * verts * 2];
                    for (int y = 0; y < verts; y++)
                        for (int x = 0; x < verts; x++)
                        {
                            var h = heights[Math.Min(oy + y, m.SizeY - 1) * size + Math.Min(ox + x, size - 1)];
                            outBytes[(y * verts + x) * 2] = (byte)h;
                            outBytes[(y * verts + x) * 2 + 1] = (byte)(h >> 8);
                        }
                    var name = $"{Math.Round(loc.X)}_{Math.Round(loc.Y)}.bin";
                    File.WriteAllBytes(Path.Combine(outDir, "terrain", name), outBytes);
                    // x, y, z: corner in game cm. step: cm between samples. zs: cm per height unit. n: samples per side.
                    tiles.Add(new { f = name, x = loc.X, y = loc.Y, z = loc.Z, step = scale.X * (1 << mip), zs = scale.Z / 128.0, n = verts });
                }
                catch (Exception e) { Console.WriteLine($"  {f.Name}: {e.Message}"); }
            }
        }
        File.WriteAllText(Path.Combine(outDir, "terrain.json"), JsonConvert.SerializeObject(tiles));
        Directory.CreateDirectory(Path.Combine(outDir, "objects"));
        foreach (var (key, list) in squares)
            File.WriteAllText(Path.Combine(outDir, "objects", key + ".json"), JsonConvert.SerializeObject(list));
        File.WriteAllText(Path.Combine(outDir, "meshes.json"), JsonConvert.SerializeObject(meshIds.OrderBy(x => x.Value).Select(x => x.Key)));
        Console.WriteLine($"{placed} world objects ({meshIds.Count} meshes) in {squares.Count} squares; {skipped} skipped (mesh not exported)");
        Console.WriteLine($"{tiles.Count} terrain tiles written to {outDir}");
        return 0;
    }
}
