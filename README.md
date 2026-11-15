# Martian Map — EVA planner for the Gale Crater boxwork

NASA Space Apps 2026, challenge "Interplanetary Survival Guide: Martian Map".

A Google-Maps-style tool for planning an astronaut walk on Mars. Pick a start and science stops on a
8 km square around the boxwork ridges Curiosity studied in 2025-26, and the planner gives walking
routes with time, distance, slope, surface, energy, oxygen and radiation per segment, shows where
orbital data sees water-formed minerals, and draws how far a crew can walk and still get home.

**Golden case.** Curiosity spent most of a year at the boxwork, drilled three holes about 6 cm deep
(clay in a ridge, carbonate in a hollow), slipped in the sand-filled hollows, and left the main
questions open. A crew can cross ridge to hollow, sample ridge walls, dig under the sand and trace
the network in one six-hour walk.

## Run it

```bash
pnpm install
pnpm data      # one-time: downloads ~1 GB from NASA/USGS (about 12 min), keeps ~600 MB in data/ (gitignored)
pnpm dev       # one Vite dev server on http://localhost:5173 (app, API Worker and map data)
pnpm test      # routing core unit tests
pnpm typecheck
```

`http://localhost:5173/?area=fixture` runs on
synthetic test data (`pnpm --filter @marsmap/web fixture`).

## Deploy (Cloudflare)

