# Martian Map — EVA planner for the Gale Crater boxwork

NASA Space Apps 2026, challenge "Interplanetary Survival Guide: Martian Map".

A Google-Maps-style tool for planning an astronaut walk on Mars. Pick a start and science stops on a
3 km square around the boxwork ridges Curiosity studied in 2025-26, and the planner gives walking
routes with time, distance, slope, surface, energy and radiation per segment, and draws how far a
crew can walk and still get home.

**Golden case.** Curiosity spent most of a year at the boxwork, drilled three holes about 6 cm deep
(clay in a ridge, carbonate in a hollow), slipped in the sand-filled hollows, and left the main
questions open. A crew can cross ridge to hollow, sample ridge walls, dig under the sand and trace
the network in one six-hour walk.

## Run it

```bash
pnpm install
pnpm data      # one-time: downloads ~300 MB from NASA/USGS, keeps ~81 MB in data/ (gitignored)
pnpm dev       # web on http://localhost:5173, API/data server on :8787
pnpm test      # routing core unit tests
pnpm typecheck
```

The server port can be changed with `MARSMAP_API_PORT`. `http://localhost:5173/?area=fixture` runs on
synthetic test data (`pnpm --filter @marsmap/web fixture`).

## Layout

| Path | What |
|---|---|
| `config/` | Everything tunable: `area.json` (bounds), `walk-params.json`, `surface-classes.json`, `pois.json` |
| `scripts/` | Data pipeline. Downloads and prepares everything so the app never calls NASA live. [Details and sources](scripts/README.md) |
| `packages/core/` | Routing, walk model, walk-limit rings. Pure TypeScript, runs in a browser worker or on a server. [Equations and sources](packages/core/README.md) |
| `apps/web/` | React + Vite + MapLibre GL app (2D and 3D) |
| `apps/server/` | Hono server: serves `data/` and `config/` |
| `data/` | Generated, not in git |

## Where each piece of data comes from

| Data | Source | Used for |
|---|---|---|
| Elevation, 1 m, resampled to 2 m | USGS Astrogeology "Mars MSL Gale Merged DEM 1m v3" (HiRISE/CTX/HRSC tied to MOLA), https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m | Slope, routing, 3D terrain, elevation profile |
| Slope | Derived from the elevation grid (Horn, 3x3 cells) | Routing cost, impassable cells, slope layer |
| Surface conditions | **Estimate** derived from elevation roughness and HiRISE brightness/texture; not ground-truthed | Routing cost, surface layer |
| Orbital photo, 0.64 m/px | NASA Mars Trek WMTS `curiosity_hirise_mosaic` (MRO HiRISE, NASA/JPL/UArizona), https://trek.nasa.gov/mars/ | Base map |
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
| Radiation | 0.67 mSv/day | Curiosity RAD |

## Checks we ran on the data

- **Georeferencing:** elevation at Curiosity's 195 waypoints in the area matches the waypoint's own
  elevation to within 0.5 m, and the photo aligns with the terrain to within one 2 m cell.
- **Slope vs the rover:** at those waypoints our slope and the rover's recorded tilt agree at the
  median (8.9° vs 8.4°). The terrain is steep: median slope over the area is 12°, and about a quarter
  of cells exceed the 20° limit.

## Honest limits

- Mars has no GPS. "Go" plays a simulated walk; "Use my location" maps your real movement onto Mars.
- The boxwork ridges are sharp in the photo but barely resolved in the elevation data, so ridge and
  hollow targets are hand-placed, not detected.
- The map library treats Mars coordinates as Earth coordinates for display (about 0.35% distortion at
  this latitude). All distances and times come from the routing core, not the map.
- Routes move between 8 neighbouring cells, so paths can run up to about 8% longer than ideal.
- Stops are visited in the order given; the planner does not reorder them.

## Changing things

- **Bigger or different area:** edit `config/area.json`, run `pnpm data`.
- **Better surface map:** `scripts/src/import-layer.ts` resamples a grid or image onto the shared grid
  and registers it; no code change needed. See [scripts/README.md](scripts/README.md).
- **Walk model:** edit `config/walk-params.json` or `config/surface-classes.json`.
- **New cost factor** (shade, radiation shelter, no-go zones): add one factor function in
  `packages/core/src/costModel.ts`; the search and UI do not change.
