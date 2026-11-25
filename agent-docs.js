// The documents /.well-known/search looks through (see agent-search.js): the tool pages, the game data
// (items with how they are made and where they drop, enemies, chests, quests, perks, spells) and the 3D models.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { htmlToDoc } from './agent-search.js';

const PAGES = [
  ['/', 'home.html', 'Ashenfallen: fan-made tools for RuneScape: Dragonwilds', 1.4],
  ['/viewer', 'index.html', '3D model viewer: browse RuneScape: Dragonwilds models in the browser', 1.4],
  ['/base-builder', 'basebuilder.html', 'Base builder: plan a base, or load your save to see it', 1.4],
  ['/crafting', 'crafting.html', 'Crafting planner: raw materials, stations and levels for anything you want to make', 1.4],
  ['/calculators', 'calculators.html', 'Calculators: XP, levels and runecrafting', 1.4],
  ['/drops', 'drops.html', 'Drops and loot finder: what drops an item, and what an enemy or chest drops', 1.4],
  ['/character', 'character.html', 'Character save editor', 1.4],
  ['/survivors', 'survivors.html', 'Survivors mini-game', 1.0],
];

const pct = c => c == null ? '' : ` (${+(c * 100).toFixed(c < 0.01 ? 2 : 1)}%)`;
const range = (a, b) => a == null ? '' : a === b || b == null ? ` ×${a}` : ` ×${a}–${b}`;
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const tag = s => clean(String(s || '').split('.').pop().replace(/([a-z])([A-Z])/g, '$1 $2'));

async function json(APP, DATA, file) {
  for (const dir of [join(DATA, 'gamedata'), join(APP, 'gamedata')]) {
    try { return JSON.parse(await readFile(join(dir, file), 'utf8')); } catch {}
  }
  return null;
}

