// Extracts the game's data tables / data assets to plain JSON (plus item icons as WebP) for the site:
//   gamedata <paks> <usmap> <out dir> [--no-icons]
// Writes version.json, meta.json, items.json, recipes.json, spells.json, quests.json, loottables.json,
// enemies.json, chests.json and icons/*.webp. See GAMEDATA.md for what the fields mean.
using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse_Conversion.Textures;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using SkiaSharp;

public static class GameData
{
    static DefaultFileProvider P = null!;
    static readonly Dictionary<string, string> ByGamePath = new(StringComparer.OrdinalIgnoreCase);   // "/Game/X/Y" -> "RSDragonwilds/Content/X/Y.uasset"
    static readonly Dictionary<string, string> ByName = new(StringComparer.OrdinalIgnoreCase);       // "ITEM_X" -> file path
    static readonly Dictionary<string, JArray?> DumpCache = new(StringComparer.OrdinalIgnoreCase);
    static readonly Dictionary<string, Dictionary<string, string>> StringTables = new(StringComparer.OrdinalIgnoreCase);
    static readonly Dictionary<string, string> ItemIdByAsset = new(StringComparer.OrdinalIgnoreCase);
    static readonly Dictionary<string, string> IconTextures = new(StringComparer.OrdinalIgnoreCase); // texture name -> game path
    static readonly JsonSerializerSettings Js = new() { Formatting = Formatting.None, Error = (_, e) => e.ErrorContext.Handled = true };

    public static int Run(string[] a)
    {
        if (a.Length < 3) { Console.WriteLine("Usage: ModelExporter gamedata <paks> <usmap> <out dir> [--no-icons]"); return 1; }
        var (paks, usmap, outDir) = (a[0], a[1], Path.GetFullPath(a[2]));
        var noIcons = a.Contains("--no-icons");
        P = PieceTools.Open(paks, usmap);
        Directory.CreateDirectory(outDir);

        foreach (var f in P.Files.Values.Where(f => f.Extension == "uasset" && f.Path.StartsWith("RSDragonwilds/", StringComparison.OrdinalIgnoreCase)))
        {
            ByGamePath[GamePath(f.Path)] = f.Path;
            ByName.TryAdd(f.NameWithoutExtension, f.Path);
        }
        Console.WriteLine($"{ByGamePath.Count} game packages indexed.");

        var items = ExportItems();
        var recipes = ExportRecipes();
        var spells = ExportSpells();
        var quests = ExportQuests();
        var (lootTables, enemyTables, chestProfiles) = ExportLoot();
        var enemies = ExportEnemies(enemyTables);
        var chests = ExportChests(chestProfiles);

        var iconCount = noIcons ? 0 : ExportIcons(outDir, items, spells);

        void Write(string name, object o) => File.WriteAllText(Path.Combine(outDir, name), JsonConvert.SerializeObject(o, Formatting.Indented,
            new JsonSerializerSettings { NullValueHandling = NullValueHandling.Ignore }));
        Write("items.json", items);
        Write("recipes.json", recipes);
        Write("spells.json", spells);
        Write("quests.json", quests);
        Write("loottables.json", lootTables);
        Write("enemies.json", enemies);
        Write("chests.json", chests);
        var counts = new Dictionary<string, int> { ["items"] = items.Count, ["recipes"] = recipes.Count, ["spells"] = spells.Count, ["quests"] = quests.Count,
            ["lootTables"] = lootTables.Count, ["enemies"] = enemies.Count, ["chests"] = chests.Count, ["icons"] = iconCount };
        var version = Path.GetFileNameWithoutExtension(usmap);
        Write("meta.json", new { gameVersion = version, extractedAt = DateTime.UtcNow.ToString("o"), counts });
        Write("version.json", new { game = version, extracted = DateTime.UtcNow.ToString("o"), counts });
        Console.WriteLine(JsonConvert.SerializeObject(counts));
        return 0;
    }

    // ---------- helpers ----------
    static string GamePath(string file)
    {
        var p = file[..file.LastIndexOf('.')];
        var m = Regex.Match(p, @"^RSDragonwilds/Content/(.*)$");
        if (m.Success) return "/Game/" + m.Groups[1].Value;
        m = Regex.Match(p, @"^RSDragonwilds/Plugins/(?:GameFeatures/)?([^/]+)/Content/(.*)$");
        return m.Success ? "/" + m.Groups[1].Value + "/" + m.Groups[2].Value : "/" + p;
    }

