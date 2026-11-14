# @marsmap/core: routing and walk model

This is pure TypeScript with no DOM or Node APIs at runtime. The same code runs in a browser Web Worker, in Node and in a Cloudflare Worker. Source is consumed directly (`main: ./src/index.ts`).

```
pnpm --filter @marsmap/core test        # unit tests (synthetic grids with known answers)
pnpm --filter @marsmap/core typecheck   # tsc --noEmit
pnpm --filter @marsmap/core bench       # 1500x1500 timing run + smoke route on data/gale-boxwork if present
```

## Files

| file | what |
|---|---|
| `src/types.ts` | The shared contract. Core added only optional fields, each marked `(added by core, optional)`. |
| `src/params.ts` | `DEFAULT_WALK_PARAMS`, a copy of `config/walk-params.json`. A test checks they match. |
| `src/grid.ts` | `lonLatToCell`, `cellToLonLat`, `rowColToLonLat`, `distanceM`, `samplePoint` |
| `src/load.ts` | `loadLayers` (reads layers by id, maps nodata to NaN) and `computeSlope` (Horn 3x3), used when slope is missing |
| `src/costModel.ts` | **All walking physics.** It holds the factor pipeline and `createCostModel`. |
| `src/search.ts` | A generic 8-connected A* and a Dijkstra flood. They use a typed-array binary heap and know nothing about Mars. |
| `src/route.ts` | `DEFAULT_PROFILES`, `planRoute`, `planRouteAlternatives`, segment stats and limits |
| `src/reach.ts` | `computeReach`, which runs an outbound flood plus a reverse-direction flood |
| `src/contour.ts` | `reachRings` builds GeoJSON MultiPolygon coordinates with marching squares, then smooths, simplifies and handles holes |

## API notes for callers

The listed contract is implemented exactly. Additions are all optional.

- **Trailing `options` argument.**
  - `planRoute(..., dwellS?, { model?, extraFactors? })` and `planRouteAlternatives(...)` accept the same options.
  - `computeReach(..., { model?, extraFactors?, maxCost? })`.
  - `reachRings(grid, reach, budgets, { minRingAreaM2 = 16, simplifyCells = 0.35 })`.
  - `walkLimitRing(grid, reach, params, dwellS?)`: one ring where a crew can walk out, work `dwellS` and walk home with time, energy and oxygen all inside their usable share. `limitedBy` names the budget that runs out first.
  - `oxygenUsedKg(params, timeS, energyKJ)`: oxygen = energy x `o2KgPerKJ` + hours x `o2LeakKgPerH`. Route totals carry `o2Kg` and `o2UsedFraction`, and `limitingFactor` can be `"oxygen"`. The model is off when `o2BudgetKg` or `o2KgPerKJ` is missing.
  - If you call routing many times with the same layers and params, pass a prebuilt model: `const model = createCostModel(layers, params)`.
- **`createCostModel(layers, params, extraFactors?)`** returns a `MarsCostModel`. That is a `CostModel` plus:
  - `stepInto`, an allocation-free fast path;
  - `edgeCost(profile)`;
  - `minCostPerMetre(profile)`;
  - `blocked`, a Uint8Array cell mask.
- **Dwell.** `dwellS[i]` is the time spent at `points[i]`. When an entry is missing, the default is:
  - 0 at the start;
  - 0 at the last point if it is the start cell (a round trip);
  - `params.stopDwellS` everywhere else.
- **Dwell energy.** Dwell time also costs energy at `params.dwellMetabolicW`, a new optional WalkParams field. This is included in `totals.energyKJ` and reported separately as `totals.dwellEnergyKJ`.
- **Limits.**
  - The usable limits are `evaLimitS x (1 - reserveFraction)` and `energyBudgetKJ x (1 - reserveFraction)`.
  - Time and energy are accumulated leg by leg, including dwell. `firstSegmentOverLimit` is the first leg after which either running total goes over its limit.
  - `limitingFactor` is the limit broken at that leg. If both break there, it is the one broken by the larger ratio. It is null when the plan is within limits.
  - `timeUsedFraction` and `energyUsedFraction` are also given.
