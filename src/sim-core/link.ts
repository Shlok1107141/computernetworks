// ============================================================
// sim-core/link.ts
// A link between two nodes, with the full set of tunable knobs.
// Deterministic given a seeded RNG, so runs are reproducible
// (required for the paper's reproducibility claim).
// ============================================================

export interface LinkDef {
  id: string;
  a: string;              // node id
  b: string;              // node id
  bandwidthMbps: number;  // capacity
  latencyMs: number;      // base propagation delay
  jitterMs: number;       // +/- random variation
  lossPct: number;        // probability a packet is dropped
  corruptPct: number;     // probability a packet is corrupted (not dropped)
  queueSize: number;      // max packets buffered before tail-drop
  weight: number;         // routing cost
  up: boolean;            // link currently alive?
}

export function makeLink(a: string, b: string, overrides: Partial<LinkDef> = {}): LinkDef {
  return {
    id: `${a}-${b}`,
    a,
    b,
    bandwidthMbps: 10,
    latencyMs: 20,
    jitterMs: 5,
    lossPct: 2,
    corruptPct: 1,
    queueSize: 8,
    weight: 1,
    up: true,
    ...overrides,
  };
}

/** Serialization delay: how long to push `bytes` onto a `mbps` link. */
export function serializationDelayMs(bytes: number, mbps: number): number {
  const bits = bytes * 8;
  const bps = mbps * 1_000_000;
  return (bits / bps) * 1000;
}

/** Seedable PRNG (mulberry32) so every run is reproducible. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
