# Martian Map — EVA planner for the Gale Crater boxwork

NASA Space Apps 2026, challenge "Interplanetary Survival Guide: Martian Map".

A Google-Maps-style tool for planning an astronaut walk (EVA) on Mars, built entirely on NASA and USGS
orbital and rover data. The map covers a 33 x 40 km region of Gale Crater: all of Curiosity's drive,
from Bradbury Landing to the boxwork ridges it studied in 2025-26. Pick a start and science stops, and
the planner answers the questions a crew has before stepping outside:

- **Which way do we walk?** Three routes (fastest, least effort, safest) with time, distance, slope,
  surface, energy, oxygen and radiation per segment.
- **Can we make it back?** A walk-limit ring shows how far the crew can go and still get home inside the
  suit's time, energy and oxygen budget, with a safety reserve held back. Each route gets a
  "turn back by" time (point of no return).
- **Where is the science?** Orbital mineral maps show where water-formed minerals (clay, hydrated
  sulfate, bound water) were seen from orbit, and every point of interest says what Curiosity did
  there, what it couldn't do, and what a crew could.

## Golden case: ridge to hollow in one walk

Curiosity spent most of a year at the boxwork, a network of low ridges and sand-filled hollows that
likely formed when groundwater flowed through cracks in the rock. It drilled three holes about 6 cm deep
(clay in a ridge, carbonate in a hollow), slipped in the sand-filled hollows, and left the main
questions open. A crew can do what the rover couldn't: cross ridge to hollow, sample ridge walls, dig
under the sand to bedrock and trace the edge of the network, in one six-hour walk. "Try the boxwork
walk" in the app loads one such plan: camp → hollow → ridge junction → sand dig.

## What you can do

| Tab / mode | What it does |
|---|---|
| **Explore** | Curiosity's traverse, waypoints (click one for its sol, rover tilt and the Navcam photos taken there), its drill sites and hand-picked science targets. Each card shows elevation, slope, surface and the orbital mineral readings at that spot. |
| **Plan** | Choose a start (a rover stop or any point), add stops from a card or by clicking the map, drag to reorder, set work time per stop, loop back to start. Compare the three routes, read the elevation and slope profile, and watch the time, energy and oxygen budget bars and the turn-back time. |
| **Go** | Plays the planned walk as a simulated astronaut with time, energy and oxygen left, bearing and the walk home. "Use my location" maps your real movement on Earth onto the Mars route. |
| **Layers** | Base imagery (HiRISE photo, CTX, THEMIS day/night infrared), slope, elevation, hillshade, estimated surface and its uncertainty, mineral indicators, walk cost from the start, walk-limit rings. 2D or 3D with adjustable vertical exaggeration. |

The Explore tab opens with typical conditions at Curiosity (air temperature range, daylight hours,
radiation dose) from its REMS and RAD instruments.

## Data sources

Everything is downloaded and prepared ahead of time by the data pipeline; the app never calls NASA live.

| Data | Source | Used for |
|---|---|---|
| Elevation, 1 m, averaged to 2 m | USGS Astrogeology "Mars MSL Gale Merged DEM 1m v3" (HiRISE/CTX/HRSC tied to MOLA), https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m | Slope, routing, 3D terrain, hillshade, elevation profile |
| Slope | Derived from the elevation (Horn method, 3x3 cells) | Routing cost, impassable ground, slope layer |
| Orbital photo, 0.64 m/px | NASA Mars Trek WMTS `curiosity_hirise_mosaic` (MRO HiRISE, NASA/JPL/UArizona), https://trek.nasa.gov/mars/ | Base map, surface estimate. The photo is grayscale; the Mars colour tint is cosmetic and can be switched off |
| Context and thermal imagery | Mars Trek `Gale_CTX_BlockAdj_dd` (MRO CTX, 10 m/px), THEMIS day/night IR mosaics (Mars Odyssey, ~100 m/px) | Alternative base layers (thermal is context only) |
| Mineral indicators, 18-36 m/px | 19 MRO CRISM targeted observations (2007-2011), summary-parameter products from the NASA PDS Geosciences Node: clay (D2300), hydrated sulfate (SINDEX2), bound water (BD1900_2). Indicators, not abundances | Mineral layers, readings on each card |
| Surface conditions | **Estimate** from elevation roughness and HiRISE brightness/texture (sand, bedrock, rubble, firm soil); not ground-truthed | Routing cost, surface layer |
| Curiosity track and waypoints | NASA/JPL MSL localized traverse, https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json | Track layer, start spots, drill-site positions, slope check |
| Rover photos | NASA Mars raw images feed (Curiosity Navcam), https://mars.nasa.gov/rss/api/?feed=raw_images&category=msl&feedtype=json | Ground-level previews |
| Weather | Curiosity REMS feed, https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json (last record sol 4995, not live) | Conditions bar, shown as typical values |
| Radiation | 0.67 mSv/day, Curiosity RAD (Hassler et al. 2014), https://www.swri.org/press-release/swri-scientists-publish-first-radiation-measurements-surface-mars | Dose per walk |
| Points of interest | Hand-written in `config/pois.json` from JPL and NASA Curiosity blog posts; drill sites use rover waypoint positions; science targets are marked illustrative | Pins and cards |

