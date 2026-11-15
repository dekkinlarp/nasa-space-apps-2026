/**
 * Original artwork for the Go walker: a generic side-view spacesuited figure (facing right) as inline
 * SVG, a ground ring/heading chevron, and a boot-print image drawn on a canvas. No external assets.
 *
 * Geometry (viewBox 0 0 60 72, ground at y = 66): hip (28, 40), knee (28, 52), shoulder (29, 26),
 * elbow (29, 34). Parts that swing are <g> elements with CSS transform origins at those joints.
 */

const leg = (cls: string) => `
  <g class="w-leg ${cls}">
    <rect x="24.6" y="38.5" width="6.8" height="14.5" rx="3.4" class="w-suit"/>
    <rect x="24.6" y="47.5" width="6.8" height="2.2" class="w-band"/>
    <g class="w-shin">
      <rect x="24.9" y="51" width="6.2" height="12" rx="3" class="w-suit"/>
      <path d="M24.2 60.6 h7.6 q3.6 0 3.6 3.1 v1.1 q0 1.2 -1.2 1.2 h-10.2 q-0.9 0 -0.9 -0.9 z" class="w-boot"/>
    </g>
  </g>`;

const arm = (cls: string, tool: boolean) => `
  <g class="w-arm ${cls}">
    <rect x="26" y="23.5" width="6" height="12" rx="3" class="w-suit"/>
    <g class="w-fore">
      <rect x="26.3" y="33" width="5.4" height="9.2" rx="2.7" class="w-suit"/>
      <rect x="26.3" y="38.6" width="5.4" height="1.8" class="w-band"/>
      ${tool ? `<g class="w-tool"><rect x="28.1" y="41" width="1.8" height="10" rx="0.9" fill="#8a6a45"/><rect x="25.6" y="49.6" width="8.4" height="3.4" rx="1" fill="#5d6670"/><rect x="25.6" y="49.6" width="8.4" height="1.2" rx="0.6" fill="#9aa4ae"/></g>` : ""}
      <circle cx="29" cy="42.6" r="3" class="w-glove"/>
    </g>
  </g>`;

export const WALKER_SVG = `
<svg class="w-svg" viewBox="0 0 60 72" width="62" height="74" aria-hidden="true">
  <defs>
    <linearGradient id="w-visor" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffd98a"/><stop offset=".45" stop-color="#e09a35"/><stop offset="1" stop-color="#6b3a12"/>
    </linearGradient>
    <linearGradient id="w-body" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#d9dde2"/><stop offset=".55" stop-color="#ffffff"/><stop offset="1" stop-color="#e6e9ec"/>
    </linearGradient>
  </defs>
  <g class="w-body">
    <g class="w-back">${leg("w-leg-b")}${arm("w-arm-b", false)}</g>
    <rect x="11.5" y="20.5" width="11" height="20" rx="3.2" class="w-pack"/>
    <rect x="13.5" y="23" width="7" height="2" rx="1" fill="#8d96a0"/>
    <rect x="13.5" y="27" width="7" height="2" rx="1" fill="#8d96a0"/>
    ${leg("w-leg-f")}
    <rect x="19.5" y="21.5" width="18" height="22" rx="6.5" class="w-torso"/>
    <rect x="30.5" y="29" width="5.5" height="6" rx="1.4" fill="#cfd5db" stroke="#7e8790" stroke-width=".6"/>
    <circle cx="32" cy="31" r=".8" fill="#36d1c4"/><circle cx="34.4" cy="31" r=".8" fill="#ff8a3d"/>
    <rect x="20" y="25.5" width="9" height="2.4" rx="1.2" fill="#ff8a3d" opacity=".9"/>
    <g class="w-head">
      <circle cx="31" cy="14" r="9.4" class="w-helmet"/>
      <path d="M31.8 7.6 q7.4 0.6 7.8 6.4 q-0.2 5.6 -7.8 6.6 q-2.2 -6.4 0 -13 z" fill="url(#w-visor)" stroke="#3b2a1d" stroke-width=".7"/>
      <path d="M33.6 9.6 q3.6 0.8 4.2 3.6" stroke="#fff7e0" stroke-width="1.1" fill="none" stroke-linecap="round" opacity=".85"/>
      <rect x="22.6" y="11.5" width="3.2" height="4.2" rx="1" fill="#c3c9cf"/>
    </g>
    ${arm("w-arm-f", true)}
  </g>
  <g class="w-sparks">
    <path class="w-spark s1" d="M47 58 l1 -3 l1 3 l3 1 l-3 1 l-1 3 l-1 -3 l-3 -1 z"/>
    <path class="w-spark s2" d="M53 63 l.7 -2 l.7 2 l2 .7 l-2 .7 l-.7 2 l-.7 -2 l-2 -.7 z"/>
    <path class="w-spark s3" d="M42 64 l.6 -1.7 l.6 1.7 l1.7 .6 l-1.7 .6 l-.6 1.7 l-.6 -1.7 l-1.7 -.6 z"/>
  </g>
</svg>`;

/** Direction ring that lies flat on the ground (rotated with the map). Chevron points north. */
export const GROUND_SVG = `
<svg viewBox="0 0 64 64" width="52" height="52" aria-hidden="true">
  <circle cx="32" cy="32" r="15" fill="#36d1c4" fill-opacity=".08" stroke="#36d1c4" stroke-opacity=".6" stroke-width="2" stroke-dasharray="5 3.5"/>
  <path class="w-chev" d="M32 5 l7.5 9.5 l-7.5 -3.4 l-7.5 3.4 z" fill="#36d1c4" stroke="#0b0a0c" stroke-width="1.2" stroke-linejoin="round"/>
</svg>`;

/** A single boot print (pointing north) for a MapLibre symbol layer, drawn on a canvas. */
export function bootPrintImage(): { width: number; height: number; data: Uint8ClampedArray } | null {
  const w = 22, h = 40;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) return null;
  const sole = (dx: number, dy: number, fill: string) => {
    g.fillStyle = fill;
    g.beginPath();
    g.ellipse(11 + dx, 12 + dy, 8, 10, 0, 0, Math.PI * 2); // toe
    g.fill();
    g.beginPath();
    g.ellipse(11 + dx, 30 + dy, 6.5, 7.5, 0, 0, Math.PI * 2); // heel
    g.fill();
    g.fillRect(5 + dx, 14 + dy, 12, 14);
  };
  sole(0, 1, "rgba(255,236,214,0.35)"); // lit rim
  sole(0, 0, "rgba(28,16,10,0.85)");
  g.fillStyle = "rgba(255,226,196,0.28)"; // tread bars
  for (let y = 6; y < 36; y += 5) if (y < 20 || y > 24) g.fillRect(6, y, 10, 1.6);
  return { width: w, height: h, data: g.getImageData(0, 0, w, h).data };
}
