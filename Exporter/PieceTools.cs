// Reads build-piece data from the game files, so the base builder can turn the piece ids in a
// save file (Wilds.sav) into names and models.
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Versions;
using CUE4Parse.UE4.Objects.Core.Misc;
using CUE4Parse.Encryption.Aes;
using CUE4Parse.MappingsProvider.Usmap;
using CUE4Parse.Compression;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

public static class PieceTools
{
    public static DefaultFileProvider Open(string paks, string usmap)
    {
        try
        {
            var oodle = Path.Combine(AppContext.BaseDirectory, OodleHelper.OodleFileName);
            if (!File.Exists(oodle)) OodleHelper.DownloadOodleDll(ref oodle);
            OodleHelper.Initialize(oodle);
        }
        catch { }
        var p = new DefaultFileProvider(paks, SearchOption.TopDirectoryOnly,
            new VersionContainer(EGame.GAME_UE5_6), StringComparer.OrdinalIgnoreCase);
        p.MappingsContainer = new FileUsmapTypeMappingsProvider(usmap, StringComparer.OrdinalIgnoreCase);
        p.Initialize();
        p.SubmitKey(new FGuid(), new FAesKey("0x" + new string('0', 64)));
        p.PostMount();
        return p;
    }

    // Debug helper: pieces-find <paks> <usmap> <text>   lists package paths containing text.
    // pieces-dump <paks> <usmap> <package path>          prints the package's exports as JSON.
    public static int Run(string mode, string[] a)
    {
        var p = Open(a[0], a[1]);
        if (mode == "pieces-find")
        {
            foreach (var f in p.Files.Values.Where(f => (f.Extension == "uasset" || f.Extension == "umap") && f.Path.Contains(a[2], StringComparison.OrdinalIgnoreCase)).Take(a.Length > 3 ? int.Parse(a[3]) : 400))
                Console.WriteLine(f.Path);
            return 0;
        }
        if (mode == "pieces-scan")
        {
            var uassets = p.Files.Values.Where(f => f.Extension.Equals("uasset", StringComparison.OrdinalIgnoreCase)).ToList();
            Console.WriteLine($"Total uasset files: {uassets.Count}");
            var groups = uassets.GroupBy(f => {
                var name = Path.GetFileNameWithoutExtension(f.Path);
                var prefix = name.Contains('_') ? name.Substring(0, name.IndexOf('_') + 1) : "Other";
                return prefix;
            }).OrderByDescending(g => g.Count());
            Console.WriteLine("Top Asset Prefixes:");
            foreach (var g in groups.Take(25))
                Console.WriteLine($"  {g.Key,-15} : {g.Count()}");

            var smFiles = uassets.Where(f => Path.GetFileName(f.Path).StartsWith("SM_", StringComparison.OrdinalIgnoreCase)).ToList();
            Console.WriteLine($"Total SM_ static meshes: {smFiles.Count}");
            var smRoots = smFiles.GroupBy(f => f.Path.Split('/')[0]).OrderByDescending(g => g.Count());
            foreach (var r in smRoots)
                Console.WriteLine($"  SM_ root {r.Key,-20}: {r.Count()}");

            var skFiles = uassets.Where(f => Path.GetFileName(f.Path).StartsWith("SK_", StringComparison.OrdinalIgnoreCase)).ToList();
            Console.WriteLine($"Total SK_ skeletal meshes: {skFiles.Count}");
            var skRoots = skFiles.GroupBy(f => f.Path.Split('/')[0]).OrderByDescending(g => g.Count());
            foreach (var r in skRoots)
                Console.WriteLine($"  SK_ root {r.Key,-20}: {r.Count()}");

            var bpFiles = uassets.Where(f => Path.GetFileName(f.Path).StartsWith("BP_", StringComparison.OrdinalIgnoreCase) || Path.GetFileName(f.Path).StartsWith("B_", StringComparison.OrdinalIgnoreCase)).ToList();
            Console.WriteLine($"Total BP_/B_ blueprints: {bpFiles.Count}");

            var vfxFiles = uassets.Where(f => Path.GetFileName(f.Path).StartsWith("NS_", StringComparison.OrdinalIgnoreCase) || Path.GetFileName(f.Path).StartsWith("FXS_", StringComparison.OrdinalIgnoreCase) || Path.GetFileName(f.Path).StartsWith("PS_", StringComparison.OrdinalIgnoreCase) || f.Path.Contains("/VFX/", StringComparison.OrdinalIgnoreCase)).ToList();
            Console.WriteLine($"Total VFX/Niagara/Emitter files: {vfxFiles.Count}");

            var chestFiles = uassets.Where(f => f.Path.Contains("Chest", StringComparison.OrdinalIgnoreCase)).ToList();
            Console.WriteLine($"Chest-related assets: {chestFiles.Count}");
            foreach (var c in chestFiles.Take(25))
                Console.WriteLine($"  Chest asset: {c.Path}");

            return 0;
        }
        if (mode == "pieces-dump")
        {
            var pkg = p.LoadPackage(a[2]);
            Console.WriteLine(JsonConvert.SerializeObject(pkg.GetExports(), Formatting.Indented));
            return 0;
        }
        if (mode == "pieces") return Export(p, a[2]);
        if (mode == "pieces-probe")
        {
            // Dump members of the export whose type is a[3] in package a[2], and any byte[] bulk data to <a[4]>.
            var pkg = p.LoadPackage(a[2]);
            foreach (var e in pkg.GetExports().Where(x => x.ExportType == a[3]))
            {
                Console.WriteLine($"{e.GetType().FullName} {e.Name}");
                void Dump(object o, string pre, int depth)
                {
                    if (o == null || depth > 4) return;
                    foreach (var m in o.GetType().GetMembers(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance))
                    {
                        object? v = null;
                        try { v = m is System.Reflection.FieldInfo fi ? fi.GetValue(o) : m is System.Reflection.PropertyInfo pi && pi.GetIndexParameters().Length == 0 ? pi.GetValue(o) : null; } catch { continue; }
                        if (v == null || m.DeclaringType == typeof(object)) continue;
                        if (m.DeclaringType?.Namespace?.StartsWith("CUE4Parse.UE4.Assets.Exports") == true && m.DeclaringType.Name == "UObject" ) continue;
                        Console.WriteLine($"{pre}{m.Name}: {v.GetType().Name} {(v is byte[] b ? b.Length + " bytes" : v is Array ar ? "len " + ar.Length : "")}");
                        if (v is byte[] bytes && a.Length > 4) { File.WriteAllBytes(a[4] + "." + System.Text.RegularExpressions.Regex.Replace(pre, "[^0-9A-Za-z]+", "_") + m.Name + ".bin", bytes); continue; }
                        if (v is Array arr && arr.Length > 0 && arr.Length < 20) { int i = 0; foreach (var x in arr) Dump(x, pre + "  [" + (i++) + "] ", depth + 1); }
                        else if (!v.GetType().IsPrimitive && v is not string && v.GetType().Namespace?.StartsWith("CUE4Parse") == true) Dump(v, pre + "  ", depth + 1);
                    }
                }
                Dump(e, "  ", 0);
            }
            return 0;
        }
        if (mode == "pieces-scan")
        {
            // Export types across every package whose path contains a[2].
            var types = new Dictionary<string, int>();
            var files = p.Files.Values.Where(f => f.Extension is "umap" or "uasset" && f.Path.Contains(a[2], StringComparison.OrdinalIgnoreCase)).ToList();
            int n = 0;
            foreach (var f in files)
            {
                try
                {
                    foreach (var e in p.LoadPackage(f.Path).GetExports())
                    {
                        var t = e.ExportType;
                        types[t] = types.GetValueOrDefault(t) + 1;
                        if (t.Contains("Landscape") && types[t] <= 2) Console.WriteLine($"{t}: {f.Path}");
                    }
                }
                catch { }
                if (++n % 200 == 0) Console.WriteLine($"  {n}/{files.Count}");
            }
            foreach (var kv in types.OrderByDescending(x => x.Value).Take(60)) Console.WriteLine($"{kv.Value,8} {kv.Key}");
            return 0;
        }
        return 1;
    }

