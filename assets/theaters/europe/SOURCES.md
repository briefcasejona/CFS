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
