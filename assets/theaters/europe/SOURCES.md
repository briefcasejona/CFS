# Northern Europe theater data

- `height.bin.gz`: 1 km elevation grid (Int16, Lambert Conformal Conic 52°N 10°E, std. parallels 47°/57°), resampled
  from **AWS Terrain Tiles** (Terrarium, zoom 7), a public dataset by Mapzen/Tilezen. Underlying sources include SRTM,
  GMTED2010, ETOPO1 and EU-DEM; see https://github.com/tilezen/joerd/blob/master/docs/attribution.md.
  Land/sea corrected with the Natural Earth 10 m land and lakes layers. Baked by `scripts/terrain/bake-theater.mjs europe`.
- `overlay.json`: national borders and major cities from **Natural Earth** (public domain), baked by
  `scripts/terrain/bake-overlay.mjs europe`.
- Airfield coordinates and runway headings in `src/world/theaters/europe.ts` are approximate public information.
- Runway layouts (`src/world/theaters/runways.ts`): thresholds and widths from **OurAirports** (public domain,
  https://github.com/davidmegginson/ourairports-data), baked by `scripts/terrain/bake-runways.mjs`.
- `landcover.bin.gz`: 1 km grid of forest, built-up, cropland and open-water fractions (Uint8 RGBA, same projection),
  derived from **ESA WorldCover 10 m 2021 v200** (© ESA WorldCover project 2021 / contains modified Copernicus Sentinel
  data (2021) processed by the ESA WorldCover consortium), **CC BY 4.0** — https://esa-worldcover.org. Changes: classes
  regrouped and resampled to fractions. Baked by `scripts/terrain/bake-landcover.mjs europe`.
- `patches.json` + `patches.bin.gz`: 50 × 50 km elevation patches at 75 m spacing around each airfield (Int16, same
  projection), from the same **AWS Terrain Tiles** at zoom 11; blended into the 1 km grid over their outer 6 km.
  Baked by `scripts/terrain/bake-patches.mjs europe`.
- `coverdetail.json` + `coverdetail.bin.gz`: 50 × 50 km landcover patches at 20 m spacing around each airfield (the
  squares of `patches.json`), the **ESA WorldCover 10 m 2021 v200** class at each cell centre reduced to tree / built-up /
  water / other (2 bits), © ESA WorldCover project 2021 / contains modified Copernicus Sentinel data (2021) processed by
  the ESA WorldCover consortium, **CC BY 4.0**. Houses and forests near the fields are placed on these cells. Baked by
  `scripts/terrain/bake-coverdetail.mjs europe`.
