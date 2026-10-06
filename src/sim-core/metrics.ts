// ============================================================
// sim-core/metrics.ts
// Collects MetricSamples emitted by the engine and turns them
// into the summary numbers + time series the dashboard and the
// A/B comparison harness need. Also does CSV export for the paper.
// ============================================================

import type { MetricSample } from './types';

export interface FlowSummary {
  flowId: string;
  sent: number;
  delivered: number;
  dropped: number;
  corrupted: number;         // caught by a checksum and discarded
  undetected: number;        // corrupted but accepted as good data
  duplicates: number;        // extra copies passed to the application
  reordered: number;         // passed to the application out of order
  retransmits: number;
  fastRetransmits: number;   // the subset triggered by later ACKs rather than the timer
  deliveryRate: number;      // delivered / sent
  avgRttMs: number;
  goodputBps: number;        // delivered bytes over sim duration
}

export class Metrics {
  samples: MetricSample[] = [];
  private bytesPerFlow: Record<string, number> = {};
  private startTime = 0;
  private endTime = 0;

  record(s: MetricSample) {
    this.samples.push(s);
    this.endTime = Math.max(this.endTime, s.time);
  }

  addDeliveredBytes(flowId: string, bytes: number) {
    this.bytesPerFlow[flowId] = (this.bytesPerFlow[flowId] || 0) + bytes;
  }

  private count(flowId: string, kind: MetricSample['kind']): number {
    return this.samples.filter((s) => s.flowId === flowId && s.kind === kind).length;
  }

  summarize(flowIds: string[]): FlowSummary[] {
    const durationSec = Math.max(1, (this.endTime - this.startTime)) / 1000;
    return flowIds.map((flowId) => {
      const sent = this.count(flowId, 'sent');
      const delivered = this.count(flowId, 'delivered');
      const dropped = this.count(flowId, 'dropped');
      const corrupted = this.count(flowId, 'corrupted');
      const retransmits = this.count(flowId, 'retransmit');
      const rtts = this.samples.filter((s) => s.flowId === flowId && s.kind === 'rtt').map((s) => s.value);
      const avgRtt = rtts.length ? rtts.reduce((a, b) => a + b, 0) / rtts.length : 0;
      const bytes = this.bytesPerFlow[flowId] || 0;
      return {
        flowId,
        sent,
        delivered,
        dropped,
        corrupted,
        undetected: this.count(flowId, 'undetected'),
        duplicates: this.count(flowId, 'duplicate'),
        reordered: this.count(flowId, 'reordered'),
        retransmits,
        fastRetransmits: this.samples.filter((s) => s.flowId === flowId && s.kind === 'retransmit' && s.value === 2).length,
        deliveryRate: sent ? delivered / sent : 0,
        avgRttMs: avgRtt,
        goodputBps: (bytes * 8) / durationSec,
      };
    });
  }

  /** Time series for a given metric kind, bucketed to `bucketMs`. */
  series(flowId: string, kind: MetricSample['kind'], bucketMs = 200): { t: number; v: number }[] {
    const pts = this.samples.filter((s) => s.flowId === flowId && s.kind === kind);
    if (kind === 'cwnd' || kind === 'rtt' || kind === 'queue') {
      // gauge-style: last value in each bucket
      const buckets: Record<number, number> = {};
      for (const p of pts) buckets[Math.floor(p.time / bucketMs)] = p.value;
      return Object.entries(buckets).map(([b, v]) => ({ t: +b * bucketMs, v }));
    }
    // counter-style: count per bucket
    const buckets: Record<number, number> = {};
    for (const p of pts) {
      const b = Math.floor(p.time / bucketMs);
      buckets[b] = (buckets[b] || 0) + 1;
    }
    return Object.entries(buckets).map(([b, v]) => ({ t: +b * bucketMs, v }));
  }

  toCSV(): string {
    const header = 'time,flowId,kind,value,nodeId,linkId';
    const rows = this.samples.map(
      (s) => `${s.time},${s.flowId},${s.kind},${s.value},${s.nodeId ?? ''},${s.linkId ?? ''}`
    );
    return [header, ...rows].join('\n');
  }

  reset() {
    this.samples = [];
    this.bytesPerFlow = {};
    this.startTime = 0;
    this.endTime = 0;
  }
}
