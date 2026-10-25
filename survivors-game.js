// Dragonwilds Survivors: Main Game Controller
import { THREE, scene, camera, renderer, $, rand, clamp, pick, bakeTemplate, templateMesh, loadCharacter, loadModel, poseBone, findBone, loadCatalog } from '/survivors/core.js';
import { loadArena, heightAt, resolveColliders, ARENA_RADIUS } from '/survivors/world.js';
import { HEROES, ENEMIES, BOSSES, WAVES, EVENTS, WEAPONS, PASSIVES, SHOP, xpForLevel, MAX_WEAPON, MAX_PASSIVE, SLOTS } from '/survivors/data.js';
import { emit, updateParticles, clearParticles, transient, ringMesh, telegraph, hitsplat, updateHitsplats, clearHitsplats, sfx, unlockAudio, ambience } from '/survivors/fx.js';

// Ground shadow blob helper to anchor models to 3D terrain
function createBlobShadow(radius = 0.6) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.7)');
  grad.addColorStop(0.65, 'rgba(0, 0, 0, 0.35)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const geo = new THREE.PlaneGeometry(radius * 2, radius * 2).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.85 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  return mesh;
}

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
  keys: {},
  pointerDir: { x: 0, z: 0, active: false },
  boss: null,
  activeEvents: []
};

window.G = G;

// Player Entity
class Player {
  constructor(heroDef) {
    this.def = heroDef;
    this.x = 0;
    this.y = 0;
    this.z = 0;
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
    this.walkCycle = 0;
    this.idleCycle = 0;
    this.attackTimer = 0;
    this.weaponMesh = null;
    this.shieldMesh = null;
  }

