// Dragonwilds Survivors: Main Game Controller
import { THREE, scene, camera, renderer, $, rand, clamp, pick, bakeTemplate, templateMesh, loadCharacter, loadModel, poseBone, findBone, loadCatalog } from '/survivors/core.js?v=vs_remake_1';
import { loadArena, heightAt, resolveColliders, ARENA_RADIUS } from '/survivors/world.js?v=vs_remake_1';
import { HEROES, ENEMIES, BOSSES, WAVES, EVENTS, WEAPONS, PASSIVES, SHOP, xpForLevel, MAX_WEAPON, MAX_PASSIVE, SLOTS } from '/survivors/data.js?v=vs_remake_1';
import { emit, updateParticles, clearParticles, transient, ringMesh, telegraph, hitsplat, updateHitsplats, clearHitsplats, sfx, unlockAudio, ambience, sound } from '/survivors/fx.js?v=vs_remake_1';

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

// Procedural skeletal arm posing helper
const _qArm1 = new THREE.Quaternion(), _qArm2 = new THREE.Quaternion();
const _axArmZ = new THREE.Vector3(0, 0, 1), _axArmY = new THREE.Vector3(0, 1, 0);

function poseArm(bone, zAngle, yAngle) {
  if (!bone || !bone.userData?.rest) return;
  _qArm1.setFromAxisAngle(_axArmZ, zAngle);
  _qArm2.setFromAxisAngle(_axArmY, yAngle);
  bone.quaternion.copy(bone.userData.rest).multiply(_qArm1).multiply(_qArm2);
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
  chests: [],
  pickups: [],
  projectiles: [],
  keys: {},
  pointerDir: { x: 0, z: 0, active: false },
  boss: null,
  activeEvents: [],
  soundMuted: false
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
    this.vx = 0;
    this.vz = 0;
    this.isMoving = false;
    this.boneAngles = { stride: 0, strideCos: 0, bounce: 0, slashProgress: 0 };
  }

  dash() {
    if (this.dashCd <= 0) {
      this.dashCd = 2.5;
      this.dashTimer = 0.22;
      this.isDashing = true;
      this.invuln = 0.35;
      sfx('dash');
      emit(this.x, this.y + 0.5, this.z, { n: 25, color: 0x38bdf8, speed: 6, size: 0.4 });
      return true;
    }
    return false;
  }

  heal(amount) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
    sfx('heal');
    hitsplat(new THREE.Vector3(this.x, this.y + 1.8, this.z), '+' + Math.round(amount), 'heal');
    emit(this.x, this.y + 1.0, this.z, { n: 12, color: 0x22c55e, speed: 3 });
  }

  async init() {
    try {
      const char = await loadCharacter(this.def.model, 2.0);
      this.mesh = char.root;
      this.charData = char;
      this.bones = char.bones;

      // Attach weapon model into hand bone/socket if available
      try {
        const handR = findBone(this.charData.bones, 'prop_r', 'hand_r');
        if (handR && this.def.start === 'scimitar') {
          const wModel = await loadModel('SM_Scimitar_Dragon_1H_01');
          const scim = wModel.clone(true);
          scim.scale.set(1.35, 1.35, 1.35);
          scim.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
          scim.position.set(0, 0, 0);
          handR.add(scim);
          this.weaponMesh = scim;
        } else if (handR && this.def.start === 'crossbow') {
          const wModel = await loadModel('SM_Crossbow_Dragon_1H_01');
          const xbow = wModel.clone(true);
          xbow.scale.set(1.15, 1.15, 1.15);
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
    if (G.overrideMove && G.overrideMove.active) {
      mx = G.overrideMove.mx;
      mz = G.overrideMove.mz;
    } else {
      if (G.keys['KeyW'] || G.keys['ArrowUp'] || G.keys['w'] || G.keys['W']) mz -= 1;
      if (G.keys['KeyS'] || G.keys['ArrowDown'] || G.keys['s'] || G.keys['S']) mz += 1;
      if (G.keys['KeyA'] || G.keys['ArrowLeft'] || G.keys['a'] || G.keys['A']) mx -= 1;
      if (G.keys['KeyD'] || G.keys['ArrowRight'] || G.keys['d'] || G.keys['D']) mx += 1;

      // Pointer / touch / mouse drag movement
      if (G.pointerDir && G.pointerDir.active) {
        mx += G.pointerDir.x;
        mz += G.pointerDir.z;
      }
    }

    const moving = mx !== 0 || mz !== 0;
    if (moving) {
      const len = Math.hypot(mx, mz);
      mx /= len; mz /= len;
      this.yaw = Math.atan2(mx, mz);
    }

    if ((G.keys['Space'] || G.keys[' ']) && moving) {
      this.dash();
    }

    let spd = this.speed;
    if (this.isDashing) {
      spd *= 3.0;
      this.dashTimer -= dt;
      if (this.dashTimer <= 0) this.isDashing = false;
    }

    this.vx = moving ? mx * spd : 0;
    this.vz = moving ? mz * spd : 0;
    this.isMoving = moving;
    this.boneAngles = {
      stride: moving ? Math.sin(this.walkCycle) : 0,
      strideCos: moving ? Math.cos(this.walkCycle) : 0,
      bounce: moving ? Math.abs(Math.sin(this.walkCycle)) * 0.08 : (Math.sin(this.idleCycle) * 0.04),
      slashProgress: this.attackTimer > 0 ? (1 - (this.attackTimer / 0.28)) : 0
    };

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
        this.bones = b;
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

        const baseY = this.charData?.baseInnerY || 0;

        if (moving) {
          const stride = Math.sin(this.walkCycle);
          const strideCos = Math.cos(this.walkCycle);
          const bounce = Math.abs(Math.sin(this.walkCycle)) * 0.08;

          // Natural vertical bob and subtle spine roll
          if (this.charData.inner) {
            this.charData.inner.position.y = baseY - bounce;
          }

          // Leg articulation: Y axis is forward/backward in Unreal humanoid coordinate system
          if (lThigh) poseBone(lThigh, 'y', stride * 0.75);
          if (rThigh) poseBone(rThigh, 'y', -stride * 0.75);

          // Backward knee flexion: calf bends backward lifting foot when leg pushes back
          if (lCalf) poseBone(lCalf, 'y', Math.max(0, stride) * 0.85);
          if (rCalf) poseBone(rCalf, 'y', Math.max(0, -stride) * 0.85);

          // Arm swinging counter to leg motion (base -0.82 lowers arms from T-pose)
          if (this.attackTimer <= 0) {
            if (lArm) poseArm(lArm, -0.82, -stride * 0.65);
            if (rArm) poseArm(rArm, -0.82, stride * 0.65);
            if (lForearm) poseBone(lForearm, 'y', 0.45 + Math.max(0, -stride) * 0.25);
            if (rForearm) poseBone(rForearm, 'y', 0.45 + Math.max(0, stride) * 0.25);
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
          const breath = Math.sin(this.idleCycle) * 0.03;
          if (this.charData.inner) this.charData.inner.position.y = baseY + breath;
          if (lThigh) poseBone(lThigh, 'y', 0);
          if (rThigh) poseBone(rThigh, 'y', 0);
          if (lCalf) poseBone(lCalf, 'y', 0);
          if (rCalf) poseBone(rCalf, 'y', 0);

          if (this.attackTimer <= 0) {
            if (lArm) poseArm(lArm, -0.82, breath * 0.25);
            if (rArm) poseArm(rArm, -0.82, breath * 0.25);
            if (lForearm) poseBone(lForearm, 'y', 0.45);
            if (rForearm) poseBone(rForearm, 'y', 0.45);
          }
          if (spine) poseBone(spine, 'y', -breath * 0.25);
        }

        // Weapon swing / attack posture override
        if (this.attackTimer > 0) {
          const atkProgress = 1 - (this.attackTimer / 0.28);
          const slashRot = Math.sin(atkProgress * Math.PI) * 1.5;
          if (rArm) poseArm(rArm, -0.82 + atkProgress * 0.75, 0.45 - slashRot);
          if (rForearm) poseBone(rForearm, 'y', 0.65 - Math.sin(atkProgress * Math.PI) * 0.35);
          if (spine) poseBone(spine, 'z', -slashRot * 0.15);
        }
      }
    }
  }

  takeDamage(amount) {
    if (G.godMode) return;
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
      this.baseInnerY = this.innerMesh ? this.innerMesh.position.y : 0;
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
          this.innerMesh.position.y = (this.baseInnerY || 0) + bob;
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
    if (this.isBoss && $('boss-fill')) {
      $('boss-fill').style.width = Math.max(0, (this.hp / this.maxHp) * 100) + '%';
    }
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
    if (this.isBoss) {
      if ($('boss-bar-wrap')) $('boss-bar-wrap').style.display = 'none';
      G.boss = null;
      sfx('win');
      spawnChest(this.x, this.z, 3);
      if (this.bossDef?.final) {
        gameOver(true);
      }
    } else if (this.isElite || Math.random() < 0.02) {
      spawnChest(this.x, this.z, 1);
    }
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

// Treasure Chests (Vampire Survivors Style)
function spawnChest(x, z, guaranteedCount = null) {
  const y = heightAt(x, z) + 0.28;
  const group = new THREE.Group();

  const baseGeom = new THREE.BoxGeometry(0.7, 0.42, 0.48);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.5, metalness: 0.4 });
  const baseMesh = new THREE.Mesh(baseGeom, baseMat);
  baseMesh.position.y = 0.21;

  const lockGeom = new THREE.BoxGeometry(0.16, 0.16, 0.08);
  const lockMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.2, metalness: 0.9 });
  const lockMesh = new THREE.Mesh(lockGeom, lockMat);
  lockMesh.position.set(0, 0.21, 0.25);

  const lidGeom = new THREE.CylinderGeometry(0.24, 0.24, 0.7, 12, 1, false, 0, Math.PI);
  lidGeom.rotateZ(Math.PI / 2);
  const lidMesh = new THREE.Mesh(lidGeom, baseMat);
  lidMesh.position.set(0, 0.42, 0);

  group.add(baseMesh, lockMesh, lidMesh);
  group.position.set(x, y, z);
  scene.add(group);

  const shadow = createBlobShadow(0.65);
  shadow.position.set(x, y - 0.24, z);
  scene.add(shadow);

  G.chests.push({ x, y, z, mesh: group, shadow, t: 0, guaranteedCount });
}

