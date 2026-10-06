// ============================================================
// sim-core/comparison.ts
// The paper's central experiment: run two protocol stacks on
// IDENTICAL traffic, topology, seed, and faults — the only
// variable is the stack itself — then align their metrics.
// ============================================================

import { runSimulation, type NetworkConfig } from './network';
import type { LayerDef } from './layer';
import type { FlowSummary } from './metrics';

export interface ComparisonResult {
  labelA: string;
  labelB: string;
  summaryA: FlowSummary[];
  summaryB: FlowSummary[];
  cwndA: { t: number; v: number }[];
  cwndB: { t: number; v: number }[];
}

/**
 * Everything in `base` is held constant; only the stack changes.
 * That isolation is what makes the comparison a valid experiment.
 */
export function compareStacks(
  base: Omit<NetworkConfig, 'stack'>,
  stackA: { label: string; stack: LayerDef[] },
  stackB: { label: string; stack: LayerDef[] }
): ComparisonResult {
  const runA = runSimulation({ ...base, stack: stackA.stack });
  const runB = runSimulation({ ...base, stack: stackB.stack });

  const flowIds = base.flows.map((f) => f.id);
  const f0 = flowIds[0];

  return {
    labelA: stackA.label,
    labelB: stackB.label,
    summaryA: runA.metrics.summarize(flowIds),
    summaryB: runB.metrics.summarize(flowIds),
    cwndA: runA.metrics.series(f0, 'cwnd', 200),
    cwndB: runB.metrics.series(f0, 'cwnd', 200),
  };
}
