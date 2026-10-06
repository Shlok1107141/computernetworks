// ============================================================
// ui/FaultTimeline.tsx
// Schedule faults on the simulation clock (kill/restore a link at
// time t) so convergence experiments are repeatable, and save or
// load the whole scenario as JSON (reproducibility for the paper).
// ============================================================

import { useState } from 'react';
import { useSim } from '../store/simStore';

export function FaultTimeline() {
  const { links, faults, addFault, removeFault, durationMs, exportScenario, importScenario } = useSim();
  const [linkId, setLinkId] = useState(links[0]?.id ?? '');
  const [atMs, setAtMs] = useState(2000);
  const [action, setAction] = useState<'kill' | 'restore'>('kill');

  const doExport = () => {
    const blob = new Blob([exportScenario()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'scenario.json';
    a.click();
  };
  const doImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = (ev) => importScenario(String(ev.target?.result ?? ''));
    r.readAsText(file);
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <select value={linkId} onChange={(e) => setLinkId(e.target.value)}>
          {links.map((l) => <option key={l.id} value={l.id}>{l.id}</option>)}
        </select>
        <select value={action} onChange={(e) => setAction(e.target.value as 'kill' | 'restore')}>
          <option value="kill">kill</option>
          <option value="restore">restore</option>
        </select>
        <label style={{ fontSize: 11.5, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
          @ <input type="number" step={100} min={0} max={durationMs} value={atMs}
            onChange={(e) => setAtMs(+e.target.value)} style={{ width: 80 }} /> ms
        </label>
        <button className="btn small" onClick={() => addFault({ linkId, atMs, action })}>Add</button>
      </div>

      {faults.length === 0 ? (
        <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>No scheduled faults. Add one to test convergence.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {faults.slice().sort((a, b) => a.atMs - b.atMs).map((f, i) => (
            <div key={i} className="stat" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px' }}>
              <span className="mono" style={{ fontSize: 12 }}>
                <span style={{ color: f.action === 'kill' ? 'var(--red)' : 'var(--teal)' }}>{f.action}</span>{' '}
                {f.linkId} @ {(f.atMs / 1000).toFixed(1)}s
              </span>
              <button className="btn secondary small" onClick={() => removeFault(i)}>&#10005;</button>
            </div>
          ))}
        </div>
      )}

      <div className="row" style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <button className="btn secondary small" onClick={doExport}>Save scenario</button>
        <label className="btn secondary small" style={{ cursor: 'pointer' }}>
          Load scenario
          <input type="file" accept=".json" style={{ display: 'none' }} onChange={doImport} />
        </label>
      </div>
    </div>
  );
}