function updateChests(dt, player) {
  for (let i = G.chests.length - 1; i >= 0; i--) {
    const c = G.chests[i];
    c.t += dt;
    c.mesh.rotation.y += dt * 1.5;
    c.mesh.position.y = c.y + Math.sin(c.t * 3.5) * 0.08;

    if (Math.random() < 0.25) {
      emit(c.x + (Math.random() - 0.5) * 0.6, c.y + 0.2 + Math.random() * 0.4, c.z + (Math.random() - 0.5) * 0.6, {
        n: 1, color: 0xfde047, speed: 0.5, size: 0.2
      });
    }

    const dist = Math.hypot(player.x - c.x, player.z - c.z);
    if (dist < 1.4) {
      scene.remove(c.mesh);
      scene.remove(c.shadow);
      const guaranteed = c.guaranteedCount;
      G.chests.splice(i, 1);
      openChestModal(guaranteed);
      break;
    }
  }
}

function openChestModal(guaranteedCount = null) {
  G.paused = true;
  sfx('chest');
  const count = guaranteedCount || (Math.random() < 0.08 ? 5 : (Math.random() < 0.28 ? 3 : 1));
  const modal = $('chest-modal');
  if (modal) modal.style.display = 'flex';
  const rewardsEl = $('chest-rewards');
  if (rewardsEl) rewardsEl.innerHTML = '';

  const pool = [];
  for (const [k, lvl] of Object.entries(G.weapons)) {
    if (lvl < MAX_WEAPON) pool.push({ type: 'weapon', key: k, lvl: lvl + 1, def: WEAPONS[k] });
  }
  for (const [k, lvl] of Object.entries(G.passives)) {
    if (lvl < MAX_PASSIVE) pool.push({ type: 'passive', key: k, lvl: lvl + 1, def: PASSIVES[k] });
  }

  const rewards = [];
  for (let r = 0; r < count; r++) {
    if (pool.length > 0) {
      const idx = Math.floor(Math.random() * pool.length);
      const item = pool.splice(idx, 1)[0];
      rewards.push(item);
      if (item.type === 'weapon') {
        G.weapons[item.key] = item.lvl;
      } else {
        G.passives[item.key] = item.lvl;
      }
    } else {
      rewards.push({ type: 'gold', key: 'gold', lvl: 1, def: { name: '50 Gold Bones', icon: '💰', desc: 'A heap of gold bones from the chest.' } });
      G.bones += 50;
    }
  }

  if (rewardsEl) {
    rewards.forEach(item => {
      const card = document.createElement('div');
      card.className = 'vs-card';
      card.style.minWidth = '140px';
      card.innerHTML = `
        <div class="vs-card-badge" style="background:#f59e0b;">LVL UP</div>
        <div class="vs-card-icon">${item.def.icon}</div>
        <div style="font-weight:800; font-size:14px; color:#fff; margin-bottom:4px;">${item.def.name}</div>
        <div style="font-size:11px; color:#fde047;">${item.type === 'gold' ? '+50 Bones' : 'Level ' + item.lvl}</div>
      `;
      rewardsEl.appendChild(card);
    });
  }

  updateInventoryHud();

  const claimBtn = $('chest-claim-btn');
  if (claimBtn) {
    claimBtn.onclick = () => {
      if (modal) modal.style.display = 'none';
      G.paused = false;
    };
  }
}

