// ============================================================
// ui/StackBuilder.tsx
// Assemble the protocol stack: reorder, add, remove layers, and
// select one to configure in the Inspector. Layers show their
// composed primitives as chips — the "protocol as data" idea.
// ============================================================

import { useSim } from '../store/simStore';

export function StackBuilder() {
  const { stack, selected, setSelected, reorderLayer, removeLayer, addLayer, loadReliable, loadUnreliable, loadTcpLike } = useSim();

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn secondary small" onClick={loadReliable}>Reliable preset</button>
        <button className="btn secondary small" onClick={loadTcpLike}>TCP-like preset</button>
        <button className="btn secondary small" onClick={loadUnreliable}>Unreliable preset</button>
        <button className="btn secondary small" onClick={addLayer}>+ Custom layer</button>
      </div>

      {stack.map((layer, i) => {
        const isSel = selected?.type === 'layer' && selected.id === layer.id;
        return (
          <div
            key={layer.id}
            className="layer"
            style={{ borderColor: isSel ? 'var(--amber)' : 'var(--border)' }}
            onClick={() => setSelected({ type: 'layer', id: layer.id })}
          >
            <div className="layer-head">
              <span style={{ fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 13.5 }}>
                {i + 1}. {layer.name}
                <span className="tag" style={{ marginLeft: 8, color: layer.scope === 'per-hop' ? 'var(--violet)' : 'var(--muted)' }}>
                  {layer.scope === 'per-hop' ? 'every hop' : 'end-to-end'}
                </span>
              </span>
              <div className="row" style={{ gap: 4 }}>
                <button className="btn secondary small" onClick={(e) => { e.stopPropagation(); reorderLayer(layer.id, -1); }}>↑</button>
                <button className="btn secondary small" onClick={(e) => { e.stopPropagation(); reorderLayer(layer.id, 1); }}>↓</button>
                <button className="btn secondary small" onClick={(e) => { e.stopPropagation(); removeLayer(layer.id); }}>✕</button>
              </div>
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {layer.primitives.map((p, j) => (
                <span key={j} className="tag">{p.kind.toLowerCase().replace('_', ' ')}</span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
