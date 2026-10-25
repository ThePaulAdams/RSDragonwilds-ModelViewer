// Dragonwilds Survivors: Main Game Controller
import { THREE, scene, camera, renderer, $, rand, clamp, pick, bakeTemplate, templateMesh, loadCharacter, poseBone, findBone, loadCatalog } from '/survivors/core.js';
import { loadArena, heightAt, resolveColliders, ARENA_RADIUS } from '/survivors/world.js';
import { HEROES, ENEMIES, BOSSES, WAVES, EVENTS, WEAPONS, PASSIVES, SHOP, xpForLevel, MAX_WEAPON, MAX_PASSIVE, SLOTS } from '/survivors/data.js';
import { emit, updateParticles, clearParticles, transient, ringMesh, telegraph, hitsplat, updateHitsplats, clearHitsplats, sfx, unlockAudio, ambience } from '/survivors/fx.js';

// Game state
export const G = {
  active: false,
  paused: false,
  time: 0,
  kills: 0,
  bones: 0,
  level: 1,
  xp: 0,
  nextXp: xpForLevel(1),
  rerolls: 1,
  selectedHeroKey: 'knight',
  hero: null,
  weapons: {},
  passives: {},
  enemies: [],
  pickups: [],
  projectiles: [],
  damageDealt: {},
  keys: {},
  boss: null
};

// Player object
class Player {
  constructor(heroDef) {
    this.def = heroDef;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.vx = 0;
    this.vz = 0;
    this.yaw = 0;
    this.maxHp = heroDef.hp;
    this.hp = this.maxHp;
    this.speed = heroDef.speed;
    this.armor = heroDef.armor;
    this.might = heroDef.might;
    this.area = heroDef.area;
    this.cdr = heroDef.cdr;
    this.projectiles = heroDef.projectiles;
    this.magnet = 4.5;
    this.invuln = 0;
    this.dashCd = 0;
    this.dashTimer = 0;
    this.isDashing = false;
    this.mesh = null;
    this.charData = null;
    this.walkCycle = 0;
  }

  async init() {
    this.charData = await loadCharacter(this.def.model, 2.0);
    this.mesh = this.charData.root;
    this.y = heightAt(0, 0);
    this.mesh.position.set(0, this.y, 0);
    scene.add(this.mesh);
  }

  update(dt) {
    if (this.invuln > 0) this.invuln -= dt;
    if (this.dashCd > 0) this.dashCd -= dt;

    let mx = 0, mz = 0;
    if (G.keys['KeyW'] || G.keys['ArrowUp']) mz -= 1;
    if (G.keys['KeyS'] || G.keys['ArrowDown']) mz += 1;
    if (G.keys['KeyA'] || G.keys['ArrowLeft']) mx -= 1;
    if (G.keys['KeyD'] || G.keys['ArrowRight']) mx += 1;

    const moving = mx !== 0 || mz !== 0;
    if (moving) {
      const len = Math.hypot(mx, mz);
      mx /= len; mz /= len;
      this.yaw = Math.atan2(mx, mz);
    }

    if (G.keys['Space'] && this.dashCd <= 0 && moving) {
      this.dashCd = 2.5;
      this.dashTimer = 0.22;
      this.isDashing = true;
      this.invuln = 0.3;
      sfx('dash');
      emit(this.x, this.y + 0.5, this.z, { n: 25, color: 0x38bdf8, speed: 6, size: 0.4 });
    }

    let spd = this.speed;
    if (this.isDashing) {
      spd *= 3.0;
      this.dashTimer -= dt;
      if (this.dashTimer <= 0) this.isDashing = false;
    }

    if (moving) {
      this.x += mx * spd * dt;
      this.z += mz * spd * dt;
      this.walkCycle += dt * 10;
    }

    // Keep within arena radius
    const dist = Math.hypot(this.x, this.z);
    if (dist > ARENA_RADIUS) {
      this.x = (this.x / dist) * ARENA_RADIUS;
      this.z = (this.z / dist) * ARENA_RADIUS;
    }

    const pos = { x: this.x, z: this.z };
    resolveColliders(pos, 0.5);
    this.x = pos.x; this.z = pos.z;

    this.y = heightAt(this.x, this.z);
    if (this.mesh) {
      this.mesh.position.set(this.x, this.y, this.z);
      this.mesh.rotation.y = this.yaw;

      // Animate walking if bones exist
      if (this.charData && this.charData.bones) {
        const lLeg = findBone(this.charData.bones, 'thigh_l', 'leg_l');
        const rLeg = findBone(this.charData.bones, 'thigh_r', 'leg_r');
        if (lLeg && rLeg) {
          const legAngle = moving ? Math.sin(this.walkCycle) * 0.45 : 0;
          poseBone(lLeg, 'x', legAngle);
          poseBone(rLeg, 'x', -legAngle);
        }
      }
    }
  }

