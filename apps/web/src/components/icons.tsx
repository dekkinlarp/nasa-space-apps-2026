/** Panel toggles share one glyph family: a window outline with the pane it controls marked. The pane is shaded while it is showing. */
const frame = { fill: "none", stroke: "currentColor", strokeWidth: 1.25, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function SidebarIcon({ on }: { on: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      {on && <path d="M4 2.75h2.25v10.5H4A2.25 2.25 0 0 1 1.75 11V5A2.25 2.25 0 0 1 4 2.75Z" fill="currentColor" opacity="0.3" />}
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.25" {...frame} />
      <path d="M6.25 3v10" {...frame} />
    </svg>
  );
}

export function BottomPaneIcon({ on }: { on: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      {on && <path d="M1.75 9.25h12.5V11A2.25 2.25 0 0 1 12 13.25H4A2.25 2.25 0 0 1 1.75 11V9.25Z" fill="currentColor" opacity="0.3" />}
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.25" {...frame} />
      <path d="M2 9.25h12" {...frame} />
    </svg>
  );
}
