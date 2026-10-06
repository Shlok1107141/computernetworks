// ============================================================
// ui/TopologyView.tsx
// Renders the network and REPLAYS the packet-move events from the
// engine on a scaled clock. The dots you see are a view of real
// discrete-event timings, not decorative animation.
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { FLOW_COLORS, useSim } from '../store/simStore';

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
  const { nodes, nodePos, links, flows, moves, hasRun, lastConfig, selected, setSelected, liveRouting, moveNode, addFlow, routing } = useSim();
  const [playT, setPlayT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(SPEEDS[0].scale); // default slow, so the counter is readable
  const rafRef = useRef<number | null>(null);
  const playTRef = useRef(0);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ id: string; moved: boolean } | null>(null);

  const scrub = (t: number) => { playTRef.current = t; setPlayT(t); };

  const maxT = moves.length ? Math.max(...moves.map((m) => m.arriveAt)) : 0;

  useEffect(() => {
    if (!playing) return;
    const start = performance.now() - playTRef.current / speed;
    const tick = () => {
      const elapsed = (performance.now() - start) * speed;
      if (elapsed >= maxT) {
        scrub(maxT);
        setPlaying(false);
        return;
      }
      scrub(elapsed);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, maxT, speed]);

  const route = liveRouting();
  const flowColor = (flowId: string) => {
    const i = (lastConfig?.flows ?? flows).findIndex((f) => f.id === flowId);
    return FLOW_COLORS.at(Math.max(0, i) % FLOW_COLORS.length)!;
  };

  // during a replay, a link is drawn as it was at that moment of the run (scheduled faults applied)
  const replaying = hasRun && playT > 0 && !!lastConfig;
  const linkUp = (id: string, upNow: boolean) => {
    if (!replaying) return upNow;
    let up = lastConfig!.links.find((l) => l.id === id)?.up ?? upNow;
    for (const f of [...lastConfig!.faults].sort((a, b) => a.atMs - b.atMs)) {
      if (f.linkId === id && f.atMs <= playT) up = f.action === 'restore';
    }
    return up;
  };

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

  // routers can be dragged; a press that doesn't move is a click (select)
  const toSvg = (e: React.PointerEvent) => {
    const svg = svgRef.current!;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current.moved = true;
    const { x, y } = toSvg(e);
    moveNode(drag.current.id, x, y);
  };
  const onPointerUp = () => {
    if (drag.current && !drag.current.moved) setSelected({ type: 'node', id: drag.current.id });
    drag.current = null;
  };

  const traced = flows.find((f) => selected?.type === 'flow' && f.id === selected.id) ?? flows[0];

  return (
    <div>
      <svg ref={svgRef} viewBox="0 0 580 300" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
        style={{ width: '100%', height: 300, background: 'var(--panel-2)', borderRadius: 8, touchAction: 'none' }}>
        {/* links */}
        {links.map((l) => {
          const a = nodePos[l.a], b = nodePos[l.b];
          const isSel = selected?.type === 'link' && selected.id === l.id;
          const up = linkUp(l.id, l.up);
          return (
            <g key={l.id} onClick={() => setSelected({ type: 'link', id: l.id })} style={{ cursor: 'pointer' }}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={12} />
              <line
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={!up ? 'var(--red)' : isSel ? 'var(--amber)' : 'var(--teal)'}
                strokeWidth={isSel ? 3 : 1.8}
                strokeDasharray={!up ? '5,5' : '0'}
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
              fill={dropHere ? 'var(--red)' : m.isAck ? 'var(--violet)' : flowColor(m.flowId)}
              opacity={dropHere ? 0.4 : 1}
            />
          );
        })}

        {/* nodes */}
        {nodes.map((n) => {
          const p = nodePos[n];
          const isSel = selected?.type === 'node' && selected.id === n;
          return (
            <g key={n} style={{ cursor: 'grab' }}
              onPointerDown={(e) => { e.stopPropagation(); drag.current = { id: n, moved: false }; }}>
              <circle cx={p.x} cy={p.y} r={18} fill="var(--panel)" stroke={isSel ? 'var(--amber)' : 'var(--violet)'} strokeWidth={1.8} />
              <text x={p.x} y={p.y + 4} className="node-lbl" textAnchor="middle" style={{ pointerEvents: 'none' }}>{n}</text>
            </g>
          );
        })}
      </svg>

      <div className="row" style={{ marginTop: 10 }}>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>Traffic</span>
        {flows.map((f, i) => {
          const isSel = selected?.type === 'flow' && selected.id === f.id;
          return (
            <button key={f.id} className="btn secondary small" onClick={() => setSelected({ type: 'flow', id: f.id })}
              style={{ borderColor: isSel ? 'var(--amber)' : undefined }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: FLOW_COLORS.at(i % FLOW_COLORS.length), marginRight: 6 }} />
              {f.id} {f.src}→{f.dst}
            </button>
          );
        })}
        <button className="btn secondary small" onClick={addFlow}>+ Add flow</button>
        <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>Drag a router to move it.</span>
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn small" disabled={!hasRun} onClick={() => { scrub(0); setPlaying(true); }}>
          ▶ Replay packets
        </button>
        <button className="btn secondary small" onClick={() => setPlaying(false)}>Pause</button>
        <input
          type="range" min={0} max={maxT || 1} value={playT}
          onChange={(e) => { setPlaying(false); scrub(+e.target.value); }}
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
            <span style={{ color: e.isAck ? 'var(--violet)' : flowColor(e.flowId) }}>{e.flowId}</span>{' '}
            <span>#{e.packetId}{e.isAck ? ' ACK' : ''} {e.fromNode}→{e.toNode}</span>{'  '}
            <span style={{
              color: e.kind === 'drop' ? 'var(--red)' : e.kind === 'arrive' ? 'var(--teal)' : 'var(--amber)',
            }}>
              {e.kind === 'depart' ? 'departed' : e.kind === 'arrive' ? 'arrived' : 'dropped'}
            </span>
          </div>
        ))}
      </div>

      {traced && (
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
          {traced.src}→{traced.dst} route now ({routing.toUpperCase()}):{' '}
          <span className="mono" style={{ color: 'var(--teal)' }}>
            {traceRoute(route.nextHop, traced.src, traced.dst).join(' → ')}
          </span>
        </div>
      )}
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
