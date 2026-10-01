// Pure planning and calculator logic shared by /crafting and /calculators (no DOM, no network).
// Game data shape (see data/README.md):
//   items:    { [id]: { name, icon?, category? } }
//   recipes:  [{ id, output: { item, qty }, ingredients: [{ item, qty }], station?, skill?, level?, xp? }]
//   stations: { [id]: { name } }   skills: [{ id, name }]   xpTable: cumulative XP to reach level i+1

// Cleans extracted game data: drops placeholder rows (no output, no ingredients, journal entries, unknown items),
// removes exact duplicate recipes and fills in an estimated XP table when the game data has none.
export function cleanData(raw) {
  const data = { ...raw, items: raw.items || {} };
  const seen = new Set();
  data.recipes = (raw.recipes || []).filter(r => {
    const out = r.output?.item;
    if (!out || !data.items[out] || /^RECIPE_Journal/i.test(r.name || '') || !r.ingredients?.length) return false;
    if (r.ingredients.some(g => !g.item || !data.items[g.item])) return false;
    const key = out + '|' + r.output.qty + '|' + r.station + '|' + r.ingredients.map(g => g.item + 'x' + g.qty).sort().join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!raw.xpTable?.length) { data.xpTable = estimatedXpTable(); data.xpEstimated = true; }
  return data;
}

// The classic RuneScape curve to level 99. Used only as an estimate when the game's own table isn't available.
export function estimatedXpTable(max = 99) {
  const t = [0]; let pts = 0;
  for (let l = 1; l < max; l++) { pts += Math.floor(l + 300 * Math.pow(2, l / 7)); t.push(Math.floor(pts / 4)); }
  return t;
}

// Short label to tell apart several recipes for the same item.
export function recipeLabel(ix, r) {
  return `${r.name || itemName(ix, r.output.item)}: ${r.ingredients.map(g => `${g.qty} ${itemName(ix, g.item)}`).join(', ')}`;
}

export function indexData(data) {
  const byOutput = new Map(), byIngredient = new Map();
  for (const r of data.recipes) {
    const o = r.output.item;
    if (!byOutput.has(o)) byOutput.set(o, []);
    byOutput.get(o).push(r);
    for (const g of r.ingredients) {
      if (!byIngredient.has(g.item)) byIngredient.set(g.item, []);
      byIngredient.get(g.item).push(r);
    }
  }
  return { data, byOutput, byIngredient };
}

export const itemName = (ix, id) => ix.data.items[id]?.name || id;

// Expands targets [{item, qty}] into a full plan.
// opts.have: { item: qty } already owned (used up front, intermediates included)
// opts.choice: { item: recipeId } which recipe to use when an item has several
// opts.raw: Set of item ids to treat as raw even though they have a recipe
export function plan(ix, targets, opts = {}) {
  const have = { ...(opts.have || {}) };
  const choice = opts.choice || {}, raw = opts.raw || new Set();
  const rawNeed = {}, crafts = {}, stations = {}, skillLevel = {}, skillXp = {}, warnings = [];
  const used = {};   // how much of `have` was consumed

  function recipeFor(item) {
    if (raw.has(item)) return null;
    const list = ix.byOutput.get(item);
    if (!list) return null;
    return list.find(r => r.id === choice[item]) || list[0];
  }

  function node(item, qty, path) {
    const take = Math.min(have[item] || 0, qty);
    if (take) { have[item] -= take; used[item] = (used[item] || 0) + take; }
    const need = qty - take;
    const n = { item, qty, fromInventory: take, need, children: [], recipe: null, crafts: 0 };
    if (need <= 0) return n;
    const r = recipeFor(item);
    if (!r) { rawNeed[item] = (rawNeed[item] || 0) + need; return n; }
    if (path.includes(item)) {
      warnings.push(`Circular recipe through ${itemName(ix, item)}; treated as raw.`);
      rawNeed[item] = (rawNeed[item] || 0) + need;
      return n;
    }
    const times = Math.ceil(need / r.output.qty);
    n.recipe = r; n.crafts = times; n.surplus = times * r.output.qty - need;
    crafts[r.id] = (crafts[r.id] || 0) + times;
    if (r.station) stations[r.station] = true;
    if (r.skill) {
      skillLevel[r.skill] = Math.max(skillLevel[r.skill] || 0, r.level || 0);
      skillXp[r.skill] = (skillXp[r.skill] || 0) + (r.xp || 0) * times;
    }
    for (const g of r.ingredients) n.children.push(node(g.item, g.qty * times, [...path, item]));
    return n;
  }

  const tree = targets.filter(t => t.qty > 0).map(t => node(t.item, t.qty, []));
  const rawList = Object.entries(rawNeed).map(([item, qty]) => ({ item, qty }))
    .sort((a, b) => itemName(ix, a.item).localeCompare(itemName(ix, b.item)));
  const craftList = Object.entries(crafts).map(([id, times]) => {
    const recipe = ix.data.recipes.find(r => r.id === id);
    return { recipe, times, makes: times * recipe.output.qty };
  });
  return { tree, raw: rawList, crafts: craftList, stations: Object.keys(stations), skillLevel, skillXp, used, warnings };
}

// Every recipe that uses `item` directly, and every item that can be made from it through any chain.
export function usedIn(ix, item) {
  const direct = ix.byIngredient.get(item) || [];
  const seen = new Set([item]), queue = [item], reach = [];
  while (queue.length) {
    for (const r of ix.byIngredient.get(queue.shift()) || []) {
      const o = r.output.item;
      if (!seen.has(o)) { seen.add(o); reach.push(o); queue.push(o); }
    }
  }
  return { direct, reachable: reach };
}

// Items you can fully make from `have` (every raw ingredient covered), one craft's worth.
export function craftableFrom(ix, have) {
  const out = [];
  for (const [item] of ix.byOutput) {
    const p = plan(ix, [{ item, qty: 1 }], { have });
    if (p.raw.length === 0 && p.crafts.length > 0 && !p.warnings.length) out.push({ item, plan: p });
  }
  return out.sort((a, b) => itemName(ix, a.item).localeCompare(itemName(ix, b.item)));
}

// How many of `item` can be made with `have`, found by doubling then bisecting (monotone in quantity).
export function maxCraftable(ix, item, have, cap = 100000) {
  const ok = q => { const p = plan(ix, [{ item, qty: q }], { have }); return p.raw.length === 0 && p.crafts.length > 0; };
  if (!ok(1)) return 0;
  let lo = 1, hi = 2;
  while (hi < cap && ok(hi)) { lo = hi; hi *= 2; }
  if (hi >= cap && ok(cap)) return cap;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; ok(m) ? lo = m : hi = m; }
  return lo;
}

