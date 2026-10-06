// ============================================================
// sim-core/types.ts
// Shared type definitions for the discrete-event simulation core.
// This file is the vocabulary the whole engine (and CONTRACTS.md) speaks.
// ============================================================

/** A single protocol header pushed onto a packet by a layer. */
export interface Header {
  layer: string;            // name of the layer that added it
  fields: Record<string, string | number>;
}

/** The unit that moves through the network. */
export interface Packet {
  id: number;
  flowId: string;           // which traffic flow this belongs to
  srcNode: string;
  dstNode: string;
  payload: string;
  size: number;             // bytes
  headers: Header[];        // encapsulation stack (last pushed = outermost)
  ttl: number;
  corrupted: boolean;       // set true by a link corruption event
  createdAt: number;        // sim-time of creation (ms)
  seq: number;              // sequence number (reliability layers use this)
  isAck: boolean;
  ackFor?: number;          // if isAck, the seq being acknowledged
  cumAck?: number;          // if isAck, highest seq received with no gaps before it (-1 = none)
  meta: Record<string, unknown>; // scratch space for layer primitives
}

/** Kinds of scheduled events the engine understands. */
export type EventKind =
  | 'APP_GENERATE'      // application produces a new packet
  | 'LAYER_DOWN'        // packet descends one layer (send path)
  | 'LAYER_UP'          // packet ascends one layer (receive path)
  | 'ENTER_LINK'        // packet handed to a link
  | 'EXIT_LINK'         // packet arrives at far end of a link
  | 'NODE_ARRIVE'       // packet arrives at a node (routing decision)
  | 'TIMER_FIRE'        // a layer timer (e.g. retransmit timeout) expires
  | 'FAULT'             // scheduled fault (kill/restore link)
  | 'ROUTING_TICK';     // periodic routing update

/** A scheduled event in the engine's priority queue. */
export interface SimEvent {
  time: number;         // sim-time (ms) at which it fires
  seqNo: number;        // insertion order, for stable tie-breaking
  kind: EventKind;
  nodeId?: string;
  linkId?: string;
  packet?: Packet;
  layerIndex?: number;  // position in the stack for LAYER_UP/DOWN
  data?: Record<string, unknown>;
}

/** A metric sample emitted as the simulation runs. */
export interface MetricSample {
  time: number;
  flowId: string;
  // corrupted = damaged packet caught by a CHECKSUM and discarded
  // undetected = damaged packet the stack accepted as good (no CHECKSUM caught it)
  // duplicate = an extra copy handed to the application (no SEQUENCE to filter it)
  // reordered = a packet handed to the application after a later one
  kind: 'sent' | 'delivered' | 'dropped' | 'corrupted' | 'undetected' | 'duplicate' | 'reordered'
    | 'retransmit' | 'cwnd' | 'rtt' | 'queue';
  value: number;
  nodeId?: string;
  linkId?: string;
}

/** Emitted for the UI to animate a packet moving on a link. */
export interface PacketMoveEvent {
  packetId: number;
  flowId: string;
  linkId: string;
  fromNode: string;
  toNode: string;
  departAt: number;
  arriveAt: number;
  isAck: boolean;
  dropped: boolean;     // will it be dropped mid-flight?
}
