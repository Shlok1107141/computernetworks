// ============================================================
// ui/TopologyView.tsx
// Renders the network and REPLAYS the packet-move events from the
// engine on a scaled clock. The dots you see are a view of real
// discrete-event timings, not decorative animation.
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSim } from '../store/simStore';

const SPEEDS = [
  { label: '0.5×', scale: 0.5 },
  { label: '1×', scale: 1 },
  { label: '3×', scale: 3 },
] as const;

type HopEvent = {
  t: number;
  packetId: number;
  flowId: string;
  fromNode: string;
  toNode: string;
  isAck: boolean;
  kind: 'depart' | 'arrive' | 'drop';
};

export function TopologyView() {
  const { nodes, nodePos, links, moves, hasRun, selected, setSelected, liveRouting } = useSim();
  const [playT, setPlayT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(SPEEDS[0].scale); // default slow, so the counter is readable
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);

  const maxT = moves.length ? Math.max(...moves.map((m) => m.arriveAt)) : 0;

  useEffect(() => {
    if (!playing) return;
    startRef.current = performance.now() - (playT / speed);
    const tick = () => {
      const elapsed = (performance.now() - startRef.current) * speed;
      if (elapsed >= maxT) {
        setPlayT(maxT);
        setPlaying(false);
        return;
      }
      setPlayT(elapsed);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, maxT, speed]);

  const route = liveRouting();

  // packets in flight at playT
  const inFlight = moves.filter((m) => playT >= m.departAt && playT <= m.arriveAt);

  // every hop split into a depart instant + an arrive/drop instant, for a
  // frame-accurate readout of exactly what's happening on the wire right now
  const hopEvents = useMemo<HopEvent[]>(() => {
    const evs: HopEvent[] = [];
    for (const m of moves) {
      evs.push({ t: m.departAt, packetId: m.packetId, flowId: m.flowId, fromNode: m.fromNode, toNode: m.toNode, isAck: m.isAck, kind: 'depart' });
      evs.push({ t: m.arriveAt, packetId: m.packetId, flowId: m.flowId, fromNode: m.fromNode, toNode: m.toNode, isAck: m.isAck, kind: m.dropped ? 'drop' : 'arrive' });
    }
    return evs.sort((a, b) => a.t - b.t);
  }, [moves]);

  const seenEvents = hopEvents.filter((e) => e.t <= playT);
  const departedCount = seenEvents.filter((e) => e.kind === 'depart').length;
  const arrivedCount = seenEvents.filter((e) => e.kind === 'arrive').length;
  const droppedCount = seenEvents.filter((e) => e.kind === 'drop').length;
  const recentLog = seenEvents.slice(-7).reverse();

  return (
    <div>
      <svg viewBox="0 0 580 300" style={{ width: '100%', height: 300, background: 'var(--panel-2)', borderRadius: 8 }}>
        {/* links */}
        {links.map((l) => {
          const a = nodePos[l.a], b = nodePos[l.b];
          const isSel = selected?.type === 'link' && selected.id === l.id;
          return (
            <g key={l.id} onClick={() => setSelected({ type: 'link', id: l.id })} style={{ cursor: 'pointer' }}>
              <line
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={!l.up ? 'var(--red)' : isSel ? 'var(--amber)' : 'var(--teal)'}
                strokeWidth={isSel ? 3 : 1.8}
                strokeDasharray={!l.up ? '5,5' : '0'}
                opacity={0.85}
              />
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 5} className="edge-lbl" textAnchor="middle">
                {l.weight}
              </text>
            </g>
          );
        })}

        {/* in-flight packets */}
        {inFlight.map((m, i) => {
          const from = nodePos[m.fromNode], to = nodePos[m.toNode];
          const frac = (playT - m.departAt) / Math.max(1, m.arriveAt - m.departAt);
          const x = from.x + (to.x - from.x) * frac;
          const y = from.y + (to.y - from.y) * frac;
          const dropHere = m.dropped && frac > 0.6;
          return (
            <circle
              key={m.packetId + '-' + i}
              cx={x} cy={y} r={dropHere ? 3 : 5}
              fill={dropHere ? 'var(--red)' : m.isAck ? 'var(--violet)' : 'var(--amber)'}
              opacity={dropHere ? 0.4 : 1}
            />
          );
        })}

        {/* nodes */}
        {nodes.map((n) => {
          const p = nodePos[n];
          const isSel = selected?.type === 'node' && selected.id === n;
          return (
            <g key={n} onClick={() => setSelected({ type: 'node', id: n })} style={{ cursor: 'pointer' }}>
              <circle cx={p.x} cy={p.y} r={18} fill="var(--panel)" stroke={isSel ? 'var(--amber)' : 'var(--violet)'} strokeWidth={1.8} />
              <text x={p.x} y={p.y + 4} className="node-lbl" textAnchor="middle">{n}</text>
            </g>
          );
        })}
      </svg>

      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn small" disabled={!hasRun} onClick={() => { setPlayT(0); setPlaying(true); }}>
          ▶ Replay packets
        </button>
        <button className="btn secondary small" onClick={() => setPlaying(false)}>Pause</button>
        <input
          type="range" min={0} max={maxT || 1} value={playT}
          onChange={(e) => { setPlaying(false); setPlayT(+e.target.value); }}
          style={{ flex: 1 }}
        />
        <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
          t = {(playT / 1000).toFixed(2)}s / {(maxT / 1000).toFixed(2)}s
        </span>
      </div>

      <div className="row" style={{ marginTop: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>Speed</span>
        <div className="seg">
          {SPEEDS.map((s) => (
            <button key={s.label} className={speed === s.scale ? 'on' : ''} onClick={() => setSpeed(s.scale)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="stat-row" style={{ marginTop: 10 }}>
        <div className="stat">
          <div className="kicker">In flight</div>
          <div className="mono" style={{ fontSize: 18, color: 'var(--amber)' }}>{inFlight.length}</div>
        </div>
        <div className="stat">
          <div className="kicker">Departed</div>
          <div className="mono" style={{ fontSize: 18 }}>{departedCount}</div>
        </div>
        <div className="stat">
          <div className="kicker">Arrived</div>
          <div className="mono" style={{ fontSize: 18, color: 'var(--teal)' }}>{arrivedCount}</div>
        </div>
        <div className="stat">
          <div className="kicker">Dropped</div>
          <div className="mono" style={{ fontSize: 18, color: 'var(--red)' }}>{droppedCount}</div>
        </div>
      </div>

      <div
        className="mono"
        style={{
          marginTop: 10, fontSize: 11, color: 'var(--muted)', background: 'var(--panel-2)',
          border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px',
          height: 132, overflowY: 'auto', lineHeight: 1.7,
        }}
      >
        {recentLog.length === 0 && <div>— replay to see packet events at each instant —</div>}
        {recentLog.map((e, i) => (
          <div key={e.t + '-' + e.packetId + '-' + e.kind + '-' + i}>
            <span style={{ color: 'var(--muted)' }}>t={(e.t / 1000).toFixed(3)}s</span>{'  '}
            <span>#{e.packetId}{e.isAck ? ' ACK' : ''} {e.fromNode}→{e.toNode}</span>{'  '}
            <span style={{
              color: e.kind === 'drop' ? 'var(--red)' : e.kind === 'arrive' ? 'var(--teal)' : 'var(--amber)',
            }}>
              {e.kind === 'depart' ? 'departed' : e.kind === 'arrive' ? 'arrived' : 'dropped'}
            </span>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
        R1→R6 next hop ({useSim.getState().routing.toUpperCase()}):{' '}
        <span className="mono" style={{ color: 'var(--teal)' }}>
          {traceRoute(route.nextHop, 'R1', 'R6').join(' → ')}
        </span>
      </div>
    </div>
  );
}

function traceRoute(nextHop: Record<string, Record<string, string | null>>, from: string, to: string): string[] {
  const path = [from];
  let cur = from;
  let guard = 0;
  while (cur !== to && guard++ < 20) {
    const nh = nextHop[cur]?.[to];
    if (!nh) return [...path, '✗ unreachable'];
    path.push(nh);
    cur = nh;
  }
  return path;
}
