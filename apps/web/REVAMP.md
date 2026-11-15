# EVAres design revamp: spec

Status: proposal, nothing built. Base: `DESIGN.md` and `PRODUCT.md` as they stand on `main` after the
declutter (#19). This document says what changes, what stays, and in what order to build it. Where it
and `DESIGN.md` disagree, `DESIGN.md` is still the rule until the phase that changes it lands.

## 1. Direction

**North Star: "The Field Instrument".** The Field Notebook stays as the purpose: a scientist's working
map that keeps evidence, caveats and sources in view. The revamp changes how it looks and reads: like an
instrument a crew would trust, not a web dashboard. Four references, and what is taken from each:

| Reference | Taken | Left behind |
|---|---|---|
| Anduril / Lattice | Near-black, hairlines, dense aligned data, one accent | Marketing gloss, full-bleed imagery |
| Apple Watch Ultra | One dominant number per surface, round gauges, true black | Large soft radii on everything |
| Apple Camera, pro settings | Yellow for the active value, mono readouts, ruler scrubbers | Text floating with no backing |
| Cybertruck UI | Flat surfaces, angular cuts, the map as the page | Cuts on every element |

What does not change: the product principles in `PRODUCT.md`, the Meaning Rule, the Dashed Rule, the
verdict first, the one-home rule from the declutter, hatching for the reserve only, every explanation
reachable by touch and keyboard.

**The test for every addition:** it is data, or it says how far data can be trusted, or it says what the
planner is operating right now. Anything else is decoration and is out.

## 2. Decisions made here

These were open. Each is decided so the build can start; the ones marked *veto* are taste calls that are
cheap to reverse before phase 1.

1. **The accent is Signal yellow, and it is a chrome colour only.** It marks what the planner is
   operating: the selected option, keyboard focus, a value while it is being changed, and the one action
   that starts a walk. It never appears in the map canvas, where bright terrain would swallow it.
2. **Warn moves from amber to orange**, so it cannot be read as Signal. Amber and yellow are 11° of hue
   apart; orange and yellow are about 21°.
3. **Mars rust leaves the chrome.** The demo action takes Signal. Budget-bar segments become ink steps,
   so a bar shows colour only when it has a status to report.
4. **Drill sites take the rover colour** (*veto*). They are where Curiosity worked, so they join the
   rover's track and waypoints in the same warm white, as a diamond. That frees orange for Warn alone.
5. **Numbers are set in mono.** Every measured or computed value is Geist Mono with tabular figures.
   Names and prose stay in the grotesque.
6. **Uppercase widens by two uses:** readout labels and evidence tags, as well as section headings.
7. **Radii shrink and large surfaces get one cut corner** (*veto*). Circles stay for things that are
   round by nature: gauges, the compass, pins.
8. **Dark only becomes binding.** The map is dark imagery and the instrument look depends on it.
   `PRODUCT.md` lists this as undecided; phase 1 records it as decided.
9. **No brushed-metal fills, glow, scan lines or decorative HUD marks.** Considered and dropped: they
   fight the glass material and fail the test in section 1.

## 3. Colour

### Tokens

| Token | Now | Revamp | Note |
|---|---|---|---|
| `void` | `#08090b` | `#000000` | Behind the map: true black |
| `hull` | `#0f1114` | `#0b0c0e` | |
| `hull-2` | `#15181c` | `#121417` | Popovers |
| `hull-3` | `#1d2126` | `#1a1d21` | Pressed, selected |
| `well` | `#0a0b0d` | `#050506` | Inset fields, marker fills |
| `track` | `#262a31` | `#24272c` | Meter tracks |
| `ink` … `ink-4` | unchanged | unchanged | `ink-3` stays the 4.5:1 floor on panels |
| `seam`, `seam-2`, `seam-3` | unchanged | unchanged | |
| `glass` | `rgba(17,19,23,.78)` | `rgba(9,10,12,.84)` | Darker and flatter |
| `glass-thick` | `rgba(15,17,20,.86)` | `rgba(7,8,10,.92)` | |
| `blur` | `blur(28px) saturate(170%)` | `blur(20px) saturate(110%)` | Stops the ground tinting panels orange |
| **`signal`** | none | `#ffd60a` | New |
| **`signal-ink`** | none | `#0a0900` | Text on a Signal fill |
| `ok` | `#4cc38a` | `#30d158` | |
| `warn` | `#e5a93c` | `#ff8a1f` | |
| `bad` | `#f2594b` | `#ff453a` | |
| `sim` | `#36d1c4` | unchanged | Simulated or GPS position, on the map and in the walk panel |
| `mars`, `mars-deep` | `#ff8a3d`, `#c1440e` | removed from chrome | Kept only as the Mars tint's values, if needed there |
| `poi-drill-site` | `#ff8a3d` | `#f2f0ea` | Same as `poi-rover` |
| other `poi-*` | unchanged | unchanged | |

### Rules

- **The Meaning Rule** stands: a colour on screen is telling the planner something.
- **The Signal Rule** (new): Signal means "this is what you are operating". Its whole list of uses:
  1. the label of the selected option in a set (active tab, 2D/3D, playback speed, selected route name);
  2. a switch that is on;
  3. the keyboard focus ring;
  4. a value while its slider is being moved, and the slider's index mark;
  5. the fill of the one action that starts a walk ("Simulate walk", and the demo walk on Explore).

  Not for status, not for emphasis, not in the map canvas. If more than about one twentieth of a panel
  is Signal, something is using it wrongly.
- **Status is never colour alone.** OK, Warn and Bad always come with a word or an icon ("Fits the
  limits", "Over time", the turn-back arrow). This is true today and becomes a rule.
- **Data ramps keep their colours.** The Slope layer, the surface classes, elevation and the mineral
  ramps are data. The route line is not a ramp any more: it uses Ink, Warn and Bad (section 7). Check once that no mineral ramp ends within a few degrees of Signal's hue; the
  key shows ramps on a panel, next to Signal text.

### Contrast (to verify in phase 1)

Signal on glass, at least 12:1. `signal-ink` on Signal, at least 14:1. Warn on glass, at least 7:1.
`ink-3` on glass, at least 4.5:1. The focus ring gets a 1px dark keyline outside it so it holds on any
ground.

## 4. Type

| Role | Face | Size / weight | Case | Used for |
|---|---|---|---|---|
| Display | Grotesque | 26 / 700 | Sentence | Site name |
| Headline | Grotesque | 22 / 500 | Sentence | A tab's opening line, card titles |
| Body, Small | Grotesque | 13.5, 12.5 / 400 | Sentence | Prose, names, buttons |
| Section label | Grotesque | 11 / 500, +0.045em | Upper | Headings that open a section |
| **Readout label** | Grotesque | 11 / 500, +0.08em | Upper | The tag beside a value: `TIME`, `ELEV`, `LAT` |
| **Readout** | Geist Mono | 13 / 500 | As written | Any number with its unit |
| **Readout small** | Geist Mono | 11.5 / 400 | As written | Table figures, status bar, axis numbers |
| **Hero readout** | Geist Mono | 34 / 400, −0.02em | As written | The one dominant number on a surface |
| **Evidence tag** | Geist Mono | 11 / 500, +0.04em | Upper | `ROVER`, `ORBIT`, `OUR READING`, `ESTIMATE` |

- **The Mono Rule** (replaces "mono for coordinates only"): if it was measured or computed, it is mono.
  Durations, distances, energy, oxygen, angles, coordinates, percentages, counts in a table. Units stay
  with the number, in the same face, one step dimmer (`ink-2` beside `ink`).
- **The Hero Rule** (new): each floating surface has at most one hero readout. Walk panel: the clock.
  Suit meter: none. Plan tab: none; the verdict is words.
- **The Caps Rule** (widened): uppercase is for section headings, readout labels and evidence tags.
  Names, buttons, sentences and status words stay sentence case.
- **The Eleven Rule** stands: nothing under 11px.
- Figures are tabular everywhere. Use the mono face's slashed or dotted zero if it has one.
- A true minus sign (−) for negative numbers, as the profile axis does today.

## 5. Shape and material

| | Now | Revamp |
|---|---|---|
| Map labels, badges | 4px | 2px |
| Controls (buttons, inputs, segments) | 8px | 4px |
| Small floating surfaces (bars, readouts, popovers) | 12px | 6px |
| Large floating surfaces (side panel, cards, walk panel, profile) | 18px | 8px, with The Cut |
| Stop numbers | 6px | 3px |
| Bottom sheet, top corners | 22px | The Cut on both |

- **The Cut:** large surfaces lose their top-right corner to a 14px 45° cut. The bottom sheet is cut on
  both top corners. The Signal action button is cut 8px at the bottom right. Nothing else is cut: two
  kinds of element, no more.
- **Concentric corners** still hold: a control inside a small surface is 4px inside 6px with 2px of
  padding.
- **Circles** stay for the compass dial, pins, gauge rings, slider index hit areas and the spinner.
- **Material:** glass stays, darker and with less saturation (section 3). Depth is still hairlines; the
  two float shadows stay. No gradients on surfaces.
- **Building The Cut:** a `cut` variant on `Panel` and nowhere else. `clip-path` clips borders and
  shadows, so the variant needs the edge drawn as a layer (the existing `glass-layer` pattern, clipped,
  over a 1px larger clipped layer in the edge colour) and the shadow as `filter: drop-shadow()` on a
  wrapper. Check that `backdrop-filter` survives the clip in Chrome and Safari before building on it. If
  it does not, The Cut is dropped rather than faked.

## 6. Components

Only what changes. Everything not listed keeps its `DESIGN.md` entry with the new tokens.

### Buttons
- **Primary:** Ink fill, as now.
- **Go** (replaces Demo): Signal fill, `signal-ink` text, cut bottom-right. Two uses only: "Simulate
  walk" and the demo walk. "Use my location" stays Secondary.
- **Focus:** 2px Signal outline, 2px offset, dark keyline.

### Selection
- **Tabs and segmented controls:** the active item keeps its lighter fill and its label turns Signal.
- **Switches:** on is a Signal track with a dark thumb.
- **Route table:** the selected route's name is Signal. Best-per-column stays Ink against muted; the two
  marks do different jobs and must not merge.

### Readout (new, shared)
One component for "label + value": uppercase readout label, mono value, unit one step dimmer. It
replaces the ad hoc pairs in the hover readout, the status bar, the walk panel, POI card stats and the
segment details. Variants: inline (label then value on one line) and stacked (label over value).

### Budget bar (signature, revised)
- Segments are ink steps: walking `ink`, stops `ink-2`, leakage `ink-3`. What is left is the track.
- A scale under the bar: a tick per hour on time, per megajoule on energy, per 100 g on oxygen. It makes
  the bar a ruler and costs one repeating gradient.
- The usable-limit index stays. The turn-back marker takes Warn. Overrun stays red and hatched; the
  reserve stays hatched.
- The figure turns Warn from 85% and Bad over 100%, as now. Under 85% nothing on the bar is coloured.
- The legend shrinks to Walk, Stops, Leak, Reserve, as lightness keys.

### Sliders become rulers
The walk settings sliders and the vertical-exaggeration slider get a ticked track and a 2px Signal index
with a 44px hit area. While dragging, the value above it is Signal; at rest it is Ink. Same `Slider`
component and keyboard behaviour: this is a restyle.

### Evidence tags
The Rover, Orbit and Our-reading tags become evidence tags (section 4) in outline badges. Estimate keeps
its dashed border. Strong keeps its brighter border.

### Walk panel
- The clock is the hero readout, mono.
- The mode line stays Sim text.
- What is left of each budget is three Readout rows with the mini bars; the bars take the same ink and
  status treatment as the budget bar.
- Phase 4 option: replace the three mini bars with one three-ring gauge beside the clock (time outside,
  oxygen inside), each ring the fraction left, coloured only by status. Build it, compare it with the
  bars on a phone at arm's length, and keep whichever reads faster. The suit meter keeps bars either way.

## 7. Map chrome

- **Planning window as corner brackets.** The window is drawn as a dashed square today, which breaks the
  Dashed Rule: it is not an estimate. Draw four corner brackets instead. This is the viewfinder look,
  earned by a fix.
- **Rover track solid.** The track is measured and is also dashed today. Make it a thin solid line with
  its waypoint dots. Time rings stay dashed (they are modelled); legs past the limit stay dashed.
- **Centre reticle.** When the status bar's position is the centre of the view (no pointer over the map:
  touch and keyboard use), a thin Ink crosshair with a dark keyline marks that point, placed at the
  centre of the uncovered map. It disappears when a pointer is over the map. It says which place the
  coordinates refer to; that is its whole job.
- **POI pins get a shape as well as a colour:** drill site diamond, science target circle, viewpoint
  triangle, start square. The key and the Explore list use the same shapes. Colour-blind planners can
  tell types apart, and it is what lets drill sites share the rover colour.
- **Hover readout and status bar** use Readout: `ELEV −3619 m`, `SLOPE 4.2°`, `LAT 4.80634°S`. The status
  bar's separators stay hairlines.
- **Every map label is mono text in a black box.** One box for ring times, the walk limit, the turn-back
  or tightest point, the walker's countdown and place names: 18px tall, 2px corner, hairline border,
  `void` fill, 11px medium Geist Mono. Place names are boxed too; there is no haloed text on the map,
  because a black box holds on the brightest ground and a halo does not. This is the one place a name is
  set in mono. The text is neutral (`ink-2` for a measure, `ink` for a place, event or limit) and a status
  shows once, on the label's icon or a 6px dot, as `map/mapLabel.ts` already does.
- **Map lines are thin and keylined, with no glow.**
  - The chosen route is a 3px Ink line on a 7px black casing (now 4px on 8.5px), with a tick every
    100 m so it reads as a ruler.
  - **The route's colours come from the system palette, not a separate slope ramp.** The line is Ink and
    takes a colour only where the ground reports a status: Warn from the caution slope (15°), Bad at the
    no-go slope (20°). This is the budget bar's rule applied to the map. It replaces the four-step
    green, yellow, orange, red ramp, so the line no longer tells gentle ground from moderate; the
    elevation profile's slope band and the Slope layer still do.
  - Routes not chosen are 1.5px hairlines in Ink 2 on a thin casing, not wide faded lines in blue and
    green. The route table loses its colour swatches; pointing at a row lights that route's line.
  - The walked part of a route is the Sim colour at the same 3px, replacing the glow and white core.
  - The walker's position is a Sim dot in a thin Sim ring, replacing the translucent halo.
  - Time rings are dotted Ink with a dark keyline. They are teal today, which is also the colour of the
    simulated position; neutral rings leave Sim with one meaning.
  - The rover's track is a solid 1.25px line with smaller waypoint dots.
- **Walk-limit ring** takes the Warn token instead of its own amber.
- **Compass:** the north marker stays the one coloured mark on the dial and moves from Bad red to Ink
  with a filled wedge; red there says "error" under the new palette.
- **Scale bar** as a ticked ruler, to match the bars.

## 8. Motion

- Controls: 120 to 180 ms, ease-out, no bounce. Panels keep the 380 ms spring.
- Numbers never count up or roll. A value changes in place; tabular mono keeps it from shifting.
- Sliders snap to their steps. Map labels and rings fade in over 120 ms and do not scale.
- `prefers-reduced-motion` is honoured as now.

## 9. Not in this revamp

No new features or data. No change to `packages/core`, `scripts` or the pipeline. No light theme. No
layout changes beyond section 7: the declutter fixed the layout. No new fonts: both faces are already
loaded. No sound or haptics.

## 10. Build order

Each phase is one UI pull request and leaves the app shippable. Each updates the parts of `DESIGN.md`
it changes, so the file is never ahead of the code.

| Phase | What | Mostly touches | Done when |
|---|---|---|---|
| 0 | Leftovers from the declutter (below) | `GoPanel`, `Cards`, `MapView`, `routeCompare` | Listed items closed |
| 1 | Tokens, Signal uses, mono numbers, readout labels, evidence tags, budget bar in ink, Go button, dark-only recorded | `index.css`, `ui/*`, `SafetyBudget`, `PlanTab`, `DESIGN.md`, `PRODUCT.md` | No raw hex for chrome; contrast table measured; Signal appears only in its five uses |
| 2 | Radii and The Cut | `ui/panel.tsx`, `index.css`, `App.tsx` | Cut holds its edge, shadow and blur in Chrome and Safari; sheet and phone layouts unchanged in size |
| 3 | Map chrome: brackets, solid track, reticle, POI shapes, Readout in the hover readout and status bar | `MapView`, `MapLegend`, `HoverReadout`, `StatusBar`, `ExploreTab` | Key matches the map; no dashed line that is not an estimate |
| 4 | Instruments: ruler sliders, bar scales, ring gauge trial | `ui/slider.tsx`, `SafetyBudget`, `GoPanel` | Ring kept or dropped on the phone test, with the reason written down |

Phase 1 carries most of the visible change and has the least risk. Phases 2 and 4 hold the two *veto*
items and the trial, and can be skipped without leaving the rest half-done.

### Phase 0: leftovers
- On the bottom sheet, fold the elevation profile when a walk starts, so it is not pushed under the sheet.
- Convert the remaining warm raw colours: the route casing in the map paint, the "illustrative" note in
  `Cards.tsx`.
- Remove the unused comparison-text helpers from `routeCompare.ts`.
- Move the explanations still held only in `title` tooltips into info buttons or visible text: the mini
  bars' figures, the start row's coordinates and hint, the Follow toggle's hint.
- Check GPS mode with a live location, and dragging a stop with a real pointer.

### Checking each phase
`pnpm typecheck` and `pnpm test`, then the same set of states the declutter used, with screenshots:
planning at 1440, a simulated walk, the side panel hidden, 1000 wide, the bottom sheet at 800, a phone
at 375, and a route over its limits. Add for the revamp: keyboard focus visible on every control,
`prefers-contrast: more`, `prefers-reduced-transparency`, and the map over the brightest and darkest
ground in the region.

## 11. Risks

- **Signal creep.** The accent is the easiest thing to overuse. The five-use list is the guard; review
  each pull request against it.
- **Orange Warn next to red Bad.** They are about 25° apart. They always carry a word or icon, and Bad also
  carries hatching on the bars, but check the pair with a colour-blindness simulator in phase 1.
- **Mono width.** Mono text is wider than the grotesque. The route table and the status bar are the
  tight spots at 336px and 375px; measure them before merging phase 1.
- **The Cut and the blur.** If clip-path and backdrop-filter do not combine cleanly, drop The Cut.
- **Familiarity.** Drill sites changing colour and shape will surprise anyone who knows the current
  map. The key covers it; say so in the pull request.
