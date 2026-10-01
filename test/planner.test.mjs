import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as L from '../static/planner-lib.js';
const data = JSON.parse(readFileSync(new URL('../data/sample-gamedata.json', import.meta.url)));
const ix = L.indexData(data);
const raw = p => Object.fromEntries(p.raw.map(r => [r.item, r.qty]));

test('oak chest expands to raw materials with batch rounding', () => {
  const p = L.plan(ix, [{ item: 'oak_chest', qty: 1 }]);
  // 6 planks = 3 crafts of 2 = 3 logs; 10 nails = 1 craft = 1 bronze bar = 1 copper + 1 tin
  assert.deepEqual(raw(p), { oak_logs: 3, copper_ore: 1, tin_ore: 1 });
  assert.deepEqual(p.stations.sort(), ['anvil', 'furnace', 'workbench']);
  assert.equal(p.skillLevel.crafting, 20);
});
test('inventory is used before crafting, intermediates included', () => {
  const p = L.plan(ix, [{ item: 'oak_chest', qty: 1 }], { have: { oak_plank: 6, bronze_bar: 1 } });
  assert.deepEqual(raw(p), {});
});
test('quantities scale and surplus is tracked', () => {
  const p = L.plan(ix, [{ item: 'oak_plank', qty: 3 }]);
  assert.equal(raw(p).oak_logs, 2);
  assert.equal(p.tree[0].surplus, 1);
});
test('reverse lookup follows chains', () => {
  const u = L.usedIn(ix, 'copper_ore');
  assert.ok(u.reachable.includes('oak_chest') && u.reachable.includes('bronze_sword'));
});
test('craftableFrom and maxCraftable', () => {
  const have = { copper_ore: 4, tin_ore: 4 };
  assert.ok(L.craftableFrom(ix, have).some(x => x.item === 'bronze_sword'));
  assert.equal(L.maxCraftable(ix, 'bronze_sword', have), 2);
  assert.equal(L.maxCraftable(ix, 'steel_sword', have), 0);
});
test('xp maths', () => {
  const t = data.xpTable;
  assert.equal(L.levelForXp(t, 0), 1);
  assert.equal(L.levelForXp(t, 83), 2);
  assert.equal(L.levelForXp(t, 82), 1);
  assert.equal(L.levelForXp(t, 1e12), t.length);
  assert.equal(L.xpProgress(t, 1e12).max, true);
  assert.equal(L.actionsNeeded(0, 100, 30), 4);
});
test('runecrafting uses flat yield plus the efficiency perk', () => {
  const air = data.runecrafting.altars[0];
  assert.equal(L.runesPerEssence(air, 10), 5);
  assert.equal(L.runesPerEssence(air, 22), 5.25);
  const r = L.runecraftRuns({ altar: air, level: 1, essencePerTrip: 28, targetRunes: 1000 });
  assert.equal(r.essence, 200); assert.equal(r.trips, 8); assert.equal(r.xp, 400); assert.equal(r.seconds, 2000);
  assert.equal(L.runecraftRuns({ altar: air, level: 1, targetXp: 100 }).essence, 50);
});
test('level requirement is credited to levelSkill, XP to skill', () => {
  const d = L.cleanData({ items: { a: { name: 'A' }, b: { name: 'B' } }, xpTable: [0, 1],
    recipes: [{ id: '1', output: { item: 'b', qty: 1 }, ingredients: [{ item: 'a', qty: 1 }], skill: 'artisan', xp: 5, level: 35, levelSkill: 'ranged' }] });
  const p = L.plan(L.indexData(d), [{ item: 'b', qty: 2 }]);
  assert.deepEqual(p.skillLevel, { ranged: 35 }); assert.deepEqual(p.skillXp, { artisan: 10 });
});
test('share links round trip', () => {
  const l = [{ item: 'oak_chest', qty: 2 }];
  assert.deepEqual(L.decodeList(L.encodeList(l)), l);
});
test('cleanData drops placeholder rows and duplicates, estimates XP', () => {
  const d = L.cleanData({ items: { a: { name: 'A' }, b: { name: 'B' } }, recipes: [
    { id: '1', name: 'B', output: { item: 'b', qty: 1 }, ingredients: [{ item: 'a', qty: 2 }] },
    { id: '2', name: 'B', output: { item: 'b', qty: 1 }, ingredients: [{ item: 'a', qty: 2 }] },
    { id: '3', name: 'RECIPE_Journal_X', output: { item: '', qty: 1 }, ingredients: [] },
    { id: '4', name: 'C', output: { item: 'b', qty: 1 }, ingredients: [] }], xpTable: [] });
  assert.equal(d.recipes.length, 1);
  assert.equal(d.xpEstimated, true);
  assert.equal(d.xpTable.length, 99);
  assert.equal(d.xpTable[1], 83); assert.equal(d.xpTable[98], 13034431);
});
