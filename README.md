# EVAres — EVA planner for the Gale Crater boxwork

NASA Space Apps 2026, challenge "Interplanetary Survival Guide: Martian Map".

A Google-Maps-style tool for planning an astronaut walk on Mars. The map covers a 33 x 40 km region of
Gale Crater: all of Curiosity's drive, from Bradbury Landing to the boxwork ridges it studied in
2025-26. Pick a start and science stops anywhere in it, and the planner gives walking routes with time,
distance, slope, surface, energy, oxygen and radiation per segment, shows where orbital data sees
water-formed minerals, and draws how far a crew can walk and still get home.

The region is too big to load whole at 2 m (330 million cells), so the data is stored as tiles. The app
shows a 16 m overview of the whole region and loads full-resolution ground for an 8 km square around
the walk (the *planning window*, drawn as a dashed square). Routes and walk limits are worked out on
that square, and it moves when the start or stops move near its edge.

**Golden case.** Curiosity spent most of a year at the boxwork, drilled three holes about 6 cm deep
(clay in a ridge, carbonate in a hollow), slipped in the sand-filled hollows, and left the main
questions open. A crew can cross ridge to hollow, sample ridge walls, dig under the sand and trace
the network in one six-hour walk.

## Run it

```bash
pnpm install
pnpm data      # one-time: downloads ~4.3 GB from NASA/USGS, about 1 h in all; keeps ~550 MB in data/<id> plus ~8 GB of cache (gitignored)
pnpm dev       # one Vite dev server on http://localhost:5173 (app, API Worker and map data)
pnpm test      # routing core unit tests
pnpm typecheck
```

`http://localhost:5173/?area=fixture` runs on
synthetic test data (`pnpm --filter @marsmap/web fixture`).

## Deploy (Cloudflare)

One Worker named `marsmap` serves everything: the built web app and the map data are static assets,
and Worker code only answers `/api/*`. Vite builds both (Cloudflare's Vite plugin), and Wrangler
uploads the result without re-bundling. No R2 is needed: static assets allow 25 MiB per file and
20 000 files per version (free plan), and the region ships as about 4500 files, none over a few MB
(elevation and surface tiles, overviews, an imagery pyramid). Wrangler only uploads files whose
content changed, so a data release re-uploads only the tiles that changed. Config is in `wrangler.jsonc`.

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
| `config/` | Everything tunable: `area.json` (bounds, tile size), `walk-params.json`, `surface-classes.json`, `pois.json` |
| `scripts/` | Data pipeline. Downloads and prepares everything so the app never calls NASA live. [Details and sources](scripts/README.md) |
| `packages/core/` | Routing, walk model, walk-limit rings, tile decoding and the planning window. Pure TypeScript, runs in a browser worker or on a server. [Equations and sources](packages/core/README.md) |
| `apps/web/` | React + MapLibre GL app (2D and 3D). Its `vite.config.ts` also runs the Worker and serves `data/` |
| `apps/server/` | Hono API as a Cloudflare Worker (`worker.ts`). Vite runs it in dev and builds it for deploy |
| `data/` | Generated, not in git |

## Where each piece of data comes from

| Data | Source | Used for |
|---|---|---|
| Elevation, 1 m, resampled to 2 m | USGS Astrogeology "Mars MSL Gale Merged DEM 1m v3" (HiRISE/CTX/HRSC tied to MOLA), https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m | Slope, routing, 3D terrain, elevation profile |
| Slope | Derived from the elevation (Horn, 3x3 cells); the app computes it from the elevation tiles | Routing cost, impassable cells, slope layer |
| Surface conditions | **Estimate** derived from elevation roughness and HiRISE brightness/texture; not ground-truthed | Routing cost, surface layer |
| Orbital photo, 0.64 m/px | NASA Mars Trek WMTS `curiosity_hirise_mosaic` (MRO HiRISE, NASA/JPL/UArizona), https://trek.nasa.gov/mars/ | Base map |
| Mineral indicators, 18-36 m/px | A mosaic of 19 MRO CRISM targeted observations (2007-2011; FRT scenes at 18 m first, HRL scenes at 36 m fill gaps), summary-parameter products from the NASA PDS Geosciences Node: clay (D2300), hydrated sulfate (SINDEX2), bound water (BD1900_2). Indicators, not abundances | "Minerals from orbit" layers, readings on each POI card |
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

`pnpm --filter @marsmap/scripts run verify` reads the data the way the app does (tiles decoded by the
routing core) and writes `data/<id>/preview/verify-report.json`.

- **Georeferencing:** elevation at all 1389 of Curiosity's waypoints (every one is inside the region)
  matches the waypoint's own elevation with a median difference of 2.7 cm (95% within 14 cm; mean
  −0.4 cm). The MMGIS waypoint elevations are probably sampled from this same DEM, so this checks the
  georeferencing and the tile encoding, not the DEM's absolute accuracy.
