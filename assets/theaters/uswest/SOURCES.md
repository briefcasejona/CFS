# US West Coast theater data

The frame reaches from the Mexican to the Canadian border and east across Nevada and Idaho; the content (airfields,
airports, roads, rail, stations, buildings) covers the United States only (`scripts/terrain/countries.mjs`, Natural Earth
10 m countries, public domain). Every file here is baked by the same scripts as Western Europe with the theater id
`uswest`; sources and licences:

- `height.bin.gz`: 1 km elevation grid (Int16, Lambert Conformal Conic 40.8°N 118.5°W, std. parallels 34°/47°), resampled
  from **AWS Terrain Tiles** (Terrarium, zoom 7), a public dataset by Mapzen/Tilezen. Underlying sources include USGS 3DEP (NED), SRTM,
  GMTED2010 and ETOPO1; see https://github.com/tilezen/joerd/blob/master/docs/attribution.md.
  Land/sea corrected with the Natural Earth 10 m land and lakes layers. Baked by `scripts/terrain/bake-theater.mjs uswest`.
- `overlay.json`: national borders, US state lines and major cities from **Natural Earth** (public domain), baked by
  `scripts/terrain/bake-overlay.mjs uswest`.
- Airfield coordinates and runway headings in `src/world/theaters/uswest.ts` are approximate public information.
- Runway layouts (`src/world/theaters/runways.ts`): thresholds and widths from **OurAirports** (public domain,
  https://github.com/davidmegginson/ourairports-data), baked by `scripts/terrain/bake-runways.mjs`.
- `landcover.bin.gz`: 1 km grid of forest, built-up, cropland and open-water fractions (Uint8 RGBA, same projection),
  derived from **ESA WorldCover 10 m 2021 v200** (© ESA WorldCover project 2021 / contains modified Copernicus Sentinel
  data (2021) processed by the ESA WorldCover consortium), **CC BY 4.0** — https://esa-worldcover.org. Changes: classes
  regrouped and resampled to fractions. Baked by `scripts/terrain/bake-landcover.mjs uswest`.
- `patches.json` + `patches.bin.gz`: 50 × 50 km elevation patches at 75 m spacing around each airfield (Int16, same
  projection), from the same **AWS Terrain Tiles** at zoom 11; blended into the 1 km grid over their outer 6 km.
  Baked by `scripts/terrain/bake-patches.mjs uswest`.
- `coverdetail.json` + `coverdetail.bin.gz`: 50 × 50 km landcover patches at 20 m spacing around each airfield (the
  squares of `patches.json`), the **ESA WorldCover 10 m 2021 v200** class at each cell centre reduced to tree / built-up /
  water / other (2 bits), © ESA WorldCover project 2021 / contains modified Copernicus Sentinel data (2021) processed by
  the ESA WorldCover consortium, **CC BY 4.0**. Houses and forests near the fields are placed on these cells. Baked by
  `scripts/terrain/bake-coverdetail.mjs uswest`.
- `buildings/index.json` + `buildings/<field>.bin.gz`: every building footprint of 30 m² or more in the squares of
  `coverdetail.json`, from the **Overture Maps** buildings theme (release 2026-10-21.0), which is built from
  **© OpenStreetMap contributors** and other open building datasets, under the **Open Database License (ODbL) 1.0** —
  https://opendatacommons.org/licenses/odbl/ (attribution: © OpenStreetMap contributors, Overture Maps Foundation).
  Changes: each footprint reduced to its minimum-area rectangle (shrunk to the footprint's area), its height where
  known, and re-projected to the theater grid. This derived database is offered under the ODbL as well. Baked by
  `scripts/terrain/extract-buildings.py` and `scripts/terrain/bake-buildings.mjs`.
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
- `imagery.json`: where the open aerial-photo service covers the ground (USGS The National Map orthoimagery, NAIP,
  public domain), rasterised from the Natural Earth 10 m countries by `scripts/terrain/bake-imagery-regions.mjs uswest`.
  The photographs themselves are streamed by the browser at runtime (`src/render/imagery.ts`), not stored here.
- Streamed elevation: around the aircraft the game fetches **AWS Terrain Tiles** (Terrarium, zoom 12, about 25 m) at
  runtime (`src/world/demStream.ts`); nothing of it is stored here.