- **Unreachable stops.**
  - A stop that lands on an impassable cell is snapped to the nearest passable cell within 3 cells (`SNAP_RADIUS_CELLS`).
  - If no path exists, that leg's segment is empty and carries `reachable: false`. The stop index goes in `result.unreachableStops`.
  - The next leg is planned from the last stop that was reached, and its `from` says so. One bad stop does not wipe out the rest of the plan.
- **Segment stats.**
  - `distanceM` is horizontal.
  - `avgSlopeDeg` and `maxSlopeDeg` are the terrain slope (steepest direction) along the path, weighted by distance. They are not the directional grade.
  - `path` is the cell-centre path, simplified with Douglas-Peucker at 0.5 cell (1 m).
  - `profile` has one point per cell, or 300 points evenly spaced by distance on long legs.
- **Rings.**
  - Outer rings are counter-clockwise and holes clockwise. Every ring is closed.
  - Islands and holes smaller than 16 m^2 are dropped.
  - The region is `outTimeS + backTimeS <= budget`, where out and back follow the profile's cheapest paths.

## The cost model (equations)

For a step from cell `a` to its neighbour `b`, the inputs are:

- horizontal length `d` (cellSize, or cellSize x sqrt 2 on diagonals);
- `dz = z_b - z_a`;
- directional grade `G = dz/d`.

The built-in factors run in this order:

1. **validity.** No-data elevation or slope means the step is impassable.
2. **slope-limit.** The step is impassable if `|atan G| > maxSlopeDeg`, or if the destination cell's slope is above `maxSlopeDeg`. Cells above `maxSlopeDeg` also go into the `blocked` mask, and diagonal moves may not squeeze between two blocked cells.
3. **speed.** `v = baseSpeedMps x T(G) x (sf_a + sf_b)/2`.
   - `T` is Tobler's hiking function normalised to 1 on flat ground: `T(G) = exp(-3.5 |G + 0.05| + 0.175)`. It peaks at 1.19 at -2.86 deg and is direction-aware.
   - `sf` is the surface class `speedFactor`.
4. **metabolic.** This is the Pandolf load-carriage equation with the Santee downhill correction. It is the "modified field-use Pandolf" form used by NASA JSC's traverse model (Kim et al. 2024, eqs. 2 and 3):
   ```
   MP = 1.5W + 2.0(W+L)(L/W)^2 + eta(W+L)(1.5V^2 + 0.35 V G%)
   CF = eta[ G%(W+L)V/3.5 - (W+L)(G%+6)^2/W + (25 - V^2) ]    (applied only when G% < 0)
   Earth:  M = MP - CF
   Mars:   M = max(1.5W, 1.5W + (g/9.80665) x (MP - CF - 1.5W))
   ```
   - W is body mass (`bodyMassKg`) and L is suit mass (`suitMassKg`).
   - V is the step speed from factor 3.
   - eta is the mean `terrainFactor` of the two cells.
   - **Gravity scaling is an assumption.** The standing or basal term `1.5W` is kept and every load-bearing term is scaled by g/g_earth. Support for this: Carr & Newman measured basal metabolic rate of about 1.5 W/kg independent of gravity, while mass-specific walking cost rose with G-level. Norcross & Gernhardt report lower metabolic rates at reduced gravity.
   - At the defaults this gives about 455 W on flat bedrock at 1 m/s. That is above the Apollo and ISS averages of about 293 W, and above the 352 W exploration suit sizing point. This is consistent with ICES-2026-127's statement that Mars rates are expected to be higher.
   - Sample values at the defaults:

     | grade | speed | power | energy |
     |---|---|---|---|
     | -15% | 0.84 m/s | 427 W | 0.51 kJ/m |
     | 0 | 1.00 m/s | 455 W | 0.46 kJ/m |
     | +15% | 0.59 m/s | 605 W | 1.02 kJ/m |
     | flat loose sand | 0.6 m/s | 429 W | 0.72 kJ/m |
   - Steep descents cost more than gentle ones (Santee): 793 W at -30%.
