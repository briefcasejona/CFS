# F-16 cockpit model

`cockpit.glb` is the F-16 cockpit made by the CFS playtester, supplied by the project owner (2026-11-19). It is loaded only in cockpit view and
placed so its MFDs sit where the exterior model's MFDs are (`src/f16/cockpit/view.ts`).

Its node names say what each control is and how it moves; the game reads them (`src/f16/cockpit/controls.ts`):

* `_S<n>`: a switch with n positions
* `_K<n>`: a knob with n detents
* `_B`: a button (`ICP_B3` is ICP button 3)
* `_AX`: an axis, bound to a joystick axis or turned with the mouse wheel

Spring-loaded: the ICP INC/DEC rocker, the ICP dobber (four ways, back to centre), MANUAL PITCH, WARN RESET (down)
and PROBE HEAT (down).
