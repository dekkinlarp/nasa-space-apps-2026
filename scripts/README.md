# @marsmap/scripts — data pipeline

Downloads and derives everything the app needs into `data/<areaId>/` (gitignored), so the
app never calls NASA at runtime.

```sh
pnpm data                                        # = pnpm --filter @marsmap/scripts run all
pnpm --filter @marsmap/scripts run all -- --force   # rebuild outputs (downloads stay cached)
pnpm --filter @marsmap/scripts run all -- --refresh # also re-fetch waypoints, photo lists, weather, capabilities
pnpm --filter @marsmap/scripts run all -- --area /abs/path/other-area.json
```

Single steps: `elevation`, `imagery`, `derive`, `minerals`, `rover`, `photos`, `conditions`, `manifest`,
`preview`, `verify`, `import-layer`. Run order matters: `elevation` → `imagery` → `derive`
(the surface estimate needs the 1 m DEM window and the HiRISE grid copy).

Everything is driven by `config/area.json`. Every step skips outputs that exist; it rebuilds
when `--force` is passed or when `data/<id>/grid.json` differs from the current config.
Raw downloads (DEM strips, map tiles, API responses) are cached under `data/cache/`, so a
re-run downloads nothing. A first run for the 8 km area downloads about 1 GB, mostly DEM
strips and HiRISE tiles, and takes about 12 minutes. Run it with
`NODE_OPTIONS=--max-old-space-size=8192` to be safe: the stitched photo and 1 m DEM window are large.

## Outputs (`data/gale-boxwork/`)

The grid is 4000 × 4000 cells of 2 m. Row 0 is north, column 0 is west. Rasters are raw
little-endian. See `packages/core/src/types.ts`.

| File | What |
|---|---|
| `grid.json` | `GridSpec` built from `config/area.json` |
| `layers.json` | `LayerManifest`: the layers below plus the imagery list with exact bounds and pixel sizes |
| `elevation.f32` | Float32 metres (Mars areoid), 64 000 000 bytes |
| `slope.f32` | Float32 degrees, 64 000 000 bytes |
| `surface.u8` | Surface class ids (`config/surface-classes.json`), **estimated** |
| `surface_confidence.u8` | 0–255 heuristic confidence (max 200), **estimated** |
| `crism_clay.f32`, `crism_sulfate.f32`, `crism_hydration.f32` | CRISM mineral indicators (band depth), 18 m pixels resampled nearest-neighbour. Listed in `layers.json` with `group: "science"` |
| `minerals.json` | CRISM observation details, per-layer stats, the alignment result and the reading at each POI |
| `imagery/hirise.jpg` | HiRISE photo of the whole area, downscaled to 4096 px |
| `imagery/hirise_{r}_{c}.jpg` | Full-res 0.64 m/px HiRISE in an n×n split with every piece at most 4096 px (4×4 for the 8 km area; r 0 = north, c 0 = west). Each piece is its own `ImageryEntry`; the app loads only the pieces in view when zoomed in |
| `imagery/ctx.jpg` | CTX photo, about 10 m/px (about 790 px) |
| `imagery/themis_night.jpg`, `themis_day.jpg` | THEMIS IR, about 81 m/px (100 px). Coarse context only |
| `rover/MSL_waypoints.json`, `MSL_traverse.json` | Full MMGIS GeoJSON copies |
| `rover/waypoints.area.json` | Waypoints in the bounds + 0.002° margin, with tidy properties and `insideArea` |
| `rover/traverse.area.json` | Drive lines clipped to the bounds + margin, with the `sol` of the ending waypoint |
| `rover/photos.json`, `rover/photos/*.jpg` | Navcam frames: 3 per waypoint, 39 waypoints, at most 1280 px wide |
| `rover/drill-sites.json` | Altadena, Valle de la Luna and Nevado Sajama. Positions are **inferred** |
| `conditions.json` | Last 30 REMS sols (stale) plus the static RAD dose rate |
| `preview/*.png`, `preview/verify-report.json` | Quick-looks and check results. Not used by the app |

## Sources and processing

