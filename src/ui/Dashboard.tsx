// ============================================================
// ui/Dashboard.tsx
// Reads the last run's Metrics and shows summary stats + a
// time-series chart, plus CSV export for reproducible results.
// ============================================================

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useSim } from '../store/simStore';

export function Dashboard() {
  const { metrics, flows, hasRun } = useSim();

  if (!hasRun || !metrics) {
    return <div style={{ color: 'var(--muted)', fontSize: 13 }}>Run a simulation to see metrics.</div>;
  }

  const flowIds = flows.map((f) => f.id);
  const summary = metrics.summarize(flowIds);

  // build combined delivered-over-time series for the first flow
  const f0 = flowIds[0];
  const delivered = metrics.series(f0, 'delivered', 250);
  const dropped = metrics.series(f0, 'dropped', 250);
  const chartData = mergeSeries(delivered, dropped, ['delivered', 'dropped']);

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
        {summary.map((s) => (
          <div className="stat" key={s.flowId} style={{ flex: '1 1 100%' }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Flow {s.flowId}</div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <Metric label="delivery" value={(s.deliveryRate * 100).toFixed(0) + '%'} />
              <Metric label="delivered" value={String(s.delivered)} />
              <Metric label="dropped" value={String(s.dropped)} />
              <Metric label="corrupt, caught" value={String(s.corrupted)} />
              <Metric label="corrupt, missed" value={String(s.undetected)} />
              <Metric label="duplicates" value={String(s.duplicates)} />
              <Metric label="out of order" value={String(s.reordered)} />
              <Metric label="retransmits" value={String(s.retransmits)} />
              <Metric label="avg RTT" value={s.avgRttMs.toFixed(1) + 'ms'} />
              <Metric label="goodput" value={(s.goodputBps / 1000).toFixed(1) + ' kbps'} />
            </div>
          </div>
        ))}
      </div>

      <div style={{ height: 200, marginTop: 16 }}>
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontFamily: 'Space Grotesk', fontSize: 18, fontWeight: 600 }}>{value}</div>
      <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{label}</div>
    </div>
  );
}

function mergeSeries(a: { t: number; v: number }[], b: { t: number; v: number }[], keys: string[]) {
  const map: Record<number, Record<string, number>> = {};
  a.forEach((p) => { (map[p.t] ||= { t: p.t } as Record<string, number>)[keys[0]] = p.v; });
  b.forEach((p) => { (map[p.t] ||= { t: p.t } as Record<string, number>)[keys[1]] = p.v; });
  return Object.values(map).sort((x, y) => x.t - y.t);
}
