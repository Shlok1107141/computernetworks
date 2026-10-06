import { lazy, Suspense } from 'react';
import { useSim } from './store/simStore';
import { TopologyView } from './ui/TopologyView';
import { StackBuilder } from './ui/StackBuilder';
import { Inspector } from './ui/Inspector';
import { FaultTimeline } from './ui/FaultTimeline';
import './index.css';

// the chart panels pull in recharts; loading them separately keeps the first bundle small
const Dashboard = lazy(() => import('./ui/Dashboard').then((m) => ({ default: m.Dashboard })));
const Comparison = lazy(() => import('./ui/Comparison').then((m) => ({ default: m.Comparison })));
const loading = <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading charts…</div>;

export default function App() {
  const { run, routing, setRouting, routingRoundMs, setRoutingRoundMs, seed, setSeed, durationMs, setDurationMs, flows, setSelected } = useSim();

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <div className="kicker">Custom Protocol Stack Simulator</div>
          <h1>Network Sandbox</h1>
          <p>Compose a protocol stack, tune every layer and link, run real discrete-event traffic, and watch packets move. Lab-ready, browser-native, no hardware.</p>
        </div>
        <span className="badge">sim-core &#183; discrete-event</span>
      </header>

      <div className="control-bar">
        <button className="btn" onClick={run}>&#9654; Run simulation</button>
        <div className="seg">
          <button className={routing === 'dv' ? 'on' : ''} onClick={() => setRouting('dv')}>Distance Vector</button>
          <button className={routing === 'ls' ? 'on' : ''} onClick={() => setRouting('ls')}>Link State</button>
        </div>
        {routing === 'dv' && (
          <label className="seed" title="After a link change, Distance Vector routers exchange tables once per period until they agree">
            DV update every
            <input type="number" min={10} max={2000} step={10} value={routingRoundMs}
              onChange={(e) => setRoutingRoundMs(+e.target.value)} /> ms
          </label>
        )}
        <label className="seed">seed
          <input type="number" value={seed} onChange={(e) => setSeed(+e.target.value)} />
        </label>
        <label className="seed">run for
          <input type="number" min={1} max={120} step={1} value={durationMs / 1000}
            onChange={(e) => setDurationMs(+e.target.value * 1000)} /> s
        </label>
        <button className="btn secondary small" onClick={() => setSelected({ type: 'flow', id: flows[0].id })}>
          Tune flow
        </button>
      </div>

      <div className="layout">
        <section className="panel col-stack">
          <h2>Stack Builder</h2>
          <div className="sub">Layers run top &#8594; bottom. Click one to configure it.</div>
          <StackBuilder />
        </section>

        <section className="panel col-net">
          <h2>Network</h2>
          <div className="sub">Click a link or router to inspect; drag routers to rearrange. Replay shows real event timings.</div>
          <TopologyView />
        </section>

        <section className="panel col-inspect">
          <h2>Inspector</h2>
          <div className="sub">Fine-grained knobs for the current selection.</div>
          <Inspector />
        </section>
      </div>

      <div className="layout" style={{ marginTop: 20, gridTemplateColumns: '1.5fr 1fr' }}>
        <section className="panel">
          <h2>Dashboard</h2>
          <div className="sub">Measured metrics from the last run &#8212; reproducible for the same seed.</div>
          <Suspense fallback={loading}><Dashboard /></Suspense>
        </section>

        <section className="panel">
          <h2>Fault Timeline &amp; Scenarios</h2>
          <div className="sub">Schedule link failures on the clock; save or load the whole scenario.</div>
          <FaultTimeline />
        </section>
      </div>

      <section className="panel" style={{ marginTop: 20 }}>
        <h2>A/B Stack Comparison</h2>
        <div className="sub">The core experiment: two stacks, identical traffic and seed &#8212; the only variable is the protocol.</div>
        <Suspense fallback={loading}><Comparison /></Suspense>
      </section>

      <div className="footer-note">
        Phase-5 &#183; discrete-event core, per-hop &amp; end-to-end layers, all 9 primitives live, reliability with slow start, adaptive timeout &amp; fast retransmit, DV vs LS convergence, link queues, multiple flows, A/B harness + loss sweep &#183; 20/20 self-check groups pass
      </div>
    </div>
  );
}
