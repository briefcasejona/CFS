# HD model sources

Candidate 3D models for every aircraft that has no HD model yet. All are
downloadable Sketchfab models whose licence allows reuse. Licences were read
from the Sketchfab API listing; re-check the licence on the model page when
downloading, and add a row to the matching `assets/models/<licence>/LICENSE.md`.

Sketchfab is blocked from the build environment, so the GLBs have to be
downloaded by hand (or `sketchfab.com` allowed in the environment's network
settings).

Licence notes:

- **CC BY-NC-SA** matches the bohmerang models already shipped (F-14A/B, F-16C,
  F/A-18F, F-4E, Gripen). Non-commercial only, derivatives share-alike.
- **CC BY** allows commercial use with credit.
- Avoid **CC BY-ND** (we cut and bake meshes, which is a derivative) and any
  model titled as a War Thunder / DCS / "Strike Fighters" rip.

| Aircraft (id) | Model | Author | Licence | Link |
|---|---|---|---|---|
| F-14B(U) (`f14b`) | grumman_f-14b_tomcat.glb (supplied by Jonathan) | ? | needs source + licence | — |
| F-16D Block 70 (`f16d70`) | F-16D Block 70.glb (supplied by Jonathan) | ? | needs source + licence | — |
| F-16D / D Blk 40 (`f16d`, `f16d40`) | General Dynamics F-16D Block 60 | MirzaArrafiERV_45 | CC BY | https://sketchfab.com/3d-models/ea8edb08d79e4eafa9c794c581f88cf3 |
| F-16A/C Blk 40 (`f16a`, `f16c40`) | reuse the F-16C model (bohmerang) | bohmerang | CC BY-NC-SA | already shipped |
| F-16B (`f16b`) | reuse the F-16D model above | | | |
| F-15C/D (`f15c`, `f15d`) | F-15 Eagle (72k faces) | dashdu | CC BY | https://sketchfab.com/3d-models/f874bffa8e314743b4a7cb9ad4b9f3a8 |
| F-15E (`f15e`) | F-15E Strike Eagle | bohmerang | CC BY-NC-SA | https://sketchfab.com/3d-models/fff7d75490474e9b964d90cc031c8d01 |
| F/A-18C (`fa18c`) | F/A-18C Hornet | Rhine_Lab_Muelsyse | CC BY | https://sketchfab.com/3d-models/c68c8417c8e84864b2a5e0c35c178fd9 |
| MiG-29A (`mig29a`) | MiG-29 | bohmerang | CC BY-NC-SA | https://sketchfab.com/3d-models/0a21787096244220b246ec8747e7b09c |
| Su-27 (`su27`) | Sukhoi Su-27 Flanker | andertan | CC BY | https://sketchfab.com/3d-models/2541c1dbc6c1499cb7b38b5bf1314750 |
| Su-30 (`su30`) | Su-30 Flanker C | andertan | CC BY | https://sketchfab.com/3d-models/92ca062c90fd45ffb6ce8144dc46004a |
| Su-57 (`su57`) | Su-57 Felon | bohmerang | CC BY-NC-SA | https://sketchfab.com/3d-models/59995d6f34ba4bb7990195be3a745fc5 |
| Mirage 2000 (`m2000`) | Mirage 2000 | bohmerang | CC BY-NC-SA | https://sketchfab.com/3d-models/aca93654c4684c5282e723c5b2999f67 |
| Rafale (`rafale`) | Rafale M | bohmerang | CC BY-NC-SA | https://sketchfab.com/3d-models/0abf2465adb04bc8bc638688fa54ce21 |
| Typhoon (`ef2000`) | Eurofighter Typhoon | bohmerang | CC BY-NC-SA | https://sketchfab.com/3d-models/992bcc8987964ca09d55410330aa8579 |
| T-38C (`t38c`) | Northrop T-38 Talon | helijah | CC BY | https://sketchfab.com/3d-models/d5d22b4b37944f0e9bb1e77ede028f2f |
| AV-8B (`av8b`) | AV-8B Harrier II | 42manako | CC BY (provenance doubtful, check before use) | https://sketchfab.com/3d-models/8482e199f18b44f3bede5a5806aa1cb1 |
| E-3 (`e3`) | Boeing E-3 Sentry | Spark_Customs | CC BY | https://sketchfab.com/3d-models/07da76ab07db4f708c217a4589d4cee2 |
| KC-135R (`kc135`) | KC-135R Stratotanker | MirzaArrafiERV_45 | CC BY | https://sketchfab.com/3d-models/86f1e11310e546db9bf323fa1a62f069 |

Also found: an F-16E/F (andertan, CC BY,
https://sketchfab.com/3d-models/d54c72e055a647ad9173e01548e50db3), which is not
in the game yet.

To wire a new model in: drop the GLB into `assets/models/<licence>/`, add an
`HdSpec` keyed by the aircraft id in `src/render/hdModels.ts` (gear/cockpit
name patterns, `hudGlass`, eye point), and add a test like the F-14 one in
`tests/render.test.ts`.
