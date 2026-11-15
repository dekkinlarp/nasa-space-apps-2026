# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is a mission planner: someone planning a crewed surface walk (EVA) on Mars, working
at a desk in a longer session. They pick a start and science stops, compare routes, and need to know
whether the walk fits the time, energy and oxygen limits and where the crew must turn back.

Hackathon judges (NASA Space Apps 2026) also see the tool, usually in a short demo. They are a real
audience but not the one the tool is shaped around.

## Product Purpose

Martian Map is a planning tool for an astronaut walk at Gale Crater. It covers a 33 x 40 km region,
all of Curiosity's drive from Bradbury Landing to the boxwork ridges. The planner gives walking routes
with time, distance, slope, surface, energy, oxygen and radiation per segment, shows where orbital
data sees water-formed minerals, and draws how far a crew can walk and still get home.

Success is a planner who can answer "does this walk fit, and where is the point of no return?" and
trust the answer, including knowing which parts of it are measured and which are estimated.

## Positioning

The routes and limits are computed on real NASA terrain, and every claim on the map says what it
rests on: rover measurement, orbital data, or the team's own reading. The golden case is the boxwork:
Curiosity spent most of a year there, drilled three holes about 6 cm deep and left the main questions
open; a crew can cross ridge to hollow, dig under the sand and trace the network in one six-hour walk.

## Operating Context

- Built for NASA Space Apps 2026, challenge "Interplanetary Survival Guide: Martian Map".
- One Cloudflare Worker serves the app, the API and the map data as static assets.
- Full-resolution ground (2 m cells) is loaded for an 8 km planning window around the walk; the rest
  of the region is a 16 m overview.
- A synthetic fixture (`?area=fixture`) exists for local development and is labelled as such in the UI.

## Capabilities and Constraints

Capabilities: Explore (points of interest with evidence), Plan (start, stops, route options, verdict,
time/energy/oxygen budgets, turn-back point, simulated or GPS-driven walk), Layers (imagery, terrain,
minerals from orbit, walk model, places), 2D and 3D terrain, elevation profile.

Constraints the user confirmed as fixed:

- **Honest about data.** Estimates, illustrative positions and synthetic data are always labelled.
  Nothing is presented as more certain than it is.
- **Real NASA data only.** Terrain, imagery, minerals and rover data come from NASA/USGS sources, and
  their credits are shown.
- **Works on phones.** The phone layout is a real target, not a fallback.

Terminology in use: EVA, sol, stop, dwell, usable budget, reserve, walk limit, turn back / point of
no return, planning window.

Undecided: whether the app stays dark only. It is dark only today; the user did not make that binding.

## Brand Commitments

The name is Martian Map. No logo, tagline or voice guide has been made binding.

## Evidence on Hand

- Real data pipeline output published as GitHub releases (`config/data-release.json`), built from the
  USGS 1 m Gale DEM, the Mars Trek HiRISE mosaic, CRISM mineral scenes and Curiosity's localized
  traverse, waypoints and photos.
- Walk parameters with their sources in the area config (`walkParams._sources`).
- Tank size and oxygen leak rate are placeholder assumptions and are described as such in the UI.
- No user testimonials, usage numbers or external reviews exist. Do not invent any.

## Product Principles

1. The verdict comes first: whether the walk fits, then why.
2. Say what each number rests on. Measured, modelled and guessed are different things and look different.
3. The map is the work surface; panels serve it and get out of its way.
4. Plain language over jargon, with the mission's real terms where they are the right words.
5. Anything a planner can do with a mouse, they can do with a keyboard or a finger.

## Accessibility & Inclusion

No formal standard has been set. The working bar is WCAG AA contrast, full keyboard operation of the
planning flow, and touch targets that work on a phone.
