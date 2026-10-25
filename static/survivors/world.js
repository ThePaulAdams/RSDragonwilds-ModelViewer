// Dragonwilds Survivors: the real Ashenfall landscape and world objects around an arena.
import { THREE, scene, ASSETS, modelForMesh, loadModel } from './core.js';

export const ARENAS = {
  temple: { name: 'Temple Road', desc: 'An ash-wood clearing on the old cobbled temple road.', X: 129150, Y: -22050, sky: 0x9fb3c4 },
  ruins:  { name: 'Ashen Ruins', desc: 'Crumbling human ruins among the trees. Tight lanes, many pillars.', X: 78750, Y: -28350, sky: 0xa7a59a },
  wither: { name: 'Witherspine Marsh', desc: 'Blighted marshland bubbling with withered spines.', X: 129150, Y: 15750, sky: 0x8a9480 },
};
export const ARENA_RADIUS = 62;          // metres the hero may roam from the centre
const TERRAIN_R = 13500, OBJECT_R = 9500, SQUARE = 25600;

export const world = { anchor: { X: 0, Y: 0, Z: 0 }, tiles: [], group: new THREE.Group(), colliders: [], grid: new Map() };
scene.add(world.group);
const toScene = (X, Y, Z) => new THREE.Vector3((X - world.anchor.X) / 100, (Z - world.anchor.Z) / 100, (Y - world.anchor.Y) / 100);

// Detail texture so the slope-coloured ground doesn't look flat.
function noiseTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d'), img = x.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) {
    const v = 200 + Math.random() * 55 - (Math.random() < 0.04 ? 60 : 0);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, map: noiseTexture() });
const grassCol = new THREE.Color(0x5b6f38), dryCol = new THREE.Color(0x76733f), dirtCol = new THREE.Color(0x6d5f45), rockCol = new THREE.Color(0x77736b);

function tileMesh(t, h) {
  const n = t.n, pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, v = toScene(t.x + i * t.step, t.y + j * t.step, t.z + (h[k] - 32768) * t.zs);
    pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z;
    uv[k * 2] = v.x / 6; uv[k * 2 + 1] = v.z / 6;
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6); let q = 0;
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i, b = a + 1, c = a + n, d = c + 1; idx.set([a, b, c, b, d, c], q); q += 6; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  const nrm = g.attributes.normal;
  if (nrm.getY(0) + nrm.getY(n * n - 1) < 0) {
    for (let k = 0; k < idx.length; k += 3) { const s = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = s; }
    g.index.needsUpdate = true; g.computeVertexNormals();
  }
  const col = new Float32Array(n * n * 3), c = new THREE.Color();
  for (let k = 0; k < n * n; k++) {
    const up = nrm.getY(k), wob = Math.sin(pos[k * 3] * 0.13) * Math.cos(pos[k * 3 + 2] * 0.11);
    if (up > 0.9) c.copy(grassCol).lerp(dryCol, 0.5 + wob * 0.5); else if (up > 0.75) c.copy(grassCol).lerp(dirtCol, (0.9 - up) / 0.15); else c.copy(dirtCol).lerp(rockCol, Math.min(1, (0.75 - up) / 0.2));
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Mesh(g, terrainMat);
}