  async init() {
    try {
      const char = await loadCharacter(this.def.model, 2.0);
      this.mesh = char.root;
      this.charData = char;

      // Attach weapon model into hand bone if available
      try {
        const handR = findBone(this.charData.bones, 'hand_r');
        if (handR && this.def.start === 'scimitar') {
          const wModel = await loadModel('SM_Scimitar_Dragon_1H_01');
          const scim = wModel.clone(true);
          scim.scale.set(1.1, 1.1, 1.1);
          scim.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
          scim.position.set(0, 0, 0);
          handR.add(scim);
          this.weaponMesh = scim;
        } else if (handR && this.def.start === 'crossbow') {
          const wModel = await loadModel('SM_Crossbow_Dragon_1H_01');
          const xbow = wModel.clone(true);
          xbow.scale.set(1.0, 1.0, 1.0);
          xbow.rotation.set(Math.PI / 2, 0, 0);
          handR.add(xbow);
          this.weaponMesh = xbow;
        }
      } catch (e) {
        console.warn('Could not attach weapon model to hand:', e);
      }
    } catch (e) {
      console.warn('Fallback hero mesh', e);
      // Fallback procedural knight mesh
      this.mesh = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.4, 8), new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.3, metalness: 0.8 }));
      body.position.y = 0.9;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), new THREE.MeshStandardMaterial({ color: 0xfde047 }));
      head.position.y = 1.8;
      this.mesh.add(body, head);
    }

    this.y = heightAt(0, 0);
    this.mesh.position.set(0, this.y, 0);
    scene.add(this.mesh);

    // Ground shadow blob
    this.shadow = createBlobShadow(0.85);
    this.shadow.position.set(0, this.y + 0.04, 0);
    scene.add(this.shadow);
  }

  update(dt) {
    if (this.invuln > 0) this.invuln -= dt;
    if (this.dashCd > 0) this.dashCd -= dt;
    if (this.attackTimer > 0) this.attackTimer -= dt;

    let mx = 0, mz = 0;
    if (G.keys['KeyW'] || G.keys['ArrowUp'] || G.keys['w'] || G.keys['W']) mz -= 1;
    if (G.keys['KeyS'] || G.keys['ArrowDown'] || G.keys['s'] || G.keys['S']) mz += 1;
    if (G.keys['KeyA'] || G.keys['ArrowLeft'] || G.keys['a'] || G.keys['A']) mx -= 1;
    if (G.keys['KeyD'] || G.keys['ArrowRight'] || G.keys['d'] || G.keys['D']) mx += 1;

    // Pointer / touch / mouse drag movement
    if (G.pointerDir && G.pointerDir.active) {
      mx += G.pointerDir.x;
      mz += G.pointerDir.z;
    }

    const moving = mx !== 0 || mz !== 0;
    if (moving) {
      const len = Math.hypot(mx, mz);
      mx /= len; mz /= len;
      this.yaw = Math.atan2(mx, mz);
    }

    if ((G.keys['Space'] || G.keys[' ']) && this.dashCd <= 0 && moving) {
      this.dashCd = 2.5;
      this.dashTimer = 0.22;
      this.isDashing = true;
      this.invuln = 0.35;
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
      this.walkCycle += dt * 11;
    } else {
      this.idleCycle += dt * 2.2;
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
    if (this.shadow) this.shadow.position.set(this.x, this.y + 0.04, this.z);
    if (this.mesh) {
      this.mesh.position.set(this.x, this.y, this.z);
      this.mesh.rotation.y = this.yaw;

      // Realistic procedural full-body locomotion & attack animation
      if (this.charData?.bones) {
        const b = this.charData.bones;
        const lThigh = findBone(b, 'thigh_l');
        const rThigh = findBone(b, 'thigh_r');
        const lCalf = findBone(b, 'calf_l');
        const rCalf = findBone(b, 'calf_r');
        const lArm = findBone(b, 'upperarm_l');
        const rArm = findBone(b, 'upperarm_r');
        const lForearm = findBone(b, 'lowerarm_l');
        const rForearm = findBone(b, 'lowerarm_r');
        const spine = findBone(b, 'spine_01', 'spine_02');
        const head = findBone(b, 'head');

        if (moving) {
          const stride = Math.sin(this.walkCycle);
          const strideCos = Math.cos(this.walkCycle);
          const bounce = Math.abs(Math.sin(this.walkCycle)) * 0.08;

          // Natural vertical bob and subtle spine roll
          if (this.charData.inner) {
            this.charData.inner.position.y = -bounce;
          }

          // Leg articulation: Y axis is forward/backward in Unreal humanoid coordinate system
          if (lThigh) poseBone(lThigh, 'y', stride * 0.75);
          if (rThigh) poseBone(rThigh, 'y', -stride * 0.75);

          // Knee flexion: calf bends backward when leg pushes back
          if (lCalf) poseBone(lCalf, 'y', Math.max(0, -strideCos) * 0.85);
          if (rCalf) poseBone(rCalf, 'y', Math.max(0, strideCos) * 0.85);

          // Arm swinging counter to leg motion
          if (this.attackTimer <= 0) {
            if (lArm) poseBone(lArm, 'y', -stride * 0.55);
            if (rArm) poseBone(rArm, 'y', stride * 0.55);
            if (lForearm) poseBone(lForearm, 'y', 0.25);
            if (rForearm) poseBone(rForearm, 'y', 0.25);
          }

          // Torso sway and spine twisting with walking stride
          if (spine) poseBone(spine, 'z', stride * 0.08);
          if (head) poseBone(head, 'z', -stride * 0.06);

          // Emit subtle running dust puffs
          if (Math.random() < 0.2) {
            emit(this.x, this.y + 0.1, this.z, { n: 2, color: 0x94a3b8, speed: 0.8, size: 0.15 });
          }
        } else {
          // Subtle breathing idle animation
          const breath = Math.sin(this.idleCycle) * 0.04;
          if (this.charData.inner) this.charData.inner.position.y = breath * 0.5;
          if (lThigh) poseBone(lThigh, 'y', 0);
          if (rThigh) poseBone(rThigh, 'y', 0);
          if (lCalf) poseBone(lCalf, 'y', 0);
          if (rCalf) poseBone(rCalf, 'y', 0);

          if (this.attackTimer <= 0) {
            if (lArm) poseBone(lArm, 'y', 0.15 + breath);
            if (rArm) poseBone(rArm, 'y', 0.15 + breath);
            if (lForearm) poseBone(lForearm, 'y', 0.35);
            if (rForearm) poseBone(rForearm, 'y', 0.35);
          }
          if (spine) poseBone(spine, 'y', -breath);
        }

        // Weapon swing / attack posture override
        if (this.attackTimer > 0) {
          const atkProgress = 1 - (this.attackTimer / 0.28);
          const slashAngle = Math.sin(atkProgress * Math.PI) * 1.5;
          if (rArm) poseBone(rArm, 'y', 0.8 - slashAngle);
          if (rForearm) poseBone(rForearm, 'y', 0.6 + slashAngle * 0.4);
          if (spine) poseBone(spine, 'z', -slashAngle * 0.2);
        }
      }
    }
  }

  takeDamage(amount) {
    if (this.invuln > 0 || this.hp <= 0) return;
    const reduced = Math.max(1, amount - this.armor);
    this.hp -= reduced;
    this.invuln = 0.4;
    sfx('hurt');
    hitsplat(new THREE.Vector3(this.x, this.y + 1.8, this.z), '-' + Math.round(reduced), 'dmg');
    emit(this.x, this.y + 1.0, this.z, { n: 12, color: 0xef4444, speed: 4 });

    // Flinch flash on damage
    if (this.mesh) {
      const origY = this.mesh.position.y;
      this.mesh.position.y = origY + 0.15;
      setTimeout(() => { if (this.mesh) this.mesh.position.y = origY; }, 80);
    }

    if (this.hp <= 0) {
      this.hp = 0;
      gameOver(false);
    }
  }
}