5. **hazard.** Half of `d` is charged to each cell. A cell is hazardous if its class has `hazard: true` or its slope is at least `cautionSlopeDeg`.

The step result is then:

```
timeS    = d / v + extraTimeS
energyKJ = metabolicW x timeS / 1000 + extraEnergyKJ
hazardM  = (from the hazard factor and any extra factors)
search cost = timeS x timeWeight + energyKJ x energyWeight + hazardM x hazardWeight
```

**Profiles** (`DEFAULT_PROFILES`). Their weights are judgement calls, not sourced.

| id | timeWeight | energyWeight | hazardWeight | meaning |
|---|---|---|---|---|
| `fastest` | 1 | 0 | 0 | minimise walking time |
| `least-effort` | 0.02 | 1 | 0 | minimise metabolic energy; a tiny time term breaks ties |
| `safest` | 1 | 0.5 | 5 | each hazardous metre costs like about 5 s of extra walking |

**A\* heuristic.** The heuristic is octile distance x a lower bound on cost per metre. The bound is found by scanning every allowed grade against every pair-mean speed factor and both extreme terrain factors, then taking off 5%. Admissibility is checked against Dijkstra in the tests. If any extra factor sets `mayReduceCost`, the heuristic drops to 0.

## How to add a new cost factor, or change the model

Everything lives in `src/costModel.ts`. A factor is a small object:

```ts
import { createCostModel, type CostFactor } from "@marsmap/core";

const shade: CostFactor = {
  id: "shade",
  description: "Walking in shadow costs 20% more heater power",
  apply(s) {                        // s: StepState, one reused object: DO NOT allocate here
    if (shadow[s.to]) s.metabolicW += 0.2 * s.metabolicW;
    // other things you may do:
    //   s.blocked = true      make the step impassable
    //   s.speedMps *= 0.8     slow down
    //   s.hazardM += ...      count towards "safest"
    //   s.extraTimeS / s.extraEnergyKJ += ...
  },
  // optional: blocksCell(layers, params, i) => boolean   bans whole cells (no-go zones)
  // optional: mayReduceCost: true   set this if the factor can make steps cheaper
};
const model = createCostModel(layers, params, [shade]);
planRoute(layers, params, profile, points, dwell, { model });
```

- Extra factors run after the built-ins. Each one sees the speed, metabolic rate and hazard those computed.
- **Radiation as a route cost.** Add a factor that puts dose into `extraEnergyKJ`, or into a new weighted term. The route-level dose total (`totalTimeS x radiationMSvPerDay`) is computed in `computeTotals` in `route.ts`.
- **Changing the physics.**
  - To change it for everyone, edit the built-in factor in `costModel.ts`. `createCostModel` calls the built-ins directly for speed, in the order of `BUILTIN_FACTORS`, so keep the two in sync.
  - To replace the whole model, pass `createCostModel(layers, params, extra, { factors: [...] })`. The A* heuristic then becomes 0.
- **New tunable numbers.**
  1. Add an optional field to `WalkParams` in `types.ts`.
  2. Add it to `config/walk-params.json`, with a `_sources` entry.
  3. Add it to `src/params.ts`.
  4. Add a row to the table below.

## Parameters and sources

Every value in `config/walk-params.json` is listed below. The **Source** column only lists documents that were actually opened while writing this. Values marked "assumption" are not backed by a source.

