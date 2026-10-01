// Writes gamedata/gamedata.json, the combined file /crafting and /calculators read, from the per-file game data.
//   node tools/build-gamedata.mjs [gamedata folder]
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const dir = process.argv[2] || 'gamedata';
const read = async (name, fallback) => { try { return JSON.parse(await readFile(join(dir, name), 'utf8')); } catch { return fallback; } };
const [version, items, recipes, skillData] = await Promise.all([read('version.json', {}), read('items.json', []), read('recipes.json', []), read('skills.json', {})]);

const out = { version: version.game || null, items: {}, recipes: [], stations: {}, skills: skillData.skills || [], xpTable: skillData.xpTable || [] };
for (const it of items) out.items[it.id] = { name: it.name || it.asset || it.id, ...(it.icon && { icon: '/gamedata/' + it.icon }), ...(it.category && { category: it.category }) };
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
for (const r of recipes) {
  if (r.test) continue;
  const station = r.station ? slug(r.station) : undefined;
  if (station) out.stations[station] = { name: r.station };
  // A recipe that makes several things is listed once per product, so each can be planned on its own.
  for (const [i, m] of (r.makes || []).entries()) out.recipes.push({
    id: i ? `${r.id}:${i}` : r.id, name: r.name, output: { item: m.item, qty: m.count ?? 1 },
    ingredients: (r.needs || []).map(n => ({ item: n.item, qty: n.count ?? 1 })),
    ...(station && { station }), ...(r.skill && { skill: slug(r.skill) }), ...(r.level != null && { level: r.level }), ...(r.xp != null && { xp: r.xp }),
  });
}
for (const r of recipes) if (r.skill && !out.skills.some(s => s.id === slug(r.skill))) out.skills.push({ id: slug(r.skill), name: r.skill });
await writeFile(join(dir, 'gamedata.json'), JSON.stringify(out));
console.log(`gamedata.json: ${Object.keys(out.items).length} items, ${out.recipes.length} recipes, ${Object.keys(out.stations).length} stations, ${out.skills.length} skills`);
