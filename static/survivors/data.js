// Dragonwilds Survivors: heroes, enemies, weapons, passives and the wave timeline.

export const HEROES = {
  knight: { name: 'Vannaka', title: 'Dragon Knight', model: 'SK_Vannaka_01', start: 'scimitar', hp: 125, speed: 6.2, armor: 2, might: 1, area: 1, cdr: 0, projectiles: 0 },
  mage:   { name: 'The Wise Old Man', title: 'Ancient Mage', model: 'SK_WiseOldMan_01', start: 'barrage', hp: 90, speed: 6.0, armor: 0, might: 1, area: 1.2, cdr: 0.15, projectiles: 0 },
  ranger: { name: 'Lagra', title: 'Wilds Ranger', model: 'SK_M_MED_MoonGarou_01_Outfit_05', fallback: 'SK_M_MED_MoonGarou_01_Outfit_01', start: 'crossbow', hp: 100, speed: 7.3, armor: 0, might: 1, area: 1, cdr: 0, projectiles: 1 },
};

// model, height (m), hp, speed (m/s), contact damage, xp, ranged?: {range, cd, dmg, speed, color}
export const ENEMIES = {
  rat:       { name: 'Giant Rat', model: 'SK_Rat_01', h: 0.55, hp: 6, speed: 3.6, dmg: 4, xp: 1 },
  chicken:   { name: 'Undead Chicken', model: 'SK_ZombieChicken_01', h: 0.7, hp: 8, speed: 4.2, dmg: 4, xp: 1 },
  runt:      { name: 'Goblin Runt', model: 'SK_M_MED_Goblin_Runt_01', h: 1.25, hp: 14, speed: 3.4, dmg: 6, xp: 2 },
  goblin:    { name: 'Goblin Warrior', model: 'SK_M_MED_Goblin_Melee_01', h: 1.45, hp: 28, speed: 3.3, dmg: 8, xp: 3 },
  gobarcher: { name: 'Goblin Archer', model: 'SK_M_MED_Goblin_Ranged_01', h: 1.4, hp: 20, speed: 3.0, dmg: 6, xp: 3, ranged: { range: 14, cd: 3.2, dmg: 7, speed: 14, color: 0xc8a060 } },
  zombie:    { name: 'Zombie', model: 'SK_M_MED_Zombie_01_Outfit_A', h: 1.8, hp: 45, speed: 2.6, dmg: 10, xp: 4 },
  zombie2:   { name: 'Rotting Zombie', model: 'SK_M_MED_Zombie_02_Outfit_B', h: 1.8, hp: 55, speed: 2.8, dmg: 11, xp: 4 },
  zcow:      { name: 'Zombie Cow', model: 'SK_Cow_Zombie_01', h: 1.6, hp: 110, speed: 2.4, dmg: 14, xp: 8 },
  skeleton:  { name: 'Skeleton Warrior', model: 'SK_U_MED_Skeleton_Human_Warrior_01', h: 1.85, hp: 70, speed: 3.6, dmg: 13, xp: 6 },
  skarcher:  { name: 'Skeleton Archer', model: 'SK_U_MED_Skeleton_Human_Archer_01', h: 1.85, hp: 55, speed: 3.2, dmg: 10, xp: 6, ranged: { range: 16, cd: 2.8, dmg: 11, speed: 16, color: 0xe8e0c8 } },
  hellrat:   { name: 'Hellrat', model: 'SK_Rat_Hellrat_01', h: 0.75, hp: 40, speed: 5.2, dmg: 10, xp: 4 },
  wolf:      { name: 'Wolf', model: 'SK_Wolf_02', h: 1.15, hp: 85, speed: 5.6, dmg: 14, xp: 7 },
  hellhound: { name: 'Hellhound', model: 'SK_Wolf_Hellhound_02', h: 1.4, hp: 150, speed: 5.4, dmg: 18, xp: 10 },
  acolyte:   { name: 'Zamorak Acolyte', model: 'SK_M_MED_Zamorak_Acolyte_01', h: 1.85, hp: 120, speed: 3.4, dmg: 16, xp: 9 },
  zammage:   { name: 'Zamorak Mage', model: 'SK_M_MED_Zamorak_Mage_01', h: 1.85, hp: 100, speed: 3.0, dmg: 14, xp: 10, ranged: { range: 17, cd: 2.6, dmg: 18, speed: 12, color: 0xff4a2a } },
  bknight:   { name: 'Black Knight', model: 'SK_M_MED_Black_Knight_Melee_01', h: 1.9, hp: 240, speed: 3.6, dmg: 22, xp: 14 },
  demon:     { name: 'Lesser Demon', model: 'SK_M_MED_Lesser_Demon_Melee_01', h: 2.3, hp: 320, speed: 3.8, dmg: 26, xp: 18 },
  rotsworn:  { name: 'Rotsworn Marauder', model: 'SK_U_MED_Skeleton_Marauder_Rotsworn_01', h: 1.95, hp: 380, speed: 4.0, dmg: 28, xp: 20 },
  abyssal:   { name: 'Abyssal Demon', model: 'SK_Abyssal_Demon_01', h: 2.2, hp: 520, speed: 4.6, dmg: 34, xp: 28 },
  lorddemon: { name: 'Demon Lord', model: 'SK_M_MED_Lord_Demon_Melee_01', h: 2.6, hp: 800, speed: 4.0, dmg: 40, xp: 40 },
};