One Worker named `marsmap` serves everything: the built web app and the map data are static assets,
and Worker code only answers `/api/*`. Vite builds both (Cloudflare's Vite plugin), and Wrangler
uploads the result without re-bundling. No R2 is needed (about 56 MB, 137 files, largest 9 MB; the
limit is 25 MiB per file). Config is in `wrangler.jsonc`.

```bash
pnpm deploy            # build + wrangler deploy (production)
pnpm preview:deploy    # build + wrangler preview (a Preview named after the current branch)
```

**Map data in builds.** `data/` is not in git. The build runs `scripts/fetch-data.mjs`, which downloads
the tarball pinned in `config/data-release.json` from this repo's GitHub releases and checks its
SHA-256, so builds never call NASA. It skips the download when `data/` is already present.
While the repo is private the build needs a `GITHUB_TOKEN` (read-only access to this repo's contents).

To publish new data after re-running `pnpm data`:

```bash
pnpm data:pack data-v2
gh release create data-v2 data/marsmap-gale-boxwork-data-v2.tar.gz
git commit -am "Pin map data data-v2"   # config/data-release.json changed
```

**GitHub integration (Workers Builds).** In the Cloudflare dashboard: Workers & Pages > marsmap >
Settings > Builds > Connect, pick this repo, production branch `main`, build command `pnpm run build`,
deploy command `npx wrangler deploy`, and enable builds for non-production branches so pull requests
get a Preview URL. Add `GITHUB_TOKEN` as a build secret.

## Layout

| Path | What |
|---|---|
| `config/` | Everything tunable: `area.json` (bounds), `walk-params.json`, `surface-classes.json`, `pois.json` |
| `scripts/` | Data pipeline. Downloads and prepares everything so the app never calls NASA live. [Details and sources](scripts/README.md) |
| `packages/core/` | Routing, walk model, walk-limit rings. Pure TypeScript, runs in a browser worker or on a server. [Equations and sources](packages/core/README.md) |
| `apps/web/` | React + MapLibre GL app (2D and 3D). Its `vite.config.ts` also runs the Worker and serves `data/` |
| `apps/server/` | Hono API as a Cloudflare Worker (`worker.ts`). Vite runs it in dev and builds it for deploy |
| `data/` | Generated, not in git |

## Where each piece of data comes from

| Data | Source | Used for |
|---|---|---|
| Elevation, 1 m, resampled to 2 m | USGS Astrogeology "Mars MSL Gale Merged DEM 1m v3" (HiRISE/CTX/HRSC tied to MOLA), https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m | Slope, routing, 3D terrain, elevation profile |
| Slope | Derived from the elevation grid (Horn, 3x3 cells) | Routing cost, impassable cells, slope layer |
| Surface conditions | **Estimate** derived from elevation roughness and HiRISE brightness/texture; not ground-truthed | Routing cost, surface layer |
| Orbital photo, 0.64 m/px | NASA Mars Trek WMTS `curiosity_hirise_mosaic` (MRO HiRISE, NASA/JPL/UArizona), https://trek.nasa.gov/mars/ | Base map |
| Mineral indicators, 18 m/px | MRO CRISM targeted observations FRT0000B6F1 (2008, 89% of the area) and FRT0001BBA1 (2010, the western strip), summary-parameter products from the NASA PDS Geosciences Node: clay (D2300), hydrated sulfate (SINDEX2), bound water (BD1900_2). Indicators, not abundances | "Minerals from orbit" layers, readings on each POI card |
| Context and thermal imagery | Mars Trek `Gale_CTX_BlockAdj_dd` (MRO CTX), THEMIS day/night IR mosaics (Mars Odyssey) | Alternative base layers (thermal is ~100 m/px, context only) |
| Curiosity track and waypoints | NASA/JPL MSL localized traverse, https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json | Track layer, start spots, drill-site positions, slope check |
| Rover photos | NASA Mars raw images feed (Curiosity Navcam), https://mars.nasa.gov/rss/api/?feed=raw_images&category=msl&feedtype=json | Ground-level previews |
| Weather | Curiosity REMS feed, https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json (last record sol 4995, not live) | Conditions bar, shown as typical values |
| Radiation | 0.67 mSv/day, Curiosity RAD (Hassler et al. 2014), https://www.swri.org/press-release/swri-scientists-publish-first-radiation-measurements-surface-mars | Dose per walk, static |
| Points of interest | Hand-written in `config/pois.json` from JPL and NASA Curiosity blog posts; drill sites use rover waypoint positions; science targets are marked illustrative | Pins and cards |

Per-file processing steps are in [scripts/README.md](scripts/README.md).

## Where each walk-model number comes from

Defaults live in `config/walk-params.json`; the full table with URLs, equations and caveats is in
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

## Checks we ran on the data

- **Georeferencing:** elevation at Curiosity's 535 waypoints in the area matches the waypoint's own
  elevation to within 0.5 m, and the photo aligns with the terrain to within one 2 m cell.
- **Mineral layers vs the photo:** as delivered, the CRISM scenes sit 170 to 245 m off the HiRISE
  photo. The pipeline finds, for each scene, the whole-pixel shift that best matches CRISM's 0.77 µm
  reflectance to the photo and applies it: the main scene goes from r = 0.59 to 0.80 (8 px west, 5 px
  north), the western one from 0.30 to 0.64 (11 px west, 8 px north). One shift per scene is a
  compromise (the best shift over the central 3 km alone was 9 px, 3 px), so expect one to two 18 m
  pixels of residual error.
- **Slope vs the rover:** at those waypoints our slope and the rover's recorded tilt agree at the
  median (9.6° vs 9.8°). The terrain is steep: median slope over the area is 11°, and about a quarter
  of cells exceed the 20° limit.

## Honest limits

- Mars has no GPS. "Go" plays a simulated walk; "Use my location" maps your real movement onto Mars.
- The boxwork ridges are sharp in the photo but barely resolved in the elevation data, so ridge and
  hollow targets are hand-placed, not detected.
- The map library treats Mars coordinates as Earth coordinates for display (about 0.35% distortion at
  this latitude). All distances and times come from the routing core, not the map.
- Routes move between 8 neighbouring cells, so paths can run up to about 8% longer than ideal.
- Stops are visited in the order given; the planner does not reorder them.
- The two CRISM scenes were taken two years apart and agree only loosely where they overlap
  (r = 0.2 to 0.4 per indicator). The western strip is level-matched to the main scene, but there is a
  visible seam and values should not be compared across it.
- At 8 km the app holds about 400 MB of rasters in the page plus a copy in each of two routing
  workers, and moving the start takes several seconds to redraw the walk limits. Not tried on an iPad;
  if it struggles there, shrink the area in `config/area.json`.
- The mineral layers are 18 m pixels of a spectral indicator. Sand and dust hide minerals from orbit:
  CRISM shows no clay signal at Nevado Sajama, where Curiosity's drill found clay.
- The oxygen limit is a simple model (breathing in proportion to metabolic energy, plus leakage) with a
  placeholder tank size. Change it with the "Oxygen carried" slider.

## Changing things

- **Bigger or different area:** edit `config/area.json`, run `pnpm data`.
- **Better surface map:** `scripts/src/import-layer.ts` resamples a grid or image onto the shared grid
  and registers it; no code change needed. See [scripts/README.md](scripts/README.md).
- **Walk model:** edit `config/walk-params.json` or `config/surface-classes.json`.
- **New cost factor** (shade, radiation shelter, no-go zones): add one factor function in
  `packages/core/src/costModel.ts`; the search and UI do not change.
