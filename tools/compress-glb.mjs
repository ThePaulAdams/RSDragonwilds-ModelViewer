// Shrinks the .glb files in the web copy in place: drops vertex data the viewer never uses
// (extra UV sets, vertex colours, tangents), then quantizes and meshopt-compresses the rest.
// Already-compressed files are skipped, so re-running only touches new models.
//   node tools/compress-glb.mjs <web dir>
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { NodeIO, Logger, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { prune, dedup, quantize, reorder } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const root = process.argv[2];
if (!root) { console.log('Usage: node tools/compress-glb.mjs <web dir>'); process.exit(1); }
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

async function* glbs(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'thumbs') yield* glbs(p); }
    else if (e.name.toLowerCase().endsWith('.glb')) yield p;
  }
}

const KEEP = new Set(['POSITION', 'NORMAL', 'TEXCOORD_0']);
let done = 0, skipped = 0, failed = 0, before = 0, after = 0;
for await (const file of glbs(root)) {
  try {
    const size = (await stat(file)).size;
    const doc = await io.read(file);
    doc.setLogger(new Logger(Logger.Verbosity.WARN));
    if (doc.getRoot().listExtensionsUsed().some(x => x.extensionName === 'EXT_meshopt_compression')) { skipped++; continue; }
    for (const mesh of doc.getRoot().listMeshes())
      for (const prim of mesh.listPrimitives())
        for (const sem of prim.listSemantics()) if (!KEEP.has(sem)) prim.setAttribute(sem, null);
    await doc.transform(prune({ keepAttributes: true }),
      // Materials must keep their names: the viewer matches them to models.json.
      dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH] }), reorder({ encoder: MeshoptEncoder }),
      // Texture coordinates stay exact: quantizing them needs a texture transform in the .glb, but the viewer
      // applies textures from models.json, so that correction would be lost.
      quantize({ pattern: /^(POSITION|NORMAL)$/ }));
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
    await io.write(file, doc);
    before += size; after += (await stat(file)).size; done++;
    if (done % 250 === 0) console.log(`  ${done} compressed, ${(before / 1048576).toFixed(0)} MB -> ${(after / 1048576).toFixed(0)} MB`);
  } catch (e) {
    if (++failed <= 5) console.log(`  failed: ${file}: ${e.message}`);
  }
}
console.log(`Compressed ${done} model(s) (${(before / 1048576).toFixed(0)} MB -> ${(after / 1048576).toFixed(0)} MB), ${skipped} already done, ${failed} failed.`);
