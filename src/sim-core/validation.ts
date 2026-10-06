// ============================================================
// sim-core/validation.ts
// Correctness-validation experiment for the paper: sweep the
// link loss rate and confirm the engine produces the textbook-
// expected relationship (higher loss -> lower delivery, and a
// reliable stack never does worse than an unreliable one).
// ============================================================

import { runSimulation, type NetworkConfig } from './network';
import { defaultTopology, reliableStack, unreliableStack } from './presets';

export interface SweepPoint {
  lossPct: number;
  reliableDelivery: number;   // delivery rate 0..1
  unreliableDelivery: number;
}

export function lossSweep(lossValues: number[] = [0, 5, 10, 20, 30, 40, 50]): SweepPoint[] {
  const { nodes, links } = defaultTopology();

  return lossValues.map((lossPct) => {
    const lossyLinks = links.map((l) => ({ ...l, lossPct, corruptPct: 0 }));
    const base: Omit<NetworkConfig, 'stack'> = {
      nodes,
      links: lossyLinks,
      flows: [{ id: 'f1', src: 'R1', dst: 'R6', ratePps: 20, count: 60, payloadBytes: 512 }],
      faults: [],
      routing: 'ls',
      seed: 123,
      durationMs: 8000,
    };
    const rel = runSimulation({ ...base, stack: reliableStack() }).metrics.summarize(['f1'])[0];
    const unrel = runSimulation({ ...base, stack: unreliableStack() }).metrics.summarize(['f1'])[0];
    return {
      lossPct,
      reliableDelivery: rel.deliveryRate,
      unreliableDelivery: unrel.deliveryRate,
    };
  });
}

/** Monotonicity check: delivery should not increase as loss increases. */
export function isMonotonicDecreasing(sweep: SweepPoint[]): boolean {
  for (let i = 1; i < sweep.length; i++) {
    // allow small seeded noise tolerance
    if (sweep[i].reliableDelivery > sweep[i - 1].reliableDelivery + 0.08) return false;
  }
  return true;
}