- **Mineral layers vs the photo:** as delivered, the CRISM scenes sit 70 to 250 m off the HiRISE
  photo. The pipeline finds, for each scene, the whole-pixel shift that best matches CRISM's 0.77 µm
  reflectance to the photo and applies it: the main boxwork scene goes from r = 0.69 to 0.83 at
  (7, 6) px, and every one of the 19 scenes lands within a few pixels of the same offset (about 8 px
  east, 4-12 px south), r = 0.55 to 0.95 after the shift. Expect one to two 18 m pixels of residual error.
- **Slope vs the rover:** at the waypoints our slope and the rover's recorded tilt agree at the median
  (7.2° vs 7.7°, median difference 1.7°). Over the region the median slope is 4°; 10% of cells are
  steeper than 21°.
- **Deploy limits:** every data file is under 25 MiB (largest 6.5 MiB) and there are about 4500 of
  them, under the 20 000-file limit for static assets.

## Honest limits

- Mars has no GPS. "Go" plays a simulated walk; "Use my location" maps your real movement onto Mars.
- The boxwork ridges are sharp in the photo but barely resolved in the elevation data, so ridge and
  hollow targets are hand-placed, not detected.
- The map library treats Mars coordinates as Earth coordinates for display (about 0.35% distortion at
  this latitude). All distances and times come from the routing core, not the map.
- Routes move between 8 neighbouring cells, so paths can run up to about 8% longer than ideal.
- Stops are visited in the order given; the planner does not reorder them.
- The CRISM map is a mosaic of 19 scenes taken between 2007 and 2011. Where scenes overlap they agree
  poorly (median r = 0.06 to 0.18 per indicator, at best about 0.3): seasons, dust and atmosphere
  differ. Each scene is level-matched to the ones before it, but seams are real; compare values within
  one scene (`crism/scene.bin`, `minerals.json`), not across a seam. 21% of the region has no CRISM coverage.
- Routing runs on an 8 km planning window at 2 m. On flat ground a walk can reach farther than that
  (about 9 km out and back), so on the plains the walk-limit ring is cut at the window's edge; the map
  key says so when it happens. Stops more than about 8 km apart cannot be planned in one walk.
- Walk limits are recomputed by flooding the whole window, out and back: about 10 s in the boxwork
  and about 35 s on the open plains, where nearly every cell is walkable.
- The app holds about 350 MB of window rasters in the page plus a copy in each of two routing workers,
  and the 16 m overview of the region (about 50 MB). Not tried on an iPad.
- About 11.6% of the region has no DEM (its corners outside the mosaic); the map leaves it blank and
  routes avoid it. Outside the planning window the map shows the 16 m overview: slopes there are means
  over 16 m cells and read gentler than they are.
- The mineral layers are 18 m pixels of a spectral indicator. Sand and dust hide minerals from orbit:
  CRISM shows no clay signal at Nevado Sajama, where Curiosity's drill found clay.
- The oxygen limit is a simple model (breathing in proportion to metabolic energy, plus leakage) with a
  placeholder tank size. Change it with the "Oxygen carried" slider.

## Changing things

- **Different region:** edit `config/area.json` (width and height multiples of `tileSize`), run
  `pnpm data`. The current region is about the largest box inside both the DEM and the HiRISE mosaic.
- **Better surface map:** `scripts/src/import-layer.ts` resamples a grid or image onto the shared grid
  and registers it; no code change needed. See [scripts/README.md](scripts/README.md).
- **Walk model:** edit `config/walk-params.json` or `config/surface-classes.json`.
- **New cost factor** (shade, radiation shelter, no-go zones): add one factor function in
  `packages/core/src/costModel.ts`; the search and UI do not change.