// Bosses use the skinned model so wings/limbs can be animated.
export const BOSSES = {
  ratking: { name: 'The Rat King', model: 'SK_RatKing_01', h: 2.4, hp: 2400, speed: 3.6, dmg: 22, xp: 120, attacks: ['summon', 'slam'], minion: 'rat' },
  titan:   { name: 'Black Knight Titan', model: 'SK_M_LRG_Black_Knight_Titan_01', h: 5.2, hp: 9000, speed: 3.4, dmg: 40, xp: 300, attacks: ['slam', 'charge', 'summon'], minion: 'bknight' },
  dragon:  { name: 'Lesser Blue Dragon', model: 'SK_Dragon_Lesser_Blue_01', h: 5.5, hp: 26000, speed: 4.2, dmg: 55, xp: 800, attacks: ['breath', 'slam', 'fireballs', 'charge'], minion: 'demon', final: true },
};

// Timeline: per minute, which enemies spawn and how many are kept on the field.
export const WAVES = [
  { t: 0,   mix: ['rat', 'chicken'], cap: 24, rate: 1.4 },
  { t: 45,  mix: ['rat', 'runt', 'chicken'], cap: 40, rate: 2.0 },
  { t: 90,  mix: ['runt', 'goblin'], cap: 55, rate: 2.6 },
  { t: 150, mix: ['goblin', 'gobarcher', 'runt'], cap: 70, rate: 3.2 },
  { t: 210, mix: ['zombie', 'zombie2', 'goblin'], cap: 85, rate: 3.6 },
  { t: 300, mix: ['zombie', 'zombie2', 'zcow'], cap: 90, rate: 3.8 },
  { t: 360, mix: ['skeleton', 'skarcher', 'zombie2'], cap: 105, rate: 4.4 },
  { t: 450, mix: ['skeleton', 'hellrat', 'skarcher', 'wolf'], cap: 120, rate: 5.0 },
  { t: 540, mix: ['wolf', 'hellhound', 'hellrat'], cap: 130, rate: 5.4 },
  { t: 600, mix: ['acolyte', 'zammage', 'wolf'], cap: 135, rate: 5.6 },
  { t: 690, mix: ['bknight', 'zammage', 'acolyte', 'hellhound'], cap: 150, rate: 6.2 },
  { t: 780, mix: ['demon', 'bknight', 'rotsworn'], cap: 160, rate: 6.6 },
  { t: 840, mix: ['abyssal', 'demon', 'rotsworn', 'zammage'], cap: 170, rate: 7.0 },
  { t: 900, mix: ['abyssal', 'lorddemon', 'demon'], cap: 180, rate: 7.5 },
];
export const EVENTS = [
  { t: 120, type: 'ring', enemy: 'runt', count: 34, msg: 'Goblins surround you!' },
  { t: 270, type: 'swarm', enemy: 'rat', count: 60, msg: 'A rat swarm pours in!' },
  { t: 300, type: 'boss', boss: 'ratking' },
  { t: 420, type: 'ring', enemy: 'zombie', count: 40, msg: 'The dead rise all around!' },
  { t: 510, type: 'swarm', enemy: 'wolf', count: 30, msg: 'A wolf pack hunts you!' },
  { t: 600, type: 'boss', boss: 'titan' },
  { t: 750, type: 'ring', enemy: 'bknight', count: 26, msg: 'Black Knights close in!' },
  { t: 900, type: 'boss', boss: 'dragon' },
];
export const RUN_LENGTH = 900;   // the dragon arrives at 15:00; slaying it wins the run

