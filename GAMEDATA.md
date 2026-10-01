# Game data export

`.\export-gamedata.ps1` (or `ModelExporter gamedata <paks> <usmap> <out>`) writes plain JSON read straight from the
game's DataTables / DataAssets, plus 128 px WebP icons (`icons/`). Names are English source strings (string tables resolved).
Ids are the game's own `PersistenceID` (22-char base64url, what save files store) where the asset has one; `asset` is the asset name.

| file | contents |
|---|---|
| items.json | `ITEM_*` and `DA_Consumable_*` assets: id, asset, name, description, category (gameplay tag), filterTags, icon, powerLevel, weight, maxStack, durability, slot, skill, damageMultiplier, blockingDamageNegation, damageTypes, model (static mesh name) |
| recipes.json | `RECIPE_*`: id, name (of the first output), makes/needs `[{item,count}]` (item = item id, or the asset name if unresolved), skill, xp, xpEvent (DataTable row; hints at the station, e.g. `Craft_Smithing_Forge_Tier4`), audioTag, raw (remaining fields) |
| skills.json | `SKILL_*` (incl. deprecated ones, flagged): id (PersistenceID, the id used in saves), asset, name, maxLevel, icon; `xpTable[i]` = cumulative XP to reach level i+1 (row `XPByLevel_011`; the game picks its row natively, so every `CT_XPByLevel` row is in `xpTables`) |
| perks.json | `PerkV2_*` skill perks: skill, level required, recipes unlocked |
| runecrafting.json | Rune altar: per-rune recipe (runes per essence, extra-rune chance, seconds, XP per craft, unlock level, bonus-yield perk) plus the Runecrafting perks |
| spells.json | `USD_*` utility spells: id (PersistenceID, else asset), name, icon, cooldown (s), castType, requirements, costs `[{item,count}]`, xpEvent, raw |
| quests.json | `Quest_*`: id, name, description, main, activity, objectives `[{key,text}]` (the data has no reward fields; rewards are scripted in the quest blueprints) |
| loottables.json | see below |
| enemies.json | one per `BP_AI_*_Character`: id, name (from the AI data asset; `nameFromAsset:true` when guessed from the asset name), difficulty, tags, lootRow, lootTables, lootByPowerLevel, model |
| chests.json | one per `DT_LootChest_RespawnProfiles` row: id, respawnSeconds (in-game time), respawnTrigger, lootTables |
| version.json / meta.json | game build (from the Mappings file name), extraction time, counts |

Recipes also carry `level` / `levelSkill` (from the perk that unlocks them, else from skill-level progression bundles); recipes with neither have no level requirement in the data.

## Loot structure (as the game defines it)

`DT_LootDropTable` (+ `_DowdunReach`): row = one enemy/resource's drop list (`kind:"drop"`):
`chance` = row `DropChance`/100 (whether the table rolls at all), `entries[]` = `{item, min, max, chance}` where
`MinimumDropAmount`/`MaximumDropAmount` is the stack size and `DropChance` (0-100, normalised here to 0..1) is that entry's
independent roll. The same item can appear several times with different chances (e.g. 100/75/25 %): each line rolls separately.

`DT_EnemyLootDropTable` / `DT_CompositeEnemyLootDropTable`: enemy row -> `TablesByPowerLevel[{MinimumPowerLevel, TableHandles[drop table rows]}]`
(the table set used grows with the enemy's power level). The enemy blueprint's `LootDropComponent.EnemyTableRowHandle.RowName` selects the row
(`lootRow`); `lootByPowerLevel` keeps the tiers, `lootTables` is the flat list of drop-table ids.

Chests: `DT_LootChest_RespawnProfiles` row -> respawn time/trigger + `LootRollHandle` -> `DT_LootChests_Prefabs` row (`kind:"chestRoll"`):
`guaranteedSets` (always dropped, ids of `kind:"set"` rows), `guaranteedItems`, `rolls{min,max}` = number of extra set rolls
(`Min/MaxAdditionalSetRolls`), `bonusSets[{set, chance}]` = pool the extra rolls pick from with that chance (0..1).
`kind:"set"` (`DT_LootChest_Sets`) = a list of `entries` like a drop table.

## Known gaps
- ~30 item icons use texture formats whose decoder needs the native Detex library (not bundled); those items have `icon: null`.
- A handful of recipe/loot references point at items that don't exist in the data (dangling in the game files); they keep the asset name as `item`.
- Station for a recipe is not a field on the recipe; only `xpEvent` hints at it.
- Enemy `model` is only filled when the character blueprint itself names a skeletal mesh (mostly null: meshes are inherited from parent blueprints).
