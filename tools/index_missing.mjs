import fs from 'fs';
import path from 'path';

// 1. Map all material jsons and textures in export/
console.log('Scanning materials and textures in export/...');
const jsonMap = new Map(); // lowercase basename -> rel path
const pngMap = new Map();  // lowercase basename -> rel path

function walkDir(dir) {
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (item !== 'thumbs' && item !== 'world') walkDir(full);
    } else if (item.endsWith('.json') && item !== 'models.json' && item !== 'pieces.json') {
      const rel = path.relative('export', full).split(path.sep).join('/');
      jsonMap.set(path.basename(item, '.json').toLowerCase(), rel);
    } else if (item.endsWith('.png')) {
      const rel = path.relative('export', full).split(path.sep).join('/');
      pngMap.set(path.basename(item, '.png').toLowerCase(), rel);
    }
  }
}
walkDir('export');
console.log(`Indexed ${jsonMap.size} material JSONs and ${pngMap.size} texture PNGs.`);

function resolveMaterial(matName) {
  if (!matName) return { Name: 'None', BaseColor: null, Normal: null, Color: null };
  const jsonRel = jsonMap.get(matName.toLowerCase());
  if (!jsonRel) return { Name: matName, BaseColor: null, Normal: null, Color: null };
  try {
    const data = JSON.parse(fs.readFileSync(path.join('export', jsonRel), 'utf8'));
    let baseColor = null, normal = null, color = null, masked = null;
    const textures = data.Textures || {};
    for (const [k, v] of Object.entries(textures)) {
      if (typeof v !== 'string') continue;
      const baseName = v.split('/').pop().split('.')[0].toLowerCase();
      const pngRel = pngMap.get(baseName);
      if (!pngRel) continue;
      if (!baseColor && /diffuse|basecolor|albedo/i.test(k)) baseColor = pngRel;
      if (!normal && /normal/i.test(k)) normal = pngRel;
    }
    if (data.Parameters?.Colors) {
      for (const [k, c] of Object.entries(data.Parameters.Colors)) {
        if (c?.Hex && /base|color/i.test(k)) { color = c.Hex; break; }
      }
    }
    if (data.Parameters?.BlendMode === 1) masked = true;
    return { Name: matName, BaseColor: baseColor, Normal: normal, Color: color, Masked: masked };
  } catch {
    return { Name: matName, BaseColor: null, Normal: null, Color: null };
  }
}

// 2. Scan all .glb files in export/
function getGlbs(dir) {
  let res = [];
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (item !== 'thumbs' && item !== 'world') res = res.concat(getGlbs(full));
    } else if (item.endsWith('.glb')) {
      res.push(full);
    }
  }
  return res;
}

const allGlbPaths = getGlbs('export').map(p => path.relative('export', p).split(path.sep).join('/'));
console.log(`Found ${allGlbPaths.length} total .glb files in export/.`);

const manifestPath = path.join('export', 'models.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const existingFiles = new Set(manifest.Models.map(m => m.File.split(path.sep).join('/').toLowerCase()));

const missingGlbs = allGlbPaths.filter(f => !existingFiles.has(f.toLowerCase()));
console.log(`Missing models to add: ${missingGlbs.length}`);

const newEntries = [];
for (const rel of missingGlbs) {
  const fullPath = path.join('export', rel);
  const size = fs.statSync(fullPath).size;
  const name = path.basename(rel, '.glb');
  
  // Read glTF JSON chunk for material names
  let materials = [];
  try {
    const buf = fs.readFileSync(fullPath);
    const jsonLen = buf.readUInt32LE(12);
    const gltf = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
    materials = (gltf.materials || []).map(m => resolveMaterial(m.name));
  } catch {}

  // Construct ObjectPath matching Unreal virtual mount path
  // E.g. DowdunReach/Art/Env/Architecture/.../SM_X.glb -> /DowdunReach/Art/Env/Architecture/.../SM_X.SM_X
  const objectPath = '/' + rel.replace(/\.glb$/i, '') + '.' + name;

  newEntries.push({
    ObjectPath: objectPath,
    File: rel,
    Size: size,
    Materials: materials.length ? materials : null
  });
}

// Group by top folder
const byFolder = {};
for (const e of newEntries) {
  const top = e.File.split('/')[0];
  byFolder[top] = (byFolder[top] || 0) + 1;
}
console.log('Added by folder:', byFolder);

manifest.Models.push(...newEntries);
manifest.Models.sort((a, b) => (a.ObjectPath || '').localeCompare(b.ObjectPath || ''));
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
console.log(`Updated models.json! Total models now: ${manifest.Models.length}`);