How each file is downloaded and processed: [scripts/README.md](scripts/README.md).

### Where each walk-model number comes from

Defaults live in `config/walk-params.json`; equations, URLs and caveats are in
[packages/core/README.md](packages/core/README.md).

| Parameter | Default | Basis |
|---|---|---|
| Walking speed, flat firm ground | 1.0 m/s | Apollo walk-back planning |
| Maximum walkable slope | 20° | Artemis suit capability |
| Caution slope | 15° | Assumption |
| EVA time limit | 6 h | BASALT analog flight rule |
| Safety reserve | 1/6 | BASALT: 5 h plan plus 30 min margin |
| Time per stop | 30 min | BASALT |
| Body / suit mass | 82 kg / 104 kg | ICES-2026-127 |
| Energy budget | 10,130 kJ | 352 W suit sizing rate over 8 h |
| Energy model | Pandolf load-carriage equation with downhill correction | NASA JSC (Kim et al. 2024); scaling to Mars gravity is our assumption |
| Surface speed and terrain factors | see `config/surface-classes.json` | Assumptions |
| Oxygen carried | 0.55 kg | **Placeholder**: Shuttle/ISS suit primary charge; no Mars suit tank is defined |
| Oxygen use | 0.071 g per kJ + 5 g/h leakage | Physiology (20.1 kJ per litre of O2); leakage is an assumption |
| Radiation | 0.67 mSv/day | Curiosity RAD |

### Checks we ran on the data

`pnpm --filter @marsmap/scripts run verify` reads the data the way the app does and writes
`data/<id>/preview/verify-report.json`.

- **Elevation vs the rover:** at all 1389 of Curiosity's waypoints, the map's elevation matches the
  waypoint's own with a median difference of 2.7 cm (95% within 14 cm). The waypoint elevations are
  probably sampled from this same DEM, so this checks georeferencing and tile encoding, not the DEM's
  absolute accuracy.
- **Slope vs the rover:** at the waypoints our slope and the rover's recorded tilt agree at the median
  (7.2° vs 7.7°, median difference 1.7°). Over the region the median slope is 4°; 10% is steeper than 21°.
- **Mineral layers vs the photo:** as delivered, the CRISM scenes sit 70 to 250 m off the HiRISE photo.
  The pipeline shifts each scene to best match the photo (the main boxwork scene goes from r = 0.69 to
  0.83); every scene lands at about the same offset. Expect one to two 18 m pixels of residual error.

## Honest limits

- Mars has no GPS. "Go" plays a simulated walk; "Use my location" maps your real movement onto Mars.
- The surface map is an estimate from orbit, not validated against rover observations.
- The boxwork ridges are sharp in the photo but barely resolved in the elevation data, so ridge and
  hollow targets are hand-placed, not detected.
- Sand and dust hide minerals from orbit: CRISM shows no clay signal at Nevado Sajama, where
  Curiosity's drill found clay. The CRISM map is a mosaic of 19 scenes taken years apart; seams are
  real, so compare values within one scene. 21% of the region has no CRISM coverage.
- The oxygen limit is a simple model with a placeholder tank size. Change it with the "Oxygen carried" slider.
- A walk is planned on an 8 km square around the start and stops (see below). Stops more than about
  8 km apart cannot be planned in one walk, and on the open plains, where a crew could walk farther,
  the walk-limit ring is cut at the square's edge (the map key says so).
- Walk limits take about 10 s to compute in the boxwork and about 35 s on the open plains.
- Stops are visited in the order given; the planner does not reorder them.
- Routes move between 8 neighbouring 2 m cells, so paths can run up to about 8% longer than ideal.
- About 11.6% of the region (its corners, outside the DEM) has no elevation; the map leaves it blank
  and routes avoid it.
