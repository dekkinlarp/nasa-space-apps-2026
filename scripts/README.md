# @marsmap/scripts — data pipeline

Downloads and derives everything the app needs into `data/<areaId>/` (gitignored), so the
app never calls NASA at runtime.

```sh
pnpm data                                        # = pnpm --filter @marsmap/scripts run all
pnpm --filter @marsmap/scripts run all -- --force   # rebuild outputs (downloads stay cached)
pnpm --filter @marsmap/scripts run all -- --refresh # also re-fetch waypoints, photo lists, weather, capabilities
pnpm --filter @marsmap/scripts run all -- --area /abs/path/other-area.json
```

Single steps: `prefetch`, `elevation`, `imagery`, `derive`, `minerals`, `rover`, `photos`, `conditions`,
`manifest`, `preview`, `verify`, `import-layer`. Run order matters: `elevation` and `imagery` → `derive`
(the surface estimate needs the 1 m roughness and the HiRISE grid copy) and `minerals` (needs the HiRISE
overview copy) → `manifest`. `prefetch` only downloads (DEM strips and imagery tiles), so the other steps
start from a full cache.

Everything is driven by `config/area.json`. Every step skips outputs that exist; it rebuilds
when `--force` is passed or when its outputs were built for a different grid.
Raw downloads (DEM strips, map tiles, API responses) are cached under `data/cache/`, so a
re-run downloads nothing. A first run for the 33 x 40 km region downloads about 4.3 GB (2.9 GB of
DEM strips, 1.4 GB of HiRISE tiles; about 25 minutes) and processing takes about an hour more (imagery and the surface estimate are the slow steps).
Nothing holds the whole region at full resolution: steps work through it one band of rows at a time,
keeping region-sized intermediates on disk in `data/cache/<id>/` (about 3 GB). Run with
`NODE_OPTIONS=--max-old-space-size=8192`.

## Outputs (`data/gale/`)

The grid is 16384 x 19968 cells of 2 m (32.8 x 39.9 km). Row 0 is north, column 0 is west. Full-resolution
layers are stored as tiles of 512 x 512 cells (1 km), 32 x 39 of them; coarse layers sit on the overview
grid of 16 m cells (2048 x 2496). Every raster is zlib-compressed int16 or uint8 values (`codec` in
`layers.json`); elevation is stored as differences along each row, which compress well. The format
and the reader are in `packages/core/src/tiles.ts`.

