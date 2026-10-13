# Third-party aircraft models — CC BY 4.0

These files are **not** covered by the CFS code licence. They are adaptations of:

| File | Original | Author | Licence |
|---|---|---|---|
| f14d.glb | "Grumman F-14D \"Super Tomcat\"" https://sketchfab.com/3d-models/grumman-f-14d-super-tomcat-74be89a104a34caabacb25a705708097 | KOG_THORNS (https://sketchfab.com/ioai25312) | CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/ |
| f16d70.glb | "General Dynamics F-16D Block 60" https://sketchfab.com/3d-models/general-dynamics-f-16d-block-60-ea8edb08d79e4eafa9c794c581f88cf3 | Muhamad Mirza Arrafi, MirzaArrafiERV_45 (https://sketchfab.com/MirzaArrafiERV_45) | CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/ |

f14d.glb — changes made for CFS: textures downscaled and re-encoded as JPEG (scripts/models/optimize-glb.mjs); geometry welded,
landing gear / small external detail simplified and vertex attributes quantized (scripts/models/reduce-glb.mjs). The
wing parts are swept in the game about a pivot fitted to the published F-14 spans. Used for the F-14D only (the F-14A and F-14B use bohmerang's F-14A model, see ../cc-by-nc-sa/LICENSE.md).

f16d70.glb — changes made for CFS: textures downscaled to 1024 px and re-encoded as JPEG
(scripts/models/optimize-glb.mjs). In the game the gear doors are cut out of the lower fuselage mesh so they retract
with the gear. Used for the F-16D Block 70 only. The Sketchfab page tags the model "createdwithai".
