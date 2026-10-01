// node tests/character-save.test.mjs
import assert from 'node:assert/strict';
import { parseSave, patchSave, findKey, getAt, ue17, idToHex, hexToId } from '../character-save.js';

// A small save in the game's layout (checked against a real save): CRLF, tabs, objects' braces on their own line,
// arrays' brackets on the key's line, empty objects split over two lines, number arrays on one line, no trailing newline.
const T = '\t', N = '\r\n';
const save = [
  '{',
  `${T}"Version": 83,`,
  `${T}"meta_data":`, `${T}{`, `${T}${T}"char_name": "Paul1337noob",`, `${T}${T}"char_type": 0`, `${T}},`,
  `${T}"GameProgress":`, `${T}{`,
  `${T}${T}"Character":`, `${T}${T}{`, `${T}${T}${T}"WellRestedDecayRate": 0.55555558204650879,`, `${T}${T}${T}"Food":`, `${T}${T}${T}{`, `${T}${T}${T}}`, `${T}${T}},`,
  `${T}${T}"Progress":`, `${T}${T}{`,
  `${T}${T}${T}"RecipesUnlocked": [`, `${T}${T}${T}${T}"G2LRQkwdrgWVlZ-EXRXtcg",`, `${T}${T}${T}${T}"NbePfEBQYxH_dpKM0pqZhw"`, `${T}${T}${T}],`,
  `${T}${T}${T}"KebbitBurrowsActivated": [],`,
  `${T}${T}${T}"SpellsUnlocked": [`, `${T}${T}${T}${T}"dXCEyUWjMTCSI-u8rVpJNg"`, `${T}${T}${T}]`,
  `${T}${T}},`,
  `${T}${T}"MapCustomization":`, `${T}${T}{`, `${T}${T}${T}"WaypointLocation": [ 130067.66050720785, 149620.06558678724, -2291.3694381713867 ]`, `${T}${T}},`,
  `${T}${T}"Spellcasting":`, `${T}${T}{`, `${T}${T}${T}"SelectedSpells": [`, `${T}${T}${T}${T}"dXCEyUWjMTCSI-u8rVpJNg",`, `${T}${T}${T}${T}""`, `${T}${T}${T}]`, `${T}${T}}`,
  `${T}},`,
  `${T}"Backup": 2585780718`,
  '}'].join(N);

const doc = parseSave(save);
assert.equal(doc.nl, N); assert.equal(doc.unit, T);
assert.equal(patchSave(doc, []), save, 'no changes: identical bytes');
assert.equal(getAt(doc.data, ['GameProgress', 'Character', 'WellRestedDecayRate']), 0.5555555820465088);
assert.equal(ue17(0.5555555820465088), '0.55555558204650879');
assert.equal(ue17(98.844970703125), '98.844970703125');
assert.equal(ue17(141782.58676004037), '141782.58676004037');

const rec = findKey(doc.data, 'RecipesUnlocked');
assert.deepEqual(rec, ['GameProgress', 'Progress', 'RecipesUnlocked']);
const out = patchSave(doc, [{ path: rec, value: ['G2LRQkwdrgWVlZ-EXRXtcg', 'NbePfEBQYxH_dpKM0pqZhw', 'fW3RTULn5g8JgxaKP38I7w'] }]);
assert.equal(out, save.replace(`"NbePfEBQYxH_dpKM0pqZhw"${N}`, `"NbePfEBQYxH_dpKM0pqZhw",${N}${T}${T}${T}${T}"fW3RTULn5g8JgxaKP38I7w"${N}`));

