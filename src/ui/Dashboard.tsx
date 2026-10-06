// ============================================================
// ui/Dashboard.tsx
// Reads the last run's Metrics and shows summary stats + a
// time-series chart, plus CSV export for reproducible results.
// ============================================================

import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { FLOW_COLORS, useSim } from '../store/simStore';
import type { FlowSummary } from '../sim-core/metrics';
import { aggregate, latencyLabel, retransmitText } from './summary';

export function Dashboard() {
  const { metrics, hasRun, lastConfig } = useSim();
  const [chartFlow, setChartFlow] = useState<string>('all');

  if (!hasRun || !metrics || !lastConfig) {
    return <div style={{ color: 'var(--muted)', fontSize: 13 }}>Run a simulation to see metrics.</div>;
  }

  // the flows and stack this run actually used, not whatever has been edited since
  const flowIds = lastConfig.flows.map((f) => f.id);
  const summary = metrics.summarize(flowIds);
  const latency = latencyLabel(lastConfig.stack);
  const shown = flowIds.includes(chartFlow) ? [chartFlow] : flowIds;
  const chartData = mergeSeries(
    shown.flatMap((id) => metrics.series(id, 'delivered', 250)),
    shown.flatMap((id) => metrics.series(id, 'dropped', 250)),
  );

  const exportCsv = () => {
    const blob = new Blob([metrics.toCSV()], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sim-metrics.csv';
    a.click();
  };

  return (
    <div>
      <div className="stat-row">
        {summary.length > 1 && <FlowCard title="All flows" s={aggregate(summary)} latency={latency} />}
        {summary.map((s, i) => {
          const f = lastConfig.flows.at(i)!;
          return <FlowCard key={s.flowId} title={`Flow ${s.flowId} (${f.src} → ${f.dst})`} color={FLOW_COLORS.at(i % FLOW_COLORS.length)} s={s} latency={latency} />;
        })}
      </div>

      {flowIds.length > 1 && (
        <div className="row" style={{ marginTop: 14 }}>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>Chart</span>
          <div className="seg">
            {['all', ...flowIds].map((id) => (
              <button key={id} className={(id === 'all' ? !flowIds.includes(chartFlow) : chartFlow === id) ? 'on' : ''} onClick={() => setChartFlow(id)}>
                {id === 'all' ? 'All flows' : id}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ height: 200, marginTop: 12 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 6, right: 10, bottom: 0, left: -20 }}>
            <CartesianGrid stroke="#243441" strokeDasharray="3 3" />
            <XAxis dataKey="t" tick={{ fill: '#8CA0B3', fontSize: 10 }} tickFormatter={(v) => (v / 1000).toFixed(1) + 's'} />
            <YAxis tick={{ fill: '#8CA0B3', fontSize: 10 }} />
            <Tooltip contentStyle={{ background: '#0C141B', border: '1px solid #243441', fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="delivered" stroke="#2FD3C6" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="dropped" stroke="#F4694B" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <button className="btn secondary small" style={{ marginTop: 12 }} onClick={exportCsv}>Export metrics CSV</button>
    </div>
  );
}

function FlowCard({ title, s, latency, color }: { title: string; s: FlowSummary; latency: string; color?: string }) {
  return (
    <div className="stat" style={{ flex: '1 1 100%', borderLeft: color ? `3px solid ${color}` : undefined }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Metric label="delivery" value={(s.deliveryRate * 100).toFixed(0) + '%'} />
        <Metric label="delivered" value={String(s.delivered)} />
        <Metric label="dropped" value={String(s.dropped)} />
        <Metric label="corrupt, caught" value={String(s.corrupted)} />
        <Metric label="corrupt, missed" value={String(s.undetected)} />
        <Metric label="duplicates" value={String(s.duplicates)} />
        <Metric label="out of order" value={String(s.reordered)} />
        <Metric label="retransmits" value={retransmitText(s)} />
        <Metric label={latency} value={s.avgRttMs.toFixed(1) + 'ms'} />
        <Metric label="goodput" value={(s.goodputBps / 1000).toFixed(1) + ' kbps'} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontFamily: 'Space Grotesk', fontSize: 18, fontWeight: 600 }}>{value}</div>
      <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{label}</div>
    </div>
  );
}

/** Sum each series per time bucket (several flows add up), then line the two up. */
function mergeSeries(delivered: { t: number; v: number }[], dropped: { t: number; v: number }[]) {
  const map: Record<number, { t: number; delivered: number; dropped: number }> = {};
  const row = (t: number) => (map[t] ||= { t, delivered: 0, dropped: 0 });
  delivered.forEach((p) => { row(p.t).delivered += p.v; });
  dropped.forEach((p) => { row(p.t).dropped += p.v; });
  return Object.values(map).sort((x, y) => x.t - y.t);
}
