// ============================================================
// sim-core/routing.ts
// Distance Vector and Link State, rebuilt from first principles.
// Both return next-hop tables + a convergence measure so the UI
// can race them head-to-head (the paper's routing experiment).
// ============================================================

import type { LinkDef } from './link';

export interface RoutingTables {
  // nextHop[from][to] = neighbor to forward to, or null if unreachable
  nextHop: Record<string, Record<string, string | null>>;
  dist: Record<string, Record<string, number>>;
}

export interface RoutingResult extends RoutingTables {
  rounds: number;       // DV: exchange rounds until stable. LS: flooding hop-diameter.
  history?: RoutingTables[]; // DV: the tables after each round (last = converged)
}

/** Costs at or above this count as unreachable (RIP's "16 = infinity", scaled for weights up to 20). */
export const DV_INFINITY = 128;

function neighbors(links: LinkDef[]): Record<string, { node: string; w: number }[]> {
  const adj: Record<string, { node: string; w: number }[]> = {};
  for (const l of links) {
    if (!l.up) continue;
    (adj[l.a] ||= []).push({ node: l.b, w: l.weight });
    (adj[l.b] ||= []).push({ node: l.a, w: l.weight });
  }
  return adj;
}

/**
 * Synchronous distributed Bellman-Ford: in each round every router rebuilds
 * its vector purely from what its neighbours advertised in the previous round.
 * Starting from `from` (the tables before a topology change) reproduces real
 * re-convergence, including transient loops and count-to-infinity.
 */
export function distanceVector(nodes: string[], links: LinkDef[], from?: RoutingTables): RoutingResult {
  const adj = neighbors(links);
  let dist: Record<string, Record<string, number>> = {};
  for (const a of nodes) {
    dist[a] = {};
    for (const b of nodes) dist[a][b] = a === b ? 0 : from ? Math.min(from.dist[a]?.[b] ?? Infinity, DV_INFINITY) : Infinity;
  }

  const history: RoutingTables[] = [];
  const limit = 4 * DV_INFINITY;
  for (let round = 1; round <= limit; round++) {
    const next: Record<string, Record<string, number>> = {};
    const nextHop: Record<string, Record<string, string | null>> = {};
    let changed = false;
    for (const v of nodes) {
      next[v] = {};
      nextHop[v] = {};
      for (const dest of nodes) {
        let best = v === dest ? 0 : Infinity;
        let hop: string | null = v === dest ? v : null;
        if (v !== dest) {
          for (const nb of adj[v] || []) {
            const via = nb.w + dist[nb.node][dest];
            if (via < best) { best = via; hop = nb.node; }
          }
        }
        if (best >= DV_INFINITY) { best = Infinity; hop = null; }
        next[v][dest] = best;
        nextHop[v][dest] = hop;
        if (best !== dist[v][dest]) changed = true;
      }
    }
    dist = next;
    history.push({ dist: next, nextHop });
    if (!changed) break;
  }
  const last = history[history.length - 1];
  return { nextHop: last.nextHop, dist: last.dist, rounds: history.length, history };
}

export function linkState(nodes: string[], links: LinkDef[]): RoutingResult {
  const adj = neighbors(links);
  const dist: Record<string, Record<string, number>> = {};
  const nextHop: Record<string, Record<string, string | null>> = {};

  for (const src of nodes) {
    const d: Record<string, number> = {};
    const prev: Record<string, string | null> = {};
    for (const n of nodes) {
      d[n] = Infinity;
      prev[n] = null;
    }
    d[src] = 0;
    const visited = new Set<string>();

    while (visited.size < nodes.length) {
      let u: string | null = null;
      let best = Infinity;
      for (const n of nodes) {
        if (!visited.has(n) && d[n] < best) {
          best = d[n];
          u = n;
        }
      }
      if (u === null) break;
      visited.add(u);
      for (const nb of adj[u] || []) {
        const alt = d[u] + nb.w;
        if (alt < d[nb.node]) {
          d[nb.node] = alt;
          prev[nb.node] = u;
        }
      }
    }

    dist[src] = d;
    nextHop[src] = {};
    for (const dest of nodes) {
      // walk prev chain back from dest to find first hop out of src
      let cur = dest;
      if (d[dest] === Infinity) {
        nextHop[src][dest] = null;
        continue;
      }
      while (prev[cur] !== null && prev[cur] !== src) {
        cur = prev[cur]!;
      }
      nextHop[src][dest] = prev[cur] === src ? cur : dest === src ? src : null;
    }
  }

  // "rounds" for LS = flooding diameter (BFS hop eccentricity), a proxy
  // for how many propagation steps an LSA needs to reach everyone.
  let diameter = 0;
  for (const src of nodes) {
    const hops: Record<string, number> = {};
    for (const n of nodes) hops[n] = Infinity;
    hops[src] = 0;
    const q = [src];
    while (q.length) {
      const u = q.shift()!;
      for (const nb of adj[u] || []) {
        if (hops[nb.node] === Infinity) {
          hops[nb.node] = hops[u] + 1;
          q.push(nb.node);
        }
      }
    }
    for (const n of nodes) if (hops[n] !== Infinity) diameter = Math.max(diameter, hops[n]);
  }

  return { nextHop, dist, rounds: diameter };
}

/** Shortest propagation time (sum of link latencies) from `src` to every router over live links. */
export function latencyFrom(src: string, nodes: string[], links: LinkDef[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const n of nodes) t[n] = Infinity;
  t[src] = 0;
  const done = new Set<string>();
  while (done.size < nodes.length) {
    let u: string | null = null;
    for (const n of nodes) if (!done.has(n) && (u === null || t[n] < t[u])) u = n;
    if (u === null || t[u] === Infinity) break;
    done.add(u);
    for (const l of links) {
      if (!l.up || (l.a !== u && l.b !== u)) continue;
      const v = l.a === u ? l.b : l.a;
      t[v] = Math.min(t[v], t[u] + l.latencyMs);
    }
  }
  return t;
}