    static JArray? Dump(string? file)
    {
        if (file == null) return null;
        lock (DumpCache)
            if (DumpCache.TryGetValue(file, out var c)) return c;
        JArray? arr = null;
        try { arr = JArray.Parse(JsonConvert.SerializeObject(P.LoadPackage(file).GetExports(), Js)); } catch { }
        lock (DumpCache) DumpCache[file] = arr;
        return arr;
    }

    static string? FileOf(string? objectPath)
    {
        if (string.IsNullOrEmpty(objectPath)) return null;
        var p = objectPath;
        var dot = p.LastIndexOf('.');
        if (dot > p.LastIndexOf('/')) p = p[..dot];
        if (ByGamePath.TryGetValue(p, out var f)) return f;
        var name = p[(p.LastIndexOf('/') + 1)..];
        return ByName.GetValueOrDefault(name);
    }

    static string? Str(JToken? t) => t is JValue v && v.Type == JTokenType.String ? v.Value<string>() : null;

    // Name inside "ItemData'ITEM_X'" or the last segment of an object path.
    static string? AssetName(JToken? t)
    {
        if (t is not JObject o) return null;
        var n = Str(o["ObjectName"]);
        if (n != null) { var m = Regex.Match(n, @"'([^':]+)'$"); return m.Success ? m.Groups[1].Value : n; }
        var ap = Str(o["AssetPathName"]) ?? Str(o["ObjectPath"]);
        if (string.IsNullOrEmpty(ap)) return null;
        var s = ap[(ap.LastIndexOf('/') + 1)..];
        var d = s.IndexOf('.');
        return d >= 0 ? s[..d] : s;
    }

    static string? AssetPath(JToken? t) => t is JObject o ? (Str(o["AssetPathName"]) ?? Str(o["ObjectPath"])) is { Length: > 0 } s ? s : null : null;

    // FText -> English string. Source string if present, else look the key up in its string table.
    static string? Text(JToken? t)
    {
        if (t is JValue v) return Str(v);
        if (t is not JObject o) return null;
        foreach (var k in new[] { "SourceString", "LocalizedString", "CultureInvariantString" })
            if (Str(o[k]) is { Length: > 0 } s) return s;
        var table = Str(o["TableId"]); var key = Str(o["Key"]);
        if (table == null || key == null) return null;
        Dictionary<string, string>? st;
        lock (StringTables)
        {
            if (!StringTables.TryGetValue(table, out st))
            {
                st = null;
                var dump = Dump(FileOf(table));
                if (dump?.FirstOrDefault(e => Str(e["Type"]) == "StringTable")?["StringTable"]?["KeysToEntries"] is JObject kv)
                    st = kv.Properties().ToDictionary(p => p.Name, p => p.Value.ToString());
                StringTables[table] = st!;
            }
        }
        return st != null && st.TryGetValue(key, out var r) ? r : null;
    }

    // The main export of a package (the one named like the file), with its Properties.
    static JObject? Main(string? file, Func<JObject, bool>? pick = null)
    {
        var d = Dump(file);
        if (d == null || file == null) return null;
        var name = Path.GetFileNameWithoutExtension(file);
        return d.OfType<JObject>().FirstOrDefault(e => pick != null ? pick(e) : Str(e["Name"]) == name && e["Properties"] != null);
    }

    static string? Tag(JToken? t) => t is JObject o ? Str(o["TagName"]) : null;
    static double? Num(JToken? t) => t is JValue v && (v.Type == JTokenType.Integer || v.Type == JTokenType.Float) ? v.Value<double>() : null;

    static IEnumerable<string> Files(Func<string, bool> pred) =>
        P.Files.Values.Where(f => f.Extension == "uasset" && f.Path.StartsWith("RSDragonwilds/", StringComparison.OrdinalIgnoreCase)
            && !f.Path.Contains("DerivedData", StringComparison.OrdinalIgnoreCase) && pred(f.NameWithoutExtension)).Select(f => f.Path).OrderBy(x => x, StringComparer.OrdinalIgnoreCase);

