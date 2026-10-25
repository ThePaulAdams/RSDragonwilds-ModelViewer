// Dragonwilds Survivors: particles, hitsplats, telegraphs and synthesised sound.
import { THREE, scene, camera, $ } from './core.js';

// ---------------------------------------------------------------------------
// Particles: one additive point cloud, CPU simulated.
// ---------------------------------------------------------------------------
const MAXP = 4000;
const pPos = new Float32Array(MAXP * 3), pCol = new Float32Array(MAXP * 3), pSize = new Float32Array(MAXP);
const pVel = new Float32Array(MAXP * 3), pLife = new Float32Array(MAXP), pMax = new Float32Array(MAXP), pGrav = new Float32Array(MAXP), pBase = new Float32Array(MAXP);
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3).setUsage(THREE.DynamicDrawUsage));
pGeo.setAttribute('size', new THREE.BufferAttribute(pSize, 1).setUsage(THREE.DynamicDrawUsage));
const pMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
  uniforms: { scale: { value: innerHeight / 2 } },
  vertexShader: `attribute float size; varying vec3 vC; void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*400.0/-mv.z; gl_Position=projectionMatrix*mv; }`,
  fragmentShader: `varying vec3 vC; void main(){ vec2 d=gl_PointCoord-0.5; float a=smoothstep(0.5,0.0,length(d)); if(a<0.01) discard; gl_FragColor=vec4(vC*a,a); }`
});
const points = new THREE.Points(pGeo, pMat); points.frustumCulled = false; scene.add(points);
let pNext = 0;
const _c = new THREE.Color();
export function emit(x, y, z, { n = 10, color = 0xffffff, speed = 4, life = 0.6, size = 0.35, up = 2, grav = -6, spread = 1, dir = null } = {}) {
  _c.set(color);
  for (let i = 0; i < n; i++) {
    const k = pNext; pNext = (pNext + 1) % MAXP;
    pPos[k * 3] = x + (Math.random() - 0.5) * 0.3 * spread; pPos[k * 3 + 1] = y; pPos[k * 3 + 2] = z + (Math.random() - 0.5) * 0.3 * spread;
    let vx = (Math.random() - 0.5) * 2, vy = Math.random() * up / Math.max(speed, 0.01), vz = (Math.random() - 0.5) * 2;
    if (dir) { vx = dir.x + (Math.random() - 0.5) * spread; vz = dir.z + (Math.random() - 0.5) * spread; vy = (dir.y || 0) + Math.random() * 0.3; }
    pVel[k * 3] = vx * speed; pVel[k * 3 + 1] = vy * speed; pVel[k * 3 + 2] = vz * speed;
    const v = 0.75 + Math.random() * 0.25;
    pCol[k * 3] = _c.r * v; pCol[k * 3 + 1] = _c.g * v; pCol[k * 3 + 2] = _c.b * v;
    pLife[k] = pMax[k] = life * (0.6 + Math.random() * 0.6); pBase[k] = size * (0.6 + Math.random() * 0.8); pGrav[k] = grav;
  }
}
export function updateParticles(dt) {
  for (let k = 0; k < MAXP; k++) {
    if (pLife[k] <= 0) { pSize[k] = 0; continue; }
    pLife[k] -= dt;
    pVel[k * 3 + 1] += pGrav[k] * dt;
    pPos[k * 3] += pVel[k * 3] * dt; pPos[k * 3 + 1] += pVel[k * 3 + 1] * dt; pPos[k * 3 + 2] += pVel[k * 3 + 2] * dt;
    pSize[k] = pBase[k] * Math.max(0, pLife[k] / pMax[k]);
  }
  pGeo.attributes.position.needsUpdate = pGeo.attributes.color.needsUpdate = pGeo.attributes.size.needsUpdate = true;
}
export function clearParticles() { pLife.fill(0); }

