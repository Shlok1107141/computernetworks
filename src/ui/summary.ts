import type { FlowSummary } from '../sim-core/metrics';
import { reliabilityLayers, type LayerDef } from '../sim-core/layer';

/** All flows added together; RTT averaged over delivered packets. */
export function aggregate(rows: FlowSummary[]): FlowSummary {
  const sum = (k: keyof FlowSummary) => rows.reduce((s, r) => s + (r[k] as number), 0);
  const sent = sum('sent'), delivered = sum('delivered');
  return {
    flowId: 'all',
    sent,
    delivered,
    dropped: sum('dropped'),
    corrupted: sum('corrupted'),
    undetected: sum('undetected'),
    duplicates: sum('duplicates'),
    reordered: sum('reordered'),
    retransmits: sum('retransmits'),
    fastRetransmits: sum('fastRetransmits'),
    deliveryRate: sent ? delivered / sent : 0,
    avgRttMs: delivered ? rows.reduce((s, r) => s + r.avgRttMs * r.delivered, 0) / delivered : 0,
    goodputBps: sum('goodputBps'),
  };
}

/** With ACKs the engine measures a round trip; without, one-way delivery latency. */
export function latencyLabel(stack: LayerDef[]): string {
  return reliabilityLayers(stack).ack ? 'avg RTT' : 'avg latency (one-way)';
}

export function retransmitText(s: FlowSummary): string {
  return s.fastRetransmits ? `${s.retransmits} (${s.fastRetransmits} fast)` : String(s.retransmits);
}