    static string ItemRef(JToken? t)
    {
        var asset = AssetName(t);
        if (asset == null) return "";
        return ItemIdByAsset.TryGetValue(asset, out var id) ? id : asset;
    }

    static List<T> Par<T>(IEnumerable<string> files, Func<string, T?> f) where T : class
    {
        var bag = new ConcurrentBag<(string, T)>();
        Parallel.ForEach(files, new ParallelOptions { MaxDegreeOfParallelism = 8 }, file =>
        {
            try { if (f(file) is { } r) bag.Add((file, r)); } catch (Exception e) { Console.WriteLine($"  failed {file}: {e.Message}"); }
        });
        return bag.OrderBy(x => x.Item1, StringComparer.OrdinalIgnoreCase).Select(x => x.Item2).ToList();
    }

    // ---------- items ----------
    static List<Dictionary<string, object?>> ExportItems()
    {
        var items = Par(Files(n => n.StartsWith("ITEM_", StringComparison.OrdinalIgnoreCase) || n.StartsWith("DA_Consum", StringComparison.OrdinalIgnoreCase)), file =>
        {
            var e = Main(file, x => x["Properties"]?["PersistenceID"] != null && Str(x["Name"]) == Path.GetFileNameWithoutExtension(file));
            if (e == null) return null;
            var p = (JObject)e["Properties"]!;
            var tags = (p["ItemFilterTags"] as JArray)?.Select(Str).Where(s => s != null).ToList() ?? [];
            var iconPath = AssetPath(p["Icon"]) ?? AssetPath(p["AmmoCounterIcon"]);
            var mesh = AssetName(p["StaticMesh"]);
            var d = new Dictionary<string, object?>
            {
                ["id"] = Str(p["PersistenceID"]),
                ["asset"] = Path.GetFileNameWithoutExtension(file),
                ["internalName"] = Str(p["InternalName"]),
                ["name"] = Text(p["Name"]),
                ["description"] = Text(p["FlavourText"]),
                ["type"] = Str(e["Type"]),
                ["category"] = Tag(p["Category"]) ?? tags.FirstOrDefault(),
                ["filterTags"] = tags.Count > 0 ? tags : null,
                ["icon"] = iconPath,                           // game path for now; replaced by the file name once icons are written
                ["powerLevel"] = Num(p["PowerLevel"]),
                ["weight"] = Num(p["Weight"]),
                ["maxStack"] = Num(p["MaxStackSize"]),
                ["durability"] = Num(p["BaseDurability"]),
                ["slot"] = Str(p["Slot"]),
                ["skill"] = AssetName(p["SkillUsed"]) ?? AssetName(p["AssociatedSkill"]),
                ["damageMultiplier"] = Num(p["DamageMultiplier"]),
                ["blockingDamageNegation"] = Num(p["BlockingDamageNegation"]),
                ["damageTypes"] = (p["DamageTypes"] as JArray)?.Select(Str).ToList(),
                ["model"] = mesh != null && mesh.StartsWith("SM_", StringComparison.OrdinalIgnoreCase) ? mesh : mesh,
            };
            return d;
        });
        items = items.Where(d => d["id"] != null && d["name"] != null).OrderBy(d => (string)d["name"]!, StringComparer.OrdinalIgnoreCase).ToList();
        foreach (var d in items) ItemIdByAsset[(string)d["asset"]!] = (string)d["id"]!;
        return items;
    }