| Parameter | Value | Source | How derived / caveats |
|---|---|---|---|
| `baseSpeedMps` | 1.0 m/s | Apollo Lunar Surface Journal, "Lunar gaits" (E. M. Jones) https://www.nasa.gov/wp-content/uploads/static/history/alsj/a11/a11.gaits.html | Apollo planners assumed 3.6 km/h (1 m/s) for an hour-long walk-back from a failed rover, and 0.75 m/s for longer ones. Measured Apollo 15 averages were lower: 0.3 to 0.6 m/s, including stops and geology. Armstrong's estimated speed was about 1 m/s. The Artemis conops walk-back sizing uses about 2 km/h. Treat 1.0 as a flat, firm-ground upper value: slope and surface factors bring typical speeds down to 0.5-0.9 m/s. |
| `maxSlopeDeg` | 20 deg | NASA, "EVA Lunar Surface Concept of Operations" (2020) https://www.nasa.gov/wp-content/uploads/2020/01/topic_1-_eva_lunar_surface_concept_of_operations.pdf | xEVA capability is "walking up/down/across a slope of up to 20°". The same document notes Apollo 15 traversed slopes of about 17°. This is a lunar suit requirement, used here for Mars (assumption). |
| `cautionSlopeDeg` | 15 deg | **assumption** | Set below the 20° limit. The same conops plans its traverses with slopes "up to ~12-16°". |
| `bodyMassKg` | 82 kg | Ogilvie et al., "Mars Spacesuit Mass Requirements", ICES-2026-127 https://ntrs.nasa.gov/api/citations/20260003038/downloads/Final_ICES2026_Mars_Mass_1.pdf | That paper's assumed average crewmember is 180 lbm. NASA standards there span 94-243 lbm. |
| `suitMassKg` | 104 kg | ICES-2026-127 (same) | 230 lbm is the recommended starting maximum Mars suit mass, PGS plus PLSS. For comparison: Apollo about 170 lbm, xEMU about 376-391 lbm. Treated as the Pandolf load L. |
| `gravity` | 3.71 m/s^2 | NASA NSSDC Mars Fact Sheet https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html | The fact sheet gives 3.73 m/s^2 as the *mean* value. We use the commonly quoted equatorial 3.71, since Gale is at 4.8° S. The difference is 0.5%. |
| `evaLimitS` | 21600 s (6 h) | Beaton et al. 2019, "Using Science-Driven Analog Research to Investigate EVA Science Operations Concepts...", Astrobiology 19(3) (BASALT) https://pmc.ncbi.nlm.nih.gov/articles/PMC6442238/ | Flight rule EM6: "A single EVA shall not exceed 6 h". Artemis conops gives a nominal "6±2 hours" (up to 8). |
| `reserveFraction` | 0.1667 | BASALT (same), rule EM7 | EVAs are planned to a 5 h timeline plus a 30-min margin inside the 6 h cap, so 1 h in 6 is held back. The same fraction is applied to energy (assumption). |
| `energyBudgetKJ` | 10130 kJ | ICES-2026-127 (sizing rate) + Artemis conops (8 h) | Exploration suits are sized for an average of 1200 BTU/hr (352 W). Over an 8 h EVA capability that is 352 W x 28800 s = 10130 kJ of metabolic load. The Apollo PLSS was designed for 4 h at 1200 Btu/hr (Carson, "Apollo PLSS performance report", https://ntrs.nasa.gov/api/citations/19720019460/downloads/19720019460.pdf). The real PLSS limit is O2, CO2 scrubbing and cooling, not "energy". This is a proxy. |
| `o2BudgetKg` | 0.55 kg | Placeholder | 1.2 lb of usable primary oxygen, the size of the Shuttle/ISS EMU primary charge. No Mars suit tank is defined, so the app exposes it as a slider. With the default 352 W sizing rate this lasts about 5.5 h, so oxygen and the 6 h time limit bind at similar distances. |
| `o2KgPerKJ` | 0.000071 kg/kJ | Physiology | About 20.1 kJ is released per litre of oxygen consumed (mixed diet), and a litre of O2 weighs 1.429 g at 0 °C and 1 atm: 1.429 / 20.1 = 0.071 g per kJ. |
| `o2LeakKgPerH` | 0.005 kg/h | Assumption | Suit leakage charged for every hour outside. Small next to breathing (about 90 g/h at 352 W). |
| `stopDwellS` | 1800 s | BASALT (Table 2) | The planned time was 30 min per sample location. The other planned blocks were 15 min approach, 5 min context survey and 30 min candidate search. |
| `radiationMSvPerDay` | 0.67 mSv/day | SwRI press release on Hassler et al. 2013, Science https://www.swri.org/press-release/swri-scientists-publish-first-radiation-measurements-surface-mars | MSL RAD measured an average GCR dose-equivalent rate in Gale from Aug 2012 to Jun 2013. The suit is assumed to give no shielding, and SPEs are not included. |
| `dwellMetabolicW` | 249 W | ICES-2026-127 | "ISS EVA profile has an average metabolic rate of 850 BTU/hr", built from Apollo, Skylab and Shuttle data. Used for time spent working at stops. |
| Pandolf equation + Santee CF | n/a | Kim, Hoffmann, Estep, Marshall-Goebel, Buckland, "Improving Metabolic Workload Estimation Accuracy for Planning and Analyzing Exploration Traverses", IEEE EMBC 2024 (NASA JSC) https://ntrs.nasa.gov/api/citations/20240001423/downloads/IEEE%20EMBC%202024.pdf | Eqs. 2 and 3 are used as written. They cite Santee et al. 2001 (Aviat Space Environ Med 72(6)) and Santee et al. 2003 (USARIEM TN03-3). We do not use their eq. 1/4 metabolic delay filter. Original Pandolf: Pandolf, Givoni & Goldman 1977, J Appl Physiol 43(4):577-581, cited via https://en.wikipedia.org/wiki/Pandolf_equation (the paper itself was not opened). |
| reduced-gravity scaling | g/9.80665 on load terms | **assumption**, informed by Carr & Newman, "Exoskeleton Energetics: Implications for Planetary EVA" (MIT) https://web.mit.edu/aeroastro/www/people/dnewman/pdf2/Exoskeleton%20Energetics_2017.pdf and Norcross & Gernhardt, "Selecting Tasks for Evaluating Human Performance as a Function of Gravity" (NASA JSC) https://ntrs.nasa.gov/api/citations/20110008554/downloads/20110008554.pdf | Basal rate is about 1.5 W/kg and independent of gravity (Carr & Newman), which is why the 1.5W term is not scaled. Walking metabolic rate falls in reduced gravity (Norcross & Gernhardt; Carson's Apollo data). Caveat: suit joint torques do not scale with g, so this may *under*-estimate suited cost. The terrain factor partly covers this. |
| Tobler slope-speed factor | `exp(-3.5\|G+0.05\|)` / flat | Tobler 1993, "Three presentations on geographical analysis and modeling", NCGIA TR 93-1, via https://en.wikipedia.org/wiki/Tobler%27s_hiking_function | This is an Earth hiking fit, normalised to 1 on flat ground so `baseSpeedMps` sets the scale. Applying it to suited Mars walking is an assumption. |
| Walk-range sanity check | n/a | NASA DRA 5.0, SP-2009-566 https://www.nasa.gov/pdf/373665main_NASA-SP-2009-566.pdf | DRA 5.0 says about 20 km per PLSS charge and about 15 km walk-back distance. Our model at the defaults gives about 18 km of flat walking in the 5 h usable time, or about 18.5 km in the usable energy. This is consistent. |

Other sources consulted but not used for a number:

- NASA, "Surface EVA Architectural Drivers" (2023). Walk-back and safe-haven range are named as qualitative drivers. https://ntrs.nasa.gov/api/citations/20230014957/downloads/Surface%20EVA%20Architectural%20Drivers.pdf
- A. Johnson, "An integrated traverse planner and analysis tool for future lunar surface exploration" (SEXTANT), MIT 2010. This is prior art for the same approach. Only the record page was opened, as the PDF download was blocked: https://dspace.mit.edu/handle/1721.1/59560
- Richmond, Potter & Santee, "Terrain Factors for Predicting Walking and Load Carriage Energy Costs: Review and Refinement", J Sport Hum Perf 3(3), 2015. Only the abstract page was opened; it notes the factors are empirical, from a limited set of surfaces. https://jhp-ojs-tamucc.tdl.org/jhp/article/view/67

### Surface classes (`config/surface-classes.json`, owned by the data pipeline)

Pandolf terrain coefficients eta come from Soule & Goldman 1972 (J Appl Physiol 32(5):706-708), via the table at https://en.wikipedia.org/wiki/Pandolf_equation:

| surface | eta |
|---|---|
| blacktop / treadmill | 1.0 |
| dirt road | 1.1 |
| light brush | 1.2 |
| heavy brush | 1.5 |
| swampy bog | 1.8 |
| loose sand | 2.1 |

No source gives Mars-specific values.

| id | class | speedFactor | terrainFactor | hazard | assessment / proposal |
|---|---|---|---|---|---|
| 0 | Unknown | 0.8 | 1.5 | no | Assumption. Fine as a pessimistic middle value. |
| 1 | Bedrock | 1.0 | 1.0 | no | eta = 1.0 matches "blacktop": firm, smooth. Boxwork bedrock is fractured, so 1.1 ("dirt road") may be more honest. |
| 2 | Firm soil | 0.9 | 1.2 | no | **Proposal: eta 1.1** ("dirt road" is the closest firm-ground analogue). 1.2 is the "light brush" value. |
| 3 | Loose sand | 0.6 | 2.1 | yes | eta = 2.1 is the Soule & Goldman loose-sand value. speedFactor 0.6 is an assumption. |
| 4 | Rocky rubble | 0.5 | 1.8 | yes | No rubble class exists in the source table; 1.8 borrows the "swampy bog" value. Assumption, and plausible. |

All `speedFactor` values are assumptions: no measured suited-walking data per surface was found. Because energy is computed per second at the slower speed, a low speedFactor *also* raises energy per metre through time. Do not double-count by pushing eta up as well.

## Performance

These figures are from Node 26 on the dev laptop, running `pnpm bench`.

| task | time |
|---|---|
| A* across 1.5 km on a synthetic 1500x1500 fractal grid | 0.3-0.4 s per profile |
| `computeReach` (two full 2.25 M-cell floods plus time/energy accumulation) | about 3 s synthetic, 1.7 s on the real Gale grid |
| `reachRings` | 0.1-0.4 s per budget |

Per-step evaluation takes about 55 ns and runs allocation-free. The search reuses its typed-array workspace between calls.

## Known limitations

- **Slope limits on the real data.** About 25% of the real Gale 2 m cells have a slope above 20° (Horn slope on the 1 m DEM). Many boxwork ridges are therefore walls, and reach rings carry about 1000 small holes. Some of this is DEM noise at 2 m. Smoothing elevation before computing slope is a pipeline decision.
- **8-connected moves.** Paths are octile, not Euclidean. On open flat ground they can be up to about 8% longer than straight. Reach rings on flat ground are octagons, with an area about 90% of the true circle.
- **What the floods minimise.** Reach rings use the profile's own cost to choose paths, then measure time along them. They are not exact minimum-time rings for non-time profiles.
- **Santee jump.** The Santee correction applies only for G < 0. This creates a step of about 22 W in metabolic rate (about 5%) at exactly 0% grade.
- **Mars energetics.** No Mars-specific suited walking data exists. The gravity scaling and the speed factors are assumptions (see the tables above).
