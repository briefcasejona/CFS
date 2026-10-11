# Legal status — CFS (Combat Flight Simulator)

RESEARCH NOTES — NOT LEGAL ADVICE — REVIEW WITH A LICENSED LAWYER BEFORE RELYING ON IT

**App version:** 0.1.13
**Last checked:** 2026-10-11
**Mode:** check (first run — full inventory, no previous baseline)

## Findings

| ID | Severity | Area | Finding | Fix | Status |
|---|---|---|---|---|---|
| L1 | 🟠 | Privacy | No privacy information published, while IP addresses reach GitHub (hosting/updates) and — in Multiplayer — public WebTorrent trackers, Google/Cloudflare STUN servers and other players; name/chat/voice go to other players | Draft written: legal/privacy-policy.md. Publish it and link it from the main menu/Settings and the Multiplayer lobby | open |
| L2 | 🟠 | Privacy / UX | Multiplayer lobby doesn't tell players their IP address is visible to other players and public trackers before they join | One-line notice in the lobby + link to the privacy policy | open |
| L3 | 🟠 | IP | Public repo has no LICENSE (code is all-rights-reserved by default; asset folder licensing not stated) | legal/license-choice.md — Jonathan decides; LICENSE must exclude assets/models/cc-by-nc-sa | open |
| L4 | 🟡 | Consumer | No provider contact shown in the app or on the site | Choose a public contact address (not necessarily the personal Gmail); add to privacy policy + About | open |
| L5 | 🟡 | IP | Third-party notices (three.js, Trystero; Electron in the desktop app) not reachable from the app | legal/THIRD_PARTY_NOTICES.md generated; add "Licenses" link in Settings | open |
| L6 | 🟡 | Consumer | No terms of use for a public free game | Short terms (free, as-is, fair play in Multiplayer, CC asset terms) — draft on request | open |
| L7 | 🟡 | IP | Real aircraft type names, air-force names and roundel colours used | Descriptive use, no manufacturer logos — fine for a free fan game [model knowledge — verify]; revisit before any monetization (lawyer) | open |
| L8 | 🟢 | IP | CC BY-NC-SA 4.0 HD models (bohmerang/Sketchfab: Gripen, F-16, F/A-18F, F-4): attribution in Settings + assets/models/cc-by-nc-sa/LICENSE.md; game is free → NC satisfied; ShareAlike: optimized files stay CC BY-NC-SA | Keep the game non-commercial while they ship; monetizing = lawyer trigger | fixed |
| L9 | 🟢 | IP | Europe terrain: AWS Terrain Tiles (Mapzen/Tilezen sources) and Natural Earth (public domain) | Credited in Settings + assets/theaters/europe/SOURCES.md | fixed |
| L10 | 🟢 | Cookies | Only localStorage + service-worker cache for the user's own settings/saves; no cookies, no analytics/tracking | Strictly necessary — no consent banner needed [model knowledge — verify] | fixed |
| L12 | 🟢 | Privacy | Voice commands send command audio to the browser vendor's speech service (Google/Microsoft) | Opt-in setting, off by default, disclosed in Settings, README and the privacy-policy draft; push-to-talk only; nothing stored by CFS | fixed |
| L11 | 🟢 | Privacy | Microphone only after an explicit click + browser permission prompt; not recorded | — | fixed |

## Documents

| Document | Path | Status | Published at |
|---|---|---|---|
| App inventory | legal/app-inventory.md | current | — |
| Privacy policy | legal/privacy-policy.md | draft (contact address missing) | not published |
| License choice | legal/license-choice.md | decision pending | — |
| Third-party notices | legal/THIRD_PARTY_NOTICES.md | generated | not linked in app |
| Terrain data sources | assets/theaters/europe/SOURCES.md | current | in repo |

## Proposed code changes (waiting for OK)

1. Publish `legal/privacy-policy.md` on the site (copy into the Pages build as `privacy.html`/`.md`) and add a "Privacy" link in the main menu footer and Settings.
2. Multiplayer lobby: add "Multiplayer connects you directly to other players: they and the public matchmaking servers can see your IP address. Only share room codes with people you trust. (Privacy)".
3. Settings → "Licenses" link showing THIRD_PARTY_NOTICES.
4. Add a LICENSE file once Jonathan picks one (license-choice.md).

## Open questions for Jonathan

- Which public contact address should CFS show (a separate address is fine)?
- Which license for the code (MIT vs all-rights-reserved)? Any plan to ever charge money for CFS? (Then the CC BY-NC-SA models must go.)
- OK to apply proposed code changes 1–3?
