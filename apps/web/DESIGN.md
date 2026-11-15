---
name: EVAres
description: A planning map for an astronaut walk at Gale Crater, with every claim labelled by what it rests on.
colors:
  void: "#08090b"
  hull: "#0f1114"
  hull-raised: "#15181c"
  hull-pressed: "#1d2126"
  well: "#0a0b0d"
  track: "#262a31"
  ink: "#e8eaed"
  ink-2: "#a8adb5"
  ink-3: "#9aa0aa"
  ink-4: "#6e747e"
  seam: "rgba(255, 255, 255, 0.07)"
  seam-2: "rgba(255, 255, 255, 0.13)"
  seam-3: "rgba(255, 255, 255, 0.32)"
  glass: "rgba(17, 19, 23, 0.78)"
  glass-thick: "rgba(15, 17, 20, 0.92)"
  ok: "#4cc38a"
  warn: "#e5a93c"
  bad: "#f2594b"
  sim: "#36d1c4"
  mars: "#ff8a3d"
  mars-deep: "#c1440e"
  poi-drill-site: "#ff8a3d"
  poi-science-target: "#b594ff"
  poi-start: "#5fd08a"
  poi-viewpoint: "#5cc4f5"
  poi-rover: "#f2f0ea"
typography:
  display:
    fontFamily: "Helvetica Now Display, Helvetica Neue, Inter Tight Variable, Helvetica, Arial, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.022em"
  headline:
    fontFamily: "Helvetica Now Display, Helvetica Neue, Inter Tight Variable, Helvetica, Arial, sans-serif"
    fontSize: "22px"
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Helvetica Now Display, Helvetica Neue, Inter Tight Variable, Helvetica, Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 500
    lineHeight: 1.25
  body:
    fontFamily: "Helvetica Now Display, Helvetica Neue, Inter Tight Variable, Helvetica, Arial, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.42
    letterSpacing: "-0.005em"
  small:
    fontFamily: "Helvetica Now Display, Helvetica Neue, Inter Tight Variable, Helvetica, Arial, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Helvetica Now Display, Helvetica Neue, Inter Tight Variable, Helvetica, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "0.045em"
  mono:
    fontFamily: "Geist Mono Variable, ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.35
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  2xl: "18px"
spacing:
  gap: "12px"
  panel: "16px"
  side-width: "372px"
  side-width-compact: "336px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.well}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-secondary:
    backgroundColor: "rgba(255, 255, 255, 0.08)"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 12px"
  button-demo:
    backgroundColor: "{colors.mars-deep}"
    textColor: "#ffffff"
    rounded: "{rounded.xl}"
    padding: "10px 12px"
  panel:
    backgroundColor: "{colors.glass}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
  panel-large:
    backgroundColor: "{colors.glass}"
    textColor: "{colors.ink}"
    rounded: "{rounded.2xl}"
  side-panel:
    backgroundColor: "{colors.glass-thick}"
    textColor: "{colors.ink}"
    rounded: "{rounded.2xl}"
    width: "{spacing.side-width}"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "4px 10px"
  badge:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.sm}"
    height: "16px"
    padding: "0 6px"
---

# Design System: EVAres

## Overview

**Creative North Star: "The Field Notebook"**

This is a scientist's working map. A planner lays a walk over real ground and the interface keeps the
evidence, the caveats and the sources in view beside it. Nothing decorates: each mark either is data
or says how far the data can be trusted. The language is plain, with the mission's own terms (sol,
EVA, reserve, turn back) where they are the right words.

The map is the page. Panels float over it on one dark glass material and stay out of its way; the
chrome is monochrome on a single cool hue so that colour is free to mean something. Density is that
of a tool used for a long session at a desk, and it has to hold up on a phone too.

**Key Characteristics:**
- The verdict ("Fits the limits", or what breaks them) has one home and comes before the detail.
- Colour is reserved for status, data ramps, point-of-interest types and the one demo action.
- A dashed outline always means estimated or inferred. Evidence is tagged Rover, Orbit or Our reading.
- Hatching marks the safety reserve on a budget bar and nothing else.
- Explanations a reader may need open from an info button; they are never tooltip-only.

## Colors

A near-black cool neutral in lightness steps, with a small set of saturated colours that each carry
one meaning.

