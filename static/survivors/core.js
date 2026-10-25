// Dragonwilds Survivors: renderer, asset loading and model "templates" (static, instanceable copies of game models).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Fix Three.js GLTFLoader crash on meshes without skinWeight attribute
THREE.SkinnedMesh.prototype.normalizeSkinWeights = function() {
  const skinWeight = this.geometry?.attributes?.skinWeight;
  if (!skinWeight) return;
  const vector = new THREE.Vector4();
  for (let i = 0, l = skinWeight.count; i < l; i++) {
    vector.fromBufferAttribute(skinWeight, i);
    const scale = 1.0 / vector.manhattanLength();
    if (scale !== Infinity) vector.multiplyScalar(scale); else vector.set(1, 0, 0, 0);
    skinWeight.setXYZW(i, vector.x, vector.y, vector.z, vector.w);
  }
};

export { THREE };
export const $ = id => document.getElementById(id);
export const rand = (a, b) => a + Math.random() * (b - a);
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const pick = arr => arr[(Math.random() * arr.length) | 0];

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
export const canvas = $('game-canvas');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fa3b5);
scene.fog = new THREE.Fog(0x8fa3b5, 45, 120);
export const camera = new THREE.PerspectiveCamera(42, 1, 0.3, 400);
const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x4a4030, 1.8);
const sun = new THREE.DirectionalLight(0xfff1d6, 2.5);
sun.position.set(30, 60, 20);
scene.add(hemi, sun);
export const lights = { hemi, sun };
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// ---------------------------------------------------------------------------
// Assets: same models.json the viewer and base builder use.
// ---------------------------------------------------------------------------
export let ASSETS = '/assets/';
const enc = p => p.split('/').map(encodeURIComponent).join('/');
const byName = new Map();
export async function loadCatalog() {
  let data = null;
  for (const base of ['/assets/', 'https://ashenfallen.com/assets/']) {
    try { const r = await fetch(base + 'models.json'); if (r.ok) { data = await r.json(); ASSETS = base; break; } } catch { }
  }
  if (!data) throw new Error('Could not load the model catalogue.');
  for (const e of data.Models || []) {
    const file = e.File.replace(/\\/g, '/');
    const name = file.split('/').pop().replace(/\.glb$/i, '').toLowerCase();
    byName.set(name, {
      url: ASSETS + enc(file),
      materials: (e.Materials || []).map(x => ({ name: (x.Name || '').toLowerCase(),
        diffuse: x.BaseColor ? ASSETS + enc(x.BaseColor.replace(/\\/g, '/')) : null,
        normal: x.Normal ? ASSETS + enc(x.Normal.replace(/\\/g, '/')) : null, color: x.Color || null, masked: !!x.Masked }))
    });
  }
  return byName.size;
}
export const hasModel = name => byName.has(name.toLowerCase());
export const modelForMesh = meshPath => byName.get(meshPath.split('/').pop().split('.')[0].toLowerCase()) || null;

const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const texLoader = new THREE.TextureLoader();
const texCache = new Map();
function loadTex(url, srgb) {
  if (!texCache.has(url)) texCache.set(url, texLoader.loadAsync(url).then(t => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
  }).catch(() => null));
  return texCache.get(url);
}
const sceneCache = new Map();
// Loads a model (by file name without .glb, or a catalogue entry) and hooks up its textures.
export function loadModel(nameOrEntry) {
  const m = typeof nameOrEntry === 'string' ? byName.get(nameOrEntry.toLowerCase()) : nameOrEntry;
  if (!m) return Promise.reject(new Error('Unknown model ' + nameOrEntry));
  const modelUrl = m.url + (m.url.includes('SK_') ? '?v=skin1' : '');
  if (!sceneCache.has(modelUrl)) sceneCache.set(modelUrl, (async () => {
    const root = (await gltf.loadAsync(modelUrl)).scene;
    const mats = [];
    root.traverse(o => { if (o.isMesh) for (const mat of [].concat(o.material)) if (mat && !mats.includes(mat)) mats.push(mat); });
    const byMat = new Map(m.materials.map(x => [x.name, x]));
    await Promise.all(mats.map(async (mat, i) => {
      mat.side = THREE.DoubleSide; mat.vertexColors = false;
      if ('metalness' in mat) { mat.metalness = 0; mat.roughness = 0.85; }
      const e = byMat.get((mat.name || '').toLowerCase()) || (mats.length === m.materials.length ? m.materials[i] : null);
      if (!e) return;
      const [map, normal] = await Promise.all([e.diffuse ? loadTex(e.diffuse, true) : null, e.normal ? loadTex(e.normal, false) : null]);
      if (map) { mat.map = map; mat.color?.set(0xffffff); } else if (e.color) mat.color?.set('#' + e.color.slice(-6));
      if (normal) mat.normalMap = normal;
      if (e.masked) mat.alphaTest = 0.33;
      mat.needsUpdate = true;
    }));
    return root;
  })());
  return sceneCache.get(modelUrl);
}

