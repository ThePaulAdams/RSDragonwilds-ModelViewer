// Dragonwilds Survivors: renderer, asset loading and model "templates" (static, instanceable copies of game models).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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
renderer.toneMappingExposure = 1.05;
export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fa3b5);
scene.fog = new THREE.Fog(0x8fa3b5, 45, 120);
export const camera = new THREE.PerspectiveCamera(42, 1, 0.3, 400);
const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x4a4030, 1.6);
const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
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
  if (!sceneCache.has(m.url)) sceneCache.set(m.url, (async () => {
    const root = (await gltf.loadAsync(m.url)).scene;
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
  return sceneCache.get(m.url);
}

// ---------------------------------------------------------------------------
// Templates: bake a (possibly skinned) model into one static geometry in its bind pose,
// normalised so the feet sit on y=0, centred, facing +Z, scaled to a target height.
// ---------------------------------------------------------------------------
function floatAttr(a) {
  const n = a.count, s = a.itemSize, out = new Float32Array(n * s);
  for (let i = 0; i < n; i++) for (let k = 0; k < s; k++) out[i * s + k] = a.getComponent(i, k);
  return new THREE.BufferAttribute(out, s);
}
function cleanGeometry(src, matrix) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', floatAttr(src.attributes.position));
  if (src.attributes.normal) g.setAttribute('normal', floatAttr(src.attributes.normal));
  g.setAttribute('uv', src.attributes.uv ? floatAttr(src.attributes.uv) : new THREE.BufferAttribute(new Float32Array(src.attributes.position.count * 2), 2));
  if (src.index) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.index.array), 1));
  else g.setIndex([...Array(src.attributes.position.count).keys()]);
  g.applyMatrix4(matrix);
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}
export async function bakeTemplate(name, { height = null, size = null, yaw = 0, tint = null } = {}) {
  const root = await loadModel(name);
  root.updateMatrixWorld(true);
  const geos = [], mats = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    const base = cleanGeometry(o.geometry, o.matrixWorld);
    const list = [].concat(o.material);
    const groups = Array.isArray(o.material) && o.geometry.groups.length ? o.geometry.groups : [{ start: 0, count: base.index.count, materialIndex: 0 }];
    for (const gr of groups) {
      const g = base.clone();
      g.setIndex(new THREE.BufferAttribute(base.index.array.slice(gr.start, gr.start + gr.count), 1));
      geos.push(g); mats.push(list[gr.materialIndex] || list[0]);
    }
  });
  if (!geos.length) throw new Error('No meshes in ' + name);
  let geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, true);
  if (geos.length === 1) geo.addGroup(0, geo.index.count, 0);
  geo.rotateY(yaw);
  geo.computeBoundingBox();
  const b = geo.boundingBox, sz = b.getSize(new THREE.Vector3());
  const s = height ? height / sz.y : size ? size / Math.max(sz.x, sz.y, sz.z) : 1;
  geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  geo.scale(s, s, s);
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  const materials = mats.map(m => { const c = m.clone(); if (tint) c.color.multiply(new THREE.Color(tint)); return c; });
  const dim = geo.boundingBox.getSize(new THREE.Vector3());
  return { name, geometry: geo, materials, height: dim.y, radius: Math.max(dim.x, dim.z) / 2 };
}
export function templateMesh(t) {
  const m = new THREE.Mesh(t.geometry, t.materials);
  return m;
}

// Skinned character for the hero and bosses: the real skeleton, posed procedurally (the exports carry no animations).
export async function loadCharacter(name, height) {
  const src = await loadModel(name);
  const { clone } = await import('three/addons/utils/SkeletonUtils.js');
  const obj = clone(src);
  const holder = new THREE.Group();
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj), sz = box.getSize(new THREE.Vector3());
  const s = height / sz.y;
  obj.scale.multiplyScalar(s);
  obj.position.set(-(box.min.x + box.max.x) / 2 * s, -box.min.y * s, -(box.min.z + box.max.z) / 2 * s);
  holder.add(obj);
  const bones = {};
  obj.traverse(o => { if (o.isBone) bones[o.name.toLowerCase()] = o; if (o.isMesh) o.frustumCulled = false; });
  for (const b of Object.values(bones)) b.userData.rest = b.quaternion.clone();
  return { root: holder, inner: obj, bones, height };
}
const _q = new THREE.Quaternion(), _ax = new THREE.Vector3();
// Rotates a bone away from its rest pose about one of its local axes.
export function poseBone(b, axis, angle) {
  if (!b) return;
  _ax.set(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
  b.quaternion.copy(b.userData.rest).multiply(_q.setFromAxisAngle(_ax, angle));
}
export function findBone(bones, ...names) {
  for (const n of names) { if (bones[n]) return bones[n]; }
  for (const n of names) { const k = Object.keys(bones).find(k => k.includes(n)); if (k) return bones[k]; }
  return null;
}
