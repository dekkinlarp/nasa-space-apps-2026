export function fmtDist(m: number): string {
  if (!Number.isFinite(m)) return "—";
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 1 : 2)} km` : `${Math.round(m)} m`;
}

export function fmtDur(s: number): string {
  if (!Number.isFinite(s)) return "—";
  const neg = s < 0;
  s = Math.abs(Math.round(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const out = h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : m > 0 ? `${m} min` : `${s % 60} s`;
  return neg ? `-${out}` : out;
}

export function fmtClock(s: number): string {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function fmtEnergy(kj: number): string {
  if (!Number.isFinite(kj)) return "—";
  return kj >= 1000 ? `${(kj / 1000).toFixed(2)} MJ` : `${Math.round(kj)} kJ`;
}

export function fmtO2(kg: number): string {
  if (!Number.isFinite(kg)) return "—";
  return Math.abs(kg) >= 1 ? `${kg.toFixed(2)} kg` : `${Math.round(kg * 1000)} g`;
}

export function fmtLonLat([lon, lat]: [number, number]): string {
  return `${Math.abs(lat).toFixed(5)}°${lat < 0 ? "S" : "N"}  ${lon.toFixed(5)}°E`;
}

export function fmtNum(v: number | null | undefined, digits = 1, unit = ""): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}${unit}`;
}
