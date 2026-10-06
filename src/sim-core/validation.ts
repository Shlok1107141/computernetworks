// ============================================================
// sim-core/validation.ts
// Correctness-validation experiment for the paper: sweep the
// link loss rate and confirm the engine produces the textbook-
// expected relationship (higher loss -> lower delivery, and a
// reliable stack never does worse than an unreliable one).
// ============================================================

import { runSimulation, type NetworkConfig } from './network';
import { defaultTopology, reliableStack, unreliableStack } from './presets';
import type { LayerDef } from './layer';

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

/**
 * Delivery rate of each stack as the loss on EVERY link is swept, everything
 * else held at `base`. Returns one row per loss value: { lossPct, <label>: rate }.
 */
export function sweepLoss(
  base: Omit<NetworkConfig, 'stack'>,
  stacks: { label: string; stack: LayerDef[] }[],
  lossValues: number[] = [0, 5, 10, 15, 20, 25, 30],
): Record<string, number>[] {
  const flowIds = base.flows.map((f) => f.id);
  return lossValues.map((lossPct) => {
    const row: Record<string, number> = { lossPct };
    const links = base.links.map((l) => ({ ...l, lossPct }));
    for (const { label, stack } of stacks) {
      const summaries = runSimulation({ ...base, links, stack }).metrics.summarize(flowIds);
      const sent = summaries.reduce((s, f) => s + f.sent, 0);
      const delivered = summaries.reduce((s, f) => s + f.delivered, 0);
      row[label] = sent ? delivered / sent : 0;
    }
    return row;
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
