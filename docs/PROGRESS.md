# CFS roadmap — progress & hand-over

This file is the single source of truth for continuing the roadmap across sessions (usage limits can end a
session at any time). Update it and `git commit && git push` after every finished step.

## Heartbeat (lock)
- heartbeat: 2026-10-11T17:04:56+02:00
- owner: scheduled resume run

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
- [x] Phase 6 — co-op multiplayer (Trystero WebRTC) [multicrew back-seat still open, optional]
- [x] Phase 7 — mission editor
- [x] Phase 8 — full Europe theater (real DEM via pure-JS bake) + landscape (Europe campaign + Earth curvature deferred)
- [x] Phase 9 — carriers (editor placement of carriers deferred)
- [x] Phase 10 — Gulf map + voice commands

## Round 2 — tester feedback (plan: C:/Users/haasn/.claude/plans/background-from-the-session-adaptive-reddy.md)
Decisions: hard limiters on FBW, soft (warning + fading stick) on analog/CAS; AoA in degrees; models: bohmerang F/A-18F, F-16, F-4 + KOG_THORNS F-14D (CC-BY, credit link+licence); VR = seated WebXR.
- [x] Phase A — editor/theater crash, HOTAS binding (edge capture, axis switches), G-LOC tolerance model → v0.1.12
- [x] Phase B — limiters (table), FCS feel per type, Dutch-roll fix → v0.1.13
- [ ] Phase C — F/A-18F, new HD models, F-14 sweep fix (F-14D node sweep + component classification), Gripen eye, HD cockpit MFDs, weapons on stations → v0.1.14
- [ ] Phase D — airports + terrain quality/depth → v0.1.15
- [ ] Phase E — WebXR seated VR → v0.1.16

## 3D models (user-supplied, 2026-10-10)
- `f-14_tomcat_-_fighter_jet_-_free.glb` — bohmerang (Sketchfab), CC BY-NC-SA 4.0, 43k tris, 42 MB (PNG textures), has cockpit/canopy/gear nodes.
- `saab_jas_39_gripen_-_fighter_jet_-_free.glb` — bohmerang (Sketchfab), CC BY-NC-SA 4.0, 30k tris, 21 MB, cockpit/HUD/gear nodes.
- `FA-18E AGM-154.obj` (+ textures) — NO license/author; naming suggests an extracted commercial game asset → excluded.
Licence duties if used: attribution (credits screen + `assets/models/CREDITS.md`), non-commercial only, processed model files stay CC BY-NC-SA.

