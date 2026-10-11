# App inventory — CFS (Combat Flight Simulator)

RESEARCH NOTES — NOT LEGAL ADVICE — REVIEW WITH A LICENSED LAWYER BEFORE RELYING ON IT

*Built by /app-legal-guard on 2026-10-10 from the code at v0.1.8 + Phase 8 work (commit 1468976). Evidence = file paths.*

## 1. Distribution
- Web/PWA: https://briefcasejona.github.io/CFS/ (GitHub Pages; `.github/workflows/pages.yml`, `installable.config.json`).
- Windows desktop: unsigned NSIS installer `CFS-Setup-x.y.z.exe` on GitHub Releases (`.github/workflows/release.yml`, `scripts/installable/desktop/`).
- Update channels: service worker checks `./version.json` (`scripts/installable/installable-client.js:47`); desktop uses `electron-updater` against GitHub Releases (`scripts/installable/desktop/main.js:4,47`).
- No app stores.

## 2. Audience
- Hobby flight-sim players; friends of the developer. Not aimed at children; no school use. Combat theme (no gore). Consumers (B2C), free.

## 3. Personal data
- No accounts, no login, no server of our own. Nothing is sent to the developer.
- Stored on the device only (localStorage): settings `src/core/settings.ts`, controller bindings/known devices `src/input/input.ts`, campaign saves `src/campaign/campaign.ts`, mission library `src/game/missionFile.ts`.
- Multiplayer (`src/net/link.ts`, `src/ui/multiplayer.ts`): a player-chosen **display name** and chat text go to the other players in the room; peers connect directly (WebRTC), so **IP addresses are visible to the other players**, the public WebTorrent trackers and the STUN servers.
- Voice chat (optional, button): microphone audio streamed peer-to-peer to the room (`src/ui/multiplayer.ts:158-163`), only after the user clicks and the browser grants mic permission.
- Voice commands (optional, Settings → Voice commands, off by default): push-to-talk uses the browser's Web Speech API (`src/input/voice.ts`); in Chrome/Edge each spoken command's audio is sent by the browser to Google/Microsoft speech services for transcription. CFS itself only receives the text and matches it to a radio call (`src/game/comms.ts`); nothing is stored. The setting is described in Settings (`src/ui/screens.ts`).
- Shared mission links: the mission is encoded in the URL **hash** (`#mission=`, `src/game/missionFile.ts`, `src/main.ts:38`) — the hash is not sent to GitHub's servers.
- Error overlay "copy log" copies to the clipboard only (`src/ui/errorOverlay.ts`).

## 4. Network destinations
| Host | Purpose | Data | Evidence |
|---|---|---|---|
| briefcasejona.github.io (GitHub Pages) | hosting the game + assets (`assets/theaters/europe/*`, `assets/models/*`) | IP, user agent (hosting logs) | `installable.config.json`, `src/world/theaters/europe.ts:117,126` |
| github.com / objects.githubusercontent.com (Releases) | desktop installer download + auto-update check | IP, app version | `scripts/installable/desktop/main.js`, `installable-client.js:33` |
| wss://tracker.openwebtorrent.com, wss://tracker.webtorrent.dev (third-party WebTorrent trackers) | multiplayer peer discovery (only when Multiplayer is opened) | IP, hashed room id, WebRTC offers | `@trystero-p2p/torrent` defaults, `src/net/link.ts:16-17` |
| stun.l.google.com / stun1-2.l.google.com:19302, stun.cloudflare.com:3478 | NAT traversal (multiplayer only) | IP | `node_modules/@trystero-p2p/core/dist/peer.mjs:378` |
| other players (peer-to-peer) | game state, chat, name, optional voice | IP, name, chat, audio | `src/net/coop.ts`, `src/ui/multiplayer.ts` |
| Browser speech service (Google in Chrome, Microsoft in Edge) — chosen by the browser, not by CFS | voice commands, only when enabled and the push-to-talk key is pressed | microphone audio of the command, IP | `src/input/voice.ts` |
| Outbound links only (user clicks): sketchfab.com, registry.opendata.aws, github.com/tilezen, naturalearthdata.com | credits | — | `src/ui/screens.ts` credits |
- Build-time only (not runtime): AWS Terrain Tiles and Natural Earth GitHub raw files fetched by `scripts/terrain/*.mjs`.

## 5. Login & scopes — none.
## 6. Cookies & storage — no cookies. localStorage (see §3) and service-worker Cache Storage (the app's own files). All strictly necessary for features the user uses (own settings/saves). Set by the app itself.
## 7. Tracking / analytics / crash reporting — none.
## 8. Payments, ads, IAP — none. **Must stay non-commercial** while CC BY-NC-SA models ship (§12).
## 9. AI features — none (speech recognition is the browser's built-in feature, used only to pick one of ten fixed radio calls; no decisions about people).
## 10. UGC / sharing / messaging — multiplayer text chat + voice among people who share a room code (private rooms, not public); mission share links. No public profiles, no moderation surface.

## 11. Dependencies (shipped)
- `three` 0.186.1 MIT, `@trystero-p2p/core` + `@trystero-p2p/torrent` 0.26.0 MIT (see `legal/THIRD_PARTY_NOTICES.md`).
- Desktop: Electron (MIT + Chromium notices added by electron-builder), `electron-updater` (MIT) — installed in CI only.

## 12. Assets
- HD models `assets/models/cc-by-nc-sa/{gripen,f16,fa18f,f4}.glb`: "bohmerang" on Sketchfab, **CC BY-NC-SA 4.0**; attribution in Settings (`src/ui/screens.ts` `hdCredits()`) and `assets/models/cc-by-nc-sa/LICENSE.md`. Derived (optimized) files stay CC BY-NC-SA.
- HD model `assets/models/cc-by/f14d.glb` (all F-14 variants): "Grumman F-14D Super Tomcat" by KOG_THORNS on Sketchfab, **CC BY 4.0** (per the file's metadata); credited with link + licence + list of changes in Settings and `assets/models/cc-by/LICENSE.md`. The source file contains a part name ("gears_Aerosoft") suggesting part of it may come from a commercial product — flagged to Jonathan, who chose to use it with credit (2026-10-11).
- Excluded: user-supplied F/A-18E OBJ (no provenance), KOG_THORNS F-14B (looks derived from the bohmerang CC BY-NC-SA model but labelled CC-BY), F-16D Block 70 (no author/licence) — never committed.
- Build-only tooling (not shipped): @gltf-transform/core/functions/extensions, meshoptimizer (MIT).
- Terrain: AWS Terrain Tiles (Mapzen/Tilezen; SRTM/GMTED/ETOPO1/EU-DEM… attribution required per joerd docs) + Natural Earth (public domain); credited in Settings and `assets/theaters/europe/SOURCES.md`.
- All other art (procedural aircraft, cockpit, HUD, icons, sounds) generated in code by the project.
- Real military aircraft type names (F-16, F-14, Gripen, …), real air-force/nation names and roundel colours (`src/world/nations.ts`) — descriptive use.

## 13. Identity & contact
- App name "CFS — Combat Flight Simulator". Provider: Jonathan (natural person), GitHub `briefcasejona`, public repo `briefcasejona/CFS`. **No repo LICENSE.** No contact address shown in the app.

## 14. Marketing claims
- README: feature descriptions only ("free flight" is a scenario name). No "secure/private/#1" claims found.
