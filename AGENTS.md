# Agent notes

## Map data needs a new release when it changes

`data/` is gitignored. Cloudflare builds do not run the data pipeline; they download the
tarball pinned in `config/data-release.json`. So a change
that alters what ends up in `data/<area>/` (pipeline code in `scripts/`, `config/area.json`,
an imported layer) is not deployed until a new release is published and pinned.

When data changes:

1. Regenerate it: `pnpm data`
2. Pack it under the next tag: `pnpm data:pack data-vN`
   (this rewrites `config/data-release.json` with the new tag, asset name and SHA-256)
3. Publish it: `gh release create data-vN data/marsmap-<area>-data-vN.tar.gz`
4. Commit the updated `config/data-release.json` in the same pull request as the change.

Rules:

- Always bump to a new `data-vN`.
- Publish the release before pushing the commit that pins it
- Changes to `config/walk-params.json`, `config/surface-classes.json` or `config/pois.json`
  do not need a release: those are bundled from git, not from `data/`.

## UI: shadcn/ui (Base UI) + Tailwind CSS v4

The web app's UI is built from shadcn components on Base UI (`apps/web/components.json`, style `base-nova`).

- Reach for `apps/web/src/components/ui` first: shadcn primitives (Button, Badge, Select, Slider, Switch,
  Tabs, Popover, Alert, …) plus app-level ones (`Panel` for anything floating over the map, `SectionHeading`,
  `Stat`/`StatGrid`/`Detail`, `Swatch`, `Disclosure`, `SliderField`, `Segmented`).
  Add more with `pnpm dlx shadcn@latest add <name>` from `apps/web`, then point its `cn` import at `@/lib/utils`.
- Design tokens live in `apps/web/src/index.css`. Use token classes (`bg-secondary`, `text-muted-foreground`,
  `text-warn`, `bg-poi-start`, `shadow-float`, `glass`, `caps`) rather than raw colours, so new screens match.
  The app is dark-only: `:root` holds the dark values and there is no `.dark` class.
- Breakpoint variants follow the layout: `sheet:` (≤860 px, side panel becomes a bottom sheet), `phone:` (≤600 px),
  `compact:` (≤1100 px), `coarse:` (touch pointers).
- Import `cn` from `@/lib/utils` (it knows the custom theme names), never from `"cn"` directly.
- Plain CSS is only for the map (markers and popups MapLibre builds) and the shell layout, in `apps/web/src/styles/`.
  Those files sit in a lower cascade layer than utilities, so never set the same property both there and by a
  utility on the same element.
