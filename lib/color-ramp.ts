/**
 * Shared color ramp for macro scoring (0..100).
 * Dark-friendly purple → amber gradient. Kept in one place so legend and
 * map renderer stay in sync.
 */

export const RAMP_STOPS: Array<{ stop: number; color: string }> = [
  { stop: 0, color: "#1a1f33" }, // near-zero — barely visible
  { stop: 35, color: "#2d1a54" }, // deep indigo
  { stop: 55, color: "#6b2a8a" }, // purple
  { stop: 70, color: "#c84a6a" }, // magenta-red
  { stop: 82, color: "#f0833a" }, // orange
  { stop: 92, color: "#ffb020" }, // solar gold
  { stop: 100, color: "#ffe08a" }, // pale gold
];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Interpolate the ramp at `score` (0..100). */
export function colorForScore(score: number): string {
  const s = Math.max(0, Math.min(100, score));
  for (let i = 0; i < RAMP_STOPS.length - 1; i++) {
    const a = RAMP_STOPS[i];
    const b = RAMP_STOPS[i + 1];
    if (s >= a.stop && s <= b.stop) {
      const t = (s - a.stop) / (b.stop - a.stop || 1);
      const [ar, ag, ab] = hexToRgb(a.color);
      const [br, bg, bb] = hexToRgb(b.color);
      return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
    }
  }
  return RAMP_STOPS[RAMP_STOPS.length - 1].color;
}