// Enemy Templates
const enemyTemplates = {};
async function preloadEnemyTemplates() {
  for (const [k, e] of Object.entries(ENEMIES)) {
    try {
      enemyTemplates[k] = await bakeTemplate(e.model, { height: e.h });
    } catch {
      // Create quick fallback geometry so game never fails to spawn enemies
      const geo = new THREE.CylinderGeometry(e.h * 0.25, e.h * 0.3, e.h, 6);
      const mat = new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.6 });
      enemyTemplates[k] = { name: e.name, geometry: geo, materials: [mat], height: e.h, radius: e.h * 0.3 };
    }
  }
}

// Enemy class
class Enemy {
  constructor(typeKey, x, z) {
    this.key = typeKey;
    this.def = ENEMIES[typeKey] || ENEMIES.rat;
    this.x = x;
    this.z = z;
    this.y = heightAt(x, z);
    this.hp = this.def.hp * (1 + G.time * 0.003);
    this.maxHp = this.hp;
    this.speed = this.def.speed * rand(0.9, 1.1);
    this.dmg = this.def.dmg;
    this.xp = this.def.xp;
    this.frozen = 0;
    this.walkCycle = Math.random() * Math.PI * 2;
    this.mesh = null;
    this.innerMesh = null;

    const tpl = enemyTemplates[typeKey];
    if (tpl) {
      this.mesh = templateMesh(tpl);
      this.innerMesh = this.mesh.children[0] || this.mesh;
      this.mesh.position.set(this.x, this.y, this.z);
      scene.add(this.mesh);
    }

    this.shadow = createBlobShadow(Math.max(0.45, (this.def.h || 1) * 0.35));
    this.shadow.position.set(this.x, this.y + 0.03, this.z);
    scene.add(this.shadow);
  }