### elevation.f32
- **Source:** USGS Astrogeology, *Mars MSL Gale Merged DEM 1m v3*:
  `https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif`
  (label: `https://astrogeology.usgs.gov/ckan/dataset/b3d63877-8544-49bb-b0f3-532cf2c648d1/resource/d1a8afb0-3a48-4dcb-92a8-6c5794bb662f/download/msl_gale_dem_mosaic_1m_v3.lbl`).
- **Reading only the area:** `src/lib/striptiff.ts` parses the IFD over HTTP Range requests.
  The file is 3.87 GB, but it stores one 32980 px row per LZW strip, so the reader fetches only
  the strips that cover the area (in chunks of 64 rows). It decodes them with `src/lib/lzw.ts`.
  For the 8 km demo area that is 126 chunks, about 600 MB, cached in `data/cache/dem-gale-1m-v3/`.
- **Georeferencing:** the projection comes from the GeoKeys, not from assumptions. It is
  equirectangular with centre lon 0, standard parallel 0 and R = 3396190 m. The tiepoint is
  PixelIsPoint, so the pixel-0 edge is at X = 8127993.49 and Y = −244781.08, which matches the
  PDS label. Longitude is east-positive (137.38 is used as-is).
- **Resampling:** each 2 m cell is the area-weighted average of the 1 m pixels its footprint
  covers. Nodata (−32767) is excluded. The 1 m window is cached as
  `data/cache/<id>/dem_1m.f32` + `.json`.
- **Check:** the DEM is compared with the 535 Curiosity waypoints inside the area. DEM minus
  waypoint `elev_geoid` has a mean of −0.003 m, a median |d| of 0.055 m and a max |d| of 0.48 m.
  The MMGIS waypoint elevations are probably sampled from this same DEM, so this check
  validates the georeferencing (a horizontal offset of a few metres on 10° slopes would show up
  as metres of error). It does not validate absolute DEM accuracy. Cross-correlating the HiRISE
  photo with the DEM hillshade peaks at an offset of ≤ 1 cell.
- **Caveat:** the mosaic's *effective* resolution here is coarser than its 1 m posting. The
  boxwork ridge network is sharp in HiRISE, but in the hillshade it shows only as a mottled
  texture. Large ridges, buttes and scarps are well resolved.

### slope.f32
Horn 3×3 on the 2 m grid. Cell sizes come from the bounds (2.000 × 2.000 m). Edges use
clamped neighbours. Demo area: median 11.1°, p90 30°, p99 51°. The max is about 75°, on
scarp faces.

### surface.u8 / surface_confidence.u8 (ESTIMATE)
This is a rule-based guess. `layers.json` marks it with `estimated: true`, and the full method
text is in `src/derive.ts` (`SURFACE_METHOD`). It turns four cues into percentile ranks over
the area:
- 1 m DEM micro-roughness R
- topographic position index T (ridge or hollow, 30 m window)
- HiRISE brightness B (Gale sand is dark)
- HiRISE texture X

It then scores each class:
- **sand:** dark, smooth, low-lying and not steep
- **bedrock:** ridge, light-toned, moderately rough
- **rubble:** very rough or textured, or slope above 30°
- **firm soil:** a constant baseline

The class is the arg-max, followed by a 3×3 majority filter. Demo histogram: bedrock 31%,
firm soil 33%, sand 29%, rubble 6%, unknown 0%. Because ranks are relative, the class mix is
relative to whatever area you choose. The result has not been validated against rover
observations.

### Mineral indicators (CRISM)
- **Source:** MRO CRISM targeted observations FRT0000B6F1 (9 July 2008) and FRT0001BBA1
  (6 November 2010), MTRDR summary-parameter products `*_SU165J_MTR3` from the NASA PDS Geosciences Node
  (`https://pds-geosciences.wustl.edu/mro/mro-m-crism-5-rdr-mptargeted-v1/mrocr_4001/mtrdr/2008/2008_191/frt0000b6f1/`).
  It was found with the PDS Orbital Data Explorer REST API (`oderest.rsl.wustl.edu`, product type
  MTRDR, queried by the area bounds); of the five scenes that touch the area it is the one covering
  all of it.
- **Reading only the area:** the image is 60 band-sequential float32 bands of 775 x 714 px (133 MB).
  `src/minerals.ts` parses the ENVI header and range-reads only the rows over the area for four bands
  (about 1.5 MB each), cached in `data/cache/crism-<observation>/`.
