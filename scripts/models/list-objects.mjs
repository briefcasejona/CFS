// Dev tool: list the objects of a model pack (children of the first node with several), with size, centre, triangles.
// Usage: node scripts/models/list-objects.mjs <file.glb>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS); const doc = await io.read(process.argv[2]);
const mul=(m,p)=>[m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12], m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13], m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]];
// descend while a node has a single child
let root = doc.getRoot().listScenes()[0].listChildren()[0];
while (root.listChildren().length === 1 && !root.getMesh()) root = root.listChildren()[0];
const kids = root.listChildren();
console.log('root', root.getName(), 'children', kids.length);
for (const k of kids) {
  let mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9], tris=0; const mats=new Set();
  k.traverse((n)=>{const mesh=n.getMesh(); if(!mesh) return; const M=n.getWorldMatrix();
    for(const p of mesh.listPrimitives()){const pos=p.getAttribute('POSITION'); const el=[0,0,0]; mats.add(p.getMaterial()?.getName());
      tris += (p.getIndices()?.getCount() ?? pos.getCount())/3;
      for(let i=0;i<pos.getCount();i+=1){const w=mul(M,pos.getElement(i,el)); for(let q=0;q<3;q++){mn[q]=Math.min(mn[q],w[q]);mx[q]=Math.max(mx[q],w[q]);}}}});
  console.log(k.getName().padEnd(40), 'size', mx.map((v,i)=>(v-mn[i]).toFixed(1)).join(' x '), 'at', mn.map((v,i)=>((v+mx[i])/2).toFixed(1)).join(','), 'tris', tris, 'mats', [...mats].slice(0,4).join('|'));
}