- Memory heavy: the app holds about 350 MB of full-resolution rasters in the page plus a copy in each
  of two routing workers. Not tried on an iPad.

## Run it

```bash
pnpm install
pnpm data      # one-time: downloads ~4.3 GB from NASA/USGS, about 1 h in all; keeps ~550 MB in data/<id> plus ~8 GB of cache (gitignored)
pnpm dev       # one Vite dev server on http://localhost:5173 (app, API Worker and map data)
pnpm test      # routing core and web unit tests
pnpm typecheck
```

`http://localhost:5173/?area=fixture` runs on synthetic test data (`pnpm --filter @marsmap/web fixture`).

Deploying to Cloudflare and publishing map data releases: [docs/deployment.md](docs/deployment.md).

## How it works

### Map rendering

The map is MapLibre GL. MapLibre assumes Earth, so Mars longitude and latitude are drawn as if they
were Earth's (about 0.35% scale distortion at this latitude); all distances and times come from the
routing core, not the map.

- **Base imagery** is full resolution across the whole region. The pipeline ships each imagery set as a
  pyramid of JPEG pictures (level 0 at full resolution in pieces of at most 2048 px, each level up 4x
  coarser). A custom `marsimg://` protocol cuts 256 px map tiles out of the level that matches the zoom
  and applies the Mars tint on the fly (`apps/web/src/map/imageryTiles.ts`).
- **Data layers** (elevation, slope, surface, uncertainty) are drawn twice: a 16 m overview of the whole
  region, and on top of it full 2 m resolution inside the planning window. Outside the window slopes
  are 16 m means and read gentler than they are. Mineral layers are on the 16 m grid everywhere, drawn
  pixel by pixel. Walk cost and walk-limit rings exist only inside the window.
- **3D terrain** is generated in the browser: a `marsdem://` protocol encodes Terrarium height tiles
  from the same overview and window grids (`apps/web/src/map/dem.ts`). Heights are scaled by
  R_earth / R_mars so that vertical ×1 is true Mars proportion; the slider goes to ×10. Hillshade uses
  the same tiles.
- **3D performance** (`apps/web/src/map/terrainPerf.ts`): only terrain inside a square around where the
  camera looks is drawn (the "Draw" setting: 2, 4, 8 or 16 km, default 8), and picking what lies under
  the mouse ray-marches the in-memory elevation grid instead of reading pixels back from the GPU.
  `cameraClearance.ts` keeps the camera from dipping into hillsides.

### Planning window

The region is too big to load whole at 2 m (330 million cells), so the data is stored as 1 km tiles
(512 x 512 cells). The app loads the 16 m overview of everything, plus full-resolution tiles for an
8 km square around the walk (the *planning window*, drawn as a dashed square). Routes and walk limits
are computed on that square in two Web Workers (one for routes, one for the slower walk-limit flood);
the window moves when the start or a stop comes within 2 km of its edge.

### Code layout

| Path | What |
|---|---|
| `config/` | Everything tunable: `area.json` (bounds, tile size), `walk-params.json`, `surface-classes.json`, `pois.json` |
| `scripts/` | Data pipeline. Downloads and prepares everything. [Details and sources](scripts/README.md) |
| `packages/core/` | Routing, walk model, walk-limit rings, tile decoding and the planning window. Pure TypeScript. [Equations and sources](packages/core/README.md) |
| `apps/web/` | React + MapLibre GL app (2D and 3D). Its `vite.config.ts` also runs the Worker and serves `data/` |
| `apps/server/` | Small Hono API as a Cloudflare Worker (`/api/areas`, `/api/config`) |
| `data/` | Generated, not in git |

### Changing things

- **Different region:** edit `config/area.json` (width and height multiples of `tileSize`), run
  `pnpm data`. The current region is about the largest box inside both the DEM and the HiRISE mosaic.
- **Better surface map:** `scripts/src/import-layer.ts` resamples a grid or image onto the shared grid
  and registers it; no code change needed. See [scripts/README.md](scripts/README.md).
- **Walk model:** edit `config/walk-params.json` or `config/surface-classes.json`.
- **New cost factor** (shade, radiation shelter, no-go zones): add one factor function in
  `packages/core/src/costModel.ts`; the search and UI do not change.