// ---------------------------------------------------------------------------
// Transient meshes (slash arcs, rings, lightning, ice): fade out and remove.
// ---------------------------------------------------------------------------
const transients = [];
export function transient(mesh, life, update) { mesh.userData.life = mesh.userData.max = life; mesh.userData.update = update; scene.add(mesh); transients.push(mesh); return mesh; }
export function updateTransients(dt) {
  for (let i = transients.length - 1; i >= 0; i--) {
    const m = transients[i]; m.userData.life -= dt;
    const k = Math.max(0, m.userData.life / m.userData.max);
    m.userData.update?.(m, k, dt);
    if (m.userData.life <= 0) { scene.remove(m); m.geometry?.dispose?.(); transients.splice(i, 1); }
  }
}
export function clearTransients() { for (const m of transients) scene.remove(m); transients.length = 0; }

export function ringMesh(r0, r1, color, opacity = 0.6, segs = 48, theta = Math.PI * 2, start = 0) {
  const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, segs, 1, start, theta),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  m.rotation.x = -Math.PI / 2; return m;
}
// A red danger telegraph on the ground that fills up, then calls back.
export function telegraph(x, y, z, r, time, onDone, { theta = Math.PI * 2, start = 0, color = 0xff2020 } = {}) {
  const outer = ringMesh(r * 0.96, r, color, 0.9, 64, theta, start);
  const fill = ringMesh(0, r, color, 0.18, 64, theta, start);
  outer.position.set(x, y + 0.08, z); fill.position.set(x, y + 0.06, z);
  transient(outer, time, (m, k) => { m.material.opacity = 0.5 + 0.4 * Math.sin(k * 30); });
  transient(fill, time, (m, k) => { m.scale.setScalar(1 - k + 0.02); m.material.opacity = 0.15 + (1 - k) * 0.25; if (k <= 0.001 && !m.userData.fired) { m.userData.fired = 1; onDone(); } });
  return { outer, fill };
}

// ---------------------------------------------------------------------------
// RuneScape-style hitsplats (DOM, pooled).
// ---------------------------------------------------------------------------
const splatRoot = $('hitsplats'), splats = [], _v = new THREE.Vector3();
for (let i = 0; i < 48; i++) { const d = document.createElement('div'); d.style.display = 'none'; splatRoot.appendChild(d); splats.push({ el: d, t: 0, pos: new THREE.Vector3() }); }
let splatNext = 0;
export function hitsplat(pos, text, kind = 'dmg') {
  const s = splats[splatNext]; splatNext = (splatNext + 1) % splats.length;
  s.el.className = 'hitsplat ' + kind; s.el.textContent = text; s.el.style.display = 'block';
  s.el.style.animation = 'none'; void s.el.offsetWidth; s.el.style.animation = '';
  s.pos.copy(pos); s.pos.x += (Math.random() - 0.5) * 0.6; s.t = 0.8;
}
export function updateHitsplats(dt) {
  for (const s of splats) {
    if (s.t <= 0) continue;
    s.t -= dt;
    if (s.t <= 0) { s.el.style.display = 'none'; continue; }
    _v.copy(s.pos).project(camera);
    if (_v.z > 1) { s.el.style.display = 'none'; continue; }
    s.el.style.left = ((_v.x + 1) / 2 * innerWidth) + 'px'; s.el.style.top = ((1 - _v.y) / 2 * innerHeight) + 'px';
  }
}
export function clearHitsplats() { for (const s of splats) { s.t = 0; s.el.style.display = 'none'; } }

