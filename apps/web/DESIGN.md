---
name: EVAres
description: A planning map for an astronaut walk at Gale Crater, with every claim labelled by what it rests on.
colors:
  void: "#000000"
  hull: "#0e0f11"
  hull-raised: "#17181b"
  hull-pressed: "#1f2124"
  poi-drill-site: "#ff7ab6"
  poi-science-target: "#b594ff"
  poi-start: "#5fd08a"
  poi-viewpoint: "#5cc4f5"
  well: "#040405"
  track: "#26282c"
  ink: "#f2f2f3"
  ink-2: "#b4b6bb"
  ink-3: "#9a9ca2"
  ink-4: "#6b6f76"
  seam: "rgba(255, 255, 255, 0.08)"
  seam-2: "rgba(255, 255, 255, 0.16)"
  seam-3: "rgba(255, 255, 255, 0.32)"
  panel-edge: "#3a3d42"
  signal: "#ffd60a"
  warn: "#ff9f0a"
  bad: "#ff453a"
typography:
  display:
    fontFamily: "Inter Tight Variable, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "56px"
    fontWeight: 500
    lineHeight: 0.8
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Inter Tight Variable, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "22px"
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Inter Tight Variable, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 500
    lineHeight: 1.25
  body:
    fontFamily: "Inter Tight Variable, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.42
    letterSpacing: "-0.005em"
  small:
    fontFamily: "Inter Tight Variable, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Geist Mono Variable, ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "0.1em"
  mono:
    fontFamily: "Geist Mono Variable, ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.35
rounded:
  sm: "3px"
  md: "4px"
  lg: "6px"
spacing:
  gap: "12px"
  panel: "16px"
  side-width: "372px"
  side-width-compact: "336px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.well}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 12px"
  button-secondary:
    backgroundColor: "#202226"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 12px"
  panel:
    backgroundColor: "{colors.hull}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
  key:
    backgroundColor: "{colors.hull-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
  side-panel:
    backgroundColor: "{colors.hull}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    width: "{spacing.side-width}"
  input:
    backgroundColor: "{colors.well}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
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

**Creative North Star: "The Field Instrument"**

This is a scientist's working map, built like a piece of field hardware: black bodies, raised keys, sunk
displays, engraved plates, one signal colour. A planner lays a walk over real ground and the interface keeps
the evidence, the caveats and the sources in view beside it. Nothing decorates: each mark either is data or
says how far the data can be trusted. The language is plain, with the mission's own terms (sol, EVA, reserve,
turn back) where they are the right words.

The map is the page: it opens in 3D, south up, with the Mars colour tint on. Panels float over it as solid black surfaces
and stay out of its way. Density is that of a tool used for a long session at a desk, and it has to hold up
on a phone too.

**Key Characteristics:**
- The verdict ("Fits the limits", or what breaks them) has one home and comes before the detail.
- Signal yellow means on, selected or live, and nothing else. A walk that fits carries no colour.
- State shows in a control's own form (a raised thumb, a knob's position) or in a word. There are no status dots.
- Every number is in the mono face; labels are small mono capitals. Units keep their SI case.
- A dashed outline always means estimated or inferred. Evidence is tagged Rover, Orbit or Our reading.
- Explanations a reader may need open from an info button; they are never tooltip-only.

## Colors

Neutral black in lightness steps, one signal colour and two status colours.