  takeDamage(amount) {
    if (this.invuln > 0 || this.hp <= 0) return;
    const reduced = Math.max(1, amount - this.armor);
    this.hp -= reduced;
    this.invuln = 0.45;
    sfx('hurt');
    hitsplat(new THREE.Vector3(this.x, this.y + 1.8, this.z), '-' + Math.round(reduced), 'dmg');
    emit(this.x, this.y + 1.0, this.z, { n: 12, color: 0xef4444, speed: 4 });

    if (this.hp <= 0) {
      this.hp = 0;
      gameOver(false);
    }
  }
}

// Enemy templates cache
const enemyTemplates = {};
async function preloadEnemyTemplates() {
  for (const [k, e] of Object.entries(ENEMIES)) {
    try {
      enemyTemplates[k] = await bakeTemplate(e.model, { height: e.h });
    } catch (err) {
      console.warn('Could not bake template for ' + e.name, err);
    }
  }
}

// Enemy class
class Enemy {
  constructor(typeKey, x, z) {
    this.key = typeKey;
    this.def = ENEMIES[typeKey];
    this.x = x;
    this.z = z;
    this.y = heightAt(x, z);
    this.hp = this.def.hp * (1 + G.time * 0.002);
    this.maxHp = this.hp;
    this.speed = this.def.speed * rand(0.9, 1.1);
    this.dmg = this.def.dmg;
    this.xp = this.def.xp;
    this.frozen = 0;
    this.mesh = null;
    this.t = 0;

    const tpl = enemyTemplates[typeKey];
    if (tpl) {
      this.mesh = templateMesh(tpl);
      this.mesh.position.set(this.x, this.y, this.z);
      scene.add(this.mesh);
    }
  }

  update(dt, player) {
    if (this.frozen > 0) {
      this.frozen -= dt;
      return;
    }

    const dx = player.x - this.x;
    const dz = player.z - this.z;
    const dist = Math.hypot(dx, dz);

    if (dist > 0.1) {
      const vx = (dx / dist) * this.speed;
      const vz = (dz / dist) * this.speed;
      this.x += vx * dt;
      this.z += vz * dt;
      this.y = heightAt(this.x, this.z);

      if (this.mesh) {
        this.mesh.position.set(this.x, this.y, this.z);
        this.mesh.rotation.y = Math.atan2(dx, dz);
      }

      // Check contact damage with player
      if (dist < 1.1) {
        player.takeDamage(this.dmg);
      }
    }
  }

  takeDamage(amt, isCrit = false) {
    this.hp -= amt;
    hitsplat(new THREE.Vector3(this.x, this.y + 1.2, this.z), Math.round(amt), isCrit ? 'crit' : 'dmg');
    sfx('hit');

    if (this.hp <= 0) {
      this.die();
      return true;
    }
    return false;
  }

  die() {
    emit(this.x, this.y + 0.5, this.z, { n: 18, color: 0xe6e6e6, speed: 3, size: 0.3 });
    if (this.mesh) scene.remove(this.mesh);
    spawnDrop(this.x, this.z, this.xp);
    G.kills++;
  }
}

// Pickups (XP Bones)
function spawnDrop(x, z, xp) {
  const y = heightAt(x, z) + 0.2;
  const geo = new THREE.DodecahedronGeometry(0.25);
  const color = xp > 10 ? 0x38bdf8 : xp > 4 ? 0xf59e0b : 0xe6e6e6;
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  G.pickups.push({ x, y, z, xp, mesh, t: 0 });
}

function updatePickups(dt, player) {
  for (let i = G.pickups.length - 1; i >= 0; i--) {
    const p = G.pickups[i];
    p.t += dt;
    p.mesh.rotation.y += dt * 3;
    p.mesh.position.y = p.y + Math.sin(p.t * 4) * 0.1;

    const dx = player.x - p.x;
    const dz = player.z - p.z;
    const dist = Math.hypot(dx, dz);

    if (dist < player.magnet) {
      const pull = Math.max(12, (player.magnet - dist) * 8);
      p.x += (dx / dist) * pull * dt;
      p.z += (dz / dist) * pull * dt;
      p.mesh.position.x = p.x;
      p.mesh.position.z = p.z;

      if (dist < 0.8) {
        // Collect
        sfx('pickup');
        scene.remove(p.mesh);
        G.pickups.splice(i, 1);
        addXp(p.xp);
        G.bones += p.xp;
      }
    }
  }
}