// ---- XP ----
export const levelForXp = (table, xp) => { let l = 1; while (l < table.length && xp >= table[l]) l++; return l; };
export const xpForLevel = (table, level) => table[Math.min(Math.max(level, 1), table.length) - 1];
export function xpProgress(table, xp) {
  const level = levelForXp(table, xp), max = level >= table.length;
  const base = xpForLevel(table, level), next = max ? base : xpForLevel(table, level + 1);
  return { level, max, base, next, into: xp - base, span: next - base, pct: max ? 1 : (xp - base) / (next - base) };
}
// actions needed to go from `from` xp to `to` xp at `perAction` xp each
export const actionsNeeded = (from, to, perAction) => perAction > 0 && to > from ? Math.ceil((to - from) / perAction) : 0;

// ---- Runecrafting ----
// altar: { rune, level, xpPerEssence, multiples?: [levels at which you get +1 rune per essence] }
export function runesPerEssence(altar, level) {
  return 1 + (altar.multiples || []).filter(l => level >= l).length;
}
export function runecraftRuns({ altar, level, essencePerRun, targetRunes, targetXp }) {
  const rpe = runesPerEssence(altar, level);
  const out = { runesPerEssence: rpe };
  if (targetRunes > 0) {
    out.essence = Math.ceil(targetRunes / rpe);
    out.runs = Math.ceil(out.essence / essencePerRun);
    out.xp = out.essence * altar.xpPerEssence;
  } else if (targetXp > 0) {
    out.essence = Math.ceil(targetXp / altar.xpPerEssence);
    out.runs = Math.ceil(out.essence / essencePerRun);
    out.runes = out.essence * rpe;
  }
  return out;
}

// ---- Share links ----
export const encodeList = list => list.filter(x => x.qty > 0).map(x => `${x.item}:${x.qty}`).join(',');
export const decodeList = s => (s || '').split(',').filter(Boolean).map(p => { const [item, q] = p.split(':'); return { item, qty: Math.max(1, parseInt(q, 10) || 1) }; });
