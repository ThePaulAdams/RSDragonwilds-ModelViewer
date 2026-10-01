// Turns the exporter's game data (export-gamedata.ps1 -> gamedata-out) into the site's gamedata/ folder:
// copies the files and icons, adds readable names the game only has as tags, and writes gamedata.json,
// the combined file /crafting and /calculators read.
//   node tools/build-gamedata.mjs [from = gamedata-out] [to = gamedata]
import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';

const [from = 'gamedata-out', to = 'gamedata'] = process.argv.slice(2);
const read = async (name, fallback) => { try { return JSON.parse(await readFile(join(from, name), 'utf8')); } catch { return fallback; } };
const write = (name, data) => writeFile(join(to, name), JSON.stringify(data));
const words = s => String(s).replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();

await mkdir(join(to, 'icons'), { recursive: true });
const names = ['version', 'items', 'recipes', 'spells', 'quests', 'loottables', 'enemies', 'chests', 'skills'];
const d = Object.fromEntries(await Promise.all(names.map(async n => [n, await read(n + '.json', n === 'version' || n === 'skills' ? {} : [])])));

// Items: readable equip slot and category ("ELoadoutSlotStrategy::HeldOnlyRight" -> "Main hand").
const SLOTS = { HeldOnlyRight: 'Main hand', HeldOnlyLeft: 'Off hand', HeldTwoHanded: 'Two-handed' };
for (const it of d.items) {
  if (it.slot) { const s = it.slot.split('::').pop(); it.slotName = SLOTS[s] || words(s); }
  if (it.category) it.categoryName = words(it.category.split('.').slice(1).filter(p => p !== 'Type').slice(-2).join(' '));
}

// Recipes: the game has no station field, only the XP event (e.g. "Craft_Smithing_Forge_Tier4"), so the station and
// tier are read from that. Soft-deleted recipes are flagged so tools can hide them.
const STATIONS = [[/Smithing_Forge/, 'Forge'], [/Crafting_Table/, 'Crafting Table'], [/Cooking_Pot/, 'Cooking Pot'], [/Campfire/, 'Campfire'],
  [/Cooking_Range/, 'Cooking Range'], [/Herblore_Lab/, 'Herblore Lab'], [/Smelting/, 'Furnace'], [/Rune_Altar/, 'Rune Altar'], [/Build_Crafting_Station/, 'Build menu']];
for (const r of d.recipes) {
  const ev = r.xpEvent || '';
  const st = STATIONS.find(([re]) => re.test(ev));
  if (st && !r.station) r.station = st[1];
  const tier = ev.match(/Tier(\d+)/);
  if (tier && r.tier == null) r.tier = +tier[1];
  if (r.skill) r.skillName = words(r.skill.replace(/^SKILL_/, ''));
  if (r.raw?.bSoftDeleted) r.deleted = true;
}

for (const n of names) if (n !== 'skills' || Object.keys(d.skills).length) await write(n + '.json', d[n]);
let icons = 0;
for (const f of await readdir(join(from, 'icons')).catch(() => [])) if (f.endsWith('.webp')) { await copyFile(join(from, 'icons', f), join(to, 'icons', f)); icons++; }

// Combined file for the crafting planner (shape in static/planner-lib.js).
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const out = { version: d.version.game || null, items: {}, recipes: [], stations: {}, skills: d.skills.skills || [], xpTable: d.skills.xpTable || [] };
for (const it of d.items) out.items[it.id] = { name: it.name || it.asset || it.id, ...(it.icon && { icon: '/gamedata/' + it.icon }), ...(it.categoryName && { category: it.categoryName }) };
for (const r of d.recipes) {
  if (r.test || r.deleted) continue;
  const station = r.station ? slug(r.station) : undefined;
  if (station) out.stations[station] = { name: r.station };
  const skill = r.skillName ? slug(r.skillName) : undefined;
  if (skill && !out.skills.some(s => s.id === skill)) out.skills.push({ id: skill, name: r.skillName });
  // A recipe that makes several things is listed once per product, so each can be planned on its own.
  for (const [i, m] of (r.makes || []).entries()) out.recipes.push({
    id: i ? `${r.id}:${i}` : r.id, name: r.name, output: { item: m.item, qty: m.count ?? 1 },
    ingredients: (r.needs || []).map(n => ({ item: n.item, qty: n.count ?? 1 })),
    ...(station && { station }), ...(skill && { skill }), ...(r.level != null && { level: r.level }), ...(r.xp != null && { xp: r.xp }),
  });
}
await write('gamedata.json', out);
console.log(`${to}: ${d.items.length} items, ${d.recipes.length} recipes, ${d.spells.length} spells, ${d.quests.length} quests, ` +
  `${d.loottables.length} loot tables, ${d.enemies.length} enemies, ${d.chests.length} chests, ${icons} icons; gamedata.json ${out.recipes.length} recipes`);
