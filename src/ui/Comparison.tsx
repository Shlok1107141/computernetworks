// ============================================================
// ui/Comparison.tsx
// The paper's core experiment, in the UI: pick two stacks, run
// them on identical traffic + seed, and see the metrics side by
// side with overlaid congestion-window curves. Plus a loss sweep:
// every stack's delivery as loss on all links rises.
// ============================================================

import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useSim } from '../store/simStore';
import { compareStacks, type ComparisonResult } from '../sim-core/comparison';
import { reliableStack, tcpLikeStack, unreliableStack } from '../sim-core/presets';
import { sweepLoss } from '../sim-core/validation';
import type { LayerDef } from '../sim-core/layer';
import type { FlowSummary } from '../sim-core/metrics';
import { aggregate, latencyLabel, retransmitText } from './summary';

type Pair = { label: string; stack: LayerDef[] };

const SWEEP_COLORS = ['#2FD3C6', '#F07AB8', '#F5A94E', '#9C8CFB'];

export function Comparison() {
  const { stack, flows, baseConfig } = useSim();
  const [result, setResult] = useState<{ res: ComparisonResult; a: Pair; b: Pair } | null>(null);
  const [sweep, setSweep] = useState<{ rows: Record<string, number>[]; labels: string[] } | null>(null);
  const [sweeping, setSweeping] = useState(false);

  const compare = (a: Pair, b: Pair) => setResult({ res: compareStacks(baseConfig(), a, b), a, b });

  const runSweep = () => {
    setSweeping(true);
    // let the button repaint as "running" before the synchronous runs start
    setTimeout(() => {
      const stacks = [
        { label: 'Current stack', stack },
        { label: 'TCP-like', stack: tcpLikeStack() },
        { label: 'Reliable', stack: reliableStack() },
        { label: 'Unreliable', stack: unreliableStack() },
      ];
      setSweep({ rows: sweepLoss(baseConfig(), stacks), labels: stacks.map((s) => s.label) });
      setSweeping(false);
    }, 20);
  };

  const cwndData = result ? mergeCwnd(result.res.cwndA, result.res.cwndB, result.a.label, result.b.label) : [];

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn small" onClick={() => compare({ label: 'Current stack', stack }, { label: 'Unreliable baseline', stack: unreliableStack() })}>
          Current vs baseline
        </button>
        <button className="btn secondary small" onClick={() => compare({ label: 'Reliable', stack: reliableStack() }, { label: 'Unreliable', stack: unreliableStack() })}>
          Reliable vs unreliable
        </button>
        <button className="btn secondary small" onClick={() => compare({ label: 'TCP-like', stack: tcpLikeStack() }, { label: 'Reliable', stack: reliableStack() })}>
          TCP-like vs reliable
        </button>
      </div>

      {!result ? (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>
          Run a comparison to see two stacks race on identical traffic and seed.
        </div>
      ) : (
        <>
          {flows.length > 1 && (
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 }}>All {flows.length} flows combined.</div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <StackCol label={result.a.label} s={aggregate(result.res.summaryA)} stack={result.a.stack} accent="var(--teal)" />
            <StackCol label={result.b.label} s={aggregate(result.res.summaryB)} stack={result.b.stack} accent="var(--violet)" />
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', margin: '12px 0 4px' }}>
            Congestion window over time, flow {flows[0]?.id} (only stacks with ACK + WINDOW have one)
          </div>
          <div style={{ height: 170 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={cwndData} margin={{ top: 6, right: 10, bottom: 0, left: -22 }}>
                <CartesianGrid stroke="#243441" strokeDasharray="3 3" />
                <XAxis dataKey="t" tick={{ fill: '#8CA0B3', fontSize: 10 }} tickFormatter={(v) => (v / 1000).toFixed(1) + 's'} />
                <YAxis tick={{ fill: '#8CA0B3', fontSize: 10 }} />
                <Tooltip contentStyle={{ background: '#0C141B', border: '1px solid #243441', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="stepAfter" dataKey={result.a.label} stroke="#2FD3C6" dot={false} strokeWidth={2} />
                <Line type="stepAfter" dataKey={result.b.label} stroke="#9C8CFB" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 14 }}>
        <div className="row" style={{ marginBottom: 8 }}>
          <button className="btn secondary small" disabled={sweeping} onClick={runSweep}>
            {sweeping ? 'Sweeping…' : 'Loss sweep 0–30%'}
          </button>
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            Delivery of four stacks as loss on every link rises, with your current links, flows, seed and run length.
          </span>
        </div>
        {sweep && (
          <div style={{ height: 210 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sweep.rows} margin={{ top: 6, right: 10, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="#243441" strokeDasharray="3 3" />
                <XAxis dataKey="lossPct" tick={{ fill: '#8CA0B3', fontSize: 10 }} tickFormatter={(v) => v + '%'} />
                <YAxis domain={[0, 1]} tick={{ fill: '#8CA0B3', fontSize: 10 }} tickFormatter={(v) => Math.round(v * 100) + '%'} />
                <Tooltip contentStyle={{ background: '#0C141B', border: '1px solid #243441', fontSize: 12 }}
                  labelFormatter={(v) => `loss ${v}% on every link`} formatter={(v) => `${Math.round(Number(v) * 100)}%`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {sweep.labels.map((label, i) => (
                  <Line key={label} type="monotone" dataKey={label} stroke={SWEEP_COLORS.at(i)} dot strokeWidth={2} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

function StackCol({ label, s, stack, accent }: { label: string; s: FlowSummary; stack: LayerDef[]; accent: string }) {
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
      <Row k="retransmits" v={retransmitText(s)} />
      <Row k={latencyLabel(stack)} v={s.avgRttMs.toFixed(1) + ' ms'} />
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