    // ---------- recipes ----------
    static List<Dictionary<string, object?>> ExportRecipes()
    {
        List<object> Stacks(JToken? t) => (t as JArray)?.Select(x => (object)new { item = ItemRef(x["ItemData"]), count = Num(x["Count"]) }).ToList() ?? [];
        return Par(Files(n => n.StartsWith("RECIPE_", StringComparison.OrdinalIgnoreCase)), file =>
        {
            var e = Main(file, x => Str(x["Type"]) == "RecipeData");
            if (e == null) return null;
            var p = (JObject)e["Properties"]!;
            var asset = Path.GetFileNameWithoutExtension(file);
            var made = Stacks(p["ItemsCreated"]);
            string? name = null;
            if (made.Count > 0 && (p["ItemsCreated"] as JArray)![0]["ItemData"] is { } first && AssetName(first) is { } fa)
                name = items_name(fa);
            return new Dictionary<string, object?>
            {
                ["id"] = Str(p["PersistenceID"]),
                ["asset"] = asset,
                ["internalName"] = Str(p["InternalName"]),
                ["name"] = name ?? asset,
                ["makes"] = made,
                ["needs"] = Stacks(p["ItemsConsumed"]),
                ["skill"] = AssetName(p["SkillUsedToCraft"]),
                ["xp"] = Num(p["SkillXPAwardedOnCraft"]),
                ["xpEvent"] = Str(p["OnCraftXpEvent"]?["RowName"]),
                ["audioTag"] = Tag(p["AudioTag"]),
                ["test"] = asset.Contains("RECIPE_TEST", StringComparison.OrdinalIgnoreCase) || asset.Contains("Debug", StringComparison.OrdinalIgnoreCase) ? true : null,
                ["raw"] = p.Properties().Where(x => !new[] { "ItemsConsumed", "ItemsCreated", "AudioTag", "SkillUsedToCraft", "OnCraftXpEvent", "SkillXPAwardedOnCraft", "PersistenceID", "InternalName" }.Contains(x.Name)).ToDictionary(x => x.Name, x => x.Value) is { Count: > 0 } r ? r : null,
            };
        });
    }
    static readonly Dictionary<string, string?> ItemNameCache = new(StringComparer.OrdinalIgnoreCase);
    static string? items_name(string asset)
    {
        lock (ItemNameCache)
        {
            if (ItemNameCache.TryGetValue(asset, out var n)) return n;
            var file = ByName.GetValueOrDefault(asset);
            var e = Main(file);
            return ItemNameCache[asset] = e?["Properties"] is JObject p ? Text(p["Name"]) : null;
        }
    }

    // ---------- spells ----------
    static List<Dictionary<string, object?>> ExportSpells()
    {
        return Par(Files(n => n.StartsWith("USD_", StringComparison.OrdinalIgnoreCase)), file =>
        {
            var d = Dump(file);
            var e = d?.OfType<JObject>().FirstOrDefault(x => Str(x["Type"]) == "UtilitySpellData");
            if (e == null) return null;
            var p = (JObject)e["Properties"]!;
            var costs = d!.OfType<JObject>().Where(x => Str(x["Type"]) == "SpellModule_CostItems").SelectMany(x => x["Properties"]?["ItemsCostInfo"] as JArray ?? [])
                .Select(x => (object)new { item = ItemRef(x["ItemData"]), count = Num(x["Count"]) }).ToList();
            var asset = Path.GetFileNameWithoutExtension(file);
            return new Dictionary<string, object?>
            {
                ["id"] = Str(p["PersistenceID"]) ?? asset,
                ["asset"] = asset,
                ["internalName"] = Str(p["InternalName"]),
                ["name"] = Text(p["SpellDisplayName"]) ?? asset,
                ["description"] = Text(p["SpellDescription"]) ?? Text(p["Description"]),
                ["icon"] = AssetPath(p["SpellIcon"]),
                ["cooldown"] = Num(p["CooldownDuration"]),
                ["castType"] = Str(p["CastType"]),
                ["requirements"] = Text(p["SpecialRequirementsText"]),
                ["costs"] = costs,
                ["xpEvent"] = d!.OfType<JObject>().Select(x => Str(x["Properties"]?["CastXpEvent"]?["RowName"])).FirstOrDefault(x => x != null),
                ["raw"] = p.Properties().Where(x => x.Name is "SpellDisplayName" or "SpecialRequirementsText" or "CooldownDuration" or "SpellIcon" or "SpellTagIcon" or "CastType" or "CooldownModifierPerk" or "SpellDescription" or "PersistenceID" or "InternalName").ToDictionary(x => x.Name, x => x.Value) is { Count: > 0 } r ? r : null,
            };
        });
    }