// ---------------------------------------------------------------------------
// Templates: create optimized clone instances of game models.
// ---------------------------------------------------------------------------
export async function bakeTemplate(name, { height = null, size = null, yaw = 0, tint = null } = {}) {
  try {
    const src = await loadModel(name);
    const obj = src.clone(true);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const sz = box.getSize(new THREE.Vector3());
    const s = height ? height / (sz.y || 1) : size ? size / Math.max(sz.x || 1, sz.y || 1, sz.z || 1) : 1;
    
    // Create container with normalized pivot (origin at feet / bottom center)
    const container = new THREE.Group();
    obj.scale.multiplyScalar(s);
    obj.position.set(-(box.min.x + box.max.x) / 2 * s, -box.min.y * s, -(box.min.z + box.max.z) / 2 * s);
    if (yaw) obj.rotation.y = yaw;
    if (tint) {
      const tintCol = new THREE.Color(tint);
      obj.traverse(o => {
        if (o.isMesh && o.material) {
          o.material = o.material.clone();
          if (o.material.color) o.material.color.multiply(tintCol);
        }
      });
    }
    container.add(obj);
    return { name, proto: container, height: height || sz.y * s, radius: Math.max(sz.x, sz.z) * s / 2 };
  } catch (err) {
    console.warn('Fallback template for', name, err);
    const h = height || 1.6;
    const geo = new THREE.CylinderGeometry(h * 0.25, h * 0.3, h, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.6 });
    const fallbackMesh = new THREE.Mesh(geo, mat);
    fallbackMesh.position.y = h / 2;
    const container = new THREE.Group();
    container.add(fallbackMesh);
    return { name, proto: container, height: h, radius: h * 0.3 };
  }
}

export function templateMesh(t) {
  if (!t || !t.proto) {
    const geo = new THREE.CylinderGeometry(0.3, 0.4, 1.2, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0xef4444 });
    const m = new THREE.Mesh(geo, mat);
    m.position.y = 0.6;
    const g = new THREE.Group();
    g.add(m);
    return g;
  }
  return t.proto.clone(true);
}

// Character loader (clones the root scene so it works reliably)
export async function loadCharacter(name, height = 2.0) {
  const src = await loadModel(name);
  const obj = src.clone(true);
  const holder = new THREE.Group();
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj), sz = box.getSize(new THREE.Vector3());
  const s = height / (sz.y || 1);
  obj.scale.multiplyScalar(s);
  obj.position.set(-(box.min.x + box.max.x) / 2 * s, -box.min.y * s, -(box.min.z + box.max.z) / 2 * s);
  holder.add(obj);
  const bones = {};
  obj.traverse(o => { if (o.isBone) bones[o.name.toLowerCase()] = o; if (o.isMesh) o.frustumCulled = false; });
  for (const b of Object.values(bones)) b.userData.rest = b.quaternion.clone();
  return { root: holder, inner: obj, bones, height };
}
const _q = new THREE.Quaternion(), _ax = new THREE.Vector3();
export function poseBone(b, axis, angle) {
  if (!b || !b.userData?.rest) return;
  _ax.set(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
  b.quaternion.copy(b.userData.rest).multiply(_q.setFromAxisAngle(_ax, angle));
}
export function findBone(bones, ...names) {
  for (const n of names) { if (bones[n]) return bones[n]; }
  for (const n of names) { const k = Object.keys(bones).find(k => k.includes(n)); if (k) return bones[k]; }
  return null;
}
