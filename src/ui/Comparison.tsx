// ============================================================
// ui/Comparison.tsx
// The paper's core experiment, in the UI: pick two stacks, run
// them on identical traffic + seed, and see the metrics side by
// side with overlaid congestion-window curves.
// ============================================================

import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useSim } from '../store/simStore';
import { compareStacks, type ComparisonResult } from '../sim-core/comparison';
import { reliableStack, unreliableStack } from '../sim-core/presets';
import type { NetworkConfig } from '../sim-core/network';

export function Comparison() {
  const { nodes, links, flows, faults, routing, seed, durationMs, stack } = useSim();
  const [result, setResult] = useState<ComparisonResult | null>(null);

  const runCompare = () => {
    const base: Omit<NetworkConfig, 'stack'> = { nodes, links, flows, faults, routing, seed, durationMs };
    // A = the stack currently in the builder; B = the unreliable baseline
    const res = compareStacks(
      base,
      { label: 'Current stack', stack },
      { label: 'Unreliable baseline', stack: unreliableStack() }
    );
    setResult(res);
  };

  const runReliableVsUnreliable = () => {
    const base: Omit<NetworkConfig, 'stack'> = { nodes, links, flows, faults, routing, seed, durationMs };
    setResult(compareStacks(base,
      { label: 'Reliable', stack: reliableStack() },
      { label: 'Unreliable', stack: unreliableStack() }));
  };

  const cwndData = result ? mergeCwnd(result.cwndA, result.cwndB, result.labelA, result.labelB) : [];

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn small" onClick={runCompare}>Current vs baseline</button>
        <button className="btn secondary small" onClick={runReliableVsUnreliable}>Reliable vs unreliable</button>
      </div>

      {!result ? (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>
          Run a comparison to see two stacks race on identical traffic and seed.
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <StackCol label={result.labelA} s={result.summaryA[0]} accent="var(--teal)" />
            <StackCol label={result.labelB} s={result.summaryB[0]} accent="var(--violet)" />
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', margin: '12px 0 4px' }}>
            Congestion window over time (AIMD sawtooth; only stacks with ACK + WINDOW have one)
          </div>
          <div style={{ height: 170 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={cwndData} margin={{ top: 6, right: 10, bottom: 0, left: -22 }}>
                <CartesianGrid stroke="#243441" strokeDasharray="3 3" />
                <XAxis dataKey="t" tick={{ fill: '#8CA0B3', fontSize: 10 }} tickFormatter={(v) => (v / 1000).toFixed(1) + 's'} />
                <YAxis tick={{ fill: '#8CA0B3', fontSize: 10 }} />
                <Tooltip contentStyle={{ background: '#0C141B', border: '1px solid #243441', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="stepAfter" dataKey={result.labelA} stroke="#2FD3C6" dot={false} strokeWidth={2} />
                <Line type="stepAfter" dataKey={result.labelB} stroke="#9C8CFB" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}

function StackCol({ label, s, accent }: { label: string; s: import('../sim-core/metrics').FlowSummary; accent: string }) {
  return (
    <div className="stat" style={{ borderColor: accent }}>
      <div style={{ fontSize: 12, color: accent, fontWeight: 600, marginBottom: 8 }}>{label}</div>
      <Row k="delivery" v={(s.deliveryRate * 100).toFixed(0) + '%'} />
      <Row k="delivered" v={String(s.delivered)} />
      <Row k="dropped" v={String(s.dropped)} />
      <Row k="corrupt, caught" v={String(s.corrupted)} />
      <Row k="corrupt, missed" v={String(s.undetected)} />
      <Row k="duplicates" v={String(s.duplicates)} />
      <Row k="out of order" v={String(s.reordered)} />
      <Row k="retransmits" v={String(s.retransmits)} />
      <Row k="avg RTT" v={s.avgRttMs.toFixed(1) + ' ms'} />
      <Row k="goodput" v={(s.goodputBps / 1000).toFixed(1) + ' kbps'} />
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }}>
      <span style={{ color: 'var(--muted)' }}>{k}</span>
      <span className="mono">{v}</span>
    </div>
  );
}

function mergeCwnd(a: { t: number; v: number }[], b: { t: number; v: number }[], la: string, lb: string) {
  const map: Record<number, Record<string, number>> = {};
  a.forEach((p) => { (map[p.t] ||= { t: p.t } as Record<string, number>)[la] = p.v; });
  b.forEach((p) => { (map[p.t] ||= { t: p.t } as Record<string, number>)[lb] = p.v; });
  return Object.values(map).sort((x, y) => x.t - y.t);
}