  update(dt, player) {
    if (this.frozen > 0) {
      this.frozen -= dt;
      return;
    }

    const dx = player.x - this.x;
    const dz = player.z - this.z;
    const dist = Math.hypot(dx, dz);

    // Enemy-enemy flocking separation to maintain a natural, menacing horde
    for (let j = 0; j < G.enemies.length; j++) {
      const other = G.enemies[j];
      if (other === this) continue;
      const ex = this.x - other.x, ez = this.z - other.z;
      const ed2 = ex * ex + ez * ez;
      const minD = 0.85;
      if (ed2 < minD * minD && ed2 > 0.0001) {
        const d = Math.sqrt(ed2);
        const push = (minD - d) * 0.5 * dt * 4;
        this.x += (ex / d) * push;
        this.z += (ez / d) * push;
      }
    }

    if (dist > 0.1) {
      const vx = (dx / dist) * this.speed;
      const vz = (dz / dist) * this.speed;
      this.x += vx * dt;
      this.z += vz * dt;
      this.y = heightAt(this.x, this.z);
      this.walkCycle += dt * 12;

      if (this.shadow) {
        this.shadow.position.set(this.x, this.y + 0.03, this.z);
      }

      if (this.mesh) {
        this.mesh.position.set(this.x, this.y, this.z);
        this.mesh.rotation.y = Math.atan2(dx, dz);

        // Procedural enemy run cycle (locomotion bob and roll)
        if (this.innerMesh) {
          const bob = Math.abs(Math.sin(this.walkCycle)) * 0.12 * (this.def.h || 1);
          const tilt = Math.sin(this.walkCycle) * 0.15;
          this.innerMesh.position.y = bob;
          this.innerMesh.rotation.z = tilt;
          this.innerMesh.rotation.x = 0.1; // Forward lean while charging
        }
      }

      if (dist < 1.1) {
        player.takeDamage(this.dmg);
        // Push enemy back gently upon dealing damage
        this.x -= (dx / dist) * 0.35;
        this.z -= (dz / dist) * 0.35;
      }
    }
  }

  takeDamage(amt, isCrit = false) {
    this.hp -= amt;
    hitsplat(new THREE.Vector3(this.x, this.y + 1.2, this.z), Math.round(amt), isCrit ? 'crit' : 'dmg');
    sfx('hit');

    // Knockback flinch
    if (this.mesh && G.hero) {
      const kx = this.x - G.hero.x, kz = this.z - G.hero.z;
      const kLen = Math.hypot(kx, kz) || 1;
      this.x += (kx / kLen) * 0.35;
      this.z += (kz / kLen) * 0.35;
      this.y = heightAt(this.x, this.z);
      this.mesh.position.set(this.x, this.y, this.z);
    }

    if (this.hp <= 0) {
      this.die();
      return true;
    }
    return false;
  }

  die() {
    emit(this.x, this.y + 0.5, this.z, { n: 16, color: 0xfef08a, speed: 3, size: 0.3 });
    if (this.mesh) scene.remove(this.mesh);
    if (this.shadow) scene.remove(this.shadow);
    spawnDrop(this.x, this.z, this.xp);
    G.kills++;
  }
}

// Drops (XP Gems / Bones)
function spawnDrop(x, z, xp) {
  const y = heightAt(x, z) + 0.25;
  const geo = new THREE.DodecahedronGeometry(0.24);
  const color = xp >= 10 ? 0x38bdf8 : xp >= 4 ? 0xf59e0b : 0x22c55e;
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6 });
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
    p.mesh.position.y = p.y + Math.sin(p.t * 4) * 0.12;

    const dx = player.x - p.x;
    const dz = player.z - p.z;
    const dist = Math.hypot(dx, dz);

    if (dist < player.magnet) {
      const pull = Math.max(12, (player.magnet - dist) * 9);
      p.x += (dx / dist) * pull * dt;
      p.z += (dz / dist) * pull * dt;
      p.mesh.position.x = p.x;
      p.mesh.position.z = p.z;

      if (dist < 0.9) {
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

// Weapons System
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
      const cd = stats.cd ? stats.cd * (1 - player.cdr) : 1.4;
      weaponCooldowns[wKey] = Math.max(0.2, cd);
      fireWeapon(wKey, stats, player);
    }
  }
}

