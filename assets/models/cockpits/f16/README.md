# F-16 cockpit model (slot)

Put the F-16 cockpit model here as `cockpit.glb` (glTF binary), with a `LICENSE.md` next to it that names the
author, the source and the licence.

It is loaded only in cockpit view. Its placement, eye point and MFD faces are set in
`src/render/cockpitModels.ts` (entry `'F-16'`). Until the file is here the game uses the exterior model's cockpit.