| File | What |
|---|---|
| `grid.json` | `GridSpec` built from `config/area.json` |
| `layers.json` | `LayerManifest`: the layers below (tiling, codec, overview) plus the imagery list with exact bounds and pixel sizes |
| `tiles/elevation/<r>_<c>.bin` | Elevation, metres (Mars areoid), in int16 steps of a few cm. A tile with no DEM data is not written (`present` in `layers.json`) |
| `tiles/surface/…`, `tiles/surface_confidence/…` | Surface class ids (`config/surface-classes.json`) and a 0-200 heuristic confidence, **estimated** |
| `overview/{elevation,slope,surface,surface_confidence}.bin` | The whole region on the 16 m grid: mean elevation, mean slope, most common class, mean confidence |
| `crism/crism_{clay,sulfate,hydration}.bin` | CRISM mineral indicators (band depth, int16 steps of 1e-5) on the 16 m grid, nearest-neighbour from 18 m (or 36 m) pixels. Listed with `group: "science"` |
| `crism/scene.bin` | Which CRISM scene each 16 m cell came from (1 = first in `CRISM_SCENES`) |
| `minerals.json` | CRISM scene list, alignment results, per-layer stats and the reading at each POI |
| `imagery/<layer>/l<level>/<r>_<c>.jpg` | Picture pyramids of HiRISE (0.64 m/px at level 0), CTX (~10 m/px) and THEMIS (~81 m/px). Pieces are at most 2048 px; each level up is 4x coarser, up to one picture of the whole region. Grayscale; the app tints visible imagery itself |
| `rover/MSL_waypoints.json`, `MSL_traverse.json` | Full MMGIS GeoJSON copies (not deployed) |
| `rover/waypoints.area.json` | Waypoints in the bounds + 0.002° margin, with tidy properties and `insideArea` (all 1389 of Curiosity's waypoints to sol 5073 are inside) |
| `rover/traverse.area.json` | Drive lines clipped to the bounds + margin, with the `sol` of the ending waypoint |
| `rover/photos.json`, `rover/photos/*.jpg` | Navcam frames: 2 per waypoint, 72 waypoints spread over the drive, at most 1280 px wide |
| `rover/drill-sites.json` | Altadena, Valle de la Luna and Nevado Sajama. Positions are **inferred** |
| `conditions.json` | Last 30 REMS sols (stale) plus the static RAD dose rate |
| `preview/*.png`, `preview/verify-report.json` | Quick-looks (from the overviews) and check results. Not deployed, except that the app reads the report |

Intermediates in `data/cache/gale/` (not deployed): `elev2m.f32` and `rough2m.f32` (region rasters on
the 2 m grid, 1.3 GB each), `hirise_grid.u8` (HiRISE on the 2 m grid) and `hirise_ov.u8` (on the 16 m grid),
`derive.json` (tiling, codecs, statistics), `imagery-entries.json`.

## Sources and processing

### Elevation (tiles/elevation)
- **Source:** USGS Astrogeology, *Mars MSL Gale Merged DEM 1m v3*:
  `https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif`
  (label: `https://astrogeology.usgs.gov/ckan/dataset/b3d63877-8544-49bb-b0f3-532cf2c648d1/resource/d1a8afb0-3a48-4dcb-92a8-6c5794bb662f/download/msl_gale_dem_mosaic_1m_v3.lbl`).
- **Reading only the region:** `src/lib/striptiff.ts` parses the IFD over HTTP Range requests.
  The file is 3.87 GB and stores one 32980 px row per LZW strip, so the reader fetches only the rows
  that cover the region (in chunks of 64 rows): 625 chunks, 2.9 GB, cached in `data/cache/dem-gale-1m-v3/`.
  It decodes them with `src/lib/lzw.ts`. The region spans nearly the full width of the mosaic.
- **Georeferencing:** the projection comes from the GeoKeys, not from assumptions. It is
  equirectangular with centre lon 0, standard parallel 0 and R = 3396190 m. The tiepoint is
  PixelIsPoint, so the pixel-0 edge is at X = 8127993.49 and Y = −244781.08, which matches the
  PDS label. Longitude is east-positive (137.38 is used as-is).
- **Resampling** (`src/elevation.ts`, one band of 512 grid rows at a time): each 2 m cell is the
  area-weighted average of the 1 m pixels its footprint covers. Nodata (−32767) is excluded; a cell
  with less than 30% coverage is nodata. The same pass computes the 1 m micro-roughness for the surface
  estimate. About 11.6% of the region has no DEM (mostly its north and south corners, outside the mosaic's footprint).
- **Holes** (`src/derive.ts`): gaps up to about 16 cells across are filled by neighbour averaging;
  larger gaps stay nodata, which the router treats as impassable and the map leaves undrawn.
- **Check:** see `verify` below.
- **Caveat:** the mosaic's *effective* resolution is coarser than its 1 m posting in many places. The
  boxwork ridge network is sharp in HiRISE, but in the hillshade it shows only as a mottled
  texture. Large ridges, buttes and scarps are well resolved.

### Slope
Horn 3x3 on the 2 m grid (cell sizes from the bounds, 2.000 x 2.000 m). Not shipped at full resolution:
the app computes it from the elevation tiles of the planning window the same way. The overview stores
the mean slope of each 16 m cell (so steep spots read gentler there). Region statistics are in `verify-report.json`.

### Surface (ESTIMATE)
This is a rule-based guess. `layers.json` marks it with `estimated: true`, and the full method
text is in `src/derive.ts` (`SURFACE_METHOD`). It turns four cues into percentile ranks over
the whole region (from a sample of every 29th cell, taken in a first pass over the bands):
- 1 m DEM micro-roughness R
- topographic position index T (ridge or hollow, 30 m window)
- HiRISE brightness B (Gale sand is dark)
- HiRISE texture X

It then scores each class:
- **sand:** dark, smooth, low-lying and not steep
- **bedrock:** ridge, light-toned, moderately rough
- **rubble:** very rough or textured, or slope above 30°
- **firm soil:** a constant baseline

The class is the arg-max, followed by a 3×3 majority filter. Because ranks are relative, the class
mix is relative to the region you choose; with the whole region the boxwork is ranked against the
plains too, so its classes differ from the 8 km-only build. The result has not been validated against
rover observations. Cells without elevation are class 0 (unknown).

### Mineral indicators (CRISM)
- **Source:** MRO CRISM targeted observations, MTRDR summary-parameter products `*_SU*J_MTR3` from the
  NASA PDS Geosciences Node (`https://pds-geosciences.wustl.edu/mro/mro-m-crism-5-rdr-mptargeted-v1/mrocr_4001/mtrdr/`).
  The scenes come from a PDS Orbital Data Explorer query (`oderest.rsl.wustl.edu`, product type MTRDR,
  bounded by the region): 22 scenes touch it; the 19 in `CRISM_SCENES` (`src/minerals.ts`) are used
  (three only clip its edges).
- **Reading only the region:** each image is 60 band-sequential float32 bands. `src/minerals.ts`
  parses the ENVI header and range-reads only the rows over the region for four bands, cached in
  `data/cache/crism-<observation>/`.
- **Grid:** the 16 m overview grid (CRISM pixels are 18 m, 36 m for HRL scenes).
- **Mosaic:** scenes in priority order: the two over the boxwork first (as in the 8 km build), then the
  other full-resolution (FRT) scenes, then the half-resolution (HRL) ones. Each scene in turn is moved by
  its median difference to the mosaic so far where they overlap, then fills the cells still empty.
  `crism/scene.bin` records which scene each cell came from. Scenes taken years apart agree only loosely,
  so seams are real.
- **Bands:** `D2300` (Fe/Mg clay), `SINDEX2` (hydrated sulfate), `BD1900_2` (bound water), defined
  in Viviano-Beck et al. 2014 (doi:10.1002/2014JE004627). `R770` is used only for alignment.
- **Alignment:** the projection matches the DEM's (equirectangular, centre lon 0, R = 3396190 m),
  but scenes are offset by up to a few hundred metres. For each scene the step averages the HiRISE
  copy on the 16 m grid to CRISM pixels and tests whole-pixel shifts of up to 20 px. A shift is applied
  when it gains at least 0.02 in correlation and is not on the edge of the search window (on the 16 m
  grid the photo is blurred, so gains are smaller than they were on the 2 m grid; every scene's best
  match sits about 8 px east and 4-12 px south of where the label puts it). Results per
  scene are in `minerals.json`; expect one to two pixels of residual error.
- **Display range:** 0 to the region's 98th percentile, stored in the layer's `display` field. Values
  at or below 0 are not drawn.
- **Other areas:** edit `CRISM_SCENES` (first = preferred).

### Imagery
NASA Mars Trek WMTS (CORS ok):
`https://trek.nasa.gov/tiles/Mars/EQ/{LAYER}/1.0.0/default/default028mm/{z}/{row}/{col}.png`.
- **Tile grid:** zoom level z has 2^(z+1) × 2^z tiles of 256 px, with the top-left corner at
  (−180, 90).
- **Max zoom:** read from `WMTSCapabilities.xml`.
- **Layers used:**
  - `curiosity_hirise_mosaic` at z16 (0.64 m/px; 49 938 tiles, 1.4 GB, none missing over the region)
  - `Gale_CTX_BlockAdj_dd` at z12
  - `THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018` and `THEMIS_DayIR_…` at z9
- **Pyramid** (`src/imagery.ts`): the region's pixel window is snapped outwards to whole image pixels, so
  each picture's `ImageryEntry` bounds are exact. Level 0 is built one band of 2048 rows at a time
  (the HiRISE window is 51 693 x 62 799 px), cut into pieces of at most 2048 px; each level up is the
  4x4 mean of the one below, until one picture holds the region (HiRISE: 4 levels). Pieces with no
  pixels are skipped. Grayscale JPEG, quality 84.
- **Grid copies:** HiRISE is also resampled onto the 2 m grid (`hirise_grid.u8`, for the surface estimate)
  and the 16 m grid (`hirise_ov.u8`, for the CRISM alignment), one band of grid rows at a time.
- **Downloads:** concurrency 8, with retries. Tiles are cached in `data/cache/trek/`.

### Rover
- **Waypoints and traverse:** `https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json`
  and `MSL_traverse.json`. Waypoint properties include sol, site/drive, lon/lat, `elev_geoid`,
  tilt/pitch/roll/yaw and distance. They contain no image links, so each waypoint gets a
  `rawImagesUrl` that points to the raw-images page for its sol.
- **Photos:** from `https://mars.nasa.gov/rss/api/?feed=raw_images&category=msl&feedtype=json&num=50&page=0&order=sol+desc&&sol=<SOL>`.
  - A request with `sol=` returns *all* images for that sol in one response and ignores
    `num`/`page`.
  - `search=NAV_LEFT_B` and `extended=sample_type::full,` work, but then the sol filter is
    ignored, so the pipeline filters by instrument and sample type itself.
  - It keeps end-of-sol `NAV_LEFT_B` full frames, which are taken after the drive at the
    waypoint position.
  - It rejects mostly-black frames: many Mastcam "full" frames are vignetted close-ups.
  - Waypoints are 36 evenly spread sols plus the three drill sols. Photo positions are the
    waypoint's, not the camera target's.
- **Drill sites:** each position is the rover's last waypoint at or before the drill sol:
  - Altadena: sol 4548 → waypoint 4548
  - Valle de la Luna: about sol 4692 (NASA blog: drilled Oct 18–19 2025) → waypoint 4687
  - Nevado Sajama: sol 4718 → waypoint 4711

  All three are inside the area. They are inferred positions, not surveyed ones.

### conditions.json
- **Weather:** REMS `https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json`.
  The feed is Latin-1 and about 3 months stale: the last sol is 4995 (2026-08-25). The file
  keeps the 30 latest sols with data (air and ground temperature, pressure, sunrise/sunset,
  UV), a summary, and `stale: true`.
- **Radiation:** `{ mSvPerDay: 0.67, source: MSL RAD (Hassler et al. 2014), static: true }`.

## Changing the region
Edit the bounds, `width` and `height` in `config/area.json`, keeping cells at 2 m and `width` and
`height` whole multiples of `tileSize`:
- `width ≈ R·Δlon·cos(lat)/2`
- `height ≈ R·Δlat/2`

Then run `pnpm data`. Only the new DEM strips and tiles are downloaded. Bounds must stay
inside the DEM mosaic (lat −5.099…−4.130, lon 137.124…137.681) and inside the
`curiosity_hirise_mosaic` extent (lat −4.925…−4.249, lon 137.122…137.730); the current region is about
the largest box inside both. A different `id` writes to a new `data/<id>/` folder.

## Swapping in a better surface (or any) layer
`src/import-layer.ts` resamples an external raster onto the shared grid, writes it as tiles (and an
overview) like the built-in layers, and registers it in `layers.json`. It records the entry in
`data/<id>/imported-layers.json`, which overrides a built-in layer with the same id on every later
manifest rebuild.

The input can be:
- a raw little-endian grid (`--dtype float32|uint8`, `--width`, `--height`, row 0 = north), or
- an image that sharp can read (first band → uint8).

The input must be lon/lat-linear and cover the bounds you give. Relative paths resolve from
`scripts/`.

```sh
# a hand-mapped class map (PNG with values = class ids) replacing the estimate:
pnpm --filter @marsmap/scripts run import-layer -- --id surface --in /abs/surface.png --nearest \
  --west 137.355605 --east 137.406395 --south -4.833306 --north -4.782694 \
  --units "class id" --source "My mapping" --method "manual"
# a continuous layer (bilinear):
pnpm --filter @marsmap/scripts run import-layer -- --id thermal_inertia --in /abs/ti.f32 \
  --width 600 --height 600 --dtype float32 --west ... --east ... --south ... --north ... --units "tiu" --estimated
```
When you replace `surface`, also replace `surface_confidence` if it no longer applies.

## Known caveats
- The surface classes are a heuristic, not ground truth.
- The CRISM layers are indicators at 18-36 m per pixel, aligned to one to two pixels, from 19 scenes with seams between them.
- The THEMIS layers are about 81 m/px, so only about 400 px across the region.
- The REMS weather is stale.
- Drill-site and photo positions are rover waypoints.
- About 11.6% of the region has no DEM; the map leaves it blank and routes avoid it.
- pnpm reported `Ignored build scripts: esbuild, sharp`. Both work from their prebuilt
  platform packages, so no approval was needed.