// Ground height (scene metres) under scene x/z, from the raw landscape tiles.
export function heightAt(x, z) {
  const X = x * 100 + world.anchor.X, Y = z * 100 + world.anchor.Y;
  for (const t of world.tiles) {
    const L = t.step * (t.n - 1);
    if (X < t.x || Y < t.y || X > t.x + L || Y > t.y + L) continue;
    const h = t.h, fi = (X - t.x) / t.step, fj = (Y - t.y) / t.step;
    const i = Math.min(t.n - 2, fi | 0), j = Math.min(t.n - 2, fj | 0), u = fi - i, v = fj - j, n = t.n;
    const a = h[j * n + i], b = h[j * n + i + 1], c = h[(j + 1) * n + i], d = h[(j + 1) * n + i + 1];
    const raw = (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
    return (t.z + (raw - 32768) * t.zs - world.anchor.Z) / 100;
  }
  return 0;
}

const skip = p => /\/VFX\/|Collision|Placeholder|Blocker|Decal|_RVT|XPlane|Volume|Spline|Water|Ocean|Sky/i.test(p);
const isPlant = p => !/Cliff|Rock|Cave|Wall|Stone|Architecture|Building|Ruin|Tree|Pillar|Pllar|Statue|Boulder/i.test(p) && /Foliage|Grass|Flowers|Branches_|Fern|Bush|Weed|Reeds|Mushroom|Clover|Ivy|Vine|Flora|Dandelion|Poppy|Thistle/i.test(p);
const solid = p => /Tree|Rock|Boulder|Stone_0|Pillar|Pllar|Statue|Ruins_Wall|Column|Stump|Log|Limestone|Spines|Crate|Barrel|Cart|Tent|Totem|Obelisk/i.test(p);

function addCollider(x, z, r) {
  const c = { x, z, r };
  world.colliders.push(c);
  const k0 = Math.floor((x - r) / 4), k1 = Math.floor((x + r) / 4), m0 = Math.floor((z - r) / 4), m1 = Math.floor((z + r) / 4);
  for (let i = k0; i <= k1; i++) for (let j = m0; j <= m1; j++) { const k = i * 4096 + j; if (!world.grid.has(k)) world.grid.set(k, []); world.grid.get(k).push(c); }
}
// Pushes a circle (x, z, radius) out of trees, rocks and pillars. Returns the corrected position in `out`.
export function resolveColliders(p, r) {
  const list = world.grid.get(Math.floor(p.x / 4) * 4096 + Math.floor(p.z / 4));
  if (!list) return;
  for (const c of list) {
    const dx = p.x - c.x, dz = p.z - c.z, d2 = dx * dx + dz * dz, R = c.r + r;
    if (d2 < R * R && d2 > 1e-6) { const d = Math.sqrt(d2), k = (R - d) / d; p.x += dx * k; p.z += dz * k; }
  }
}

const ueQuat = (x, y, z, w) => new THREE.Quaternion(-x, -z, -y, w);
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _b = new THREE.Box3();

export async function loadArena(key, onProgress = () => { }) {
  const A = ARENAS[key];
  world.group.clear(); world.colliders.length = 0; world.grid.clear(); world.tiles = [];
  scene.background.set(A.sky); scene.fog.color.set(A.sky);
  const [tiles, meshes] = await Promise.all(['terrain.json', 'meshes.json'].map(f => fetch(ASSETS + 'world/' + f).then(r => r.json())));
  const near = tiles.filter(t => {
    const L = t.step * (t.n - 1), dx = Math.max(t.x - A.X, 0, A.X - (t.x + L)), dy = Math.max(t.y - A.Y, 0, A.Y - (t.y + L));
    return dx * dx + dy * dy < TERRAIN_R * TERRAIN_R;
  });
  // The anchor's height: sample after the tiles arrive.
  world.anchor = { X: A.X, Y: A.Y, Z: 0 };
  let done = 0;
  await Promise.all(near.map(async t => {
    const buf = await (await fetch(ASSETS + 'world/terrain/' + t.f)).arrayBuffer();
    world.tiles.push({ ...t, h: new Uint16Array(buf) });
    onProgress('Landscape', ++done / near.length);
  }));
  world.anchor.Z = heightAt(0, 0) * 100;
  for (const t of world.tiles) world.group.add(tileMesh(t, t.h));

  // World objects: trees, rocks, ruins... instanced per mesh.
  const keys = [];
  for (let ix = Math.floor((A.X - OBJECT_R) / SQUARE); ix <= Math.floor((A.X + OBJECT_R) / SQUARE); ix++)
    for (let iy = Math.floor((A.Y - OBJECT_R) / SQUARE); iy <= Math.floor((A.Y + OBJECT_R) / SQUARE); iy++) keys.push(ix + '_' + iy);
  const lists = await Promise.all(keys.map(k => fetch(ASSETS + 'world/objects/' + k + '.json').then(r => r.ok ? r.json() : []).catch(() => [])));
  const byMesh = new Map();
  for (const list of lists) for (const r of list) {
    const p = meshes[r[0]], dx = r[1] - A.X, dy = r[2] - A.Y, d2 = dx * dx + dy * dy;
    if (!p || skip(p) || d2 > OBJECT_R * OBJECT_R) continue;
    if (isPlant(p) && (d2 > 4500 * 4500 || Math.random() < 0.5)) continue;   // thin out ground cover far away
    if (!byMesh.has(r[0])) byMesh.set(r[0], []);
    byMesh.get(r[0]).push(r);
  }
  let loaded = 0, total = byMesh.size;
  await Promise.all([...byMesh].map(async ([mi, rows]) => {
    const path = meshes[mi], entry = modelForMesh(path);
    try {
      if (!entry) return;
      const root = await loadModel(entry);
      root.updateMatrixWorld(true);
      _b.setFromObject(root);
      const half = Math.min(_b.max.x - _b.min.x, _b.max.z - _b.min.z) / 2;
      root.traverse(o => {
        if (!o.isMesh) return;
        const im = new THREE.InstancedMesh(o.geometry, o.material, rows.length);
        rows.forEach((r, i) => {
          _p.copy(toScene(r[1], r[2], r[3])); _s.set(r[8], r[10], r[9]);
          _m.compose(_p, ueQuat(r[4], r[5], r[6], r[7]), _s).multiply(o.matrixWorld);
          im.setMatrixAt(i, _m);
        });
        im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
        world.group.add(im);
      });
      if (solid(path) && !isPlant(path)) for (const r of rows) {
        const rr = half * Math.max(r[8], r[9]) * (/Tree/i.test(path) ? 0.25 : 0.6);
        if (rr > 0.25 && rr < 6) { const v = toScene(r[1], r[2], r[3]); if (v.x * v.x + v.z * v.z < (ARENA_RADIUS + 12) ** 2) addCollider(v.x, v.z, rr); }
      }
    } catch { } finally { onProgress('Trees, rocks and ruins', ++loaded / total); }
  }));
  // Keep the spawn point clear.
  world.colliders = world.colliders.filter(c => c.x * c.x + c.z * c.z > 9);
  for (const [k, list] of world.grid) world.grid.set(k, list.filter(c => c.x * c.x + c.z * c.z > 9));
  addBoundary();
  return { tiles: world.tiles.length, meshes: byMesh.size };
}

// A ring of ash-mist at the arena's edge.
function addBoundary() {
  const g = new THREE.CylinderGeometry(ARENA_RADIUS + 1, ARENA_RADIUS + 1, 14, 96, 1, true);
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { t: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform float t; varying vec2 vUv; void main(){ float a=(1.0-vUv.y)*0.55*(0.7+0.3*sin(vUv.x*80.0+t*1.5)); gl_FragColor=vec4(0.55,0.5,0.62,a); }'
  });
  const ring = new THREE.Mesh(g, m);
  ring.position.y = heightAt(0, 0) + 4;
  ring.userData.update = dt => { m.uniforms.t.value += dt; };
  world.group.add(ring);
  world.ring = ring;
}
