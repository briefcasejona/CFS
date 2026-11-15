# Persian Gulf theater data

- `height.bin.gz`: 1 km elevation grid (Int16, Lambert Conformal Conic 29.5°N 47.5°E, std. parallels 26°/33°, ±600 km),
  resampled from **AWS Terrain Tiles** (Terrarium, zoom 8), a public dataset by Mapzen/Tilezen. Underlying sources include
  SRTM, GMTED2010 and ETOPO1; see https://github.com/tilezen/joerd/blob/master/docs/attribution.md. Land/sea corrected with
  the Natural Earth 10 m land and lakes layers. Baked by `scripts/terrain/bake-theater.mjs gulf`.
- `overlay.json`: national borders and cities from **Natural Earth** (public domain), baked by
  `scripts/terrain/bake-overlay.mjs gulf`.
- Airfield coordinates, runway headings and objectives in `src/world/theaters/gulf.ts` are approximate public information;
  the 1991 order of battle is simplified.
- Runway layouts (`src/world/theaters/runways.ts`): thresholds and widths from **OurAirports** (public domain,
  https://github.com/davidmegginson/ourairports-data), baked by `scripts/terrain/bake-runways.mjs`.
- `landcover.bin.gz`: 500 m grid of forest, built-up, cropland and open-water fractions (Uint8 RGBA, same projection),
  derived from **ESA WorldCover 10 m 2021 v200** (© ESA WorldCover project 2021 / contains modified Copernicus Sentinel
  data (2021) processed by the ESA WorldCover consortium), **CC BY 4.0** — https://esa-worldcover.org. Changes: classes
  regrouped and resampled to fractions. Baked by `scripts/terrain/bake-landcover.mjs gulf`.
- `patches.json` + `patches.bin.gz`: 50 × 50 km elevation patches at 75 m spacing around each airfield (Int16, same
  projection), from the same **AWS Terrain Tiles** at zoom 11; blended into the 1 km grid over their outer 6 km.
  Baked by `scripts/terrain/bake-patches.mjs gulf`.
- `roads/index.json`, `roads/major/<i>_<j>.bin.gz`, `roads/local/<field>.bin.gz`, `roads/stations.json`: the road
  and railway network of the whole theater (motorways to tertiary roads, standard-gauge railways; the minor roads and
  streets as well inside the squares of `patches.json`) and its railway stations, from the **Overture Maps**
  transportation and places themes (release 2026-10-21.0), built from **© OpenStreetMap contributors**, under the
  **Open Database License (ODbL) 1.0** — https://opendatacommons.org/licenses/odbl/ (attribution: © OpenStreetMap
  contributors, Overture Maps Foundation). Changes: tunnels and unbuilt or abandoned lines dropped, chains merged,
  simplified to 1.5–4.5 m, re-projected to the theater grid and cut into 8 km (streets: 2 km) cells; stations snapped
  to the nearest track. This derived database is offered under the ODbL as well. Extracted by
  `scripts/terrain/extract-transport.py` and `extract-stations.py`, baked by `scripts/terrain/bake-transport.mjs`.
- Civil and other non-mission airfields (`src/world/theaters/civil.ts`): every large or medium airport with a paved
  runway of 1,200 m or more, from **OurAirports** (public domain), baked by `scripts/terrain/bake-airports.mjs`.
  Terminals, hangars and aprons are generic, sized by the airport's class.
