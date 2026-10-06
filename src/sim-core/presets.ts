// ============================================================
// sim-core/presets.ts
// Rebuilt-from-scratch reference stacks (for the validation
// experiment) and a default 6-node topology.
// ============================================================

import { makeLayer, type LayerDef } from './layer';
import { makeLink, type LinkDef } from './link';

export function defaultTopology(): { nodes: string[]; links: LinkDef[] } {
  const nodes = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'];
  const links: LinkDef[] = [
    makeLink('R1', 'R2', { weight: 2, latencyMs: 15 }),
    makeLink('R1', 'R3', { weight: 5, latencyMs: 30 }),
    makeLink('R2', 'R3', { weight: 1, latencyMs: 10 }),
    makeLink('R2', 'R4', { weight: 4, latencyMs: 25 }),
    makeLink('R3', 'R4', { weight: 1, latencyMs: 10 }),
    makeLink('R3', 'R5', { weight: 3, latencyMs: 20 }),
    makeLink('R4', 'R5', { weight: 1, latencyMs: 10 }),
    makeLink('R4', 'R6', { weight: 2, latencyMs: 15 }),
    makeLink('R5', 'R6', { weight: 2, latencyMs: 15 }),
  ];
  return { nodes, links };
}

/** A minimal reliable stack: sequenced, checksummed, ACKed, retransmitted, windowed. */
export function reliableStack(): LayerDef[] {
  return [
    makeLayer('Application', [{ kind: 'ADD_HEADER', params: { app: 'demo' } }], { headerBytes: 8 }),
    makeLayer('Transport', [
      { kind: 'SEQUENCE', params: {} },
      { kind: 'CHECKSUM', params: {} },
      { kind: 'ACK', params: {} },
      { kind: 'RETRANSMIT', params: {} },
      { kind: 'WINDOW', params: {} },
    ], { headerBytes: 20, windowSize: 4, timeoutMs: 500 }),
    networkLayer(),
  ];
}

/** IP-like: re-applied at every router, where the TTL check belongs. */
function networkLayer(): LayerDef {
  return makeLayer('Network', [
    { kind: 'ADD_HEADER', params: { proto: 'ip' } },
    { kind: 'DROP_IF', params: { field: 'ttl', op: '==', value: 0 } },
  ], { headerBytes: 20, scope: 'per-hop' });
}

/** A bare unreliable stack for A/B contrast: app + network only. */
export function unreliableStack(): LayerDef[] {
  return [
    makeLayer('Application', [{ kind: 'ADD_HEADER', params: { app: 'demo' } }], { headerBytes: 8 }),
    networkLayer(),
  ];
}