// Weapons: level 1..8. `lv(l)` gives the stats at that level.
export const WEAPONS = {
  scimitar: { name: 'Dragon Scimitar', icon: '⚔️', model: 'SM_Scimitar_Dragon_1H_01', desc: 'Slashes a wide arc in front of you.',
    lv: l => ({ dmg: 14 + l * 5, cd: 1.15 - l * 0.05, arc: 2.0 + l * 0.08, range: 3.6 + l * 0.18, back: l >= 4, double: l >= 7 }),
    up: ['', '+5 damage, longer reach', '+5 damage, faster swings', 'Also slashes behind you', '+5 damage, wider arc', '+5 damage, faster swings', 'Swings twice', '+5 damage, longer reach'],
    evo: { with: 'piety', name: 'Dragon Claws', desc: 'Four rapid slashes all around you that crit far more often.' } },
  barrage: { name: 'Ice Barrage', icon: '❄️', desc: 'Ancient ice bursts on enemies, freezing them solid.',
    lv: l => ({ dmg: 12 + l * 4, cd: 2.3 - l * 0.1, radius: 2.4 + l * 0.2, count: 1 + Math.floor(l / 3), freeze: 1.2 + l * 0.12 }),
    up: ['', '+4 damage, bigger burst', '+1 cast', '+4 damage, longer freeze', '+4 damage, faster casts', '+1 cast', '+4 damage, bigger burst', '+1 cast, longer freeze'],
    evo: { with: 'pouch', name: 'Ice Blitz Storm', desc: 'A blizzard that follows you, freezing and shattering everything.' } },
  crossbow: { name: 'Dragon Crossbow', icon: '🏹', model: 'SM_CrosbowBolt_Runite_Gem_01', desc: 'Fires piercing bolts at the nearest enemies.',
    lv: l => ({ dmg: 10 + l * 3, cd: 0.95 - l * 0.05, count: 1 + Math.floor((l + 1) / 3), pierce: 1 + Math.floor(l / 2), speed: 30 }),
    up: ['', '+3 damage, pierces more', '+1 bolt', '+3 damage, faster', '+1 pierce', '+1 bolt', '+3 damage, faster', '+1 bolt, +1 pierce'],
    evo: { with: 'glory', name: 'Dragonfire Bolts', desc: 'Bolts explode in dragonfire on every hit.' } },
  shields: { name: 'Dragon Kiteshields', icon: '🛡️', model: 'SM_Kite_Dragon_1H_01', desc: 'Kiteshields orbit you, battering enemies away.',
    lv: l => ({ dmg: 9 + l * 3, count: 1 + Math.floor((l + 1) / 2), radius: 2.6 + l * 0.15, spin: 2.6 + l * 0.15 }),
    up: ['', '+1 shield', '+3 damage, faster spin', '+1 shield', '+3 damage, wider orbit', '+1 shield', '+3 damage', '+1 shield, faster spin'],
    evo: { with: 'dragonhide', name: 'Anti-dragon Bulwark', desc: 'Six great shields that also block enemy projectiles.' } },
  breath: { name: 'Dragonfire Breath', icon: '🔥', desc: 'Breathes a cone of dragonfire where you are heading.',
    lv: l => ({ dmg: 6 + l * 2, cd: 3.2 - l * 0.15, length: 6 + l * 0.5, dur: 1.0 + l * 0.08, width: 0.55 + l * 0.03 }),
    up: ['', '+2 damage, longer flame', '+2 damage, faster', 'Wider cone', '+2 damage, longer flame', '+2 damage, faster', 'Longer breath', '+2 damage, wider cone'],
    evo: { with: 'graceful', name: 'Kuldra\'s Wrath', desc: 'Dragonfire pours out in three directions at once.' } },
  chinchompa: { name: 'Chinchompas', icon: '💥', model: 'SK_Chinchompa_Carnivorous_01', desc: 'Throws exploding chinchompas into the horde.',
    lv: l => ({ dmg: 18 + l * 6, cd: 2.6 - l * 0.12, radius: 2.6 + l * 0.18, count: 1 + Math.floor(l / 3) }),
    up: ['', '+6 damage, bigger blast', '+1 chinchompa', '+6 damage, faster', '+6 damage, bigger blast', '+1 chinchompa', '+6 damage, faster', '+1 chinchompa'],
    evo: { with: 'wealth', name: 'Black Chinchompa Barrage', desc: 'Chinchompas split into cluster bombs.' } },
  retribution: { name: 'Retribution', icon: '✨', desc: 'A holy aura that scorches enemies near you.',
    lv: l => ({ dmg: 4 + l * 1.6, tick: 0.55 - l * 0.02, radius: 2.4 + l * 0.25, slow: 0.1 + l * 0.03 }),
    up: ['', '+damage, bigger aura', '+damage, faster ticks', 'Slows enemies more', '+damage, bigger aura', '+damage, faster ticks', 'Bigger aura', '+damage, slows more'],
    evo: { with: 'rejuv', name: 'Saradomin\'s Light', desc: 'The aura heals you for part of the damage dealt.' } },
  lightning: { name: 'Saradomin Strike', icon: '⚡', desc: 'Calls lightning down on random enemies.',
    lv: l => ({ dmg: 20 + l * 7, cd: 2.2 - l * 0.1, count: 2 + Math.floor(l / 2), radius: 1.6 + l * 0.08 }),
    up: ['', '+7 damage', '+1 strike', '+7 damage, faster', '+1 strike', '+7 damage, bigger strikes', '+1 strike', '+7 damage, faster'],
    evo: { with: 'rapid', name: 'Wrath of Saradomin', desc: 'Strikes chain to two nearby enemies.' } },
};
export const MAX_WEAPON = 8, MAX_PASSIVE = 5, SLOTS = 6;

