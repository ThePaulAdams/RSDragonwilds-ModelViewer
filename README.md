# Ashenfallen: 3D Base-Builder & Quest Storyboarder

A browser-based 3D design studio and quest storyboarder for **RuneScape: Dragonwilds** ([https://ashenfallen.com](https://ashenfallen.com) or local web app).

---

## 🎮 Does Ashenfallen Base-Builder require the in-game Modpack?
**YES!** 

- **Ashenfallen Base-Builder** is your **creative workspace**: freely search and inspect over 5,100+ extracted game models, plan castle layouts, place NPC companions (Doric, Wise Old Man, Cook, Zanik...), write branching dialogue trees, configure item collection or slaying objectives, and assign real rewards.
- **RSDragonwilds-Toolkit (CustomBuilds mod)** is the **in-game runtime engine**: to see your placed objects and play your custom quests inside *RuneScape: Dragonwilds*, you must install the **CustomBuilds** mod via UE4SS. The mod reads your exported `base.txt`, `placed.txt`, and `quests.json`, materializes the models in the UE5 world, hooks the `E` interaction key, animates 3D overhead `!` markers, tracks inventory, and hands out real items.

### How to use with the game:
1. Design your base layout or quest storyboard in the web builder.
2. Click **Save / Export**:
   - If using the **File System Access API**, connect your game's `RSDragonwilds\Binaries\Win64\ue4ss\Mods\CustomBuilds` folder for instant live syncing.
   - Or download `quests.json` / `placed.txt` and place them directly into `ue4ss\Mods\CustomBuilds\`.
3. Launch the game or type `cb quest reload` in the `F10` console to immediately enjoy your custom quests and builds!

---

## Quick start (automatic)

In PowerShell, from the repo folder:

```powershell
.\export-models.ps1
```

That one command:
1. Finds the game through Steam.
2. Makes sure a `Mappings.usmap` exists. If not, it installs the small `MappingsDumper` UE4SS mod, starts the game, waits for the mod to write the file, then closes the game again.
3. Installs the .NET 10 SDK into `Exporter\.dotnet` if you don't have it (no admin needed).
4. Builds `Exporter` (a small CUE4Parse tool) and exports every `SM_*` static mesh, with textures, to `export`. Running it again resumes where it stopped.
5. Opens the viewer at `http://localhost:8765`, which loads the export by itself.

Options: `-Include Base_Building,Castle` exports only paths containing those words, `-Limit 50` does a quick test, `-NoTextures` is faster and smaller, `-Aes 0x...` is for encrypted paks, and `-GameRoot` sets the game folder if it isn't found. To reopen the viewer later without exporting, run `.\view.ps1`.

Previews are drawn once and saved as small images in `export\thumbs`. The first time you open the viewer it builds the missing ones in the background (what's on screen goes first, and the button at the top shows how many are left). After that the grid loads instantly.

## Manual route: export with FModel

Use this if the automatic export doesn't work for you.

## 1. Export the models with FModel

1. Download [FModel](https://fmodel.app) and open it.
2. **Settings > General**
   - *Archive Directory*: `<Steam>\steamapps\common\RSDragonwilds\RSDragonwilds\Content\Paks`
   - *UE Versions*: `GAME_UE5_6` (the game runs Unreal Engine 5.6, per `UE4SS.log`).
3. **Mappings file.** UE5 games need one to read their assets. In game with UE4SS running, open the UE4SS console and use *Dumpers > Generate .usmap file* (or its keybind, Ctrl+Numpad 6 by default). It writes `Mappings.usmap` next to the game exe. In FModel, go to **Settings > General > Local Mapping File** and pick it.
4. If FModel asks for an **AES key**, the paks are encrypted and you need the game's key (the Dragonwilds modding community usually publishes it). If it opens without asking, skip this.
5. **Settings > Models > Mesh Export Format**: `glTF 2.0 (binary)`.
6. In the **Archives** tab, load all archives. In **Folders**, go to `RSDragonwilds/Content/Art/Env` (buildings, walls and props live there; base building pieces are under `Base_Building`), right-click the folder and choose **Export Folder's Packages Models**. Export more folders the same way if you want them.

FModel writes to its `Output\Exports` folder by default.

## 2. Open the viewer

Open `ModelViewer/index.html` in Chrome or Edge, click **Open export folder** and pick FModel's `Output\Exports` folder (or any folder under it). You can also drag the folder onto the page.

If the page stays blank when opened by double-click, serve it instead: in the `ModelViewer` folder run `python -m http.server 8000` and open `http://localhost:8000`.

The page loads three.js from jsDelivr, so it needs an internet connection.

## Notes

- Models may show in flat colours. FModel's glTF export usually writes textures as separate files that the mesh does not link to. Shapes and sizes are what matter for finding objects.
- Sizes are shown in the export's units. FModel's glTF export normally converts Unreal centimetres to metres.
- Big castles are usually built from many pieces (walls, towers, roofs), so search for parts like `wall`, `tower`, `battlement`, `gate`.
- Folder and type filters use the object path. `SM_` is a static mesh (the usual choice for placeable pieces). `SK_` is a skeletal (animated) mesh.
- Stars are kept in your browser for this page.

## Save Editor (/character)

`character.html` edits a character save (`%LOCALAPPDATA%\RSDragonwilds\Saved\SaveCharacters\<name>.json`) in the browser:
spellbooks (4 wheels of 12, `GameProgress.Spellcasting.SelectedSpells`, "" is an empty slot), unlocked spells and recipes
(`GameProgress.Progress.SpellsUnlocked` / `RecipesUnlocked`, plus the `...New` lists that show the "new" badge in game).
Names and icons come from `/gamedata/` (see `gamedata/README.md`); ids are the game's persistence ids.

The save is plain JSON in Unreal's own layout (CRLF, tabs, objects' braces on their own line, floats with 17 digits), which
`JSON.stringify` can't reproduce. `character-save.js` parses the file while remembering where every value sits and, on save,
rewrites only the values that changed, so the rest of the file stays byte-identical. Before the first write it copies the
original to `SaveCharacters\Ashenfallen backups\` (or downloads it) and into the browser's IndexedDB. `npm test` runs its tests.

## Hosting it online (Railway)

`server.js` is a small no-dependency web server for the viewer. Railway builds it from this repo on every push, and the model data lives on a Railway volume at `/data`.

- `.\deploy.ps1` publishes the data. It makes a slim copy in `web-data\` (textures as 512px WebP, meshes meshopt-compressed, about 400 MB instead of 9 GB), then uploads only the files the site doesn't have yet. Run it again after each export.
- Variables on the Railway service: `SITE_PASSWORD` (optional: set it to require a password, leave it unset for a public site), `SITE_CLOSED` (set it to show a "coming soon" page), `SITE_NAME`, `DATA_DIR` (default `/data`) and `UPLOAD_TOKEN` (set by `deploy.ps1`).
