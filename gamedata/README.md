# Game data

Extracted from the RuneScape: Dragonwilds pak files by `ModelExporter gamedata` (run `.\export-gamedata.ps1`),
then `node tools/build-gamedata.mjs gamedata` writes the combined `gamedata.json`. Every tool on the site reads it from here.

Served at `/gamedata/<file>` (and `/gamedata.json`). The copy in this folder deploys with the code; a file uploaded to
`$DATA_DIR/gamedata/` on the Railway volume overrides it without a redeploy. Re-run the export after each game update.

## Conventions
- `id` is the game's **persistence id** (22-char base64url, e.g. `YZOJIURm2He0FSiVNikuuw`), the key the character save uses.
  Where the game has none, `id` falls back to the asset name; `asset` always holds the asset or row name.
- Every cross reference (`item`, `lootTables`, `table`) is an `id`.
- `icon` is a path relative to `/gamedata/`, e.g. `icons/T_Icon_Bones.webp` (square WebP), or null.
- Optional fields may be missing or null. Extra fields may appear.

## Files
| File | Shape |
|---|---|
| `version.json` | `{ game, extracted, counts: { items, recipes, ... } }` |
| `items.json` | `[{ id, name, description, icon, asset, category, maxStack, durability, weight, slot, powerLevel, model }]` (`model`: SM_ mesh name if the viewer can show it) |
| `spells.json` | `[{ id, name, description, icon, asset, school, level, cooldown, costs: [{ item, count }] }]` |
| `recipes.json` | `[{ id, name, icon, asset, station, tier, skill, level, xp, makes: [{ item, count }], needs: [{ item, count }], test }]` (`test: true` only on debug rows) |
| `skills.json` | `{ skills: [{ id, name }], xpTable: [cumulative XP to reach level i+1] }` |
| `quests.json` | `[{ id, name, icon, asset, region, stages: [...], rewards: [...] }]` |
| `loottables.json` | `[{ id, asset, rolls: { min, max }, weighted, guaranteed: [entry], bonus: [entry] }]`; entry `{ item | table, min, max, chance (0..1 per roll), weight, note }` |
| `enemies.json` | `[{ id, name, asset, level, region, lootTables: [id], model, icon }]` |
| `chests.json` | `[{ id, name, asset, lootTables: [id], respawnSeconds, model, icon }]` |
| `gamedata.json` | combined file for /crafting and /calculators: `{ version, items: {id: {name, icon, category}}, recipes: [{ id, output: {item, qty}, ingredients: [{item, qty}], station, skill, level, xp }], stations, skills, xpTable }` |
| `icons/` | item, spell and quest icons, 128 px WebP |

Loot maths (drops page): a guaranteed entry always drops (times its `chance` if under 1). A bonus entry drops on each of
`rolls` rolls with `chance`, or with `weight / sum of weights` when the table is `weighted`. An entry with `table` rolls
that nested table. The page folds this into one chance per kill.
