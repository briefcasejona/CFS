// Dev tool: print per-node bounds/attributes of a GLB in world space and ASCII top/front views of the airframe.
// Usage: node scripts/models/inspect-glb.mjs <file.glb>
import { NodeIO } from '@gltf-transform/core';
const io = new NodeIO(); const doc = await io.read(process.argv[2]);
const mul=(m,p)=>[m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12], m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13], m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]];
const all=[];
for (const node of doc.getRoot().listNodes()) { const mesh=node.getMesh(); if(!mesh) continue; const M=node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) { const pos=prim.getAttribute('POSITION'); const n=pos.getCount(); let mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9]; const el=[0,0,0];
    for(let i=0;i<n;i++){const w=mul(M,pos.getElement(i,el)); for(let k=0;k<3;k++){mn[k]=Math.min(mn[k],w[k]);mx[k]=Math.max(mx[k],w[k]);} if((node.getName()+(node.getParentNode()?.getName()??'')).includes('airframe')&&prim.getMaterial()?.getName().includes('airframe')&&n>20000) all.push(w);}
    console.log(node.getName(), 'attrs', prim.listSemantics().join(','), 'n',n, 'min',mn.map(v=>v.toFixed(1)).join(' '),'max',mx.map(v=>v.toFixed(1)).join(' '), 'mat', prim.getMaterial()?.getName()); } }
// top view occupancy of airframe: X (span? ) vs fore-aft. print grid of axis0 vs axis2 and axis0 vs axis1
const grid=(a,b,W=70,H=40)=>{let mna=1e9,mxa=-1e9,mnb=1e9,mxb=-1e9;for(const p of all){mna=Math.min(mna,p[a]);mxa=Math.max(mxa,p[a]);mnb=Math.min(mnb,p[b]);mxb=Math.max(mxb,p[b]);}
 const g=Array.from({length:H},()=>Array(W).fill(' '));for(const p of all){const x=Math.floor((p[a]-mna)/(mxa-mna+1e-9)*(W-1));const y=Math.floor((p[b]-mnb)/(mxb-mnb+1e-9)*(H-1));g[y][x]='#';}
 console.log(`axis${a} [${mna.toFixed(1)},${mxa.toFixed(1)}] → right; axis${b} [${mnb.toFixed(1)},${mxb.toFixed(1)}] → down`);console.log(g.map(r=>r.join('')).join('\n'));};
grid(0,2); grid(0,1,70,16);