### Signal
- **Signal Yellow** (#ffd60a): the open tab, the picked segment, a switch that is on, the walked part of a
  route, the walker and the live clock. It is never a button's fill and never decoration.

### Neutral
- **Void** (#000000): behind the map.
- **Hull** (#0e0f11): panel bodies. **Hull Raised** (#17181b): keys that float on the map and map plates.
  **Hull Pressed** (#1f2124): thumbs and selected rows.
- **Well** (#040405): anything sunk into a panel: tab tracks, fields, meters, displays.
- **Ink** (#f2f2f3), **Ink 2** (#b4b6bb), **Ink 3** (#9a9ca2), **Ink 4** (#6b6f76): text from primary to
  faint. Ink 3 is the muted text colour, about 7:1 on a panel. Ink 4 is for marks such as grips, not text.
- **Seams** (white at 8%, 16% and 32%): hairlines, dividers, and hover or dashed borders.
- **Panel edge** (#3a3d42): the 1px edge of a panel. Keys take a black keyline and a lit top edge instead.

### Status and data
- **Warn** (#ff9f0a): close to a limit, a caution slope, a turn-back time. **Bad** (#ff453a): over a limit.
- There is no "ok" colour. A budget with room, a route that fits and the tick beside the verdict are plain ink.
- Kinds of place differ twice, by shape and by colour: a drill site is a pink diamond (#ff7ab6), a science
  target a violet ring (#b594ff), a viewpoint a blue disc (#5cc4f5), a start a green square (#5fd08a). The
  same mark is used in the list, on the card, in the map key and on the map. These colours keep clear of
  the signal yellow and of the status orange and red.
- Data ramps (minerals, slope, elevation) keep their own colours; they are data, not chrome.

### Named Rules
**The Signal Rule.** Yellow says on, selected or live. If none of those is true, the thing is not yellow.

**The Quiet Rule.** Nothing is coloured while the walk is fine. Orange and red appear only with a reason.

**The No Dots Rule.** No lamp, dot or square is placed beside a label to mark a state. The control's form,
the label's colour or a word carries it. A swatch that keys a data ramp is not a status dot.

**The Dashed Rule.** A dashed outline means estimated or inferred, everywhere, and is used for nothing else.

## Typography

**Text font:** Inter Tight, for names and prose.
**Mono font:** Geist Mono, for every number, coordinate and label.

**Character:** A tight grotesque for what is read, a mono face for what is measured. Labels are small mono
capitals with open tracking, like the engraving on an instrument.

### Hierarchy
- **Display** (500, 56px): the one number to glance at, what is left of the tightest budget, in its display.
  The walk's clock is the same face at 40px.
- **Headline** (500, 22px, 1.1): card titles and a tab's opening line.
- **Title** (500, 17px, 1.25): the site name in the panel header.
- **Body** (400, 13.5px, 1.42): tab content. **Small** (400, 12.5px, 1.4): secondary text and notes.
- **Label** (mono 500, 11px, 0.1em, uppercase): section headings, tab and button text, the names of readouts.
- **Readout** (mono 400 to 500, 11px to 12.5px): every figure.

### Named Rules
**The Eleven Rule.** Nothing is set under 11px. The miniature markers inside the map key are the one exception.

**The Units Rule.** Labels are capitals; units never are. "1h 44m", "569 m" and "1.82 MJ" stay as written,
because "M" would read as both minutes and metres.

**The Brand Rule.** The name is written EVAres, in the mono face, and is never set in capitals.

## Layout

The map fills the window and everything else floats over it. A *stage* covers the part of the map the
side panel leaves visible and only lays things out: it ignores the pointer, and each panel takes the
pointer back, so the map stays draggable in every gap.

- **Side panel:** 372px (336px under 1100px), 12px from the window edge, with header, tabs and one
  scrolling tab body. The header is the app name and the site name only. A slim handle on its right edge
  hides it, and stays at the window's left edge to bring it back.
- **Explore tab:** figures and pictures before prose. Top to bottom: the position and extent on one line;
  the typical sol as three readout rows, each an icon, a name and a value (temperature, daylight, radiation),
  with their source behind an info button; the walk card (a title, one sentence, the demo walk drawn as numbered
  steps, the demo button and "Plan your own", with the longer story folded behind "Why the boxwork?");
  the places as one list with a filter by kind; then Curiosity's counts as three tiles. A place's row is a
  32px picture of its ground with its pin colour on the corner, its name, and its kind and priority. The
  description is on the place's card, not in the list.
- **Plan tab:** top to bottom, the verdict and the three budgets as one block; the walk as one ordered
  list (start, stops, "Return to start" with a switch); the routes as a comparison table; then the Segment
  details and Walk settings disclosures. "Simulate walk" sits in a footer under the scrolling body. With no start and no stops it opens with a card that names the three steps and offers
  the demo walk.
- **Top right:** one stack of keys in the corner: zoom in, zoom out, home, and the compass as its last cell.
- **Middle:** the point-of-interest card on the right, 340px (300px under 1100px).
- **Top left:** empty, except for the prompt shown while the planner is placing the start.
- **Map edges:** coordinate ticks, like the frame of a chart: longitude along the top and latitude down the left, just clear of the side panel, labelled in mono at round values with plain ticks between. They follow the map, and are hidden in 3D.
- **Bottom row:** the walk panel while a walk is running (on small screens also a one-line verdict, the Plan tab's stand-in while the sheet hides it), then the 2D/3D switch and gesture help on the right. In 3D a settings button joins the switch and opens a popover with vertical exaggeration and draw distance.
- **Foot:** a status bar, 32px tall with 16px of side padding and mono text: in this order, with a hairline rule between each piece: the map key, the elevation toggle with the route's length and relief, the scale bar, the position, then what is under the pointer (elevation, slope, surface, any science layer's value, distance from the start), and the imagery credit at the far end. This is the one place those readings are shown. Fixed-width pieces come first, so only the credit gives way as the readings change. The credit is said once, as text: when it does not fit, its cut edge fades and blurs out and the line slides to its end and back. The key opens upward as a panel of its own beside the bar. The elevation profile opens above the status bar when asked and takes no room while folded.
- **Under 1100px** the elevation toggle drops its summary; the relief is written on the open profile instead.
- **Under 860px** the side panel becomes a bottom sheet (46dvh, 50dvh on phones) that folds to its tab
  bar; cards move to the left; a one-line verdict rides on the map. The status bar is the sheet's last
  row, under the Plan tab's footer.
- **Under 600px** the card takes the full width and the open sheet takes the elevation profile's room.

Each fact has one home. A second place that needs it is a stand-in, shown only while the home is out of
sight: the one-line verdict on small screens for the Plan tab's verdict, the walk panel for what the crew is
doing. On wide screens the suit's figures live only on the Plan tab, with no floating card on the map. A
stand-in links to its home: tapping the one-line verdict opens the Plan tab, and once the demo walk is in the
plan the Explore card offers "View the plan" in place of loading it again.

The map is told how much of it is covered, so "centre" means the centre of what the planner can see,
and a selected place is never left under its own card.

## Elevation & Depth

Relief is drawn with shadows only: a lit top edge, a black keyline, a short drop shadow. No fill is a
gradient. Three heights are in use.

- **Raised** (`shadow-raised`, `shadow-thumb`, `shadow-key`): buttons, thumbs and the keys that float on the map.
- **Flush**: the panel body, with its grey edge.
- **Sunk** (`sunk`, `inset-shadow-sunk`, `shadow-lip`): tab tracks, segmented controls, fields, meters and
  displays. A black fill shaded under its top edge, with a faint lit lip below.

The map layer is its own stacking context: a raised marker stacks among the markers and never above a panel.

## Shapes

A short scale: 3px for plates and badges, 4px for keys and thumbs, 6px for tracks, displays and panels.
Nothing is a pill except the switch and the slider thumb. The side panel and the main action each have one
cut corner (`chamfer`, 16px top right on the panel; `chamfer-br`, 10px bottom right on the button), and
nothing else does. Stop markers are 22px rounded squares carrying their number.

## Components

### Buttons
- **Shape:** 4px corner, 32px tall, 11px mono capitals. Not a pill.
- **Primary:** Ink fill with Well text on `shadow-raised-strong`. One per group. The Plan tab's "Simulate
  walk" is the main action: 44px tall with the cut corner.
- **Secondary:** a #202226 fill, raised; the everyday button. Select triggers are the same.
- **Pressed** (`shadow-pressed`): the drop shadow goes and the fill darkens to Well; a toggled-on button
  ("Follow") also writes its icon in the signal colour.
- **Ghost and link:** icon buttons and inline "show" links. Links are sentence case in the text face.
- **Key:** a control that floats on the map, on Hull Raised with a black keyline and a lit top edge.
- **Focus:** a 2px Ink outline, 2px offset, on everything.

### Badges
- **Style:** 16px tall, 3px radius, 11px text, a hairline border and no fill.
- **Estimate:** dashed border. **Strong:** brighter border for primary objectives and rover evidence.
  **Warning:** orange border and text, used for "Synthetic test data".

### Panels and cards
- **Material:** a solid Hull body with a 1px grey edge and a float shadow. There is no blur and no
  translucency, so the ground never tints the chrome.
- **One component:** every floating surface is a `Panel` or takes its classes from `panelVariants`. The
  default size is a key (bars, readouts, the map key); `lg` is a card.
- **Padding:** 16px. A card's actions sit in a footer that stays put while the body scrolls.

### Displays
A sunk black window set into a panel, for the figure that matters most there: the verdict and the tightest
budget on the Plan tab, the clock and the current task in the walk panel. One per panel.

### Inputs
- **Style:** a sunk Well field with a black border, 4px radius, 32px tall, mono text.

### Switches and sliders
- **Switch:** a 38 x 22px capsule. Off, a black track and a light knob; on, a Signal Yellow track and a
  dark knob. The state reads from the knob's position as well as the colour.
- **Slider:** a 6px sunk track, filled in Ink up to a white pill thumb. A slider shows its value beside it.

### Readout rows
A name in mono capitals on the left, its figure in mono on the right, a hairline under each. Used for the
typical sol on the Explore tab and for the walk panel's "next" and "home".

### Layer rows
One row per layer on the Layers tab: a 32px preview, the name, an info button and a switch. The preview
is real data, drawn by the function that draws it on the map. The opacity slider and the colour key show
only while the layer is on. Base imagery is a four-column grid of square picture cards; the chosen one has
an Ink outline and a check. The Mars colour tint is on by default; turning it off shows the ground in grey, as
the camera recorded it.

### Navigation
- Three tabs (Explore, Plan, Layers) as a segmented control. On the bottom sheet, tapping the active tab
  folds the sheet.
- **Segmented controls**, the tab bar and the 2D/3D switch are one control: a sunk 6px track with 3px of
  padding and a raised 4px thumb. The picked option is written in the signal colour.

- **The thumb slides.** In a tab bar or segmented control the highlight is one element that moves and
  resizes from the old option to the new one (`SlidingThumb`), over 300ms on the panels' no-overshoot curve.
  It can be redirected part-way, and under reduced motion it swaps without moving. Options never paint
  their own selected fill.
- A scrolling panel's content simply runs under its neighbours' hairlines: there is no blur or fade at the
  scroll edges.

### Map labels
Every label on the map is a small black plate with engraved text (`MAP_LABEL_BOX` in `map/mapLabel.ts`).
The time-ring and walk-limit labels, the turn-back or tightest-point chip, the walker's countdown and place
names all use it.

- **The plate:** 22px tall, 3px corner, 9px of side padding, 11px medium in the mono face, on Hull Raised.
  `shadow-plate` gives it a black keyline, a lit top edge, a dark bottom edge and a short shadow on the ground.
- **The text** is cut in: a 1px dark line above the letters. Ink 2 for a plain measure (a ring's time), Ink
  for a place, an event or a limit. Place names are capitals; measures keep their units' case.
- **Status shows once, on an icon** (`MAP_LABEL_MARK`) that says what the status is. The plate and the text
  never take a status colour, and there is no lamp.
- **In 2D** a plate lies beside its point. **In 3D** it stands on a 14px post above it (`MAP_LABEL_POST`).

### Map marks
A place is marked by its shape and colour (see Colors): diamond, ring, disc or square, with a black keyline
and a short shadow on the ground (`shadow-dome`). The rover's waypoints are small grey discs.

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
- **Walked part of a route:** solid Signal Yellow, 3px. The walk's position is in the same colour.
- **Time rings:** dotted Ink on a dark keyline (they are modelled). **Walk limit:** solid Warn (orange).
- **Rover track:** solid, 1.25px, in grey, with small waypoint discs (it was measured).
- **The ground** is dimmed to about two thirds of its brightness, so the white route and the black chrome both hold against it.
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
One row per route in a sunk track, selectable: its name and right-aligned mono columns for time, distance,
energy and hazard metres. The chosen route is a raised row, like a tab's thumb. The best figure in each
column is in Ink and the rest are muted; no colour is added. A route that does not fit says so in red under its name.

### Walk panel
The mode in mono capitals in the signal colour, then play, Follow, fold and close. Under it the display: the
clock, one line for what is happening and, while the crew works at a stop, their task. Then what is left of
time, energy and oxygen on plain meters, the distance and bearing to the next point, and the walk home. It
folds to a single row: clock, status, play, follow, unfold, stop. On the bottom-sheet layout every walk opens
folded, and unfolding it folds the sheet, so the full panel and the open sheet are never both over the map.

### Meters
What is left of one budget (`PlainMeter`, in `MiniBar`): a bar in a sunk track that drains toward the left
as the budget is spent. It is plain Ink, turns orange once it drains to 25% left and red at 10% left, and the
figure beside it takes the same colour. Used on the Plan tab and in the walk panel. Above the Plan tab's
meters, in the display, the tightest budget is the headline (`MeterHeadline`).

### Slope bars
In Segment details, each leg carries 18 small bars of its slope from start to end: a bar is the steepest
ground in its stretch, as tall as that is against the no-go slope and in the colour the route line has
there on the map.

### Budget rows
One row per limit (EVA time, energy, oxygen), directly under the display: the name in mono capitals, the
meter, and used / usable in mono. Each row has an info button, which gives the split between walking, stops
and what is left, and a full text label for screen readers.

### Info button
A small "i" that opens a popover, the same material as the panels. Use it for any explanation a reader may need; a `title` tooltip is
only for a hint that repeats what is already visible.
A note is written for the planner: what the thing shows, the one caveat that matters, and a one-line
source, in at most three short paragraphs. Formulas, file URLs and scene lists stay in the data manifest;
a note never prints the manifest's `method` string.

## Do's and Don'ts

### Do:
- **Do** state the verdict once, above the detail, in the same words everywhere ("Fits the limits").
- **Do** label anything estimated, illustrative or synthetic, with the dashed style or in words.
- **Do** credit the data source wherever data is shown.
- **Do** use tokens (`text-muted-foreground`, `bg-well`, `text-signal`) rather than raw hex.
- **Do** set every figure in the mono face and keep its unit's case.
- **Do** give every control a name, a keyboard path and a touch size that works on a phone.

### Don't:
- **Don't** add a status dot, lamp or pill beside a label. Show the state in the control or in a word.
- **Don't** use yellow for anything that is not on, selected or live.
- **Don't** fill anything with a gradient, or blur the map behind a panel.
- **Don't** set text under 11px, or set a unit in capitals.
- **Don't** use unicode glyphs or emoji as icons; use lucide.
- **Don't** cut a corner on anything but the side panel and the main action.
- **Don't** hide an explanation in a `title` tooltip.
- **Don't** let a panel cover the place the planner just selected.
