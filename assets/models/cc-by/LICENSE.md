# Third-party models — CC BY 4.0

These files are **not** covered by the CFS code licence. They are adaptations of:

| File | Original | Author | Licence |
|---|---|---|---|
| f14d.glb | "Grumman F-14D \"Super Tomcat\"" https://sketchfab.com/3d-models/grumman-f-14d-super-tomcat-74be89a104a34caabacb25a705708097 | KOG_THORNS (https://sketchfab.com/ioai25312) | CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/ |
| f16d70.glb | "General Dynamics F-16D Block 60" https://sketchfab.com/3d-models/general-dynamics-f-16d-block-60-ea8edb08d79e4eafa9c794c581f88cf3 | Muhamad Mirza Arrafi, MirzaArrafiERV_45 (https://sketchfab.com/MirzaArrafiERV_45) | CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/ |
| aim120.glb | "Game Ready Low Poly Aim-120" https://sketchfab.com/3d-models/game-ready-low-poly-aim-120-81b5a823252f49e7846efb5cd81f1725 | Mustafa Garip (https://sketchfab.com/Mustafa.Garip) | CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/ |
| aim54.glb | "AIM-54 Phoenix (Low Poly)" https://sketchfab.com/3d-models/aim-54-phoenix-low-poly-0f93756f393d498f95c4364244f8bda0 | Mustafa Garip (https://sketchfab.com/MustafaGarip) | CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/ |
| scenery-eu.glb | "European Buildings Asset Pack 1" https://sketchfab.com/3d-models/european-buildings-asset-pack-1-b35bb99dac624919b40fb3fdf59b438a | EddyNL (https://sketchfab.com/EddyNL) | CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/ |
| scenery-eu.glb | "Buildings" https://sketchfab.com/3d-models/buildings-53fdd165f327434e9a88873253f710a5 | Elbolillo (https://sketchfab.com/Elbolilloduro) | CC BY 4.0 |
| scenery-eu.glb | "Detailed 12 storey panel apartment building" https://sketchfab.com/3d-models/detailed-12-storey-panel-apartment-building-cb7064bec48845fea62a830b2c692fb1 | bean(alwayshasbean) (https://sketchfab.com/alwayshasbean) | CC BY 4.0 |
| scenery-eu.glb | "Low Poly Forest Tree Pack" https://sketchfab.com/3d-models/low-poly-forest-tree-pack-5ff5a51e74324845a4e4905f182dfb2b | 99.Miles (https://sketchfab.com/99.Miles) | CC BY 4.0 |

f14d.glb — changes made for CFS: textures downscaled and re-encoded as JPEG (scripts/models/optimize-glb.mjs); geometry welded,
landing gear / small external detail simplified and vertex attributes quantized (scripts/models/reduce-glb.mjs). The
wing parts are swept in the game about a pivot fitted to the published F-14 spans. Used for the F-14D only (the F-14A and F-14B use bohmerang's F-14A model, see ../cc-by-nc-sa/LICENSE.md).

f16d70.glb — changes made for CFS: textures downscaled to 1024 px and re-encoded as JPEG
(scripts/models/optimize-glb.mjs). In the game the gear doors are cut out of the lower fuselage mesh so they retract
with the gear. Used for the F-16D Block 70 only. The Sketchfab page tags the model "createdwithai".

scenery-eu.glb — changes made for CFS (scripts/models/bake-scenery.mjs, then scripts/models/optimize-glb.mjs): the four
packs were split into separate buildings and trees, recentred, merged per material (untextured materials turned into
vertex colours), the 12-storey building reduced to its LOD1, the rocks, bushes and LOD0 left out, normal/occlusion/
metal-roughness maps removed and colour textures downscaled to 512 px. Supplied by Jonathan (2026-10-14).

aim120.glb, aim54.glb — the files are unchanged. In the game each is turned so its nose points forward, centred and scaled to
the real missile's length (3.66 m and 3.96 m), and hung on the AIM-120C and AIM-54C stations. Supplied by Jonathan (2026-10-15).