function addXp(amt) {
  G.xp += amt;
  while (G.xp >= G.nextXp) {
    G.xp -= G.nextXp;
    G.level++;
    G.nextXp = xpForLevel(G.level);
    sfx('level');
    openLevelUp();
  }
}

// Weapons Execution
let weaponCooldowns = {};
function initWeapons() {
  weaponCooldowns = {};
  for (const k of Object.keys(WEAPONS)) {
    weaponCooldowns[k] = 0;
  }
}

function updateWeapons(dt, player) {
  for (const [wKey, rank] of Object.entries(G.weapons)) {
    if (rank <= 0) continue;
    const wDef = WEAPONS[wKey];
    const stats = wDef.lv(rank);
    weaponCooldowns[wKey] = (weaponCooldowns[wKey] || 0) - dt;

    if (weaponCooldowns[wKey] <= 0) {
      const cd = stats.cd ? stats.cd * (1 - player.cdr) : 1.5;
      weaponCooldowns[wKey] = Math.max(0.2, cd);
      fireWeapon(wKey, stats, player);
    }
  }
}

function fireWeapon(wKey, stats, player) {
  const dmg = stats.dmg * player.might;

  if (wKey === 'scimitar') {
    sfx('slash');
    const arc = ringMesh(0.5, stats.range * player.area, 0xff3333, 0.85, 32, stats.arc, player.yaw - stats.arc / 2);
    arc.position.set(player.x, player.y + 0.8, player.z);
    transient(arc, 0.25, (m, k) => { m.material.opacity = k; });

    for (let i = G.enemies.length - 1; i >= 0; i--) {
      const e = G.enemies[i];
      const dx = e.x - player.x, dz = e.z - player.z;
      const d = Math.hypot(dx, dz);
      if (d <= stats.range * player.area) {
        const ang = Math.atan2(dx, dz);
        let diff = Math.abs(ang - player.yaw);
        if (diff > Math.PI) diff = 2 * Math.PI - diff;
        if (diff <= stats.arc / 2) {
          if (e.takeDamage(dmg)) G.enemies.splice(i, 1);
        }
      }
    }
  } else if (wKey === 'barrage') {
    sfx('ice');
    // Target closest enemy or random enemy
    let target = null, minDist = 999;
    for (const e of G.enemies) {
      const d = Math.hypot(e.x - player.x, e.z - player.z);
      if (d < minDist && d < 18) { minDist = d; target = e; }
    }
    if (target) {
      const r = stats.radius * player.area;
      const iceCube = new THREE.Mesh(
        new THREE.BoxGeometry(r * 1.5, r * 2, r * 1.5),
        new THREE.MeshStandardMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.7, roughness: 0.1 })
      );
      iceCube.position.set(target.x, target.y + r, target.z);
      transient(iceCube, 0.7, (m, k) => { m.material.opacity = k * 0.7; });

      for (let i = G.enemies.length - 1; i >= 0; i--) {
        const e = G.enemies[i];
        if (Math.hypot(e.x - target.x, e.z - target.z) <= r) {
          e.frozen = stats.freeze;
          if (e.takeDamage(dmg)) G.enemies.splice(i, 1);
        }
      }
    }
  } else if (wKey === 'crossbow') {
    sfx('bolt');
    // Fire bolts towards closest enemies
    const sorted = [...G.enemies].sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z));
    const count = Math.min(stats.count + player.projectiles, sorted.length);
    for (let c = 0; c < count; c++) {
      const target = sorted[c];
      const dx = target.x - player.x, dz = target.z - player.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.1) {
        const dir = new THREE.Vector3(dx / dist, 0, dz / dist);
        // Projectile
        const bolt = new THREE.Mesh(
          new THREE.CylinderGeometry(0.08, 0.08, 0.8),
          new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
        );
        bolt.rotation.x = Math.PI / 2;
        bolt.rotation.z = Math.atan2(dir.x, dir.z);
        bolt.position.set(player.x, player.y + 1.0, player.z);
        scene.add(bolt);
        G.projectiles.push({ mesh: bolt, dir, x: player.x, z: player.z, y: player.y + 1.0, speed: stats.speed, pierce: stats.pierce, dmg, life: 1.2 });
      }
    }
  } else if (wKey === 'shields') {
    // Passive damage zone around player
    for (let i = G.enemies.length - 1; i >= 0; i--) {
      const e = G.enemies[i];
      if (Math.hypot(e.x - player.x, e.z - player.z) <= stats.radius * player.area) {
        if (e.takeDamage(dmg * 0.4)) G.enemies.splice(i, 1);
      }
    }
  }
}