// Boss Timeline & Spawner
const BOSS_TIMELINE = [
  { t: 60, bossKey: 'ratking', spawned: false },
  { t: 180, bossKey: 'titan', spawned: false },
  { t: 300, bossKey: 'dragon', spawned: false }
];

function checkBossWaves(currentTime) {
  for (const entry of BOSS_TIMELINE) {
    if (!entry.spawned && currentTime >= entry.t && !G.boss) {
      entry.spawned = true;
      spawnBoss(entry.bossKey);
    }
  }
}

function spawnBoss(bossKey) {
  const bDef = BOSSES[bossKey] || BOSSES.ratking;
  sfx('boss');
  sfx('roar');

  const ang = Math.random() * Math.PI * 2;
  const dist = 24;
  const bx = (G.hero?.x || 0) + Math.cos(ang) * dist;
  const bz = (G.hero?.z || 0) + Math.sin(ang) * dist;

  const boss = new Enemy(bossKey, bx, bz);
  boss.isBoss = true;
  boss.bossDef = bDef;
  boss.hp = bDef.hp;
  boss.maxHp = bDef.hp;
  boss.dmg = bDef.dmg;
  boss.speed = bDef.speed;

  if (boss.mesh) {
    boss.mesh.scale.set(1.6, 1.6, 1.6);
  }

  G.boss = boss;
  G.enemies.push(boss);

  const bar = $('boss-bar-wrap');
  if (bar) bar.style.display = 'flex';
  const nameEl = $('boss-name');
  if (nameEl) nameEl.innerText = bDef.name;
  const fillEl = $('boss-fill');
  if (fillEl) fillEl.style.width = '100%';

  emit(bx, boss.y + 1, bz, { n: 40, color: 0xef4444, speed: 8, size: 0.6 });
  return boss;
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

// Test Hooks & Lifecycle Listeners
const preUpdateHooks = new Set();
const postUpdateHooks = new Set();

// Main Game Loop
let lastTime = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  for (const fn of preUpdateHooks) {
    try { fn(dt, G); } catch (e) { console.error('Error in preUpdateHook:', e); }
  }

  if (G.active && !G.paused && G.hero) {
    G.time += dt;
    checkBossWaves(G.time);
    G.hero.update(dt);
    updateWeapons(dt, G.hero);
    updateProjectiles(dt);
    updateSpawner(dt, G.hero);

    for (let i = G.enemies.length - 1; i >= 0; i--) {
      G.enemies[i].update(dt, G.hero);
    }
    updatePickups(dt, G.hero);
    updateChests(dt, G.hero);
    updateHUD(G.hero);
  }

  updateParticles(dt);
  updateHitsplats(dt);

  for (const fn of postUpdateHooks) {
    try { fn(dt, G); } catch (e) { console.error('Error in postUpdateHook:', e); }
  }

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

// Start a game run programmatically or via UI
export async function startRun(heroKey = 'knight', arenaKey = 'temple') {
  unlockAudio();
  $('start-modal').style.display = 'none';
  $('hud').style.display = 'block';
  const touchStick = $('touch-stick');
  if (touchStick && ('ontouchstart' in window || navigator.maxTouchPoints > 0)) {
    touchStick.style.display = 'block';
  }

  const heroDef = HEROES[heroKey] || HEROES.knight;
  G.selectedHeroKey = heroKey;

  await loadArena(arenaKey);
  G.hero = new Player(heroDef);
  await G.hero.init();
  camera.position.set(G.hero.x, G.hero.y + 17, G.hero.z + 17);
  camera.lookAt(G.hero.x, G.hero.y + 1.2, G.hero.z);

  preloadEnemyTemplates(); // Runs fast in parallel

  G.weapons = { [heroDef.start]: 1 };
  G.passives = {};
  G.chests = [];
  G.boss = null;
  for (const b of BOSS_TIMELINE) b.spawned = false;
  if ($('boss-bar-wrap')) $('boss-bar-wrap').style.display = 'none';
  initWeapons();
  G.active = true;
  G.paused = false;
  G.time = 0;
  G.kills = 0;
  G.bones = 0;
  G.level = 1;
  G.xp = 0;
  G.nextXp = xpForLevel(1);
  ambience(true);
  return G.hero;
}

// Comprehensive Test & Automation Hooks Harness
export const testHooks = {
  // --- Lifecycle Loop Hooks ---
  onPreUpdate(fn) { preUpdateHooks.add(fn); return () => preUpdateHooks.delete(fn); },
  onPostUpdate(fn) { postUpdateHooks.add(fn); return () => postUpdateHooks.delete(fn); },

  // --- Run Control ---
  async startRun(heroKey = 'knight', arenaKey = 'temple') {
    return await startRun(heroKey, arenaKey);
  },
  pause(val = true) {
    G.paused = val;
    $('pause-modal').style.display = G.paused ? 'flex' : 'none';
  },
  resume() {
    G.paused = false;
    $('pause-modal').style.display = 'none';
  },
  setGodMode(val = true) {
    G.godMode = val;
  },

  // --- Movement & Locomotion Controls ---
  setMoveInput(mx, mz) {
    G.overrideMove = { mx, mz, active: (mx !== 0 || mz !== 0) };
  },
  stopMovement() {
    G.overrideMove = { mx: 0, mz: 0, active: false };
    G.keys = {};
    if (G.pointerDir) G.pointerDir.active = false;
  },
  async moveFor(mx, mz, durationMs) {
    if (!G.hero) return null;
    const startPos = { x: G.hero.x, y: G.hero.y, z: G.hero.z };
    const startCycle = G.hero.walkCycle;
    this.setMoveInput(mx, mz);
    await new Promise(r => setTimeout(r, durationMs));
    this.stopMovement();
    const endPos = { x: G.hero.x, y: G.hero.y, z: G.hero.z };
    return {
      startPos,
      endPos,
      distMoved: Math.hypot(endPos.x - startPos.x, endPos.z - startPos.z),
      dx: endPos.x - startPos.x,
      dz: endPos.z - startPos.z,
      walkCycleDelta: G.hero.walkCycle - startCycle,
      yaw: G.hero.yaw,
      finalHeight: G.hero.y
    };
  },
  dash() {
    if (!G.hero) return false;
    return G.hero.dash();
  },
  teleport(x, z) {
    if (!G.hero) return null;
    G.hero.x = x;
    G.hero.z = z;
    const dist = Math.hypot(G.hero.x, G.hero.z);
    if (dist > ARENA_RADIUS) {
      G.hero.x = (G.hero.x / dist) * ARENA_RADIUS;
      G.hero.z = (G.hero.z / dist) * ARENA_RADIUS;
    }
    const pos = { x: G.hero.x, z: G.hero.z };
    resolveColliders(pos, 0.5);
    G.hero.x = pos.x;
    G.hero.z = pos.z;
    G.hero.y = heightAt(G.hero.x, G.hero.z);
    if (G.hero.mesh) G.hero.mesh.position.set(G.hero.x, G.hero.y, G.hero.z);
    if (G.hero.shadow) G.hero.shadow.position.set(G.hero.x, G.hero.y + 0.04, G.hero.z);
    return { x: G.hero.x, y: G.hero.y, z: G.hero.z };
  },

  // --- Combat & Actions ---
  triggerWeapon(wKey) {
    if (!G.hero) return false;
    const key = wKey || Object.keys(G.weapons)[0] || 'scimitar';
    const rank = G.weapons[key] || 1;
    const wDef = WEAPONS[key];
    if (!wDef) return false;
    fireWeapon(key, wDef.lv(rank), G.hero);
    return true;
  },
  takeDamage(amount) {
    if (!G.hero) return;
    G.hero.takeDamage(amount);
  },
  heal(amount) {
    if (!G.hero) return;
    G.hero.heal(amount);
  },

  // --- Enemies & Horde Management ---
  spawnEnemy(typeKey = 'rat', x, z) {
    const ex = x !== undefined ? x : (G.hero ? G.hero.x + 8 : 8);
    const ez = z !== undefined ? z : (G.hero ? G.hero.z + 8 : 8);
    const e = new Enemy(typeKey, ex, ez);
    G.enemies.push(e);
    return e;
  },
  clearEnemies() {
    for (const e of G.enemies) {
      if (e.mesh) scene.remove(e.mesh);
      if (e.shadow) scene.remove(e.shadow);
    }
    G.enemies.length = 0;
  },
  damageEnemy(indexOrKey, amount = 999) {
    const e = typeof indexOrKey === 'number' ? G.enemies[indexOrKey] : G.enemies.find(x => x.key === indexOrKey);
    if (!e) return false;
    return e.takeDamage(amount);
  },

  // --- XP & Progression ---
  addXp(amount) {
    addXp(amount);
  },
  spawnDrop(x, z, xp = 10) {
    spawnDrop(x, z, xp);
  },
  openLevelUp() {
    openLevelUp();
  },
  chooseUpgrade(cardIndex = 0) {
    const cards = document.querySelectorAll('#levelup-cards .vs-card');
    if (cards[cardIndex]) {
      cards[cardIndex].click();
      return true;
    }
    return false;
  },
  rerollLevelUp() {
    const btn = $('reroll-btn');
    if (btn) { btn.click(); return true; }
    return false;
  },
  skipLevelUp() {
    const btn = $('skip-btn');
    if (btn) { btn.click(); return true; }
    return false;
  },

  // --- Vampire Survivors Feature Hooks ---
  spawnChest(x, z, count = 1) {
    const cx = x !== undefined ? x : (G.hero ? G.hero.x : 0);
    const cz = z !== undefined ? z : (G.hero ? G.hero.z : 0);
    spawnChest(cx, cz, count);
    return G.chests[G.chests.length - 1];
  },
  openChest(count = 1) {
    openChestModal(count);
  },
  claimChest() {
    const btn = $('chest-claim-btn');
    if (btn) { btn.click(); return true; }
    return false;
  },
  spawnBoss(bossKey = 'ratking') {
    return spawnBoss(bossKey);
  },
  toggleAudio(on) {
    sound.on = on !== undefined ? on : !sound.on;
    G.soundMuted = !sound.on;
    const btn = $('sound-btn');
    if (btn) btn.innerText = sound.on ? '🔊 SOUND' : '🔇 MUTED';
    localStorage.setItem('dws-sound', sound.on ? 'on' : 'off');
    return sound.on;
  },
  getBossState() {
    if (!G.boss) return null;
    return {
      name: G.boss.bossDef?.name,
      hp: G.boss.hp,
      maxHp: G.boss.maxHp,
      x: G.boss.x,
      z: G.boss.z,
      isBoss: G.boss.isBoss,
      barVisible: $('boss-bar-wrap')?.style.display !== 'none'
    };
  },

  // --- Telemetry & State Extraction ---
  getHeroState() {
    if (!G.hero) return null;
    const h = G.hero;
    return {
      x: h.x,
      y: h.y,
      z: h.z,
      yaw: h.yaw,
      vx: h.vx || 0,
      vz: h.vz || 0,
      speed: h.speed,
      isMoving: !!h.isMoving,
      isDashing: !!h.isDashing,
      dashCd: h.dashCd,
      hp: h.hp,
      maxHp: h.maxHp,
      armor: h.armor,
      might: h.might,
      invuln: h.invuln,
      walkCycle: h.walkCycle,
      idleCycle: h.idleCycle,
      attackTimer: h.attackTimer,
      boneAngles: h.boneAngles || null,
      meshPos: h.mesh ? [h.mesh.position.x, h.mesh.position.y, h.mesh.position.z] : null,
      shadowPos: h.shadow ? [h.shadow.position.x, h.shadow.position.y, h.shadow.position.z] : null,
      distFromOrigin: Math.hypot(h.x, h.z)
    };
  },
  getGameState() {
    return {
      active: G.active,
      paused: G.paused,
      time: G.time,
      kills: G.kills,
      bones: G.bones,
      level: G.level,
      xp: G.xp,
      nextXp: G.nextXp,
      weapons: { ...G.weapons },
      passives: { ...G.passives },
      enemiesCount: G.enemies.length,
      pickupsCount: G.pickups.length,
      projectilesCount: G.projectiles.length,
      cameraPos: [camera.position.x, camera.position.y, camera.position.z]
    };
  },

  // --- Automated Capability Test Suite ---
  async runSelfTest() {
    const results = [];
    const log = (name, passed, detail) => {
      results.push({ name, passed, detail });
      console.log(`[TEST] ${passed ? '✓' : '✗'} ${name}:`, detail);
    };

    try {
      if (!G.active || !G.hero) {
        await this.startRun('knight', 'temple');
      }

      // 1. Idle capability
      this.stopMovement();
      const idleStart = G.hero.idleCycle;
      await new Promise(r => setTimeout(r, 200));
      const idlePassed = G.hero.idleCycle > idleStart;
      log('Idle Locomotion Cycle', idlePassed, { cycleDelta: G.hero.idleCycle - idleStart });

      // 2. Movement East (+X)
      const moveE = await this.moveFor(1, 0, 400);
      const ePassed = moveE.dx > 0.3 && moveE.walkCycleDelta > 0;
      log('Movement East (+X) & Stride Articulation', ePassed, moveE);

      // 3. Movement North (-Z)
      const moveN = await this.moveFor(0, -1, 400);
      const nPassed = moveN.dz < -0.3 && moveN.walkCycleDelta > 0;
      log('Movement North (-Z) & Stride Articulation', nPassed, moveN);

      // 4. Movement West (-X)
      const moveW = await this.moveFor(-1, 0, 400);
      const wPassed = moveW.dx < -0.3 && moveW.walkCycleDelta > 0;
      log('Movement West (-X) & Stride Articulation', wPassed, moveW);

      // 5. Movement South (+Z)
      const moveS = await this.moveFor(0, 1, 400);
      const sPassed = moveS.dz > 0.3 && moveS.walkCycleDelta > 0;
      log('Movement South (+Z) & Stride Articulation', sPassed, moveS);

      // 6. Dash Capability
      this.setMoveInput(1, 0);
      const dashed = this.dash();
      await new Promise(r => setTimeout(r, 100));
      const heroState = this.getHeroState();
      this.stopMovement();
      const dashPassed = dashed && heroState.dashCd > 0 && heroState.invuln > 0;
      log('Dash Action & Invulnerability Window', dashPassed, { dashed, dashCd: heroState.dashCd, invuln: heroState.invuln });

      // 7. Terrain Height Resolving
      const groundH = heightAt(G.hero.x, G.hero.z);
      const hPassed = Math.abs(G.hero.y - groundH) < 0.05;
      log('Terrain Height Resolving', hPassed, { heroY: G.hero.y, groundH });

      // 8. Arena Boundary Resolution
      this.teleport(ARENA_RADIUS + 50, 0);
      const clampedDist = Math.hypot(G.hero.x, G.hero.z);
      const bPassed = Math.abs(clampedDist - ARENA_RADIUS) < 0.5;
      log('Arena Boundary Clamping', bPassed, { clampedDist, maxRadius: ARENA_RADIUS });
      this.teleport(0, 0);

      // 9. Weapon Attack Execution & Animation
      const fired = this.triggerWeapon('scimitar');
      const attackTimerActive = G.hero.attackTimer > 0;
      log('Weapon Attack Execution & Slash Gesture', fired && attackTimerActive, { fired, attackTimer: G.hero.attackTimer });

      // 10. Enemy Spawning & Flocking Separation
      this.clearEnemies();
      const e1 = this.spawnEnemy('rat', G.hero.x + 4, G.hero.z);
      const e2 = this.spawnEnemy('rat', G.hero.x + 4.1, G.hero.z);
      await new Promise(r => setTimeout(r, 300));
      const enemyDist = Math.hypot(e1.x - e2.x, e1.z - e2.z);
      const flockingPassed = enemyDist > 0.2;
      log('Enemy Spawning & Horde Separation', flockingPassed, { enemyDist, e1Pos: [e1.x, e1.z], e2Pos: [e2.x, e2.z] });

      // 11. Enemy Damage & Drops
      const preKills = G.kills;
      const preDrops = G.pickups.length;
      e1.takeDamage(999);
      const killPassed = G.kills > preKills && G.pickups.length > preDrops;
      log('Enemy Damage, Hitsplats & Gem Drop', killPassed, { kills: G.kills, drops: G.pickups.length });

      // 12. Drop Magnet & Pickup Collection
      this.teleport(G.pickups[0]?.x || 0, G.pickups[0]?.z || 0);
      await new Promise(r => setTimeout(r, 300));
      const postDrops = G.pickups.length;
      log('XP Gem Magnet & Absorption', postDrops === 0, { remainingDrops: postDrops });

      // 13. Level Up & Upgrade Resolution
      const preLevel = G.level;
      this.addXp(100);
      await new Promise(r => setTimeout(r, 100));
      const modalOpen = $('levelup-modal')?.style.display === 'flex';
      const upgraded = this.chooseUpgrade(0);
      const levelPassed = modalOpen && upgraded && G.level > preLevel;
      log('Level Up Modal & Upgrade Resolution', levelPassed, { preLevel, curLevel: G.level, modalOpen, upgraded });

      // 14. Treasure Chest Spawning & Claiming
      const preChests = G.chests.length;
      const chest = this.spawnChest(G.hero.x + 0.1, G.hero.z + 0.1, 1);
      await new Promise(r => setTimeout(r, 150));
      const chestModalOpen = $('chest-modal')?.style.display === 'flex';
      const claimed = this.claimChest();
      const chestPassed = chestModalOpen && claimed;
      log('Treasure Chest Spawning & Slot Fanfare', chestPassed, { preChests, chestModalOpen, claimed });

      // 15. Boss Wave Spawning & Health Bar Tracking
      const boss = this.spawnBoss('ratking');
      await new Promise(r => setTimeout(r, 100));
      const bossState = this.getBossState();
      const bossPassed = boss && bossState && bossState.barVisible && bossState.hp > 0;
      log('Boss Wave Spawning & Health Bar Tracking', bossPassed, bossState);
      this.clearEnemies();
      if ($('boss-bar-wrap')) $('boss-bar-wrap').style.display = 'none';
      G.boss = null;

      // 16. Sound Toggle & Audio Control
      const muted = !this.toggleAudio(false);
      const unmuted = this.toggleAudio(true);
      log('Sound Toggle & Mute Control', muted && unmuted, { muted, unmuted });

      const allPassed = results.every(r => r.passed);
      return {
        passed: allPassed,
        total: results.length,
        passedCount: results.filter(r => r.passed).length,
        results
      };
    } catch (err) {
      log('Test Suite Execution', false, { error: err.message, stack: err.stack });
      return { passed: false, error: err.message, results };
    }
  }
};

window.DWS_TEST = testHooks;
G.test = testHooks;

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
    const heroKey = document.querySelector('.hero-select-card.selected')?.dataset.hero || 'knight';
    await startRun(heroKey, 'temple');
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

  const soundBtn = $('sound-btn');
  if (soundBtn) {
    soundBtn.onclick = () => {
      sound.on = !sound.on;
      G.soundMuted = !sound.on;
      soundBtn.innerText = sound.on ? '🔊 SOUND' : '🔇 MUTED';
      localStorage.setItem('dws-sound', sound.on ? 'on' : 'off');
      if (!sound.on) ambience(false); else if (G.active) ambience(true);
    };
  }

  $('resume-btn').onclick = () => {
    G.paused = false;
    $('pause-modal').style.display = 'none';
  };

  $('restart-btn').onclick = () => location.reload();
  $('retry-btn').onclick = () => location.reload();
}

start().catch(err => console.error('Failed to start Survivors game:', err));