    // ---------- quests ----------
    static List<Dictionary<string, object?>> ExportQuests()
    {
        return Par(Files(n => n.StartsWith("Quest_", StringComparison.OrdinalIgnoreCase)), file =>
        {
            var e = Main(file, x => Str(x["Type"]) == "QuestData");
            if (e == null) return null;
            var p = (JObject)e["Properties"]!;
            return new Dictionary<string, object?>
            {
                ["id"] = Str(p["PersistenceID"]) ?? Path.GetFileNameWithoutExtension(file),
                ["asset"] = Path.GetFileNameWithoutExtension(file),
                ["internalName"] = Str(p["InternalName"]),
                ["name"] = Text(p["QuestName"]),
                ["description"] = Text(p["QuestDescription"]),
                ["main"] = p["bIsMainQuest"]?.Value<bool>() == true ? true : null,
                ["activity"] = Str(p["LinkedActivityID"]),
                ["objectives"] = (p["ObjectiveTexts"] as JArray)?.Select(o => (object)new { key = Str(o["Key"]), text = Text(o["Value"]) }).ToList(),
            };
        });
    }

    // ---------- loot ----------
    const string LootDir = "/LootDropTables/";
    static (List<Dictionary<string, object?>> tables, Dictionary<string, JObject> enemyRows, Dictionary<string, JObject> profileRows) ExportLoot()
    {
        var tables = new List<Dictionary<string, object?>>();
        var enemyRows = new Dictionary<string, JObject>(StringComparer.OrdinalIgnoreCase);
        var profileRows = new Dictionary<string, JObject>(StringComparer.OrdinalIgnoreCase);
        var files = P.Files.Values.Where(f => f.Extension == "uasset" && f.Path.Contains(LootDir, StringComparison.OrdinalIgnoreCase)
            && f.NameWithoutExtension.StartsWith("DT_")).Select(f => f.Path).OrderBy(x => x).ToList();
        object Entry(JToken x) => new
        {
            item = ItemRef(x["SpawnedItemData"]),
            asset = AssetName(x["SpawnedItemData"]),
            min = Num(x["MinimumDropAmount"]),
            max = Num(x["MaximumDropAmount"]),
            chance = (Num(x["DropChance"]) ?? 100) / 100.0,
            perPlayer = x["bOneInstancePerPlayerOnlyVisibleToThem"]?.Value<bool>() == true ? true : (bool?)null,
            autoAdd = x["bAutoAddToInventory"]?.Value<bool>() == true ? true : (bool?)null,
            damagersOnly = x["bOnlyForPlayersThatInflictedDamage"]?.Value<bool>() == true ? true : (bool?)null,
        };
        string Ref(JToken? h) => $"{Str(h?["RowName"])}";
        foreach (var file in files)
        {
            var dt = Dump(file)?.OfType<JObject>().FirstOrDefault(e => Str(e["Type"])?.EndsWith("DataTable") == true);
            if (dt?["Rows"] is not JObject rows) continue;
            var table = Path.GetFileNameWithoutExtension(file);
            var rowStruct = AssetName(dt["Properties"]?["RowStruct"]) ?? "";
            Console.WriteLine($"  {table}: {rows.Count} rows ({rowStruct})");
            foreach (var r in rows.Properties())
            {
                var v = (JObject)r.Value;
                if (rowStruct == "LootDropTableRow")
                    tables.Add(new()
                    {
                        ["id"] = r.Name, ["kind"] = "drop", ["source"] = table,
                        ["chance"] = (Num(v["DropChance"]) ?? 100) / 100.0,
                        ["conditions"] = (v["Conditions"] as JArray)?.Count > 0 ? v["Conditions"] : null,
                        ["entries"] = (v["Resources"] as JArray)?.Select(Entry).ToList() ?? [],
                    });
                else if (rowStruct == "LootItemSet")
                    tables.Add(new()
                    {
                        ["id"] = r.Name, ["kind"] = "set", ["source"] = table,
                        ["entries"] = (v["SpawnableItems"] as JArray)?.Select(Entry).ToList() ?? [],
                        ["raw"] = v.Properties().Where(x => x.Name != "SpawnableItems").ToDictionary(x => x.Name, x => x.Value) is { Count: > 0 } o ? o : null,
                    });
                else if (rowStruct == "LootItemSetRoll")
                    tables.Add(new()
                    {
                        ["id"] = r.Name, ["kind"] = "chestRoll", ["source"] = table,
                        ["rolls"] = new { min = Num(v["MinAdditionalSetRolls"]), max = Num(v["MaxAdditionalSetRolls"]) },
                        ["guaranteedSets"] = (v["GuaranteedItemSets"] as JArray)?.Select(Ref).ToList(),
                        ["guaranteedItems"] = (v["GuaranteedStandaloneItems"] as JArray)?.Select(Entry).ToList(),
                        ["bonusSets"] = (v["AdditionalItemSets"] as JArray)?.Select(x => (object)new { set = Ref(x["LootItemSetHandle"]), chance = (Num(x["DropChance"]) ?? 100) / 100.0 }).ToList(),
                        ["raw"] = v.Properties().Where(x => x.Name is not ("GuaranteedItemSets" or "GuaranteedStandaloneItems" or "AdditionalItemSets" or "MinAdditionalSetRolls" or "MaxAdditionalSetRolls")).ToDictionary(x => x.Name, x => x.Value) is { Count: > 0 } o ? o : null,
                    });
                else if (rowStruct == "LootDropEnemyTableRow") enemyRows.TryAdd(r.Name, v);     // composite table wins over the plain one (read later)
                else if (rowStruct == "ChestRespawnSettings") profileRows[r.Name] = v;
            }
        }
        return (tables, enemyRows, profileRows);
    }

