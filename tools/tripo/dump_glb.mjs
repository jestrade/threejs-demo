// Usage: node dump_glb.mjs <tripo.glb> <outdir>
// Decodes the meshopt-compressed Tripo export into raw arrays (pos/nrm/uv .f32, idx .u32)
// and its embedded textures, for crop_tripo.py.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import fs from 'fs';

const [src, out] = process.argv.slice(2);
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(src);
await doc.transform(dequantize());
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
fs.mkdirSync(out, { recursive: true });
const save = (name, arr) => fs.writeFileSync(`${out}/${name}`, Buffer.from(arr.buffer));
save('pos.f32', Float32Array.from(prim.getAttribute('POSITION').getArray()));
save('nrm.f32', Float32Array.from(prim.getAttribute('NORMAL').getArray()));
save('uv.f32', Float32Array.from(prim.getAttribute('TEXCOORD_0').getArray()));
save('idx.u32', Uint32Array.from(prim.getIndices().getArray()));
const mat = prim.getMaterial();
for (const [name, tex] of [['color', mat.getBaseColorTexture()], ['orm', mat.getMetallicRoughnessTexture()], ['normal', mat.getNormalTexture()]]) {
  fs.writeFileSync(`${out}/${name}.${tex.getMimeType().split('/')[1].replace('jpeg', 'jpg')}`, tex.getImage());
}
console.log('vertices', prim.getAttribute('POSITION').getCount(), 'triangles', prim.getIndices().getCount() / 3);