## Current step / next actions
Phase 7 done: src/ui/editor.ts (map placement of flights/ground groups/waypoints, property panels, goals, weather, briefing, saved-mission library,
JSON export/import, share link #mission=… copied to clipboard, Briefing → fly), src/game/missionFile.ts (validateMissionSpec, encode/decodeMission
deflate-raw+base64url, localStorage library cfs.missions.v1), main.ts opens #mission= links in the editor, tests/editor.test.ts. 52 tests.
(Phase 8 notes below.)
DONE step (1): src/world/lcc.ts (Lambert Conformal Conic, lat0 52 lon0 10, std parallels 47/57) + scripts/terrain/bake-europe.mjs → assets/theaters/europe/height.bin.gz (6.4 MB, 2301×2301 @1 km, ±1150 km, Int16 LE) + meta.json; tile cache .cache/ (git-ignored). Region lon ~−6…26 so Kaliningrad (RU) and W Belarus are inside for the OPFOR side.
PLAN for Europe campaign: the campaign frontline model assumes an east-west front (z per x-sector); Europe needs a north-south front → add Theater.frontAxis or defer the Europe campaign; Instant Action/editor/MP first via a scenario transform (rotate+translate Varnia-frame scenario coordinates to a theater anchor, map halvorsen/volsk to nearest blue/red base).
NOTE: a user hook asks to run /app-legal-guard check after network/data-flow changes — do it at the end of Phase 8 (attribution for AWS Terrain Tiles/OurAirports in credits).
DONE step (2): src/world/theaters/europe.ts (DEM rawHeight + fbm micro-relief, 26 real airfields with grid-converted runway headings, 10 objectives, nations NATO vs ru/by, iaAnchor over NE Poland, campaign:false, async load via fetch+DecompressionStream; setEuropeGrid for tests), Theater.campaign/iaAnchor/load + ensureTheater() in theater.ts, land mask in the bake (Natural Earth 10m land minus lakes → polders stay land), tests/europe.test.ts. 55 tests.
DONE step (3)+(4): theater picker in mission setup (ensureTheater before briefing), Europe load gunzips only if needed, terrain chunk loop windowed around the camera, scenarios adapt via theaterAdapt.ts (commit dee22ce).
DONE step (5a): Theater.palette (beach/snowLine/rockBelowSnow; Europe snowline by latitude, no sand band), micro-relief fades near sea level so polders stay dry (+test), map: 1024px background on large theaters, Theater.overlay (borders+cities from scripts/terrain/bake-europe-overlay.mjs → overlay.json, 79 KB) drawn on all maps, credits in Settings + assets/theaters/europe/SOURCES.md (commit e79852d). 57 tests.
DONE (5b): instanced conifers (≤12k, 5 km radius, rebuilt per km, hidden >3000 m AGL) in forest-noise patches, clear of runways.
DONE: /app-legal-guard check → legal/ (no 🔴; L1–L7 wait for Jonathan: contact address, license, OK for privacy link/lobby notice/licenses link). Release v0.1.9.
DONE Phase 9: src/sim/carrier.ts (Carrier: moving deck as pure function of time, angled deck, 4 wires, 2 bow cats, island; CarrierOps: cat hold/launch (C) + end-of-stroke rotation, wire arrest within 100 m runout, trapped hold, bolter detection, LSO calls, approach info), FlightEnv.groundVelocity (deck-relative tyre friction), World.carriers/carrierOps + stoppedOnDeck landing, StartSpec kind carrier, MissionSpec.carriers, Theater.carriers (CVN-71 off Varnia west coast, CVN-75 in the North Sea), scenarios carrier_ops/carrier_trap (trimApproach solver, on-speed approach at recovery weight, crabbed for deck drift), HUD ball/lineup + HOOK flag, src/render/carrierMesh.ts, hook (H)/catLaunch (C) actions, FBW law includes flap lift, mechanical-jet trim authority 0.5, tests/carrier.test.ts (6). 65 tests.
DONE Phase 10a (Gulf map): scripts/terrain/bake-theater.mjs <europe|gulf> + bake-overlay.mjs (generalised, Europe output byte-identical), src/world/demTheater.ts (DemGrid shared by Europe+Gulf), src/world/theaters/gulf.ts (Persian Gulf 1991: 5 coalition + 5 Iraqi/occupied-Kuwait fields, 14 objectives, CVN-71 in N Gulf, desert palette, no trees, campaign:false), TerrainPalette.style/trees, desert map colours, tests/gulf.test.ts. 68 tests.
DONE Phase 10b: src/game/comms.ts (10 radio calls: wingman attack/engage/rejoin/RTB via AIPilot.order, AWACS picture BRAA, tanker/home vectors, call the ball, gear up/down; phrase regexes), src/input/voice.ts (Web Speech push-to-talk, opt-in setting voiceCommands, off by default), comms menu ( then 1-9/0, capture-phase key handling), actions commsMenu/voicePtt, legal docs updated (L12). 72 tests. Release v0.1.11.
ALL PLANNED PHASES DONE. OPTIONAL (only if the user asks): multicrew back seat; Europe/Gulf dynamic campaign (theater-aware squadrons + front axis); editor carrier placement; Earth curvature. Original Phase 10 note: Gulf map (same pure-JS bake pipeline as Europe: scripts/terrain/bake-europe.mjs generalised; region ~ Kuwait/S-Iraq/N-Gulf, e.g. lat 27–33, lon 44–51; LCC or TM centred ~30N 47.5E; airfields: real (Ali Al Salem, Ahmed Al Jaber, KKMC, Shaikh Isa, Tallil, Jalibah, …) with 1991-style coalition vs Iraq framing; carrier in the N Gulf) + voice commands (src/input/voice.ts, Web Speech API push-to-talk ~20 phrases → wingman/ATC/tanker/LSO commands; keyboard comms menu fallback). Then optional: multicrew back seat, Europe campaign (N-S front), editor carrier placement.
Original plan (for reference):
(1) scripts/terrain/bake-europe.mjs (pure JS: fetch AWS Terrarium tiles https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png,
decode with pngjs, height = (R*256 + G + B/256) - 32768) for lon −6…20, lat 42…62 at zoom ~7–8 → resample into a Transverse-Mercator
(centre 7°E 52°N) local grid ~1 km/px → write Int16 binary tiles site-ready under assets/theaters/europe/ (+ a meta.json with extent, projection);
check total size (< ~60 MB) and that GitHub Pages can serve it; mark assets/theaters/ as noPrecache in installable.config.json.
(2) src/world/theaters/europe.ts: Theater whose rawHeight samples the baked grid (bilinear; async load before missions: theater 'ready' promise),
airbases from OurAirports (bake a curated list of ~40 military fields with real runway headings/lengths into the theater file), nations per side
(NATO: nl, be, de, fr, uk, dk, no, se, pl, us vs OPFOR: ru, by — hypothetical scenario), objectives, frontline sectors along the east.
(3) TerrainRenderer: window the chunk loop around the camera (currently loops all chunks!), camera-relative is OK; earth-curvature drop in the
terrain vertex positions (h -= d²/(2R) relative to the camera) for the horizon; land/water colours from the DEM.
(4) Theater picker in Instant Action / Mission Setup / Campaign lobby; map drawing for Europe (theaterBackground from DEM).
(5) landscape: splat-style vertex colours by height/slope/latitude, instanced trees near the camera, haze; credits screen entries for AWS Terrain
Tiles (Mapzen: SRTM/GMTED/ETOPO1 etc.) and OurAirports (public domain). Tests: projection round trip, baked tile sampling, airbases on land.

