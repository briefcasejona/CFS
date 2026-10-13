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
