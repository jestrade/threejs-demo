// Usage: node build_glb.mjs <dumpdir> <out.glb> [ratio]   (after crop_tripo.py and textures_tripo.py)
// Simplifies the cropped dog (meshoptimizer), embeds the WebP textures and writes a
// meshopt-compressed GLB (EXT_meshopt_compression + KHR_mesh_quantization + EXT_texture_webp).
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization } from '@gltf-transform/extensions';
import { weld, simplify, reorder, quantize } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import fs from 'fs';

const [dir, out, ratio = '0.25'] = process.argv.slice(2);
const read = (name, T) => { const b = fs.readFileSync(`${dir}/${name}`); return new T(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const pos = read('dog_pos.f32', Float32Array), nrm = read('dog_nrm.f32', Float32Array), uv = read('uv.f32', Float32Array);
const faces = read('dog_idx.u32', Uint32Array);

// compact to the vertices the cropped faces use
const remap = new Int32Array(pos.length / 3).fill(-1);
let n = 0;
for (const i of faces) if (remap[i] < 0) remap[i] = n++;
const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2);
remap.forEach((j, i) => {
  if (j < 0) return;
  P.set(pos.subarray(i * 3, i * 3 + 3), j * 3);
  N.set(nrm.subarray(i * 3, i * 3 + 3), j * 3);
  U.set(uv.subarray(i * 2, i * 2 + 2), j * 2);
});

const doc = new Document();
const buffer = doc.createBuffer();
const accessor = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
const texture = (name) => doc.createTexture(name).setImage(fs.readFileSync(`${dir}/tex_${name}.webp`)).setMimeType('image/webp');
const material = doc.createMaterial('shorkie')
  .setBaseColorTexture(texture('color'))
  .setMetallicRoughnessTexture(texture('orm'))
  .setNormalTexture(texture('normal'))
  .setMetallicFactor(0);
const prim = doc.createPrimitive()
  .setAttribute('POSITION', accessor('VEC3', P))
  .setAttribute('NORMAL', accessor('VEC3', N))
  .setAttribute('TEXCOORD_0', accessor('VEC2', U))
  .setIndices(accessor('SCALAR', Uint32Array.from(faces, (i) => remap[i])))
  .setMaterial(material);
const scene = doc.createScene();
doc.getRoot().setDefaultScene(scene);
scene.addChild(doc.createNode('shorkie').setMesh(doc.createMesh('shorkie').addPrimitive(prim)));

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
await doc.transform(
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: parseFloat(ratio), error: 0.002 }),
  reorder({ encoder: MeshoptEncoder }),
  quantize()
);
doc.createExtension(EXTTextureWebP).setRequired(true);
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization, EXTTextureWebP])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
  .write(out, doc);
const p = doc.getRoot().listMeshes()[0].listPrimitives()[0];
console.log('vertices', p.getAttribute('POSITION').getCount(), 'triangles', p.getIndices().getCount() / 3, 'bytes', fs.statSync(out).size);
