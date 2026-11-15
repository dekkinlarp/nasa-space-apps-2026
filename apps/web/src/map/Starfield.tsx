import { useEffect, useRef } from "react";

/** One fixed sky, in CSS pixels, so resizing the window uncovers more of it instead of reshuffling it. */
const FIELD_W = 2400;
const FIELD_H = 1600;
const STAR_COUNT = 1100;

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
  color: string;
}

function makeStars(): Star[] {
  // mulberry32: a small seeded generator, so the sky is the same on every load.
  let s = 0x4d415253;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const stars: Star[] = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    const k = rnd();
    // Mostly faint points, some clear ones, a handful of bright ones with a slight tint.
    const bright = k > 0.985, clear = k > 0.82;
    stars.push({
      x: rnd() * FIELD_W,
      y: rnd() * FIELD_H,
      r: bright ? 1.2 + rnd() * 0.4 : clear ? 0.8 + rnd() * 0.3 : 0.45 + rnd() * 0.3,
      a: bright ? 0.95 : clear ? 0.55 + rnd() * 0.3 : 0.2 + rnd() * 0.3,
      color: bright ? (rnd() > 0.5 ? "#cfe0ff" : "#ffe6cc") : "#e8eaed",
    });
  }
  return stars;
}

const STARS = makeStars();

/** A still field of stars behind the map. It shows wherever the map draws nothing: past the edge of the mapped area and above the horizon in 3D. */
export function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      for (let ox = 0; ox < w; ox += FIELD_W) {
        for (let oy = 0; oy < h; oy += FIELD_H) {
          for (const st of STARS) {
            const x = ox + st.x, y = oy + st.y;
            if (x > w + 2 || y > h + 2) continue;
            ctx.globalAlpha = st.a;
            ctx.fillStyle = st.color;
            ctx.beginPath();
            ctx.arc(x, y, st.r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    };
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    draw();
    return () => ro.disconnect();
  }, []);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 size-full" aria-hidden />;
}