## Log
- 2026-10-11 — Round 2 Phase B: limit table, FBW hard / CAS+analog soft limiters, stability-axis coordination + inertia-coupling feed-forward + roll-sideslip interconnect (no more yaw sway), pitch ratio changer, F-14A manual; tests/handling.test.ts; diag scripts build/diag (not committed); 85 tests; v0.1.13.
- 2026-10-11 — Round 2 Phase A: editor map fix, HOTAS binding, G tolerance; 82 tests; v0.1.12.
- 2026-10-11 — Phase 10 done: Persian Gulf 1991 map, radio menu + voice commands; 72 tests; release v0.1.11. All planned phases complete.
- 2026-10-10 — Phase 9 done: carriers (cat, wires, LSO, ball), 65 tests; release v0.1.10.
- 2026-10-10 — Phase 8 done: Northern Europe theater (1 km DEM, 26 airfields, theater picker, borders/cities map, latitude snowline, forests), legal check; 57 tests; release v0.1.9.
- 2026-10-10 — Phase 7 done: mission editor + share links, 52 tests; release v0.1.8.
- 2026-10-10 — Phase 6 co-op multiplayer working (WebRTC, no port forwarding), 49 tests; release v0.1.7.
- 2026-10-10 — Phase 5 done: datalink/AWACS/NCTR + aerial refuelling, 47 tests; release v0.1.6.
- 2026-10-10 — Phase 4 done: 3D cockpits + chase cam modes, 43 tests; release v0.1.5.
- 2026-10-10 — Phase 3 done: aircraft families + TF30 stalls, 42 tests; release v0.1.4.
- 2026-10-10 — Phase 2 done (theater registry, variants, nations), 40 tests; release v0.1.3.
- 2026-10-10 — Phase 1c done: HD models in game (F-14 swing-wing shader, Gripen), runway-start landing bug fixed, 30 tests.
- 2026-10-10 — 3D model council done; optimized F-14/Gripen GLBs committed with licence file; auto-resume task cfs-roadmap-resume created (every 2 h).
- 2026-10-10 — Phases 0, 1, 1b done; public: https://briefcasejona.github.io/CFS/ ; installer v0.1.1 on Releases.
