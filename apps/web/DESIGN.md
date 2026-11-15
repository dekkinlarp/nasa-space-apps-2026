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
  ink-3: "#7a808a"
  ink-4: "#4e545d"
  seam: "rgba(255, 255, 255, 0.07)"
  seam-2: "rgba(255, 255, 255, 0.13)"
  seam-3: "rgba(255, 255, 255, 0.32)"
  glass: "rgba(17, 19, 23, 0.78)"
  glass-thick: "rgba(15, 17, 20, 0.86)"
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
    padding: "0 10px"
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
  pressed surfaces; popovers sit on Hull Raised.
- **Well** (#0a0b0d): inset fields and marker fills.
- **Ink** (#e8eaed), **Ink 2** (#a8adb5), **Ink 3** (#7a808a), **Ink 4** (#4e545d): text from primary
  to disabled. Ink 3 is the muted text colour and sits at about 4.5:1 on the panel, so it is not used
  on lighter surfaces such as a selected card; step up to Ink 2 there.
- **Seams** (white at 7%, 13% and 32%): hairlines, input borders, and hover or dashed borders.
- **Glass** (rgba(17,19,23,0.78)) and **Thick Glass** (rgba(15,17,20,0.86)): the floating material,
  with a 12% white edge and a 28px blur.

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
  scrolling tab body. It collapses off the left edge.
- **Top row:** map key on the left, view controls on the right, 44px tall.
- **Middle:** the point-of-interest card on the right, 340px (300px under 1100px).
- **Bottom row:** hover readout, verdict or suit meter, then the elevation dock, which starts folded.
- **Under 860px** the side panel becomes a bottom sheet (46dvh, 50dvh on phones) that folds to its tab
  bar; cards move to the left; a one-line verdict rides on the map.
- **Under 600px** the card takes the full width and the open sheet takes the elevation dock's room.

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

Rounded rectangles on a short scale: 4px for badges and map labels, 8px for controls, 12px for small
floating panels, 18px for large ones. Borders are 1px hairlines. Point-of-interest pins are 12px
circles with a dark keyline and a light ring; a start is a rounded square. Stop markers are 22px
rounded squares carrying their number.

## Components

### Buttons
- **Shape:** 8px radius, 32px tall, 12.5px medium text.
- **Primary:** Ink fill with Well text. One per group ("Simulate walk", "Add as stop").
- **Secondary:** an 8% white fill with a hairline; the everyday button.
- **Ghost and link:** icon buttons and inline "show" links.
- **Glass:** a control that floats on the map.
- **Demo:** the one coloured button, Mars Rust, flat, no gradient or glow.
- **Focus:** a 2px Ink outline, 2px offset, on everything.

### Badges
- **Style:** 16px tall, 4px radius, 11px text, a hairline border and no fill.
- **Estimate:** dashed border. **Strong:** brighter border for primary objectives and rover evidence.
  **Warning:** amber border and text, used for "Synthetic test data".

### Panels and cards
- **Material:** glass, with a 12% white edge and a float shadow. The side panel uses thick glass.
- **Corner:** 12px for bars and readouts, 18px for cards and the side panel.
- **Padding:** 16px. A card's actions sit in a footer that stays put while the body scrolls.

### Inputs
- **Style:** transparent with a 13% white border, 8px radius, 32px tall. Number fields for dwell time sit in a Well fill.

### Navigation
- Three tabs (Explore, Plan, Layers) as a segmented control; the active tab is a lighter fill. On the
  bottom sheet, tapping the active tab folds the sheet.

### Budget bar (signature)
One bar per limit (EVA time, energy, oxygen): used segments in colour, what is left in a faint green,
the safety reserve hatched at the end, a marker for the turn-back time, and a red hatched overrun if
the plan exceeds the usable budget. Each has an info button and a full text label for screen readers.

### Info button
A small "i" that opens a popover. Use it for any explanation a reader may need; a `title` tooltip is
only for a hint that repeats what is already visible.

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
- **Don't** put a coloured left or right edge on an alert, or a gradient or glow on a button.
- **Don't** hide an explanation in a `title` tooltip.
- **Don't** let a panel cover the place the planner just selected.
