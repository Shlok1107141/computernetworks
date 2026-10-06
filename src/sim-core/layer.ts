// ============================================================
// sim-core/layer.ts
// The layer behavior model. This is the research object:
// a custom protocol layer is DEFINED by composing primitives,
// never by writing arbitrary code. That keeps every layer
// analyzable and lets a novice invent a protocol with no code.
// ============================================================

import type { Packet } from './types';

/** The primitive operations a layer can be built from. */
export type PrimitiveKind =
  | 'ADD_HEADER'      // push a header with static/derived fields
  | 'STRIP_HEADER'    // pop this layer's header on the way up
  | 'CHECKSUM'        // compute/verify an integrity field
  | 'SEQUENCE'        // stamp an incrementing sequence number
  | 'ACK'             // generate/expect acknowledgements (reliability)
  | 'RETRANSMIT'      // resend on timeout (needs ACK + timer)
  | 'WINDOW'          // sliding-window flow control (cwnd/awnd)
  | 'DROP_IF'         // conditional drop (e.g. ttl == 0)
  | 'DELAY'           // add fixed processing delay
  | 'FRAGMENT';       // split oversized packets (by MTU)

export const PRIMITIVE_KINDS: PrimitiveKind[] = [
  'ADD_HEADER', 'STRIP_HEADER', 'CHECKSUM', 'SEQUENCE', 'ACK',
  'RETRANSMIT', 'WINDOW', 'DROP_IF', 'DELAY', 'FRAGMENT',
];

export interface Primitive {
  kind: PrimitiveKind;
  params: Record<string, string | number>;
}

/** A layer = an ordered set of primitives + its own knobs. */
export interface LayerDef {
  id: string;
  name: string;
  primitives: Primitive[];
  // Per-layer tunable knobs (the "minute things"):
  windowSize: number;       // for WINDOW
  timeoutMs: number;        // for RETRANSMIT
  mtu: number;              // for FRAGMENT
  headerBytes: number;      // overhead this layer adds
  // 'end-to-end' (default): runs once at the source and once at the destination, like TCP.
  // 'per-hop': re-applied on every link — departing a node and arriving at the next — like IP.
  scope?: LayerScope;
}

export type LayerScope = 'end-to-end' | 'per-hop';

export const DEFAULT_DELAY_MS = 10;

export function makeLayer(name: string, primitives: Primitive[], overrides: Partial<LayerDef> = {}): LayerDef {
  return {
    id: 'L' + Math.random().toString(16).slice(2, 8),
    name,
    primitives,
    windowSize: 4,
    timeoutMs: 500,
    mtu: 1500,
    headerBytes: 20,
    ...overrides,
  };
}

/** Deterministic, order-independent checksum over payload. */
export function checksum(payload: string): number {
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    sum = (sum + payload.charCodeAt(i) * 31) % 65521;
  }
  return sum;
}

/**
 * Apply a layer's primitives to a packet on the SEND (down) path.
 * Returns { packet, drop } — drop=true means a primitive discarded it.
 * Pure function: no side effects, fully unit-testable.
 */
export function applyDown(layer: LayerDef, pkt: Packet): { packet: Packet; drop: boolean } {
  const p: Packet = structuredClone(pkt);
  for (const prim of layer.primitives) {
    switch (prim.kind) {
      case 'ADD_HEADER':
        p.headers.push({ layer: layer.name, fields: { ...prim.params } });
        p.size += headerCost(layer, prim.kind);
        break;
      case 'SEQUENCE':
        // seq is assigned by the flow driver; here we just record it in a header
        p.headers.push({ layer: layer.name, fields: { seq: p.seq } });
        p.size += headerCost(layer, prim.kind);
        break;
      case 'CHECKSUM':
        p.headers.push({ layer: layer.name, fields: { cksum: checksum(p.payload) } });
        p.size += headerCost(layer, prim.kind);
        break;
      case 'DROP_IF': {
        const field = String(prim.params.field ?? 'ttl');
        const op = String(prim.params.op ?? '==');
        const val = Number(prim.params.value ?? 0);
        const cur = Number((p as unknown as Record<string, unknown>)[field] ?? NaN);
        if (compare(cur, op, val)) return { packet: p, drop: true };
        break;
      }
      case 'DELAY':
      case 'WINDOW':
      case 'ACK':
      case 'RETRANSMIT':
      case 'FRAGMENT':
        // Handled by the engine (they involve time/queues), not the pure transform.
        break;
      case 'STRIP_HEADER':
        break; // decapsulation is automatic on the up path
    }
  }
  return { packet: p, drop: false };
}

/**
 * Apply a layer's primitives on the RECEIVE (up) path: unwrap this layer's
 * headers in the reverse order they were pushed, verifying any checksum.
 * Returns { packet, reject } — reject=true means integrity check failed.
 */
export function applyUp(layer: LayerDef, pkt: Packet): { packet: Packet; reject: boolean } {
  const p: Packet = structuredClone(pkt);
  for (let i = layer.primitives.length - 1; i >= 0; i--) {
    const kind = layer.primitives[i].kind;
    if (kind !== 'ADD_HEADER' && kind !== 'SEQUENCE' && kind !== 'CHECKSUM') continue;
    const top = p.headers[p.headers.length - 1];
    if (!top || top.layer !== layer.name) continue;
    if (kind === 'CHECKSUM' && Number(top.fields.cksum) !== checksum(p.payload)) {
      return { packet: p, reject: true };
    }
    p.headers.pop();
    p.size -= headerCost(layer, kind);
  }
  return { packet: p, reject: false };
}

function headerCost(layer: LayerDef, kind: PrimitiveKind): number {
  if (kind === 'ADD_HEADER') return layer.headerBytes;
  if (kind === 'SEQUENCE') return 4;
  if (kind === 'CHECKSUM') return 2;
  return 0;
}

/** Total processing delay (ms) the DELAY primitives in these layers add. */
export function delayOf(layers: LayerDef[]): number {
  let ms = 0;
  for (const l of layers) {
    for (const p of l.primitives) if (p.kind === 'DELAY') ms += Math.max(0, Number(p.params.ms ?? DEFAULT_DELAY_MS));
  }
  return ms;
}

function compare(a: number, op: string, b: number): boolean {
  switch (op) {
    case '==': return a === b;
    case '!=': return a !== b;
    case '>': return a > b;
    case '<': return a < b;
    case '>=': return a >= b;
    case '<=': return a <= b;
    default: return false;
  }
}

export function layerHasReliability(layer: LayerDef): boolean {
  return layer.primitives.some((p) => p.kind === 'ACK' || p.kind === 'RETRANSMIT');
}

/**
 * Which layers' knobs drive the reliability machinery. RETRANSMIT and WINDOW
 * need ACK feedback, so they are inactive without an ACK somewhere in the
 * stack; if several layers carry a primitive, the topmost one wins. `seq`
 * and `frag` are the layers whose SEQUENCE / FRAGMENT (and MTU) are in effect.
 */
export function reliabilityLayers(stack: LayerDef[]) {
  const find = (k: PrimitiveKind) => stack.find((l) => l.primitives.some((p) => p.kind === k));
  const ack = find('ACK');
  const rtx = ack ? find('RETRANSMIT') : undefined;
  const win = ack ? find('WINDOW') : undefined;
  return { ack, rtx, win, timer: rtx ?? ack, seq: find('SEQUENCE'), frag: find('FRAGMENT') };
}
