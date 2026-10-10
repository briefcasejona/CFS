# CFS roadmap — progress & hand-over

This file is the single source of truth for continuing the roadmap across sessions (usage limits can end a
session at any time). Update it and `git commit && git push` after every finished step.

## Heartbeat (lock)
- heartbeat: 2026-10-10T22:27:52+02:00
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
Phase 6 core done (co-op multiplayer): src/net/protocol.ts (pack/apply/Interpolator/room codes), src/net/coop.ts (CoopHost authoritative world;
CoopClient: own jet local, others = interpolated ghosts, missiles = ghost list, fire requests via world.netFire, RWR relayed), src/net/link.ts
(Trystero torrent strategy, @trystero-p2p/torrent + core vendored via import map / site copy), src/ui/multiplayer.ts lobby (host code, join,
chat, optional voice), FlightSession.netHook, main menu 'Multiplayer (co-op)'. Verified: two browser tabs connected over real WebRTC via public
trackers and flew a co-op BVR mission; tests/net.test.ts (in-memory end-to-end). launch.json now autoPort (another project uses :5173).
Phase 6 remaining (multicrew, reduced): second client in the back seat of a two-seater owning radar/MFD input — deferred; do it after Phase 7
if time allows (plan said 'last').
NEXT: Phase 7 — mission editor: src/ui/editor.ts — 2D canvas over theaterBackground() (pan/zoom like campaignScreen map), palette to place
flights (side, aircraft, count, task, start air/runway, waypoints by clicking), ground groups (GroupSpec kinds incl. SAM types), goals;
reads/writes MissionSpec; save to localStorage list, JSON export/import file, share URL (#m=base64 of deflate via CompressionStream);
'Fly' launches via app.fly with the briefing; tests: MissionSpec JSON round-trip + validateMissionSpec.

## Log
- 2026-10-10 — Phase 6 co-op multiplayer working (WebRTC, no port forwarding), 49 tests; release v0.1.7.
- 2026-10-10 — Phase 5 done: datalink/AWACS/NCTR + aerial refuelling, 47 tests; release v0.1.6.
- 2026-10-10 — Phase 4 done: 3D cockpits + chase cam modes, 43 tests; release v0.1.5.
- 2026-10-10 — Phase 3 done: aircraft families + TF30 stalls, 42 tests; release v0.1.4.
- 2026-10-10 — Phase 2 done (theater registry, variants, nations), 40 tests; release v0.1.3.
- 2026-10-10 — Phase 1c done: HD models in game (F-14 swing-wing shader, Gripen), runway-start landing bug fixed, 30 tests.
- 2026-10-10 — 3D model council done; optimized F-14/Gripen GLBs committed with licence file; auto-resume task cfs-roadmap-resume created (every 2 h).
- 2026-10-10 — Phases 0, 1, 1b done; public: https://briefcasejona.github.io/CFS/ ; installer v0.1.1 on Releases.