function fireWeapon(wKey, stats, player) {
  const dmg = stats.dmg * player.might;

  if (wKey === 'scimitar') {
    player.attackTimer = 0.28; // Triggers arm slash animation
    sfx('slash');
    const arc = ringMesh(0.5, stats.range * player.area, 0xd97706, 0.9, 32, stats.arc, player.yaw - stats.arc / 2);
    arc.position.set(player.x, player.y + 0.8, player.z);
    transient(arc, 0.22, (m, k) => { m.material.opacity = k; });

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
    player.attackTimer = 0.25; // Casting gesture
    sfx('ice');
    let target = null, minDist = 999;
    for (const e of G.enemies) {
      const d = Math.hypot(e.x - player.x, e.z - player.z);
      if (d < minDist && d < 16) { minDist = d; target = e; }
    }
    if (target) {
      const r = stats.radius * player.area;
      const iceCube = new THREE.Mesh(
        new THREE.BoxGeometry(r * 1.6, r * 2.2, r * 1.6),
        new THREE.MeshStandardMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.75, roughness: 0.1 })
      );
      iceCube.position.set(target.x, target.y + r, target.z);
      transient(iceCube, 0.65, (m, k) => { m.material.opacity = k * 0.75; });

      for (let i = G.enemies.length - 1; i >= 0; i--) {
        const e = G.enemies[i];
        if (Math.hypot(e.x - target.x, e.z - target.z) <= r) {
          e.frozen = stats.freeze;
          if (e.takeDamage(dmg)) G.enemies.splice(i, 1);
        }
      }
    }
  } else if (wKey === 'crossbow') {
    player.attackTimer = 0.22; // Recoil animation
    sfx('bolt');
    const sorted = [...G.enemies].sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z));
    const count = Math.min(stats.count + player.projectiles, sorted.length);
    for (let c = 0; c < count; c++) {
      const target = sorted[c];
      const dx = target.x - player.x, dz = target.z - player.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.1) {
        const dir = new THREE.Vector3(dx / dist, 0, dz / dist);
        const bolt = new THREE.Mesh(
          new THREE.CylinderGeometry(0.08, 0.08, 0.9),
          new THREE.MeshBasicMaterial({ color: 0xf59e0b })
        );
        bolt.rotation.x = Math.PI / 2;
        bolt.rotation.z = Math.atan2(dir.x, dir.z);
        bolt.position.set(player.x, player.y + 1.0, player.z);
        scene.add(bolt);
        G.projectiles.push({ mesh: bolt, dir, x: player.x, z: player.z, y: player.y + 1.0, speed: stats.speed, pierce: stats.pierce, dmg, life: 1.2 });
      }
    }
  } else if (wKey === 'shields') {
    for (let i = G.enemies.length - 1; i >= 0; i--) {
      const e = G.enemies[i];
      if (Math.hypot(e.x - player.x, e.z - player.z) <= stats.radius * player.area) {
        if (e.takeDamage(dmg * 0.35)) G.enemies.splice(i, 1);
      }
    }
  } else if (wKey === 'breath') {
    player.attackTimer = 0.3;
    sfx('dragon');
    const flame = ringMesh(0.4, stats.length, 0xef4444, 0.85, 24, stats.width, player.yaw - stats.width / 2);
    flame.position.set(player.x, player.y + 0.8, player.z);
    transient(flame, stats.dur || 0.6, (m, k) => { m.material.opacity = k * 0.85; });
    for (let i = G.enemies.length - 1; i >= 0; i--) {
      const e = G.enemies[i];
      const dx = e.x - player.x, dz = e.z - player.z;
      const d = Math.hypot(dx, dz);
      if (d <= stats.length) {
        const ang = Math.atan2(dx, dz);
        let diff = Math.abs(ang - player.yaw);
        if (diff > Math.PI) diff = 2 * Math.PI - diff;
        if (diff <= stats.width / 2) {
          emit(e.x, e.y + 0.8, e.z, { n: 8, color: 0xf97316, speed: 2 });
          if (e.takeDamage(dmg)) G.enemies.splice(i, 1);
        }
      }
    }
  } else if (wKey === 'lightning') {
    sfx('magic');
    const sorted = [...G.enemies].sort(() => Math.random() - 0.5);
    const count = Math.min(stats.count, sorted.length);
    for (let c = 0; c < count; c++) {
      const t = sorted[c];
      const bolt = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.2, 12, 6),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
      );
      bolt.position.set(t.x, t.y + 6, t.z);
      transient(bolt, 0.25, (m, k) => { m.material.opacity = k; });
      emit(t.x, t.y + 0.5, t.z, { n: 16, color: 0x67e8f9, speed: 4 });
      if (t.takeDamage(dmg, true)) {
        const idx = G.enemies.indexOf(t);
        if (idx !== -1) G.enemies.splice(idx, 1);
      }
    }
  } else if (wKey === 'chinchompa') {
    sfx('fire');
    let target = null, maxD = -1;
    for (const e of G.enemies) {
      const d = Math.hypot(e.x - player.x, e.z - player.z);
      if (d > 4 && d < 18) { target = e; break; }
    }
    if (target) {
      emit(target.x, target.y + 0.8, target.z, { n: 24, color: 0xf59e0b, speed: 5, size: 0.4 });
      for (let i = G.enemies.length - 1; i >= 0; i--) {
        const e = G.enemies[i];
        if (Math.hypot(e.x - target.x, e.z - target.z) <= stats.radius) {
          if (e.takeDamage(dmg)) G.enemies.splice(i, 1);
        }
      }
    }
  } else if (wKey === 'retribution') {
    for (let i = G.enemies.length - 1; i >= 0; i--) {
      const e = G.enemies[i];
      if (Math.hypot(e.x - player.x, e.z - player.z) <= stats.radius * player.area) {
        if (e.takeDamage(dmg * 0.2)) G.enemies.splice(i, 1);
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
    const r = rand(20, 32);
    const ex = player.x + Math.cos(ang) * r;
    const ez = player.z + Math.sin(ang) * r;
    G.enemies.push(new Enemy(type, ex, ez));
  }
}

// Vampire Survivors HUD & Modals
function updateHUD(player) {
  $('hud-time').textContent = formatTime(G.time);
  $('hud-kills').textContent = G.kills;
  $('hud-bones').textContent = G.bones;
  $('hud-level').textContent = G.level;
  $('hud-xp-ratio').textContent = `${Math.floor(G.xp)} / ${G.nextXp}`;
  $('xp-bar-fill').style.width = `${Math.min(100, (G.xp / G.nextXp) * 100)}%`;

  $('hp-cur').textContent = Math.max(0, Math.round(player.hp));
  $('hp-max').textContent = player.maxHp;
  $('hp-fill').style.width = `${Math.max(0, (player.hp / player.maxHp) * 100)}%`;

  // Update Inventory Slots HUD
  const wContainer = $('weapon-slots');
  wContainer.innerHTML = '';
  const wKeys = Object.keys(G.weapons);
  for (let i = 0; i < 6; i++) {
    const k = wKeys[i];
    const rank = G.weapons[k];
    const div = document.createElement('div');
    div.className = 'inv-slot' + (k ? ' active' : '');
    if (k) {
      const def = WEAPONS[k];
      div.textContent = def.icon;
      const pips = document.createElement('div');
      pips.className = 'inv-pips';
      for (let p = 0; p < MAX_WEAPON; p++) {
        const pip = document.createElement('div');
        pip.className = 'inv-pip' + (p < rank ? ' filled' : '');
        pips.appendChild(pip);
      }
      div.appendChild(pips);
    }
    wContainer.appendChild(div);
  }

  const pContainer = $('passive-slots');
  pContainer.innerHTML = '';
  const pKeys = Object.keys(G.passives);
  for (let i = 0; i < 6; i++) {
    const k = pKeys[i];
    const rank = G.passives[k];
    const div = document.createElement('div');
    div.className = 'inv-slot passive' + (k ? ' active' : '');
    if (k) {
      const def = PASSIVES[k];
      div.textContent = def.icon;
      const pips = document.createElement('div');
      pips.className = 'inv-pips';
      for (let p = 0; p < MAX_PASSIVE; p++) {
        const pip = document.createElement('div');
        pip.className = 'inv-pip' + (p < rank ? ' filled' : '');
        pips.appendChild(pip);
      }
      div.appendChild(pips);
    }
    pContainer.appendChild(div);
  }
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

  const options = [];
  for (const [wKey, rank] of Object.entries(G.weapons)) {
    if (rank < MAX_WEAPON) {
      const w = WEAPONS[wKey];
      options.push({ type: 'weapon', key: wKey, name: w.name, icon: w.icon, desc: w.up[rank] || '+Damage', rank: rank + 1, isNew: false });
    }
  }
  if (Object.keys(G.weapons).length < 6) {
    for (const [wKey, w] of Object.entries(WEAPONS)) {
      if (!G.weapons[wKey]) {
        options.push({ type: 'weapon', key: wKey, name: w.name, icon: w.icon, desc: 'Unlock weapon: ' + w.desc, rank: 1, isNew: true });
      }
    }
  }
  for (const [pKey, p] of Object.entries(PASSIVES)) {
    const cur = G.passives[pKey] || 0;
    if (cur < MAX_PASSIVE) {
      options.push({ type: 'passive', key: pKey, name: p.name, icon: p.icon, desc: p.desc, rank: cur + 1, isNew: cur === 0 });
    }
  }

  const picks = options.sort(() => Math.random() - 0.5).slice(0, 3);
  if (picks.length === 0) {
    picks.push(
      { type: 'stat', stat: 'might', name: 'Saradomin Might', icon: '⚔️', desc: '+15% Damage Might', rank: 1, isNew: false },
      { type: 'stat', stat: 'speed', name: 'Guthix Agility', icon: '🥾', desc: '+10% Movement Speed', rank: 1, isNew: false },
      { type: 'stat', stat: 'hp', name: 'Zamorak Vitality', icon: '❤️', desc: '+30 Max HP and Heal', rank: 1, isNew: false }
    );
  }

  for (const opt of picks) {
    const card = document.createElement('div');
    card.className = 'vs-card';
    card.innerHTML = `
      <div class="vs-card-badge ${opt.isNew ? 'new' : ''}">${opt.isNew ? 'NEW!' : 'LV ' + opt.rank}</div>
      <div class="vs-card-icon">${opt.icon}</div>
      <div class="vs-card-name">${opt.name}</div>
      <div class="vs-card-tier">Level ${opt.rank}</div>
      <div class="vs-card-desc">${opt.desc}</div>
    `;
    card.onclick = () => {
      applyUpgrade(opt);
      modal.style.display = 'none';
      G.paused = false;
    };
    container.appendChild(card);
  }

  // Hook up Reroll and Skip buttons
  const rCount = $('reroll-count');
  if (rCount) rCount.textContent = G.rerolls;
  const rBtn = $('reroll-btn');
  if (rBtn) {
    rBtn.onclick = () => {
      if (G.rerolls > 0) {
        G.rerolls--;
        if (rCount) rCount.textContent = G.rerolls;
        openLevelUp();
      }
    };
  }
  const sBtn = $('skip-btn');
  if (sBtn) {
    sBtn.onclick = () => {
      if (G.hero) {
        G.hero.maxHp += 20;
        G.hero.hp = Math.min(G.hero.maxHp, G.hero.hp + 20);
      }
      modal.style.display = 'none';
      G.paused = false;
    };
  }

  modal.style.display = 'flex';
}

function applyUpgrade(opt) {
  if (opt.type === 'stat') {
    if (opt.stat === 'might') G.hero.might *= 1.15;
    if (opt.stat === 'speed') G.hero.speed *= 1.10;
    if (opt.stat === 'hp') { G.hero.maxHp += 30; G.hero.hp = Math.min(G.hero.maxHp, G.hero.hp + 30); }
    return;
  }
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
  $('gameover-subtitle').textContent = victory ? 'You conquered the beasts of Ashenfall!' : 'The horde consumed your essence.';
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

  if (G.active && !G.paused && G.hero) {
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

  // Smooth damped isometric chase camera
  if (G.hero) {
    const targetX = G.hero.x;
    const targetY = G.hero.y + 17;
    const targetZ = G.hero.z + 17;
    const f = Math.min(1, 8 * dt);
    camera.position.x += (targetX - camera.position.x) * f;
    camera.position.y += (targetY - camera.position.y) * f;
    camera.position.z += (targetZ - camera.position.z) * f;
    camera.lookAt(camera.position.x, G.hero.y + 1.2, camera.position.z - 17);
  }

  renderer.render(scene, camera);
}

// Setup & Event Listeners
async function start() {
  await loadCatalog();
  requestAnimationFrame(loop);

  const canvasEl = $('game-canvas');
  if (canvasEl) {
    canvasEl.tabIndex = 0;
    const handlePointer = (clientX, clientY, active) => {
      if (!active || !G.active || G.paused || !G.hero) {
        G.pointerDir.active = false;
        return;
      }
      const rect = canvasEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = clientX - cx;
      const dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > 25) {
        G.pointerDir.x = dx / dist;
        G.pointerDir.z = dy / dist;
        G.pointerDir.active = true;
      } else {
        G.pointerDir.active = false;
      }
    };

    canvasEl.addEventListener('pointerdown', e => {
      canvasEl.focus();
      handlePointer(e.clientX, e.clientY, true);
    });
    window.addEventListener('pointermove', e => {
      if (e.buttons === 1) {
        handlePointer(e.clientX, e.clientY, true);
      }
    });
    window.addEventListener('pointerup', () => {
      G.pointerDir.active = false;
    });
    window.addEventListener('pointercancel', () => {
      G.pointerDir.active = false;
    });
  }

  // Touch analog stick
  const touchStick = $('touch-stick');
  const touchNub = $('touch-nub');
  if (touchStick && touchNub) {
    let stickActive = false;
    let stickCenterX = 0, stickCenterY = 0;
    const maxR = 40;

    touchStick.addEventListener('pointerdown', e => {
      stickActive = true;
      const rect = touchStick.getBoundingClientRect();
      stickCenterX = rect.left + rect.width / 2;
      stickCenterY = rect.top + rect.height / 2;
      e.stopPropagation();
    });

    window.addEventListener('pointermove', e => {
      if (!stickActive) return;
      const dx = e.clientX - stickCenterX;
      const dy = e.clientY - stickCenterY;
      const dist = Math.hypot(dx, dy);
      const clampedDist = Math.min(dist, maxR);
      const ang = Math.atan2(dy, dx);
      const nx = Math.cos(ang) * clampedDist;
      const ny = Math.sin(ang) * clampedDist;
      touchNub.style.transform = `translate(${nx}px, ${ny}px)`;
      if (dist > 6) {
        G.pointerDir.x = dx / dist;
        G.pointerDir.z = dy / dist;
        G.pointerDir.active = true;
      } else {
        G.pointerDir.active = false;
      }
    });

    const endStick = () => {
      stickActive = false;
      touchNub.style.transform = 'translate(0px, 0px)';
      G.pointerDir.active = false;
    };
    window.addEventListener('pointerup', endStick);
    window.addEventListener('pointercancel', endStick);
  }

  $('play-btn').onclick = async () => {
    unlockAudio();
    $('start-modal').style.display = 'none';
    $('hud').style.display = 'block';
    if (touchStick && ('ontouchstart' in window || navigator.maxTouchPoints > 0)) {
      touchStick.style.display = 'block';
    }

    const heroKey = document.querySelector('.hero-select-card.selected')?.dataset.hero || 'knight';
    const heroDef = HEROES[heroKey] || HEROES.knight;

    await loadArena('temple');
    G.hero = new Player(heroDef);
    await G.hero.init();
    camera.position.set(G.hero.x, G.hero.y + 17, G.hero.z + 17);
    camera.lookAt(G.hero.x, G.hero.y + 1.2, G.hero.z);

    preloadEnemyTemplates(); // Runs fast in parallel

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

  document.querySelectorAll('.hero-select-card').forEach(c => {
    c.onclick = () => {
      document.querySelectorAll('.hero-select-card').forEach(x => x.classList.remove('selected'));
      c.classList.add('selected');
    };
  });

  window.addEventListener('keydown', e => {
    G.keys[e.code] = true;
    if (e.key) G.keys[e.key.toLowerCase()] = true;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code) || ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
      e.preventDefault();
    }
    if (e.code === 'KeyP' || e.code === 'Escape' || e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
      if (G.active) {
        G.paused = !G.paused;
        $('pause-modal').style.display = G.paused ? 'flex' : 'none';
      }
    }
  });

  window.addEventListener('keyup', e => {
    G.keys[e.code] = false;
    if (e.key) G.keys[e.key.toLowerCase()] = false;
  });

  $('resume-btn').onclick = () => {
    G.paused = false;
    $('pause-modal').style.display = 'none';
  };

  $('restart-btn').onclick = () => location.reload();
  $('retry-btn').onclick = () => location.reload();
}

start().catch(err => console.error('Failed to start Survivors game:', err));