function updateProjectiles(dt) {
  for (let i = G.projectiles.length - 1; i >= 0; i--) {
    const p = G.projectiles[i];
    p.life -= dt;
    p.x += p.dir.x * p.speed * dt;
    p.z += p.dir.z * p.speed * dt;
    p.mesh.position.set(p.x, p.y, p.z);

    // Collision with enemies
    for (let j = G.enemies.length - 1; j >= 0; j--) {
      const e = G.enemies[j];
      if (Math.hypot(e.x - p.x, e.z - p.z) < 1.0) {
        p.pierce--;
        if (e.takeDamage(p.dmg)) G.enemies.splice(j, 1);
        if (p.pierce <= 0) { p.life = 0; break; }
      }
    }

    if (p.life <= 0) {
      scene.remove(p.mesh);
      G.projectiles.splice(i, 1);
    }
  }
}

// Spawner
let spawnTimer = 0;
function updateSpawner(dt, player) {
  spawnTimer += dt;
  const currentWave = WAVES.slice().reverse().find(w => G.time >= w.t) || WAVES[0];

  if (G.enemies.length < currentWave.cap && spawnTimer >= (1 / currentWave.rate)) {
    spawnTimer = 0;
    const type = pick(currentWave.mix);
    const ang = Math.random() * Math.PI * 2;
    const r = rand(22, 35);
    const ex = player.x + Math.cos(ang) * r;
    const ez = player.z + Math.sin(ang) * r;
    G.enemies.push(new Enemy(type, ex, ez));
  }
}

