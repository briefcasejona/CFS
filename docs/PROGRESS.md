# CFS roadmap — progress & hand-over

This file is the single source of truth for continuing the roadmap across sessions (usage limits can end a
session at any time). Update it and `git commit && git push` after every finished step.

## Heartbeat (lock)
- heartbeat: 2026-10-10T22:22:59+02:00
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
- [x] Phase 1c — 3D models: council verdict on the user's models, then integrate the usable ones (see below)
- [x] Phase 2 — foundations: Theater interface + registry, aircraft variant system (`extends`), Nation model, camera-relative rendering hook, campaign save migration (theaterId)
- [x] Phase 3 — aircraft families: F-14A/B/B(U)/D, F-16A/B blk15, C/D blk40/50/70, F-15C/D, F-15E
- [x] Phase 4 — cameras + 3D cockpit (orbit chase cam, procedural/GLB cockpit, collimated HUD)
- [x] Phase 5 — radar/datalink, AWACS, aerial refueling
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
Phase 5 done: src/avionics/datalink.ts (per-side Link 16 picture, world.datalink; HSD hollow off-board tracks, FCR hollow boxes, AWACS dot; NO_DATALINK
for older jets), E-3 + KC-135R support defs (playable:false, hidden from pickers), AI tasks 'awacs'/'tanker' with racetrack (pilot.ts flyRacetrack),
src/sim/refuel.ts (boom/drogue envelopes, contact/disconnect, 16 kg/s, HUD director cue, radio), boom/probe capabilities by family,
'Aerial refueling' Instant Action scenario (FlightSpec.fuelFraction/stationHdg/speed), AWACS 'Magic' in BVR/furball, NCTR on FCR STT. 47 tests.
NEXT: Phase 6 — co-op multiplayer (2–4 players) over WebRTC without port forwarding:
(1) vendor Trystero (pure ESM, pick the nostr or torrent strategy; check npm 'trystero' package files for a browser ESM build) into site/vendor and
dev import map; src/net/net.ts: joinRoom(code) → peers, send/recv channels.
(2) host-authoritative: host runs World; clients send own-ship state (pos/quat/vel/ctrl/weapons fired) at 20 Hz; host broadcasts snapshots
(AI aircraft, missiles, ground units, kills) at 15 Hz; clients render remote entities with interpolation (100 ms buffer); remote players are
Aircraft without AI on the host (state applied from net).
(3) lobby UI (main menu 'Multiplayer'): host → room code + mission pick (Instant Action scenarios); join → code; chat; WebRTC voice optional.
(4) multicrew later (back-seat client owns radar/MFD input).
(5) tests: snapshot encode/decode, interpolation; browser two-tab test (two tabs in the preview, same room).

## Log
- 2026-10-10 — Phase 5 done: datalink/AWACS/NCTR + aerial refuelling, 47 tests; release v0.1.6.
- 2026-10-10 — Phase 4 done: 3D cockpits + chase cam modes, 43 tests; release v0.1.5.
- 2026-10-10 — Phase 3 done: aircraft families + TF30 stalls, 42 tests; release v0.1.4.
- 2026-10-10 — Phase 2 done (theater registry, variants, nations), 40 tests; release v0.1.3.
- 2026-10-10 — Phase 1c done: HD models in game (F-14 swing-wing shader, Gripen), runway-start landing bug fixed, 30 tests.
- 2026-10-10 — 3D model council done; optimized F-14/Gripen GLBs committed with licence file; auto-resume task cfs-roadmap-resume created (every 2 h).
- 2026-10-10 — Phases 0, 1, 1b done; public: https://briefcasejona.github.io/CFS/ ; installer v0.1.1 on Releases.
