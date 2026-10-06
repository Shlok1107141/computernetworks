// ============================================================
// ui/Inspector.tsx
// Context-sensitive knob panel. Whatever is selected (link, layer,
// flow) exposes its "minute things you can change" here. This is
// where the per-link / per-layer / per-flow tuning lives.
// ============================================================

import { useState } from 'react';
import { useSim } from '../store/simStore';
import { DEFAULT_DELAY_MS, PRIMITIVE_KINDS, reliabilityLayers, type LayerDef, type Primitive, type PrimitiveKind } from '../sim-core/layer';
import type { RoutingResult } from '../sim-core/routing';

function Knob({ label, value, min, max, step, unit, hint, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string;
  hint?: string; onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)', marginBottom: 3 }}>
        <span>{label}</span>
        <span className="mono" style={{ color: 'var(--text)' }}>{value}{unit}</span>
      </label>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(+e.target.value)} style={{ width: '100%', opacity: hint ? 0.55 : 1 }} />
      {hint && <div style={{ fontSize: 10.5, color: 'var(--amber)', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

const PRIMITIVE_HELP: Record<PrimitiveKind, string> = {
  ADD_HEADER: 'Push a header; adds this layer\'s header overhead to every packet',
  STRIP_HEADER: 'Legacy: headers are already removed automatically on receive',
  CHECKSUM: 'Stamp a checksum of the payload; receiver discards the packet on mismatch',
  SEQUENCE: 'Number packets; receiver drops duplicates (and with RETRANSMIT, delivers in order)',
  ACK: 'Receiver sends an ACK back for every packet it accepts',
  RETRANSMIT: 'Resend a packet if no ACK arrives within Timeout; optionally learn the timeout and resend early',
  WINDOW: 'Cap unACKed packets by a congestion window (AIMD, optionally slow start), up to Window size',
  DROP_IF: 'Drop the packet when the condition holds (per-hop: checked at every router)',
  DELAY: 'Add processing time before sending (per-hop: at every router)',
  FRAGMENT: 'Split packets bigger than MTU; receiver reassembles, one lost piece loses all',
};

// STRIP_HEADER stays loadable for old scenarios but isn't offered: unwrapping is automatic now
const ADDABLE_KINDS = PRIMITIVE_KINDS.filter((k) => k !== 'STRIP_HEADER');

/** Why a primitive in this stack currently does nothing, if it doesn't. */
function inactiveReason(kind: PrimitiveKind, layer: LayerDef, stack: LayerDef[]): string | null {
  const rel = reliabilityLayers(stack);
  if ((kind === 'RETRANSMIT' || kind === 'WINDOW') && !rel.ack) return 'inactive: add ACK to the stack';
  if (kind === 'FRAGMENT' && rel.frag !== layer) return 'inactive: a higher layer\'s FRAGMENT is in charge';
  if (kind === 'STRIP_HEADER') return 'no extra effect';
  return null;
}

function PrimitiveEditor({ layer, stack }: { layer: LayerDef; stack: LayerDef[] }) {
  const { addPrimitive, removePrimitive, movePrimitive, updatePrimitive } = useSim();
  const [newKind, setNewKind] = useState<PrimitiveKind>('CHECKSUM');

  return (
    <div style={{ marginTop: 6, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      <div className="kicker" style={{ marginBottom: 8 }}>Primitives (run top → bottom on send)</div>
      {layer.primitives.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>No primitives: this layer passes packets through untouched.</div>
      )}
      {layer.primitives.map((p, i) => {
        const reason = inactiveReason(p.kind, layer, stack);
        return (
          <div key={i} className="layer" style={{ cursor: 'default', padding: '8px 10px', marginBottom: 8 }}>
            <div className="layer-head">
              <span className="mono" style={{ fontSize: 12, fontWeight: 600, opacity: reason ? 0.6 : 1 }}>{p.kind}</span>
              <div className="row" style={{ gap: 4 }}>
                <button className="btn secondary small" disabled={i === 0} onClick={() => movePrimitive(layer.id, i, -1)}>↑</button>
                <button className="btn secondary small" disabled={i === layer.primitives.length - 1} onClick={() => movePrimitive(layer.id, i, 1)}>↓</button>
                <button className="btn secondary small" onClick={() => removePrimitive(layer.id, i)}>✕</button>
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{PRIMITIVE_HELP[p.kind]}</div>
            {reason && <div style={{ fontSize: 10.5, color: 'var(--amber)', marginTop: 2 }}>{reason}</div>}
            <PrimitiveParams p={p} onChange={(params) => updatePrimitive(layer.id, i, params)} />
          </div>
        );
      })}
      <div className="row">
        <select value={newKind} onChange={(e) => setNewKind(e.target.value as PrimitiveKind)} style={{ flex: 1 }}>
          {ADDABLE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <button className="btn small" onClick={() => addPrimitive(layer.id, newKind)}>+ Add</button>
      </div>
    </div>
  );
}

function Choice({ label, value, options, onChange }: {
  label: string; value: string; options: [string, string][]; onChange: (v: string) => void;
}) {
  return (
    <>
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </>
  );
}

function PrimitiveParams({ p, onChange }: { p: Primitive; onChange: (params: Primitive['params']) => void }) {
  if (p.kind === 'RETRANSMIT') {
    return (
      <div className="row" style={{ marginTop: 6, gap: 4 }}>
        <Choice label="timeout" value={String(p.params.rto ?? 'fixed')}
          options={[['fixed', 'fixed'], ['adaptive', 'adaptive (learns RTT)']]}
          onChange={(rto) => onChange({ ...p.params, rto })} />
        <Choice label="fast retransmit" value={String(p.params.fast ?? 'off')}
          options={[['off', 'off'], ['on', 'on (after 3 later ACKs)']]}
          onChange={(fast) => onChange({ ...p.params, fast })} />
      </div>
    );
  }
  if (p.kind === 'WINDOW') {
    return (
      <div className="row" style={{ marginTop: 6, gap: 4 }}>
        <Choice label="growth" value={String(p.params.growth ?? 'aimd')}
          options={[['aimd', 'AIMD only'], ['slow-start', 'slow start, then AIMD']]}
          onChange={(growth) => onChange({ ...p.params, growth })} />
      </div>
    );
  }
  if (p.kind === 'DELAY') {
    return (
      <div className="row" style={{ marginTop: 6, gap: 4 }}>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>delay</span>
        <input type="number" min={0} max={1000} value={Number(p.params.ms ?? DEFAULT_DELAY_MS)} style={{ width: 70 }}
          onChange={(e) => onChange({ ms: Math.max(0, +e.target.value) })} />
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>ms</span>
      </div>
    );
  }
  if (p.kind === 'DROP_IF') {
    return (
      <div className="row" style={{ marginTop: 6, gap: 4 }}>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>drop if</span>
        <select value={String(p.params.field ?? 'ttl')} onChange={(e) => onChange({ ...p.params, field: e.target.value })}>
          {['ttl', 'size', 'seq'].map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <select value={String(p.params.op ?? '==')} onChange={(e) => onChange({ ...p.params, op: e.target.value })}>
          {['==', '!=', '>', '<', '>=', '<='].map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <input type="number" value={Number(p.params.value ?? 0)} style={{ width: 70 }}
          onChange={(e) => onChange({ ...p.params, value: +e.target.value })} />
      </div>
    );
  }
  if (p.kind === 'ADD_HEADER') {
    const [key, val] = Object.entries(p.params)[0] ?? ['tag', ''];
    return (
      <div className="row" style={{ marginTop: 6, gap: 4 }}>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>field</span>
        <input type="text" value={key} style={{ width: 80 }}
          onChange={(e) => onChange({ [e.target.value]: val })} />
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>=</span>
        <input type="text" value={String(val)} style={{ width: 80 }}
          onChange={(e) => onChange({ [key]: e.target.value })} />
      </div>
    );
  }
  return null;
}

export function Inspector() {
  const { selected, nodes, links, stack, flows, routing, liveRouting, updateLink, updateLayer, updateFlow, removeFlow } = useSim();

  if (!selected) {
    return <div style={{ color: 'var(--muted)', fontSize: 13 }}>Select a link, layer, or flow to tune its parameters.</div>;
  }

  if (selected.type === 'link') {
    const l = links.find((x) => x.id === selected.id);
    if (!l) return null;
    return (
      <div>
        <h3 style={{ fontSize: 14, marginBottom: 12 }}>Link {l.id}</h3>
        <Knob label="Bandwidth" value={l.bandwidthMbps} min={1} max={100} step={1} unit=" Mbps" onChange={(v) => updateLink(l.id, { bandwidthMbps: v })} />
        <Knob label="Latency" value={l.latencyMs} min={0} max={200} step={5} unit=" ms" onChange={(v) => updateLink(l.id, { latencyMs: v })} />
        <Knob label="Jitter" value={l.jitterMs} min={0} max={50} step={1} unit=" ms" onChange={(v) => updateLink(l.id, { jitterMs: v })} />
        <Knob label="Loss" value={l.lossPct} min={0} max={80} step={1} unit=" %" onChange={(v) => updateLink(l.id, { lossPct: v })} />
        <Knob label="Corruption" value={l.corruptPct} min={0} max={80} step={1} unit=" %" onChange={(v) => updateLink(l.id, { corruptPct: v })} />
        <Knob label="Queue size" value={l.queueSize} min={1} max={64} step={1} unit=" pkts" onChange={(v) => updateLink(l.id, { queueSize: v })} />
        <Knob label="Routing weight" value={l.weight} min={1} max={20} step={1} onChange={(v) => updateLink(l.id, { weight: v })} />
        <button className="btn small" style={{ marginTop: 6 }} onClick={() => updateLink(l.id, { up: !l.up })}>
          {l.up ? 'Kill link' : 'Restore link'}
        </button>
      </div>
    );
  }

  if (selected.type === 'layer') {
    const l = stack.find((x) => x.id === selected.id);
    if (!l) return null;
    const rel = reliabilityLayers(stack);
    const has = (k: PrimitiveKind) => l.primitives.some((p) => p.kind === k);
    const windowHint = rel.win === l ? undefined
      : !has('WINDOW') ? 'inactive: this layer has no WINDOW primitive'
      : !rel.ack ? 'inactive: add ACK to the stack'
      : 'inactive: a higher layer\'s WINDOW is in charge';
    const timeoutHint = rel.timer === l ? undefined
      : !has('RETRANSMIT') && !has('ACK') ? 'inactive: this layer has no RETRANSMIT primitive'
      : !rel.ack ? 'inactive: add ACK to the stack'
      : 'inactive: another layer\'s timer is in charge';
    const adaptive = rel.rtx?.primitives.find((p) => p.kind === 'RETRANSMIT')?.params.rto === 'adaptive';
    return (
      <div>
        <h3 style={{ fontSize: 14, marginBottom: 12 }}>{l.name}</h3>
        <label style={{ fontSize: 12, color: 'var(--muted)' }}>Name</label>
        <input type="text" value={l.name} onChange={(e) => updateLayer(l.id, { name: e.target.value })}
          style={{ width: '100%', margin: '4px 0 12px' }} />
        <label style={{ fontSize: 12, color: 'var(--muted)' }}>Runs at</label>
        <div className="seg" style={{ display: 'flex', margin: '4px 0 4px' }}>
          <button style={{ flex: 1 }} className={l.scope !== 'per-hop' ? 'on' : ''} onClick={() => updateLayer(l.id, { scope: 'end-to-end' })}>
            End-to-end
          </button>
          <button style={{ flex: 1 }} className={l.scope === 'per-hop' ? 'on' : ''} onClick={() => updateLayer(l.id, { scope: 'per-hop' })}>
            Every hop
          </button>
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--muted)', marginBottom: 12 }}>
          {l.scope === 'per-hop'
            ? 'Re-applied on every link, like IP: routers unwrap, check and re-wrap it. Sits beneath the end-to-end layers.'
            : 'Applied once at the source and undone once at the destination, like TCP. Routers never look inside.'}
        </div>
        <Knob label="Window size" value={l.windowSize} min={1} max={32} step={1} unit=" pkts" hint={windowHint} onChange={(v) => updateLayer(l.id, { windowSize: v })} />
        <Knob label={adaptive ? 'Timeout (starting value, then learned)' : 'Timeout'} value={l.timeoutMs} min={100} max={3000} step={100} unit=" ms" hint={timeoutHint} onChange={(v) => updateLayer(l.id, { timeoutMs: v })} />
        <Knob label="MTU" value={l.mtu} min={128} max={9000} step={64} unit=" B"
          hint={rel.frag === l ? undefined : has('FRAGMENT') ? 'inactive: a higher layer\'s FRAGMENT is in charge' : 'inactive: this layer has no FRAGMENT primitive'}
          onChange={(v) => updateLayer(l.id, { mtu: v })} />
        <Knob label="Header overhead" value={l.headerBytes} min={0} max={60} step={2} unit=" B"
          hint={has('ADD_HEADER') ? undefined : 'inactive: only ADD_HEADER adds these bytes'}
          onChange={(v) => updateLayer(l.id, { headerBytes: v })} />
        <PrimitiveEditor layer={l} stack={stack} />
      </div>
    );
  }

  if (selected.type === 'flow') {
    const f = flows.find((x) => x.id === selected.id);
    if (!f) return null;
    return (
      <div>
        <h3 style={{ fontSize: 14, marginBottom: 12 }}>Flow {f.id} ({f.src} → {f.dst})</h3>
        <div className="row" style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>from</span>
          <select value={f.src} onChange={(e) => updateFlow(f.id, { src: e.target.value })}>
            {nodes.filter((n) => n !== f.dst).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>to</span>
          <select value={f.dst} onChange={(e) => updateFlow(f.id, { dst: e.target.value })}>
            {nodes.filter((n) => n !== f.src).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <Knob label="Rate" value={f.ratePps} min={1} max={500} step={1} unit=" pkt/s" onChange={(v) => updateFlow(f.id, { ratePps: v })} />
        <Knob label="Packet count" value={f.count} min={1} max={500} step={1} onChange={(v) => updateFlow(f.id, { count: v })} />
        <Knob label="Payload" value={f.payloadBytes} min={64} max={4096} step={64} unit=" B" onChange={(v) => updateFlow(f.id, { payloadBytes: v })} />
        {flows.length > 1 && (
          <button className="btn secondary small" onClick={() => removeFlow(f.id)}>Remove flow {f.id}</button>
        )}
      </div>
    );
  }

  if (selected.type === 'node') {
    return <RouterView key={`${selected.id}-${routing}`} id={selected.id} nodes={nodes} routing={routing} table={liveRouting()} />;
  }

  return null;
}

/** A router's table; for Distance Vector, step through the exchange rounds that built it. */
function RouterView({ id, nodes, routing, table }: { id: string; nodes: string[]; routing: 'dv' | 'ls'; table: RoutingResult }) {
  const rounds = table.history?.length ?? 0;
  const [round, setRound] = useState(rounds);
  const shown = routing === 'dv' && table.history ? table.history.at(Math.max(0, round - 1))! : table;
  return (
    <div>
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>Router {id}</h3>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>
        {routing === 'dv'
          ? `Distance Vector: built from neighbours' tables, one exchange per round. Converged in ${rounds} rounds.`
          : `Link State: every router learns the full map by flooding (${table.rounds} hops across) and runs Dijkstra itself.`}
      </div>
      {routing === 'dv' && rounds > 0 && (
        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)', marginBottom: 3 }}>
            <span>After exchange round</span>
            <span className="mono" style={{ color: 'var(--text)' }}>{round} / {rounds}</span>
          </label>
          <input type="range" min={1} max={rounds} step={1} value={round} onChange={(e) => setRound(+e.target.value)} style={{ width: '100%' }} />
        </div>
      )}
      <table className="mono" style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
            <th style={{ fontWeight: 500, paddingBottom: 4 }}>dest</th>
            <th style={{ fontWeight: 500 }}>next hop</th>
            <th style={{ fontWeight: 500, textAlign: 'right' }}>cost</th>
          </tr>
        </thead>
        <tbody>
          {nodes.filter((n) => n !== id).map((n) => {
            const nh = shown.nextHop[id]?.[n];
            const cost = shown.dist[id]?.[n];
            return (
              <tr key={n} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '4px 0' }}>{n}</td>
                <td style={{ color: nh ? 'var(--teal)' : 'var(--red)' }}>{nh ?? 'not known yet'}</td>
                <td style={{ textAlign: 'right' }}>{Number.isFinite(cost) ? cost : '∞'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