// ---------------------------------------------------------------------------
// Sound: tiny WebAudio synth, fully safeguarded against audio/note exceptions
// ---------------------------------------------------------------------------
let ac = null, master = null, lastPlay = {};
export const sound = { on: localStorage.getItem('dws-sound') !== 'off' };
function ctx() {
  try {
    if (!ac) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      ac = new AudioCtx();
      master = ac.createGain();
      master.gain.value = 0.35;
      master.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  } catch {
    return null;
  }
}
function tone(freq, dur, { type = 'square', vol = 0.2, slide = 0, delay = 0, noise = false } = {}) {
  try {
    const a = ctx();
    if (!a || !master) return;
    const safeFreq = Math.max(20, Math.min(10000, Number(freq) || 440));
    const safeDur = Math.max(0.02, Math.min(5, Number(dur) || 0.1));
    const safeVol = Math.max(0.001, Math.min(1, Number(vol) || 0.2));
    const safeDelay = Math.max(0, Number(delay) || 0);
    const t = a.currentTime + safeDelay;
    const g = a.createGain();
    g.gain.setValueAtTime(safeVol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + safeDur);
    let src;
    if (noise) {
      const b = a.createBuffer(1, Math.floor(a.sampleRate * safeDur), a.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      src = a.createBufferSource();
      src.buffer = b;
      const f = a.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = safeFreq;
      src.connect(f);
      f.connect(g);
    } else {
      src = a.createOscillator();
      src.type = type;
      src.frequency.setValueAtTime(safeFreq, t);
      if (slide) {
        const targetFreq = Math.max(20, safeFreq + slide);
        src.frequency.exponentialRampToValueAtTime(targetFreq, t + safeDur);
      }
      src.connect(g);
    }
    g.connect(master);
    src.start(t);
    src.stop(t + safeDur + 0.05);
  } catch (err) {
    // Silent catch for audio policy / device errors
  }
}
const SFX = {
  hit: () => tone(180 + Math.random() * 60, 0.06, { type: 'square', vol: 0.05, slide: -80 }),
  slash: () => tone(1800, 0.12, { noise: true, vol: 0.12 }),
  bolt: () => tone(900, 0.08, { type: 'triangle', vol: 0.06, slide: -500 }),
  ice: () => { tone(2400, 0.25, { noise: true, vol: 0.1 }); tone(1200, 0.2, { type: 'sine', vol: 0.06, slide: 600 }); },
  boom: () => { tone(500, 0.35, { noise: true, vol: 0.22 }); tone(90, 0.3, { type: 'sine', vol: 0.2, slide: -50 }); },
  zap: () => { tone(3000, 0.15, { noise: true, vol: 0.12 }); tone(220, 0.15, { type: 'sawtooth', vol: 0.06, slide: -150 }); },
  fire: () => tone(700, 0.25, { noise: true, vol: 0.06 }),
  pickup: () => tone(880 + Math.random() * 200, 0.05, { type: 'sine', vol: 0.04, slide: 300 }),
  coin: () => { tone(1320, 0.06, { type: 'square', vol: 0.05 }); tone(1760, 0.1, { type: 'square', vol: 0.05, delay: 0.06 }); },
  hurt: () => tone(140, 0.18, { type: 'sawtooth', vol: 0.14, slide: -60 }),
  level: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, { type: 'triangle', vol: 0.12, delay: i * 0.08 })),
  chest: () => [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.2, { type: 'triangle', vol: 0.1, delay: i * 0.07 })),
  boss: () => { tone(80, 1.2, { type: 'sawtooth', vol: 0.18, slide: -30 }); tone(120, 1.2, { type: 'sawtooth', vol: 0.12, slide: -40, delay: 0.3 }); },
  roar: () => { tone(300, 0.9, { noise: true, vol: 0.25 }); tone(70, 0.9, { type: 'sawtooth', vol: 0.15, slide: -30 }); },
  die: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.12, delay: i * 0.18 })),
  win: () => [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, 0.25, { type: 'triangle', vol: 0.12, delay: i * 0.12 })),
  dash: () => tone(600, 0.15, { noise: true, vol: 0.08 }),
  heal: () => [660, 880].forEach((f, i) => tone(f, 0.12, { type: 'sine', vol: 0.08, delay: i * 0.07 })),
};
export function sfx(name, minGap = 0.04) {
  if (!sound.on) return;
  const now = performance.now() / 1000;
  if (lastPlay[name] && now - lastPlay[name] < minGap) return;
  lastPlay[name] = now;
  try { SFX[name]?.(); } catch { }
}
export function unlockAudio() { try { ctx(); } catch { } }

// Ambient wind drone while playing.
let drone = null;
export function ambience(on) {
  if (!sound.on) on = false;
  try {
    if (on && !drone) {
      const a = ctx(), b = a.createBuffer(1, a.sampleRate * 4, a.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const s = a.createBufferSource(); s.buffer = b; s.loop = true;
      const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 400; f.Q.value = 0.6;
      const g = a.createGain(); g.gain.value = 0.05;
      s.connect(f); f.connect(g); g.connect(master); s.start();
      drone = { s, g };
    } else if (!on && drone) { drone.s.stop(); drone = null; }
  } catch { }
}
