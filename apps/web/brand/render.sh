#!/bin/sh
# Renders the link-preview image and the icon PNGs from the sources in this folder.
# Needs Google Chrome (headless) and ImageMagick. Run from anywhere: sh apps/web/brand/render.sh
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
web="$(dirname "$here")"
chrome="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
font="$(find "$web/node_modules/@fontsource-variable/inter-tight/files/" -name 'inter-tight-latin-wght-normal.woff2' | head -1)"
tmp="$(mktemp -d)"

sed "s|FONT_URL|file://$font|" "$here/og.html" > "$tmp/og.html"
"$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1200,630 \
  --virtual-time-budget=3000 --screenshot="$tmp/og.png" "file://$tmp/og.html" >/dev/null 2>&1
magick "$tmp/og.png" -quality 88 -interlace Plane "$web/public/og.jpg"

# Icons are drawn by Chrome too (ImageMagick's own SVG renderer drops the gradients), then scaled down.
shot() { # shot <svg> <png> : a 512 px transparent render of an SVG
  printf '<!doctype html><style>*{margin:0}html,body{background:transparent;overflow:hidden}img{display:block;width:512px;height:512px}</style><img src="file://%s">' "$1" > "$tmp/icon.html"
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=512,512 \
    --default-background-color=00000000 --screenshot="$2" "file://$tmp/icon.html" >/dev/null 2>&1
}
shot "$web/public/favicon.svg" "$tmp/favicon.png"
shot "$here/icon-app.svg" "$tmp/app.png"
magick "$tmp/favicon.png" -define icon:auto-resize=48,32,16 "$web/public/favicon.ico"
magick "$tmp/app.png" -resize 180x180 -background '#05070D' -alpha remove -strip "$web/public/apple-touch-icon.png"
echo "wrote og.jpg, favicon.ico and apple-touch-icon.png to $web/public"
