import maplibregl from "maplibre-gl";

/**
 * Cosmetic Mars colouring for single-band (grayscale) visible imagery.
 * An image URL wrapped as marstint://… is fetched, multiplied by a butterscotch tone and
 * handed to MapLibre in place of the original. The pixels' brightness pattern is the data;
 * the colour is not measured.
 */
const SCHEME = "marstint://";
/** White ground becomes this; darker ground scales toward black. */
const LIGHT = "#ffb47c";
/** Lifts pure black to a warm shadow so shaded slopes are not ink-black. */
const SHADOW = "#1c0d07";

/** Thermal imagery shows temperature, not what the ground looks like: leave it alone. */
export const tintable = (id: string) => !/themis|thermal|night/i.test(id);
export const tintUrl = (url: string) => SCHEME + encodeURIComponent(new URL(url, location.href).href);

const cache = new Map<string, ArrayBuffer>();
const CACHE_MAX = 12;

async function render(src: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const hit = cache.get(src);
  if (hit) return hit;
  const res = await fetch(src, { signal });
  if (!res.ok) throw new Error(`imagery ${res.status} ${src}`);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = LIGHT;
  ctx.fillRect(0, 0, bmp.width, bmp.height);
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = SHADOW;
  ctx.fillRect(0, 0, bmp.width, bmp.height);
  // Keep the source's transparent (no-data) pixels transparent.
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const type = blob.type === "image/png" ? "image/png" : "image/jpeg";
  const out = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("could not encode tinted imagery"))), type, 0.92));
  canvas.width = canvas.height = 0;
  const buf = await out.arrayBuffer();
  cache.set(src, buf);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return buf;
}

let registered = false;
export function registerTintProtocol() {
  if (registered) return;
  registered = true;
  maplibregl.addProtocol("marstint", async (params, abort) => {
    const src = decodeURIComponent(params.url.slice(SCHEME.length));
    return { data: (await render(src, abort.signal)).slice(0) };
  });
}
