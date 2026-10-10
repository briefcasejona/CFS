# CFS roadmap — progress & hand-over

This file is the single source of truth for continuing the roadmap across sessions (usage limits can end a
session at any time). Update it and `git commit && git push` after every finished step.

## Heartbeat (lock)
- heartbeat: 2026-10-10T10:56:15+02:00
- owner: interactive session (wishlist session)

Rule: a session that is actively working updates `heartbeat` (local ISO time, `date -Iseconds`) at least every
30 minutes and on every commit. An automatic resume run must exit without changing anything if the heartbeat is
less than 60 minutes old (someone else is working). When taking over, set `owner` to `scheduled resume run`.

## Sources of truth
- Approved plan + council verdict: `C:\Users\haasn\.claude\plans\background-from-the-session-adaptive-reddy.md`
- User decisions (2026-10-10): unsigned Electron .exe + GitHub Pages link; GitHub Pages (public repo briefcasejona/CFS);
  **full Europe map first**; **real nations** as factions (frame scenarios as hypothetical/historical).
- 3D models (user-supplied, folder `3D models/`, git-ignored): see "3D models" below.

## Constraints (do not break)
- Windows Application Control blocks native npm binaries locally (no esbuild/rollup/Vite/Electron/sharp/Playwright locally).
  Local tooling = plain `tsc` + Node scripts. Native things only in GitHub Actions.
- Keep `npm test` green; add tests for every new system. Verify in the browser preview (`.claude/launch.json`:
  `cfs` = dev on :5173, `cfs-site` = built PWA on :5174 — service workers only work on preview-launched servers).
- Use Edit/Write tools for source changes (a GateGuard hook asks for facts before the first edit of each file — answer briefly).
- Commits: author briefcasejona <339529738+briefcasejona@users.noreply.github.com> (already set in repo config). Push to main
  → Pages redeploys. Desktop release: `npm run release` (only at the end of a phase, tests green).
- Never commit `3D models/` raw files. Never use the F/A-18E OBJ (unknown provenance, likely ripped game asset) in the public build.

## Phases
- [x] Phase 0 — baseline verified in browser, quick-tap input fix, git init
- [x] Phase 1 — installable PWA + Electron installer + CI (Pages + Releases), Quick Fight, how-to-fly, error overlay; auto-update verified on the user's PC (v0.1.0 → v0.1.1)
- [x] Phase 1b — `ship-installable` user skill (~/.claude/skills/ship-installable)
- [ ] Phase 1c — 3D models: council verdict on the user's models, then integrate the usable ones (see below)
- [ ] Phase 2 — foundations: Theater interface + registry, aircraft variant system (`extends`), Nation model, camera-relative rendering hook, campaign save migration (theaterId)
- [ ] Phase 3 — aircraft families: F-14A/B/B(U)/D, F-16A/B blk15, C/D blk40/50/70, F-15C/D, F-15E
- [ ] Phase 4 — cameras + 3D cockpit (orbit chase cam, procedural/GLB cockpit, collimated HUD)
- [ ] Phase 5 — radar/datalink, AWACS, aerial refueling
- [ ] Phase 6 — co-op multiplayer (Trystero WebRTC), then multicrew
- [ ] Phase 7 — mission editor
- [ ] Phase 8 — full Europe theater (real DEM via pure-JS bake + streaming) + landscape
- [ ] Phase 9 — carriers
- [ ] Phase 10 — Gulf map + voice commands

## 3D models (user-supplied, 2026-10-10)
- `f-14_tomcat_-_fighter_jet_-_free.glb` — bohmerang (Sketchfab), CC BY-NC-SA 4.0, 43k tris, 42 MB (PNG textures), has cockpit/canopy/gear nodes.
- `saab_jas_39_gripen_-_fighter_jet_-_free.glb` — bohmerang (Sketchfab), CC BY-NC-SA 4.0, 30k tris, 21 MB, cockpit/HUD/gear nodes.
- `FA-18E AGM-154.obj` (+ textures) — NO license/author; naming suggests an extracted commercial game asset → excluded.
Licence duties if used: attribution (credits screen + `assets/models/CREDITS.md`), non-commercial only, processed model files stay CC BY-NC-SA.

## Current step / next actions
Phase 1c (3D models) in progress. Council verdict (2026-10-10): F/A-18E OBJ NOT used (no licence, likely ripped; user advised to delete it).
F-14 + Gripen USED as opt-in 'HD aircraft models' (setting), lazy-loaded (runtime cache, NOT in SW precache), procedural model stays
as placeholder / far LOD (>~3 km) / hitbox; credits screen + assets/models/cc-by-nc-sa/LICENSE.md; game must stay non-commercial.
Done: scripts/models/optimize-glb.mjs (pure JS) → assets/models/cc-by-nc-sa/f14.glb (6.4 MB), gripen.glb (3.9 MB); scripts/models/inspect-glb.mjs.
Findings: models in decimetres (×0.1 → metres); glTF world: axis0 = fore-aft (+x = nose, F-14 x∈[-64.7,126.8]), axis1 = up, axis2 = span (±97.7, wings UNSWEPT 20°).
F-14 nodes: Object_4 airframe, Object_6 glass canopy, Object_8 cockpit (x 52–96), Object_10/12 gear (one is gearOn/gearOff), Object_14 glass, Object_16 refuel probe.
Primitives carry TANGENT + TEXCOORD_1..3 — strip unused attrs in optimize-glb to cut ~half the geometry size.
inspect-glb.mjs grid bug: 'all' only collects nodes whose name contains 'airframe' but meshes are on child nodes (Object_4) — use parent name.
NEXT: (1) fix inspect grid, find F-14 wing glove pivot (span ≈ ±2.7 m) for shader wing-sweep; (2) src/render/hdModels.ts: GLTFLoader via import map
'three/examples/jsm/' (copy GLTFLoader.js + utils/BufferGeometryUtils.js into site/vendor via installable.config.json), bake node transforms,
convert to game frame (nose -Z, span X, up Y, metres), toggle gear nodes by fm.gearPos, hide cockpit outside F1, swing-wing via onBeforeCompile
(attribute aSwing ±1 on outer-wing verts); (3) setting 'HD aircraft models' + credits screen; (4) site copy of assets/models + runtimeCacheHosts/route;
(5) verify in browser (cfs dev :5173), tests, commit, then Phase 2.

## Log
- 2026-10-10 — 3D model council done; optimized F-14/Gripen GLBs committed with licence file; auto-resume task cfs-roadmap-resume created (every 2 h).
- 2026-10-10 — Phases 0, 1, 1b done; public: https://briefcasejona.github.io/CFS/ ; installer v0.1.1 on Releases.