export async function buildAgentDocs({ APP, DATA, SITE_URL, models }) {
  const docs = [];
  for (const [route, file, title, boost] of PAGES) {
    try {
      const page = htmlToDoc(await readFile(join(APP, file), 'utf8'));
      docs.push({ path: route, url: SITE_URL + route, title, boost, text: [page.description, page.text].filter(Boolean).join('\n') });
    } catch {}
  }

  const [items, recipes, loot, enemies, chests, quests, perks, spells, skillData] = await Promise.all(
    ['items.json', 'recipes.json', 'loottables.json', 'enemies.json', 'chests.json', 'quests.json', 'perks.json', 'spells.json', 'skills.json']
      .map(f => json(APP, DATA, f)));
  const itemName = new Map((items || []).map(i => [i.id, clean(i.name) || i.asset]));
  const nameOf = id => itemName.get(id) || id;
  const skillName = new Map((skillData?.skills || []).flatMap(s => [[s.asset, s.name], [s.id, s.name]]));
  const skill = s => skillName.get(s) || tag(String(s || '').replace(/^SKILL_/, ''));

  // Loot: which items a table can give, following sets inside chest rolls.
  const tables = new Map((loot || []).map(t => [t.id, t]));
  function tableItems(id, seen = new Set()) {
    const t = tables.get(id);
    if (!t || seen.has(id)) return [];
    seen.add(id);
    const out = (t.entries || []).filter(e => e.item).map(e => ({ item: e.item, min: e.min, max: e.max, chance: t.kind === 'drop' ? e.chance : null }));
    for (const s of [...(t.guaranteedSets || []), ...(t.bonusSets || []).map(b => b.set)]) out.push(...tableItems(typeof s === 'string' ? s : s?.set, seen));
    for (const g of t.guaranteedItems || []) if (g?.item) out.push({ item: g.item, min: g.min ?? g.count, max: g.max ?? g.count });
    return out;
  }
  const droppedBy = new Map();   // item id -> ["Abyssal Demon (enemy)", ...]
  const dropList = (list, label) => {
    const seen = new Map();
    for (const d of list) if (!seen.has(d.item)) seen.set(d.item, d);
    for (const d of seen.values()) { let a = droppedBy.get(d.item); if (!a) droppedBy.set(d.item, a = []); if (a.length < 12 && !a.includes(label)) a.push(label); }
    return [...seen.values()];
  };

  for (const e of enemies || []) {
    const ids = new Set([...(e.lootTables || []), ...(e.lootByPowerLevel || []).flatMap(p => p.tables || [])]);
    const name = clean(e.name || e.nameFromAsset || e.id);
    const drops = dropList([...ids].flatMap(id => tableItems(id)), `${name} (enemy)`);
    docs.push({ path: `enemies/${e.id}`, url: `${SITE_URL}/drops?enemy=${encodeURIComponent(e.id)}`, title: `${name} (enemy)`,
      text: [`Enemy: ${name}.`, e.difficulty && `Difficulty: ${tag(e.difficulty)}.`, e.tags?.length && `Tags: ${e.tags.map(tag).join(', ')}.`,
        drops.length && `Drops: ${drops.slice(0, 40).map(d => nameOf(d.item) + range(d.min, d.max) + pct(d.chance)).join(', ')}.`].filter(Boolean).join('\n') });
  }
  for (const c of chests || []) {
    const name = clean(c.name || c.id);
    const drops = dropList((c.lootTables || []).flatMap(id => tableItems(id)), `${name} (chest)`);
    docs.push({ path: `chests/${c.id}`, url: `${SITE_URL}/drops?chest=${encodeURIComponent(c.id)}`, title: `${name} (chest)`,
      text: [`Chest: ${name}.`, c.respawnSeconds && `Respawns ${Math.round(c.respawnSeconds / 3600)} h after ${tag(c.respawnTrigger || 'opening')}.`,
        drops.length && `Contains: ${drops.slice(0, 40).map(d => nameOf(d.item) + range(d.min, d.max)).join(', ')}.`].filter(Boolean).join('\n') });
  }

  const madeBy = new Map();   // item id -> recipe lines
  for (const r of recipes || []) {
    if (r.deleted || r.test) continue;
    const line = `${(r.makes || []).map(m => nameOf(m.item) + (m.count > 1 ? ` ×${m.count}` : '')).join(', ')} from ` +
      `${(r.needs || []).map(n => `${n.count} × ${nameOf(n.item)}`).join(', ') || 'nothing'}` +
      `${r.station ? `, at ${tag(r.station)}` : ''}${r.tier ? ` (tier ${r.tier})` : ''}` +
      `${r.level ? `, needs ${skill(r.levelSkill || r.skill)} level ${r.level}` : ''}${r.xp ? `, gives ${r.xp} ${skill(r.skill)} XP` : ''}`;
    for (const m of r.makes || []) { let a = madeBy.get(m.item); if (!a) madeBy.set(m.item, a = []); if (a.length < 6) a.push(line); }
  }
  for (const i of items || []) {
    const name = clean(i.name);
    if (!name || /(^|_)(test|debug)(_|$)/i.test(i.internalName || i.asset || '')) continue;
    const facts = [i.categoryName && `Category: ${i.categoryName}`, i.slotName && `Slot: ${i.slotName}`, i.skill && `Skill: ${skill(i.skill)}`,
      i.powerLevel != null && `Power level: ${i.powerLevel}`, i.weight != null && `Weight: ${i.weight}`,
      i.durability != null && `Durability: ${i.durability}`, i.maxStack > 1 && `Stacks to ${i.maxStack}`].filter(Boolean);
    docs.push({ path: `items/${i.internalName || i.asset || i.id}`, url: `${SITE_URL}/drops?item=${encodeURIComponent(i.id)}`, title: name,
      text: [`Item: ${name}.`, clean(i.description), facts.length && facts.join('. ') + '.',
        madeBy.has(i.id) && `How to make: ${madeBy.get(i.id).join('; ')}. Plan it at ${SITE_URL}/crafting.`,
        droppedBy.has(i.id) && `Dropped by: ${droppedBy.get(i.id).join(', ')}.`,
        i.model && `3D model: ${SITE_URL}/model/${encodeURIComponent(i.model)}`].filter(Boolean).join('\n') });
  }

  for (const q of quests || []) {
    const name = clean(q.name || q.asset);
    docs.push({ path: `quests/${q.internalName || q.id}`, url: `${SITE_URL}/gamedata/quests.json`, title: `${name} (quest)`,
      text: [`Quest: ${name}.`, clean(q.description), q.objectives?.length && `Objectives: ${q.objectives.map(o => clean(o.text)).filter(Boolean).join(' ')}`].filter(Boolean).join('\n') });
  }
  for (const p of perks || []) {
    const name = clean(p.name || p.asset);
    docs.push({ path: `perks/${p.internalName || p.id}`, url: `${SITE_URL}/calculators`, title: `${name} (${skill(p.skill)} perk)`,
      text: [`Perk: ${name}. ${skill(p.skill)} level ${p.level ?? '?'}.`, clean(p.description)].filter(Boolean).join('\n') });
  }
  for (const s of spells || []) {
    const name = clean(s.name || s.asset);
    docs.push({ path: `spells/${s.internalName || s.id}`, url: `${SITE_URL}/gamedata/spells.json`, title: `${name} (spell)`,
      text: [`Spell: ${name}.`, clean(s.description), s.cooldown != null && `Cooldown: ${s.cooldown} s.`,
        s.costs?.length && `Costs: ${s.costs.map(c => `${c.count} × ${nameOf(c.item)}`).join(', ')}.`].filter(Boolean).join('\n') });
  }

  for (const m of models || []) {
    docs.push({ path: `model/${m.slug}`, url: `${SITE_URL}/model/${encodeURIComponent(m.slug)}`, title: `${m.title} (3D model)`, boost: 0.6,
      text: `3D model ${m.title} (${m.name})${m.where ? `, from ${m.where}` : ''}. View, rotate and zoom it in the browser.` });
  }
  return docs;
}