    // pieces <paks> <usmap> <out pieces.json>
    // Every BuildingPieceData: { id (PersistenceID, as stored in the save), name, tag, meshes: [{ mesh, t:[x,y,z], q:[x,y,z,w], s:[x,y,z] }] }
    static int Export(DefaultFileProvider p, string outPath)
    {
        var list = new List<object>();
        var files = p.Files.Values.Where(f => f.Extension == "uasset" && f.Path.Contains("/Gameplay/", StringComparison.OrdinalIgnoreCase)
            && (f.Name.StartsWith("DA_", StringComparison.OrdinalIgnoreCase) || f.Name.StartsWith("BUILDPIECE", StringComparison.OrdinalIgnoreCase))
            && !f.Path.Contains("DerivedData", StringComparison.OrdinalIgnoreCase)).ToList();
        Console.WriteLine($"{files.Count} candidate data assets");
        var byName = p.Files.Values.Where(x => x.Extension == "uasset")
            .GroupBy(x => x.NameWithoutExtension, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().Path, StringComparer.OrdinalIgnoreCase);
        string Resolve(string objectPath)
        {
            var pkg = objectPath.Split('.')[0];
            return byName.TryGetValue(pkg[(pkg.LastIndexOf('/') + 1)..], out var real) ? real : pkg;
        }
        int noMesh = 0, fromBp = 0;
        foreach (var f in files)
        {
            JArray ex;
            try { ex = JArray.FromObject(p.LoadPackage(f.Path).GetExports()); } catch { continue; }
            var d = ex.FirstOrDefault(e => (string?)e["Type"] == "BuildingPieceData");
            if (d == null) continue;
            var props = d["Properties"]!;
            var id = (string?)props["PersistenceID"];
            if (string.IsNullOrEmpty(id)) continue;
            var meshes = new List<object>();
            double[]? bounds = null;
            var dd = (string?)props["DerivedData"]?["AssetPathName"];
            if (dd != null)
            {
                try
                {
                    var dex = JArray.FromObject(p.LoadPackage(Resolve(dd)).GetExports());
                    var lb = dex.SelectToken("$..BuildingPieceLocalBounds");
                    if (lb?["Origin"] is JObject && lb["BoxExtent"] is JObject) bounds = new[] { (double)lb["Origin"]!["X"]!, (double)lb["Origin"]!["Y"]!, (double)lb["Origin"]!["Z"]!,
                        (double)lb["BoxExtent"]!["X"]!, (double)lb["BoxExtent"]!["Y"]!, (double)lb["BoxExtent"]!["Z"]! };
                    foreach (var ent in dex.SelectTokens("$..EntityRepresentation.EntityCollection.Entities[*]"))
                    {
                        var frags = ent["Fragments"] as JArray;
                        if (frags == null) continue;
                        var tr = frags.Select(x => x["Transform"]).FirstOrDefault(x => x != null && x.Type == JTokenType.Object);
                        var sm = frags.Select(x => x["StaticMesh"]).FirstOrDefault(x => x != null && x.Type == JTokenType.Object);
                        var path = (string?)sm?["ObjectPath"];
                        if (path == null) continue;
                        path = System.Text.RegularExpressions.Regex.Replace(path, @"\.\d+$", "");
                        if (path.Contains("/SM_Placement")) continue; // build-mode marker, not part of the look
                        meshes.Add(new
                        {
                            mesh = path,
                            t = tr == null ? new double[] { 0, 0, 0 } : new[] { (double)tr["Translation"]!["X"]!, (double)tr["Translation"]!["Y"]!, (double)tr["Translation"]!["Z"]! },
                            q = tr == null ? new double[] { 0, 0, 0, 1 } : new[] { (double)tr["Rotation"]!["X"]!, (double)tr["Rotation"]!["Y"]!, (double)tr["Rotation"]!["Z"]!, (double)tr["Rotation"]!["W"]! },
                            s = tr == null ? new double[] { 1, 1, 1 } : new[] { (double)tr["Scale3D"]!["X"]!, (double)tr["Scale3D"]!["Y"]!, (double)tr["Scale3D"]!["Z"]! },
                        });
                    }
                }
                catch (Exception e) { Console.WriteLine($"  {f.Name}: {e.Message}"); }
            }
            // No entity list: read the meshes off the piece's blueprint components instead.
            var bp = (string?)props["BuildableActor"]?["AssetPathName"];
            if (meshes.Count == 0 && bp != null)
            {
                try
                {
                    foreach (var c in JArray.FromObject(p.LoadPackage(Resolve(bp)).GetExports()))
                    {
                        if (c["Properties"] is not JObject cp) continue;
                        var path = (string?)cp?["StaticMesh"]?["ObjectPath"];
                        if (path == null || !((string?)c["Type"] ?? "").Contains("StaticMeshComponent")) continue;
                        path = System.Text.RegularExpressions.Regex.Replace(path, @"\.\d+$", "");
                        if (path.Contains("/SM_Placement")) continue;
                        double V(string k, string a, double def) => (double?)cp![k]?[a] ?? def;
                        meshes.Add(new
                        {
                            mesh = path,
                            t = new[] { V("RelativeLocation", "X", 0), V("RelativeLocation", "Y", 0), V("RelativeLocation", "Z", 0) },
                            r = new[] { V("RelativeRotation", "Pitch", 0), V("RelativeRotation", "Yaw", 0), V("RelativeRotation", "Roll", 0) },
                            s = new[] { V("RelativeScale3D", "X", 1), V("RelativeScale3D", "Y", 1), V("RelativeScale3D", "Z", 1) },
                        });
                    }
                    if (meshes.Count > 0) fromBp++;
                }
                catch (Exception e) { Console.WriteLine($"  {f.Name} blueprint: {e.Message}"); }
            }
            if (meshes.Count == 0) noMesh++;
            list.Add(new
            {
                id,
                name = (string?)props["DisplayName"]?["LocalizedString"] ?? (string?)props["DisplayName"]?["SourceString"] ?? d["Name"]!.ToString(),
                asset = d["Name"]!.ToString(),
                tag = ((string?)props["PieceTag"]?["TagName"])?.Replace("BaseBuilding.PieceType.", ""),
                meshes,
                bounds, // [origin x,y,z, extent x,y,z] in cm: a stand-in box when there's no static mesh
            });
        }
        File.WriteAllText(outPath, JsonConvert.SerializeObject(list));
        Console.WriteLine($"{list.Count} pieces written to {outPath} ({fromBp} from blueprints, {noMesh} without a mesh)");
        return 0;
    }
}