    // enemy loot table row -> [{ minPower, tables:[row names] }]
    static List<object> PowerTables(JObject row) =>
        (row["TablesByPowerLevel"] as JArray)?.Select(t => (object)new
        {
            minPower = Num(t["MinimumPowerLevel"]),
            tables = (t["TableHandles"] as JArray)?.Select(h => Str(h["RowName"])).Where(x => x != null && x != "None").ToList(),
        }).ToList() ?? [];

    // ---------- enemies ----------
    static List<Dictionary<string, object?>> ExportEnemies(Dictionary<string, JObject> enemyRows)
    {
        return Par(Files(n => Regex.IsMatch(n, @"^BP_AI_.*_Character")), file =>
        {
            var d = Dump(file);
            if (d == null) return null;
            var loot = d.OfType<JObject>().FirstOrDefault(x => Str(x["Type"]) == "LootDropComponent");
            var cdo = d.OfType<JObject>().FirstOrDefault(x => Str(x["Name"])?.StartsWith("Default__") == true && x["Properties"]?["AIDataClass"] != null);
            if (cdo == null && loot == null) return null;
            var asset = Path.GetFileNameWithoutExtension(file);
            var dataPath = AssetPath(cdo?["Properties"]?["AIDataClass"]);
            var dataFile = FileOf(dataPath);
            // Variants (..._Character_02) inherit their data class from a parent blueprint; use the data asset next to them.
            dataFile ??= P.Files.Values.Where(f => f.Extension == "uasset" && f.Path.StartsWith(file[..(file.LastIndexOf('/') + 1)], StringComparison.OrdinalIgnoreCase) && Regex.IsMatch(f.NameWithoutExtension, @"^BP_AI_.*_Data")).Select(f => f.Path).OrderBy(x => x).FirstOrDefault();
            var dataMain = Main(dataFile, x => Str(x["Name"])?.StartsWith("Default__") == true && x["Properties"] != null);
            var dp = dataMain?["Properties"] as JObject;
            var row = Str(loot?["Properties"]?["EnemyTableRowHandle"]?["RowName"]);
            if (row == "None") row = null;
            JObject? lootRow = row != null && enemyRows.TryGetValue(row, out var lr) ? lr : null;
            var meshes = d.OfType<JObject>().Select(x => AssetName(x["Properties"]?["SkeletalMeshAsset"]) ?? AssetName(x["Properties"]?["SkinnedAsset"])).FirstOrDefault(x => x != null);
            return new Dictionary<string, object?>
            {
                ["id"] = Regex.Replace(asset, @"^BP_AI_|_Character$", ""),
                ["asset"] = asset,
                ["name"] = Text(dp?["AIName"]) ?? Pretty(Regex.Replace(asset, @"^BP_AI_|_Character", "")),
                ["nameFromAsset"] = Text(dp?["AIName"]) == null ? true : null,
                ["difficulty"] = Tag(dp?["AIDifficultyScalingCategoryTag"]),
                ["tags"] = (dp?["GameplayTags"] as JArray)?.Select(Str).ToList(),
                ["lootRow"] = row,
                ["lootTables"] = lootRow == null ? (row != null ? new List<string?> { row } : null) : PowerTables(lootRow).SelectMany(t => ((dynamic)t).tables as List<string?> ?? []).Distinct().ToList(),
                ["lootByPowerLevel"] = lootRow == null ? null : PowerTables(lootRow),
                ["model"] = meshes,
            };
        }).ToList();
    }