// Empty -> filled and filled -> empty follow the game's layout, and round trip to the same bytes.
const kb = ['GameProgress', 'Progress', 'KebbitBurrowsActivated'], sp = ['GameProgress', 'Progress', 'SpellsUnlocked'];
const food = ['GameProgress', 'Character', 'Food'], wp = ['GameProgress', 'MapCustomization', 'WaypointLocation'];
const out2 = patchSave(doc, [{ path: kb, value: ['a'] }, { path: sp, value: [] }, { path: food, value: { a: 1 } }, { path: wp, value: [1.5, 2, 3] }]);
assert.ok(out2.includes(`"KebbitBurrowsActivated": [${N}${T}${T}${T}${T}"a"${N}${T}${T}${T}],`));
assert.ok(out2.includes(`"SpellsUnlocked": []${N}${T}${T}},`));
assert.ok(out2.includes(`"Food":${N}${T}${T}${T}{${N}${T}${T}${T}${T}"a": 1${N}${T}${T}${T}}`));
assert.ok(out2.includes(`"WaypointLocation": [ 1.5, 2, 3 ]`));
const back = parseSave(out2);
assert.equal(patchSave(back, [{ path: kb, value: [] }, { path: sp, value: ['dXCEyUWjMTCSI-u8rVpJNg'] }, { path: food, value: {} },
  { path: wp, value: [130067.66050720785, 149620.06558678724, -2291.3694381713867] }]), save);

// Adding a key that doesn't exist yet, and removing one.
const out3 = patchSave(doc, [{ path: ['GameProgress', 'Progress', 'RecipesNew'], value: ['x'] }]);
assert.deepEqual(parseSave(out3).data.GameProgress.Progress.RecipesNew, ['x']);
assert.ok(out3.includes(`${T}${T}${T}],${N}${T}${T}${T}"RecipesNew": [${N}${T}${T}${T}${T}"x"${N}${T}${T}${T}]${N}${T}${T}},`));
const out3b = patchSave(doc, [{ path: [...food, 'b'], value: true }]);
assert.ok(out3b.includes(`"Food":${N}${T}${T}${T}{${N}${T}${T}${T}${T}"b": true${N}${T}${T}${T}}`));
const out4 = patchSave(doc, [{ path: kb, value: undefined }]);
assert.equal(parseSave(out4).data.GameProgress.Progress.KebbitBurrowsActivated, undefined);
assert.ok(!out4.includes('Kebbit') && out4.includes(`],${N}${T}${T}${T}"SpellsUnlocked"`));
const out5 = patchSave(doc, [{ path: food, value: undefined }]);
assert.ok(out5.includes(`0.55555558204650879${N}${T}${T}},`));

// New numbered slots go in slot order, before named keys like MaxSlotIndex.
const bag = ['{', `${T}"Inventory":`, `${T}{`, `${T}${T}"0":`, `${T}${T}{`, `${T}${T}${T}"Count": 1`, `${T}${T}},`, `${T}${T}"7":`, `${T}${T}{`, `${T}${T}${T}"Count": 7`, `${T}${T}},`, `${T}${T}"MaxSlotIndex": 7`, `${T}}`, '}'].join(N);
const bd = parseSave(bag);
const bo = patchSave(bd, [{ path: ['Inventory', '3'], value: { Count: 3 } }, { path: ['Inventory', '9'], value: { Count: 9 } }, { path: ['Inventory', 'MaxSlotIndex'], value: 9 }]);
assert.deepEqual(Object.keys(parseSave(bo).data.Inventory), ['0', '3', '7', '9', 'MaxSlotIndex']);
assert.ok(bo.includes(`${T}${T}},${N}${T}${T}"3":${N}${T}${T}{${N}${T}${T}${T}"Count": 3${N}${T}${T}},${N}${T}${T}"7":`));
assert.ok(bo.includes(`"Count": 7${N}${T}${T}},${N}${T}${T}"9":${N}${T}${T}{${N}${T}${T}${T}"Count": 9${N}${T}${T}},${N}${T}${T}"MaxSlotIndex": 9${N}${T}}`));
// The text order matches the order the game writes: slots ascending, then MaxSlotIndex.
assert.ok(bo.indexOf('"3"') < bo.indexOf('"7"') && bo.indexOf('"9"') < bo.indexOf('MaxSlotIndex'));

// Ids
assert.equal(idToHex('mKIxNUr0C8E6YXOL8OSRkQ'), '98A231354AF40BC13A61738BF0E49191');
assert.equal(hexToId('98A231354AF40BC13A61738BF0E49191'), 'mKIxNUr0C8E6YXOL8OSRkQ');

assert.throws(() => parseSave('{"a": 1,}'));
assert.throws(() => parseSave('[1]'));
console.log('character-save: all tests passed');
