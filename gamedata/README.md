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
| `version.json` | `{ game, extracted, counts }` (`game` is the build string, e.g. `RSDragonwilds-5.6.1-245400+++dominion+hotfix-...`) |
| `items.json` | `[{ id, asset, internalName, name, description, icon, category, categoryName, type, maxStack, durability, weight, powerLevel, slot, slotName, skill, damageMultiplier, model }]` (`model`: SM_ mesh name, linkable as /model/NAME) |
| `spells.json` | `[{ id, asset, name, description, icon, cooldown, castType, requirements, costs: [{ item, count }], xpEvent }]` (52 utility spells; no school or level field in the game data) |
| `recipes.json` | `[{ id, asset, name, makes: [{ item, count }], needs: [{ item, count }], skill, skillName, xp, xpEvent, station, tier, test, deleted, raw }]`. `station`/`tier` are read from `xpEvent` (the game has no station field); `deleted: true` = soft-deleted in game, hide it; `test: true` = debug row. No level requirement exists in the data. |
| `quests.json` | `[{ id, asset, name, description, main, activity, objectives }]` (no rewards or stages in the data) |
| `loottables.json` | three kinds, keyed by row name (no persistence id): `drop` `{ id, chance, entries: [{ item, asset, min, max, chance }] }`, every entry rolls on its own; `set` `{ id, entries }`, one entry is picked, `chance` is its share; `chestRoll` `{ id, guaranteedSets, guaranteedItems, rolls: { min, max }, bonusSets: [{ set, chance }] }`, each guaranteed set is picked once, then each bonus roll picks a set by `chance` share |
| `enemies.json` | `[{ id, asset, name, nameFromAsset, difficulty, tags, lootRow, lootTables: [id], lootByPowerLevel: [{ minPower, tables }], model }]` |
| `chests.json` | `[{ id, name, lootTables: [id], respawnSeconds, respawnTrigger }]` |
| `gamedata.json` | combined file for /crafting and /calculators: `{ version, items: {id: {name, icon, category}}, recipes: [{ id, output: {item, qty}, ingredients: [{item, qty}], station, skill, xp }], stations, skills, xpTable }` (deleted and test recipes left out) |
| `icons/` | 1,048 item, spell and quest icons, at most 128 px WebP |

Not in the data yet: skill XP table (`skills.json`), recipe level requirements, quest rewards. 41 items have no icon
(31 use a texture format the exporter cannot decode yet).

## Updating
On the PC with the game: `.\export-gamedata.ps1` (writes `gamedata-out\`), then `node tools/build-gamedata.mjs gamedata-out gamedata`, commit.