// HUD & Modals
function updateHUD(player) {
  $('hud-time').textContent = formatTime(G.time);
  $('hud-kills').textContent = G.kills;
  $('hud-bones').textContent = G.bones;
  $('hud-level').textContent = G.level;
  $('hud-xp-ratio').textContent = `${Math.floor(G.xp)} / ${G.nextXp}`;
  $('xp-bar').style.width = `${Math.min(100, (G.xp / G.nextXp) * 100)}%`;

  $('hp-cur').textContent = Math.max(0, Math.round(player.hp));
  $('hp-max').textContent = player.maxHp;
  $('hp-fill').style.width = `${Math.max(0, (player.hp / player.maxHp) * 100)}%`;
  $('dash-fill').style.width = `${player.dashCd > 0 ? (1 - player.dashCd / 2.5) * 100 : 100}%`;
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

function openLevelUp() {
  G.paused = true;
  const modal = $('levelup-modal');
  const container = $('levelup-cards');
  container.innerHTML = '';

  // Pick 3 random upgrade options
  const options = [];
  // Existing weapons upgrades
  for (const [wKey, rank] of Object.entries(G.weapons)) {
    if (rank < MAX_WEAPON) {
      const w = WEAPONS[wKey];
      options.push({ type: 'weapon', key: wKey, name: w.name, icon: w.icon, desc: w.up[rank] || '+Damage', rank: rank + 1 });
    }
  }
  // New weapons if slot available
  if (Object.keys(G.weapons).length < 4) {
    for (const [wKey, w] of Object.entries(WEAPONS)) {
      if (!G.weapons[wKey]) {
        options.push({ type: 'weapon', key: wKey, name: w.name, icon: w.icon, desc: 'Unlock weapon: ' + w.desc, rank: 1 });
      }
    }
  }
  // Passives
  for (const [pKey, p] of Object.entries(PASSIVES)) {
    const cur = G.passives[pKey] || 0;
    if (cur < MAX_PASSIVE) {
      options.push({ type: 'passive', key: pKey, name: p.name, icon: p.icon, desc: p.desc, rank: cur + 1 });
    }
  }

  // Shuffle and pick 3
  const picks = options.sort(() => Math.random() - 0.5).slice(0, 3);
  for (const opt of picks) {
    const card = document.createElement('div');
    card.className = 'upgrade-card';
    card.innerHTML = `
      <div class="upgrade-rarity"></div>
      <div class="upgrade-icon">${opt.icon}</div>
      <div class="upgrade-name">${opt.name}</div>
      <div class="upgrade-tier">Level ${opt.rank}</div>
      <div class="upgrade-desc">${opt.desc}</div>
    `;
    card.onclick = () => {
      applyUpgrade(opt);
      modal.style.display = 'none';
      G.paused = false;
    };
    container.appendChild(card);
  }
  modal.style.display = 'flex';
}

function applyUpgrade(opt) {
  if (opt.type === 'weapon') {
    G.weapons[opt.key] = opt.rank;
  } else {
    G.passives[opt.key] = opt.rank;
    if (opt.key === 'rejuv') G.hero.maxHp += 20;
    if (opt.key === 'graceful') G.hero.speed *= 1.08;
    if (opt.key === 'piety') G.hero.might *= 1.10;
    if (opt.key === 'wealth') G.hero.magnet *= 1.30;
    if (opt.key === 'dragonhide') G.hero.armor += 1;
    if (opt.key === 'rapid') G.hero.cdr += 0.07;
  }
}

function gameOver(victory) {
  G.active = false;
  $('gameover-title').textContent = victory ? 'VICTORY SURVIVED!' : 'YOU DIED';
  $('gameover-subtitle').textContent = victory ? 'You conquered the beasts of Ashenfall!' : 'You fell in battle.';
  $('gameover-stats').innerHTML = `
    <b>Survival Time:</b> ${formatTime(G.time)}<br>
    <b>Enemies Slain:</b> ${G.kills}<br>
    <b>Bones Collected:</b> ${G.bones}<br>
    <b>Level Reached:</b> ${G.level}
  `;
  $('gameover-modal').style.display = 'flex';
}

// Main Game Loop
let lastTime = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  if (G.active && !G.paused) {
    G.time += dt;
    G.hero.update(dt);
    updateWeapons(dt, G.hero);
    updateProjectiles(dt);
    updateSpawner(dt, G.hero);

    for (let i = G.enemies.length - 1; i >= 0; i--) {
      G.enemies[i].update(dt, G.hero);
    }
    updatePickups(dt, G.hero);
    updateHUD(G.hero);
  }

  updateParticles(dt);
  updateHitsplats(dt);

  // Camera follow player smoothly
  if (G.hero) {
    camera.position.x = G.hero.x;
    camera.position.y = G.hero.y + 18;
    camera.position.z = G.hero.z + 18;
    camera.lookAt(G.hero.x, G.hero.y + 1, G.hero.z);
  }

  renderer.render(scene, camera);
}

// Setup & Event Listeners
async function start() {
  $('play-btn').onclick = async () => {
    unlockAudio();
    $('start-modal').style.display = 'none';
    $('hud').style.display = 'block';

    const heroKey = $('.hero-card.selected')?.dataset.hero || 'knight';
    const heroDef = HEROES[heroKey];

    await preloadEnemyTemplates();
    await loadArena('temple');

    G.hero = new Player(heroDef);
    await G.hero.init();

    G.weapons = { [heroDef.start]: 1 };
    G.passives = {};
    initWeapons();
    G.active = true;
    G.time = 0;
    G.kills = 0;
    G.bones = 0;
    G.level = 1;
    G.xp = 0;
    G.nextXp = xpForLevel(1);
    ambience(true);
  };

  document.querySelectorAll('.hero-card').forEach(c => {
    c.onclick = () => {
      document.querySelectorAll('.hero-card').forEach(x => x.classList.remove('selected'));
      c.classList.add('selected');
    };
  });

  window.addEventListener('keydown', e => {
    G.keys[e.code] = true;
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (G.active) {
        G.paused = !G.paused;
        $('pause-modal').style.display = G.paused ? 'flex' : 'none';
      }
    }
  });

  window.addEventListener('keyup', e => {
    G.keys[e.code] = false;
  });

  $('resume-btn').onclick = () => {
    G.paused = false;
    $('pause-modal').style.display = 'none';
  };

  $('restart-btn').onclick = () => location.reload();
  $('retry-btn').onclick = () => location.reload();

  // Load models catalogue
  await loadCatalog();
  requestAnimationFrame(loop);
}

start().catch(err => console.error('Failed to start Survivors game:', err));
