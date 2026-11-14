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