export const PASSIVES = {
  piety:      { name: 'Piety', icon: '🙏', desc: '+10% damage per rank.' },
  graceful:   { name: 'Graceful Outfit', icon: '👢', desc: '+8% movement speed per rank.' },
  wealth:     { name: 'Ring of Wealth', icon: '💍', desc: '+30% pickup radius and +5% luck per rank.' },
  glory:      { name: 'Amulet of Glory', icon: '📿', desc: '+10% experience per rank.' },
  pouch:      { name: 'Rune Pouch', icon: '👝', desc: '+10% area of effect per rank.' },
  rapid:      { name: 'Rapid Prayer', icon: '⏳', desc: '-7% weapon cooldowns per rank.' },
  rejuv:      { name: 'Rejuvenation Pool', icon: '❤️', desc: '+20 max HP and +0.3 HP/s per rank.' },
  dragonhide: { name: 'Dragonhide Armour', icon: '🐉', desc: '+1 armour per rank (less damage taken).' },
};

// Permanent upgrades bought with coins between runs.
export const SHOP = {
  vigour:  { name: 'Vigour', icon: '❤️', desc: '+10 max HP', max: 5, cost: l => 60 + l * 60 },
  power:   { name: 'Strength', icon: '💪', desc: '+5% damage', max: 5, cost: l => 80 + l * 80 },
  agility: { name: 'Agility', icon: '🏃', desc: '+4% move speed', max: 4, cost: l => 70 + l * 70 },
  magnet:  { name: 'Magnetism', icon: '🧲', desc: '+15% pickup radius', max: 4, cost: l => 50 + l * 50 },
  wisdom:  { name: 'Wisdom', icon: '📘', desc: '+6% experience', max: 5, cost: l => 70 + l * 70 },
  reroll:  { name: 'Fortune', icon: '🎲', desc: '+1 reroll each run', max: 3, cost: l => 120 + l * 120 },
  revive:  { name: 'Ring of Life', icon: '💫', desc: 'Revive once with half HP', max: 1, cost: () => 500 },
};

export const xpForLevel = l => Math.round(6 + l * 9 + Math.max(0, l - 20) * 12 + Math.max(0, l - 40) * 20);