### Primary
- **Mars Rust** (#c1440e, with **Mars Orange** #ff8a3d as its light step): the one coloured action in
  the panel (the demo walk) and the walking segment of a budget bar. Not used for decoration.

### Neutral
- **Void** (#08090b): behind the map.
- **Hull** (#0f1114), **Hull Raised** (#15181c), **Hull Pressed** (#1d2126): docked, raised and
  pressed surfaces. Nothing that floats uses them as its fill: popovers and menus are glass.
- **Well** (#0a0b0d): inset fields and marker fills.
- **Ink** (#e8eaed), **Ink 2** (#a8adb5), **Ink 3** (#9aa0aa), **Ink 4** (#6e747e): text from primary
  to faint. Ink 3 is the muted text colour and holds about 5.8:1 on the side panel over the brightest ground
  (6.7:1 over dark ground); on lighter surfaces such as a selected row, step up to Ink 2. Ink 4 is for marks
  such as grips and hatching, not text: about 3.3:1.
- **Seams** (white at 7%, 13% and 32%): hairlines, input borders, and hover or dashed borders.
- **Glass** (rgba(17,19,23,0.78)) and **Thick Glass** (rgba(15,17,20,0.92)): the floating material,
  with a 12% white edge and a 28px blur. The edge is always drawn over the glass, never over bare ground, so
  every panel's edge reads the same; a panel whose glass is an inner layer (`glass-host`) carries its edge on that layer.

### Status and data
- **OK** (#4cc38a), **Warn** (#e5a93c), **Bad** (#f2594b): fits, close to or at a limit, over a limit.
- **Sim** (#36d1c4): the simulated or GPS position during a walk.
- **POI types**: drill site #ff8a3d, science target #b594ff, start #5fd08a, viewpoint #5cc4f5,
  rover #f2f0ea. The same colour is used in the list, on the card and on the map pin.

### Named Rules
**The Meaning Rule.** If a colour is on screen it is telling the planner something: a status, a data
value, a kind of place. Chrome stays neutral.

**The Dashed Rule.** A dashed outline means estimated or inferred, everywhere, and is used for nothing else.

## Typography

**Display and body font:** Helvetica Now Display where installed, Helvetica Neue on Apple devices,
Inter Tight elsewhere.
**Mono font:** Geist Mono, for coordinates and identifiers only.

**Character:** One tight grotesque throughout, with tabular figures so numbers line up. Headings are
large with negative tracking; everything else is small and even.

### Hierarchy
- **Display** (700, 26px, 1.05): the site name in the panel header.
- **Headline** (500, 22px, 1.1): a tab's opening line and card titles.
- **Title** (500, 17px, 1.25): the headline number on a route card.
- **Body** (400, 13.5px, 1.42): tab content.
- **Small** (400, 12.5px, 1.4): secondary text, controls, notes.
- **Label** (500, 11px, 0.045em, uppercase): section headings only.
- **Mono** (400, 11px): coordinates.

### Named Rules
**The Eleven Rule.** Nothing is set under 11px. The miniature markers inside the map key are the one exception.

**The Caps Rule.** Uppercase is for the heading that opens a section of a panel. Value labels, buttons,
names and badges are sentence case.

## Layout

The map fills the window and everything else floats over it. A *stage* covers the part of the map the
side panel leaves visible and only lays things out: it ignores the pointer, and each panel takes the
pointer back, so the map stays draggable in every gap.

- **Side panel:** 372px (336px under 1100px), 12px from the window edge, with header, tabs and one
  scrolling tab body. The header is the app name and the site name only. It collapses off the left edge.
- **Explore tab:** figures and pictures before prose. Top to bottom: the position and extent on one line;
  the typical sol as three tiles, each an icon and a value (temperature, daylight, radiation), with their
  source behind an info button; the walk card (a title, one sentence, the demo walk drawn as numbered
  steps, the demo button and "Plan your own", with the longer story folded behind "Why the boxwork?");
  the places as one list with a filter by kind; then Curiosity's counts as three tiles. A place's row is a
  32px picture of its ground with its pin colour on the corner, its name, and its kind and priority. The
  description is on the place's card, not in the list.
- **Plan tab:** top to bottom, the verdict and the three budgets as one block; the walk as one ordered
  list (start, stops, "Return to start" with a switch); the routes as a comparison table; then the Segment
  details and Walk settings disclosures. "Simulate walk" sits in a footer under the scrolling body. With no start and no stops it opens with a card that names the three steps and offers
  the demo walk.
- **Top right:** zoom buttons and the compass dial stack in the corner. The top left holds only the button that brings back a hidden side panel.
- **Middle:** the point-of-interest card on the right, 340px (300px under 1100px).
- **Top left:** empty, except for the prompt shown while the planner is placing the start.
- **Bottom row:** the suit meter (the Plan tab's stand-in when that tab is out of sight) or the walk panel, then the 2D/3D switch and gesture help on the right. In 3D a settings button joins the switch and opens a popover with vertical exaggeration and draw distance.
- **Foot:** a slim status bar: in this order, with a hairline rule between each piece: the map key, the elevation toggle with the route's length and relief, the scale bar, the position, then what is under the pointer (elevation, slope, surface, any science layer's value, distance from the start), and the imagery credit at the far end. This is the one place those readings are shown. Fixed-width pieces come first, so only the credit gives way as the readings change. The credit is said once, as text: when it does not fit, its cut edge fades and blurs out and the line slides to its end and back. The key opens upward as a glass panel of its own beside the bar, not inside it, because a blur nested in a blurred surface cannot see the map. The elevation profile opens above the status bar when asked and takes no room while folded.
- **Under 1100px** the elevation toggle drops its summary; the relief is written on the open profile instead.
- **Under 860px** the side panel becomes a bottom sheet (46dvh, 50dvh on phones) that folds to its tab
  bar; cards move to the left; a one-line verdict rides on the map. The status bar is the sheet's last
  row, under the Plan tab's footer.
- **Under 600px** the card takes the full width and the open sheet takes the elevation profile's room.

Each fact has one home. A second place that needs it is a stand-in, shown only while the home is out of
sight: the suit meter for the Plan tab's verdict, the walk panel for what the crew is doing.

The map is told how much of it is covered, so "centre" means the centre of what the planner can see,
and a selected place is never left under its own card.

## Elevation & Depth

Depth is drawn with hairlines. Only surfaces that float over the imagery get a shadow, and there are
two of them.

### Shadow Vocabulary
- **Float** (`0 0 0 0.5px rgba(0,0,0,0.7), 0 10px 30px rgba(0,0,0,0.45)`): the side panel, cards, the dock.
- **Float small** (`0 0 0 0.5px rgba(0,0,0,0.7), 0 4px 14px rgba(0,0,0,0.4)`): control bars, the key, readouts.

The map layer is its own stacking context: a raised marker stacks among the markers and never above a panel.

## Shapes

Rounded rectangles on a short scale: 4px for badges and map labels, 8px for controls, fields and tiles, 12px for small
floating panels, 18px for large ones. Nothing is a pill except the switch and the slider thumb. Borders are 1px hairlines. Point-of-interest pins are 12px
circles with a dark keyline and a light ring; a start is a rounded square. Stop markers are 22px
rounded squares carrying their number.

## Components

### Buttons
Buttons are skeuomorphic: small solid things lit from above, not flat fills.
- **Shape:** a rounded rectangle, 8px radius (6px for the small sizes), 32px tall, 12.5px medium text. Not a pill.
- **Raised** (`shadow-raised`): a dark 1px keyline, a bright top lip, a faint inner edge and a short drop
  shadow. No CSS border: the edge is in the shadow, flush with the fill.
- **Primary:** Ink fill with Well text, on the strong form (`shadow-raised-strong`), which adds a soft
  highlight across the top and shade along the bottom. Keep it faint: it should round the fill, not read as a gradient. One per group
  ("Simulate walk", "Add as stop").
- **Secondary:** an 8% white fill, raised; the everyday button. Select triggers are the same.
- **Pressed** (`shadow-pressed`): the drop shadow goes and the top edge darkens, on press and on a
  toggled-on button ("Pick on map" while picking).
- **Ghost and link:** icon buttons and inline "show" links. They have no surface, so no relief.
- **Glass:** a control that floats on the map, with a bright top lip.
- **Demo:** the one coloured button, Mars Rust, on the strong raised form. Still no glow.
- **Sunk** (`inset-shadow-sunk`): the opposite of raised, for what a thumb runs in or text is typed into:
  the tab bar, segmented controls and input fields are shaded under their top edge.
- The relief is drawn with shadows only, never a gradient fill, so a button's colour stays one token.
- **Focus:** a 2px Ink outline, 2px offset, on everything.

### Badges
- **Style:** 16px tall, 4px radius, 11px text, a hairline border and no fill.
- **Estimate:** dashed border. **Strong:** brighter border for primary objectives and rover evidence.
  **Warning:** amber border and text, used for "Synthetic test data".
- No filled pills: a count (the stops on the Plan tab) is a badge like any other.

### Panels and cards
- **Material:** glass, with a 12% white edge and a float shadow. The side panel uses thick glass.
- **One component:** every floating surface is a `Panel` or takes its classes from `panelVariants`. That
  includes everything that pops up: info notes, popovers and select menus are glass by default, with the
  12px corner, so a new popover matches without asking for anything. No surface sets its own radius, fill or
  blur. The one exception is a popup nested inside another glass surface (the map key inside the status
  bar), which is solid (`surface="solid"`) because a blur inside a blur cannot see the map.
- **Corner:** 12px for bars, readouts and controls on the map; 18px for cards, the walk panel and the side panel.
- **Padding:** 16px. A card's actions sit in a footer that stays put while the body scrolls.

### Inputs
- **Style:** transparent with a 13% white border, 8px radius, 32px tall. Number fields for dwell time sit in a Well fill.

### Switches and sliders
- **Switch:** a 38 x 22px capsule with a white pill thumb, in the macOS style. Off is a 30% white track,
  on is OK green. The thumb is white in both states, so the state never rests on colour alone. This is the
  one place a status colour is used in the chrome: it says the thing is on.
- **Slider:** a 6px capsule track, filled in Ink up to a white 24 x 16px pill thumb (28 x 20px on touch).
  A slider shows its value beside it.

### Fact tiles
A small figure in a faint tile (5% white fill, 8px corner): the value in medium weight with its label
under it, or an icon in place of the label where the unit already says what it is. Used for the typical
sol and Curiosity's counts on the Explore tab. Never more than three across.

### Layer rows
One row per layer on the Layers tab: a 32px preview, the name, an info button and a switch. The preview
is real data: 4 km of ground around the start in the chosen imagery (1 km for the mineral layers, whose 18 m pixels are only speckle from further out), with the layer drawn over it by the
function that draws it on the map. The opacity slider and the colour key show only while the layer is on.
What a layer means and where it comes from sit behind its info button. Base imagery is a four-column grid of square picture
cards showing the same 4 km of ground; the chosen one has an Ink outline and a check.

### Navigation
- Three tabs (Explore, Plan, Layers) as a segmented control; the active tab is a lighter fill. On the
  bottom sheet, tapping the active tab folds the sheet.
- **Segmented controls** and the tab bar are sunk 8px tracks with 2px of padding and a raised 6px thumb, so the corners are concentric. The
  2D/3D switch floats on the map, so it sits in a 12px panel with 4px of padding and 8px segments.

- **The thumb slides.** In a tab bar or segmented control the highlight is one element that moves and
  resizes from the old option to the new one (`SlidingThumb`), over 300ms on the panels' no-overshoot curve.
  It can be redirected part-way, and under reduced motion it swaps without moving. Options never paint
  their own selected fill.
- A scrolling panel's content simply runs under its neighbours' hairlines: there is no blur or fade at the
  scroll edges.

### Map labels
Every label on the map is one physical thing: a small black plate with engraved text (`MAP_LABEL_BOX` in
`map/mapLabel.ts`). The time-ring and walk-limit labels, the turn-back or tightest-point chip, the walker's
countdown and place names all use it. This is the one place the map is skeuomorphic, and it follows the
raised controls and the segmented meters: lit from above, drawn with shadows only.

- **The plate:** 18px tall, 4px corner, the Well fill, 11px medium in the mono face. No border: `shadow-plate`
  gives it a dark keyline, a bright top lip with a soft highlight under it, a dark bottom edge and a short
  shadow on the ground.
- **The text** is cut in: a 1px dark line above the letters. Ink 2 for a plain measure (a ring's time), Ink
  for a place, an event or a limit. Sentence case.
- **Status shows once, on a mark** (`MAP_LABEL_MARK`): the label's icon, or a 6px lamp with a highlight, a dark
  rim and a faint ring of its own colour. The plate and the text never take a status colour. The lamp is the
  only thing on the map that glows.
- **Place names are plates too.** There is no bare text on the map. A hovered or selected place shows its
  full name.
- **In 2D** a plate lies beside its point. **In 3D** it stands on a 14px post above it (`MAP_LABEL_POST`), with
  the pin, a foot mark or the turn-back diamond where the post meets the ground. Plates stay flat to the
  screen. Nearer ones draw over farther ones, and one whose point is behind a hill is dimmed (MapLibre's
  own covered-marker opacity).
- The walker's label holds only the work time left at a stop.

### Map dots
A dot on the map is a small dome lit from above, to match the plates (`shadow-dome`): a dark keyline, a light
ring so it holds on dark ground, a short shadow on the ground, a highlight under its top edge and shade under
its lower half. The place pins, the foot of a plate's post and the rover's waypoints all use it; the waypoints
are an image of the same dome, since they are drawn on the map canvas. The same dots in the map key, the
Explore list and a place card take the small form (`shadow-dome-sm`). The dome is drawn with shadows only, so
its colour stays the one token that says what kind of place it is.

### Map lines
Lines are flat, thin and keylined, with no glow. Their colours are the tokens, read once in
`map/mapPalette.ts` because MapLibre paint cannot use CSS variables. A broken line means estimated, modelled
or hypothetical, and nothing else.

- **Chosen route:** 3px on a 7px black casing. Ink, taking Warn from the caution slope and Bad in the last
  degree before the no-go slope. Like the budget bars it carries no colour until there is a status. A bar
  crosses it every 100 m.
- **Routes not chosen:** 1.5px Ink 2 hairlines on a thin casing. Pointing at or focusing a row of the route
  table brightens that route's line.
- **Legs past the limit:** dashed Bad on the black casing.
- **Walked part of a route:** solid Sim, 3px. The walk's position is a Sim dot in a thin Sim ring.
- **Time rings:** dotted Ink on a dark keyline (they are modelled). **Walk limit:** solid Warn.
- **Rover track:** solid, 1.25px, in the rover colour, with small waypoint dots (it was measured).
- **Planning window:** four corner brackets, not a dashed square (it is a boundary, not an estimate).

### Stop numbers
One badge in the Plan tab's list, on the map and in the map key (`STOP_BADGE`): a rounded square with a
6px corner and a 1.5px Ink border on a Well fill; the start is the same shape inverted. 18px in the list,
22px on the map (30px on touch screens).

### Walk list
Start, stops and "Return to start" as one ordered list, one line each: grip, number, name, dwell, remove.
The start row holds the start select and "Pick on map". Stops reorder by dragging or with the arrow keys
on the grip. What the crew does at a stop is on the place's card and, during a walk, in the walk panel.

### Route table
One row per route, selectable: its name and right-aligned columns
for time, distance, energy and hazard metres. The best figure in each column is in Ink and the rest are
muted; no colour is added. A route that does not fit says so in red under its name.

### Walk panel
The mode as plain text in the Sim colour, a Follow toggle and a close button; the clock; one line for what
is happening and, while the crew works at a stop, their task under it. Then the distance and bearing to
the next point, what is left of time, energy and oxygen on segmented meters, and the walk home. Beside the
clock is the headline: what is left of the tightest budget.

### Segmented meter
What is left of one budget, read like a battery (`SegMeter`, in `MiniBar`): a sunk track of 14 or 20
segments that light from the left. Each segment is coloured for what being down to it means: red for the
last tenth, amber for the last quarter, green above. So the last lit segment is the status, and the figure
beside the meter takes the same colour. Used where one glance has to do: the suit panel on the map and the
walk panel. Above the meters, the tightest budget is the headline: its percentage left in 26px, with its
name (`MeterHeadline`). Not used on the Plan tab, whose budget bars show the split a meter cannot.

### Slope bars
In Segment details, each leg carries 18 small bars of its slope from start to end: a bar is the steepest
ground in its stretch, as tall as that is against the no-go slope and in the colour the route line has
there on the map.

### Budget bar (signature)
One row per limit (EVA time, energy, oxygen), directly under the verdict: the name, the bar, and used /
usable. On the bar: used segments in colour, what is left in a faint green, the safety reserve hatched at
the end, a marker for the turn-back time, and a red hatched overrun if the plan exceeds the usable budget.
One legend serves all three bars. Each row has an info button, which also gives the split between walking,
stops and what is left, and a full text label for screen readers.

### Info button
A small "i" that opens a glass popover, the same material as the panels. Use it for any explanation a reader may need; a `title` tooltip is
only for a hint that repeats what is already visible.
A note is written for the planner: what the thing shows, the one caveat that matters, and a one-line
source, in at most three short paragraphs. Formulas, file URLs and scene lists stay in the data manifest;
a note never prints the manifest's `method` string.

## Do's and Don'ts

### Do:
- **Do** state the verdict once, above the detail, in the same words everywhere ("Fits the limits").
- **Do** label anything estimated, illustrative or synthetic, with the dashed style or in words.
- **Do** credit the data source wherever data is shown.
- **Do** use tokens (`text-muted-foreground`, `bg-well`, `text-warn`) rather than raw hex.
- **Do** give every control a name, a keyboard path and a touch size that works on a phone.
- **Do** round a duration the same way wherever one route's time is shown.

### Don't:
- **Don't** add a status dot, pill or badge for a state that is true almost all the time.
- **Don't** use uppercase outside section headings, or set text under 11px.
- **Don't** use unicode glyphs or emoji as icons; use lucide.
- **Don't** put a coloured left or right edge on an alert, or a gradient fill or glow on a button.
- **Don't** hide an explanation in a `title` tooltip.
- **Don't** let a panel cover the place the planner just selected.
