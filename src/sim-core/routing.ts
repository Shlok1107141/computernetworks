// ============================================================
// sim-core/routing.ts
// Distance Vector and Link State, rebuilt from first principles.
// Both return next-hop tables + a convergence measure so the UI
// can race them head-to-head (the paper's routing experiment).
// ============================================================

import type { LinkDef } from './link';

export interface RoutingResult {
  // nextHop[from][to] = neighbor to forward to, or null if unreachable
  nextHop: Record<string, Record<string, string | null>>;
  dist: Record<string, Record<string, number>>;
  rounds: number;       // DV: relaxation rounds. LS: flooding hop-diameter.
}

function neighbors(links: LinkDef[]): Record<string, { node: string; w: number }[]> {
  const adj: Record<string, { node: string; w: number }[]> = {};
  for (const l of links) {
    if (!l.up) continue;
    (adj[l.a] ||= []).push({ node: l.b, w: l.weight });
    (adj[l.b] ||= []).push({ node: l.a, w: l.weight });
  }
  return adj;
}

export function distanceVector(nodes: string[], links: LinkDef[]): RoutingResult {
  const adj = neighbors(links);
  const dist: Record<string, Record<string, number>> = {};
  const nextHop: Record<string, Record<string, string | null>> = {};

  for (const a of nodes) {
    dist[a] = {};
    nextHop[a] = {};
    for (const b of nodes) {
      dist[a][b] = a === b ? 0 : Infinity;
      nextHop[a][b] = null;
    }
    for (const nb of adj[a] || []) {
      dist[a][nb.node] = nb.w;
      nextHop[a][nb.node] = nb.node;
    }
  }

  let rounds = 0;
  let changed = true;
  while (changed && rounds < nodes.length + 5) {
    changed = false;
    rounds++;
    for (const v of nodes) {
      for (const nb of adj[v] || []) {
        for (const dest of nodes) {
          const via = (adj[v]!.find((n) => n.node === nb.node)!.w) + dist[nb.node][dest];
          if (via < dist[v][dest]) {
            dist[v][dest] = via;
            nextHop[v][dest] = nb.node;
            changed = true;
          }
        }
      }
    }
  }
  return { nextHop, dist, rounds };
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