    static string Pretty(string s) => Regex.Replace(Regex.Replace(s.Replace("_", " "), "([a-z])([A-Z])", "$1 $2"), @"\s+", " ").Trim();

    // ---------- chests ----------
    static List<Dictionary<string, object?>> ExportChests(Dictionary<string, JObject> profiles)
    {
        var list = new List<Dictionary<string, object?>>();
        foreach (var (name, v) in profiles.OrderBy(x => x.Key, StringComparer.OrdinalIgnoreCase))
        {
            var t = v["InGameRespawnTime"];
            double? secs = t == null ? null : (Num(t["Days"]) ?? 0) * 86400 + (Num(t["Hours"]) ?? 0) * 3600 + (Num(t["Minutes"]) ?? 0) * 60 + (Num(t["Seconds"]) ?? 0);
            list.Add(new()
            {
                ["id"] = name,
                ["name"] = Regex.Replace(name, "_", " "),
                ["respawnSeconds"] = secs,
                ["respawnTrigger"] = Str(v["RespawnTrigger"])?.Split("::").Last(),
                ["lootTables"] = new List<string?> { Str(v["LootRollHandle"]?["RowName"]) },
            });
        }
        return list;
    }

    // ---------- icons ----------
    static int ExportIcons(string outDir, List<Dictionary<string, object?>> items, List<Dictionary<string, object?>> spells)
    {
        var dir = Path.Combine(outDir, "icons");
        Directory.CreateDirectory(dir);
        var all = items.Concat(spells).Where(d => d["icon"] is string s && s.Length > 0).ToList();
        var paths = all.Select(d => (string)d["icon"]!).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        Console.WriteLine($"{paths.Count} icon texture(s)...");
        var done = new ConcurrentDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        int failed = 0;
        var retry = new List<string>(); string lastError = "";
        void One(string gp)
        {
            try
            {
                var file = FileOf(gp) ?? throw new Exception("package not found");
                var tex = P.LoadPackage(file).GetExports().OfType<UTexture2D>().FirstOrDefault() ?? throw new Exception("no texture");
                using var bmp = tex.Decode()?.ToSkBitmap() ?? throw new Exception("decode failed");
                var scale = Math.Min(1.0, 128.0 / Math.Max(bmp.Width, bmp.Height));
                using var sized = scale < 1 ? bmp.Resize(new SKImageInfo(Math.Max(1, (int)(bmp.Width * scale)), Math.Max(1, (int)(bmp.Height * scale)), SKColorType.Rgba8888, SKAlphaType.Unpremul), SKFilterQuality.High) : null;
                using var img = SKImage.FromBitmap(sized ?? bmp);
                using var data = img.Encode(SKEncodedImageFormat.Webp, 85);
                var name = Path.GetFileNameWithoutExtension(file) + ".webp";
                File.WriteAllBytes(Path.Combine(dir, name), data.ToArray());
                done[gp] = "icons/" + name;
            }
            catch (Exception e) { lock (retry) retry.Add(gp); lastError = e.Message; }
        }
        Parallel.ForEach(paths, new ParallelOptions { MaxDegreeOfParallelism = 6 }, One);
        // The native texture decoder sometimes is not ready on a worker thread; a serial pass picks those up.
        foreach (var gp in retry.ToList()) { retry.Remove(gp); One(gp); }
        foreach (var gp in retry) { failed++; if (failed <= 8) Console.WriteLine($"  icon failed {gp}: {lastError}"); }
        foreach (var d in all) d["icon"] = done.TryGetValue((string)d["icon"]!, out var rel) ? rel : null;
        Console.WriteLine($"Icons: {done.Count} written, {failed} failed.");
        return done.Values.Distinct().Count();
    }
}
