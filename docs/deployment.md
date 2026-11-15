# Deployment (Cloudflare)

One Worker named `marsmap` serves everything: the built web app and the map data are static assets,
and Worker code only answers `/api/*`. Vite builds both (Cloudflare's Vite plugin), and Wrangler
uploads the result without re-bundling. No R2 is needed: static assets allow 25 MiB per file and
20 000 files per version (free plan), and the region ships as about 4500 files, none over a few MB
(largest 6.5 MiB): elevation and surface tiles, overviews, an imagery pyramid. Wrangler only uploads
files whose content changed, so a data release re-uploads only the tiles that changed. Config is in
[`wrangler.jsonc`](../wrangler.jsonc).

```bash
pnpm deploy            # build + wrangler deploy (production)
```

```bash
pnpm preview:deploy    # build + wrangler preview (a Preview named after the current branch)
```

## Map data in builds

`data/` is not in git. The build runs `scripts/fetch-data.mjs`, which downloads the tarball pinned in
`config/data-release.json` from this repo's GitHub releases and checks its SHA-256, so builds never
call NASA. It skips the download when `data/` is already present. While the repo is private the build
needs a `GITHUB_TOKEN` (read-only access to this repo's contents).

## Publishing new map data

Anything that changes what ends up in `data/<area>/` (pipeline code in `scripts/`, `config/area.json`,
an imported layer) is not deployed until a new release is published and pinned. Changes to
`config/walk-params.json`, `config/surface-classes.json` or `config/pois.json` do not need one: those
are bundled from git.

```bash
pnpm data                                                      # regenerate
pnpm data:pack data-v5                                         # rewrites config/data-release.json
gh release create data-v5 data/marsmap-gale-data-v5.tar.gz     # publish before pushing the pin
git commit -am "Pin map data data-v5"
```

Always bump to a new `data-vN`, and publish the release before pushing the commit that pins it.

## GitHub integration (Workers Builds)

In the Cloudflare dashboard: Workers & Pages > marsmap > Settings > Builds > Connect, pick this repo,
production branch `main`, build command `pnpm run build`, deploy command `npx wrangler deploy`, and
enable builds for non-production branches so pull requests get a Preview URL. Add `GITHUB_TOKEN` as a
build secret.