- **Mosaic:** a cell takes the first scene in `CRISM_SCENES` that has data there: FRT0000B6F1 for
  89.3% of the area, FRT0001BBA1 for the western 10.7%. The second scene is moved by the median
  difference to the first where they overlap (52 443 pixels). The scenes agree only loosely there
  (r = 0.23 clay, 0.40 sulfate, 0.20 bound water), so the seam is real. `crism_scene.u8` records
  which scene each cell came from (1 or 2).
- **Bands:** `D2300` (Fe/Mg clay), `SINDEX2` (hydrated sulfate), `BD1900_2` (bound water), defined
  in Viviano-Beck et al. 2014 (doi:10.1002/2014JE004627). `R770` is used only for alignment.
- **Alignment:** the projection matches the DEM's (equirectangular, centre lon 0, R = 3396190 m),
  but the scene is offset. The step averages the HiRISE grid copy to CRISM pixels and tests
  whole-pixel shifts of up to 14 px, per scene. Result here: FRT0000B6F1 r = 0.59 unshifted, 0.80 at
  (8, 5) px; FRT0001BBA1 r = 0.30 unshifted, 0.64 at (11, 8) px. Both are applied. Over the central
  3 km alone the first scene peaked at (9, 3) px with r = 0.83, so the offset varies across a scene
  and one shift leaves an error of one to two pixels. A shift is skipped when it gains less than 0.05 or
  lands on the edge of the search window.
- **Display range:** 0 to the area's 98th percentile, stored in the layer's `display` field. Values
  at or below 0 are not drawn.
- **Other areas:** the scenes are listed in `CRISM_SCENES`. For a different area, pick covering
  MTRDR scenes and edit that list (first = preferred).

### Imagery
NASA Mars Trek WMTS (CORS ok):
`https://trek.nasa.gov/tiles/Mars/EQ/{LAYER}/1.0.0/default/default028mm/{z}/{row}/{col}.png`.
- **Tile grid:** zoom level z has 2^(z+1) × 2^z tiles of 256 px, with the top-left corner at
  (−180, 90).
- **Max zoom:** read from `WMTSCapabilities.xml`. If a level returns 404, the step falls back
  to lower levels.
- **Layers used:**
  - `curiosity_hirise_mosaic` at z16 (0.64 m/px, 2550 tiles)
  - `Gale_CTX_BlockAdj_dd` at z12
  - `THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018` and `THEMIS_DayIR_…` at z9
- **Crop:** the stitched mosaic is cropped to the area, snapped to whole image pixels. The
  `ImageryEntry` bounds are therefore the *exact* snapped bounds, which differ from the grid by
  less than one image pixel. The HiRISE crop is 12625 × 12580 px.
- **Downloads:** concurrency is 6, with retries. Tiles are cached in `data/cache/trek/`.

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

## Expanding the area
Edit the bounds, `width` and `height` in `config/area.json`, keeping cells at 2 m:
- `width ≈ R·Δlon·cos(lat)/2`
- `height ≈ R·Δlat/2`

Then run `pnpm data`. Only the new DEM strips and tiles are downloaded. Bounds must stay
inside the DEM mosaic (lat −5.099…−4.130, lon 137.124…137.681) and inside the
`curiosity_hirise_mosaic` extent (lat −4.925…−4.249, lon 137.122…137.730). A different `id`
writes to a new `data/<id>/` folder.

## Swapping in a better surface (or any) layer
`src/import-layer.ts` resamples an external raster onto the shared grid and registers it in
`layers.json`. It records the entry in `data/<id>/imported-layers.json`, which overrides a
built-in layer with the same id on every later manifest rebuild.

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
When you replace `surface`, also delete or replace `surface_confidence` if it no longer
applies.

## Known caveats
- The surface classes are a heuristic, not ground truth.
- The CRISM layers are indicators at 18 m per pixel, aligned to one to two pixels, with a seam between the two scenes.
- The THEMIS layers are about 81 m/px, so only 100 px across the area.
- The REMS weather is stale.
- Drill-site and photo positions are rover waypoints.
- pnpm reported `Ignored build scripts: esbuild, sharp`. Both work from their prebuilt
  platform packages, so no approval was needed.
