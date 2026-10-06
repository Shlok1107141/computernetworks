// ============================================================
// sim-core/network.ts
// Orchestrator: given a topology, a protocol stack, and traffic
// flows, it drives packets through the engine and produces
// metrics + packet-move events. This is the seam the UI binds to.
//
// Packet life cycle:
//   source:  end-to-end layers (down) -> FRAGMENT -> DELAY -> per-hop layers (down) -> link
//   router:  per-hop layers (up, verify) -> route, TTL -> per-hop layers (down) -> link
//   dest:    per-hop layers (up) -> reassemble -> end-to-end layers (up) -> SEQUENCE -> app (+ ACK)
// ============================================================

import { Engine } from './engine';
import { Metrics } from './metrics';
import { type LinkDef, serializationDelayMs, makeRng } from './link';
import { type LayerDef, applyDown, applyUp, reliabilityLayers, delayOf } from './layer';
import { distanceVector, latencyFrom, linkState, type RoutingResult, type RoutingTables } from './routing';
import type { Packet, PacketMoveEvent, SimEvent } from './types';

export interface FlowDef {
  id: string;
  src: string;
  dst: string;
  ratePps: number;      // packets per second
  count: number;        // total packets to send
  payloadBytes: number;
}

export interface FaultDef {
  atMs: number;
  linkId: string;
  action: 'kill' | 'restore';
}

export interface NetworkConfig {
  nodes: string[];
  links: LinkDef[];
  stack: LayerDef[];
  flows: FlowDef[];
  faults: FaultDef[];
  routing: 'dv' | 'ls';
  seed: number;
  durationMs: number;
  // Distance Vector exchange period: after a topology change, round k of re-convergence
  // takes effect (k - 1) periods later. Link State instead floods at link speed.
  routingRoundMs?: number;
}

export const DEFAULT_ROUTING_ROUND_MS = 100;

export interface RunResult {
  metrics: Metrics;
  routingResult: RoutingResult;
  moves: PacketMoveEvent[];
}

const ACK_BYTES = 40;
const FRAG_HEADER_BYTES = 8;
export const MAX_RETRIES = 6;
const FAST_RETRANSMIT_THRESHOLD = 3; // later packets ACKed before we call one lost, as TCP's 3 dup-ACKs
/** `retransmit` metric value: 1 = the timer fired, 2 = fast retransmit. */
export const FAST_RETRANSMIT = 2;
const RTO_MAX_MS = 5000;
const RTO_MIN_MS = 200; // Linux's floor: room for later ACKs (fast retransmit) before the timer

/** A data packet the sender has transmitted but not yet seen acknowledged. */
interface Outstanding {
  template: Packet;       // post-stack packet, cloned fresh for every (re)transmission
  sentAt: number;
  attempt: number;        // bumped per transmission; stale timers compare against it
  retransmitted: boolean; // Karn's rule: no RTT samples from retransmitted packets
  laterAcks: number;      // packets sent after this one that were ACKed first
}

interface SenderState {
  flow: FlowDef;
  cwnd: number;
  ssthresh: number;       // slow-start mode: below this the window doubles per round trip
  lastDecreaseAt: number;
  outstanding: Map<number, Outstanding>;
  backlog: Packet[];      // generated but held back by the window
  rto: number;            // current retransmit timeout
  srtt?: number;          // smoothed RTT (adaptive timeout only)
  rttvar?: number;        // RTT variation (adaptive timeout only)
}

interface ReceiverState {
  received: Set<number>;   // seqs the protocol has accepted
  nextExpected: number;    // lowest seq not yet accepted (drives the cumulative ACK)
  holding: Map<number, { pkt: Packet; bad: boolean }>; // in-order mode: waiting for a gap to fill
  nextRelease: number;     // in-order mode: next seq the application may receive
  highestHanded: number;   // highest seq handed to the application so far
}

interface Reassembly {
  parts: (Packet | undefined)[];
  got: number;
}

export function runSimulation(cfg: NetworkConfig): RunResult {
  const engine = new Engine();
  const metrics = new Metrics();
  const rng = makeRng(cfg.seed);
  const moves: PacketMoveEvent[] = [];

  engine.metricSink = (m) => metrics.record(m);
  engine.moveSink = (m) => moves.push(m);

  // Mutable link map (faults toggle .up)
  const linkMap = new Map<string, LinkDef>();
  for (const l of cfg.links) linkMap.set(l.id, structuredClone(l));

  // ---- What the stack switches on ----
  const e2eLayers = cfg.stack.filter((l) => l.scope !== 'per-hop');
  const hopLayers = cfg.stack.filter((l) => l.scope === 'per-hop');
  const rel = reliabilityLayers(cfg.stack);
  const ackLayer = rel.ack, rtxLayer = rel.rtx, winLayer = rel.win;
  const timeoutMs = Math.max(1, rel.timer?.timeoutMs ?? 500);
  const rtxParams = rtxLayer?.primitives.find((p) => p.kind === 'RETRANSMIT')?.params ?? {};
  const adaptiveRto = rtxParams.rto === 'adaptive';
  const fastRetransmit = !!rtxLayer && rtxParams.fast === 'on';
  const slowStart = !!winLayer && winLayer.primitives.find((p) => p.kind === 'WINDOW')?.params.growth === 'slow-start';
  const maxWindow = winLayer ? Math.max(1, winLayer.windowSize) : Infinity;
  const hasSequence = !!rel.seq;
  const inOrder = hasSequence && !!rtxLayer; // only a retransmitting stack can afford to wait for gaps
  const mtu = rel.frag ? Math.max(FRAG_HEADER_BYTES + 32, rel.frag.mtu) : Infinity;
  const e2eDelay = delayOf(e2eLayers);
  const hopDelay = delayOf(hopLayers);
  const initialTtl = cfg.nodes.length + 2;

  const computeRouting = (): RoutingResult =>
    cfg.routing === 'dv'
      ? distanceVector(cfg.nodes, [...linkMap.values()])
      : linkState(cfg.nodes, [...linkMap.values()]);

  // The tables routers actually forward with. They start converged; after a
  // topology change they catch up gradually (see the FAULT handler).
  const initial = computeRouting();
  const live: RoutingTables = { nextHop: structuredClone(initial.nextHop), dist: structuredClone(initial.dist) };
  const roundMs = Math.max(1, cfg.routingRoundMs ?? DEFAULT_ROUTING_ROUND_MS);
  let routingEpoch = 0; // a newer topology change supersedes updates still on their way

  const linkBetween = (a: string, b: string): LinkDef | undefined => {
    return linkMap.get(`${a}-${b}`) || linkMap.get(`${b}-${a}`);
  };

  let pktId = 0;
  let txCounter = 0;
  const seqByFlow: Record<string, number> = {};
  const senders = new Map<string, SenderState>();
  const receivers = new Map<string, ReceiverState>();
  const reassembly = new Map<string, Reassembly>();
  const linkBusy = new Map<string, number[]>(); // per link direction: serialization end times, FIFO
  for (const f of cfg.flows) {
    senders.set(f.id, { flow: f, cwnd: 1, ssthresh: maxWindow, lastDecreaseAt: -Infinity, outstanding: new Map(), backlog: [], rto: timeoutMs });
    receivers.set(f.id, { received: new Set(), nextExpected: 0, holding: new Map(), nextRelease: 0, highestHanded: -1 });
  }

  const emitCwnd = (st: SenderState) => {
    if (!winLayer) return;
    engine.emitMetric({ time: engine.now, flowId: st.flow.id, kind: 'cwnd', value: Math.round(st.cwnd * 100) / 100 });
  };

  const windowOpen = (st: SenderState) =>
    !winLayer || st.outstanding.size < Math.max(1, Math.min(Math.floor(st.cwnd), maxWindow));

  const dataDrop = (pkt: Packet, nodeId?: string, linkId?: string) => {
    if (!pkt.isAck) engine.emitMetric({ time: engine.now, flowId: pkt.flowId, kind: 'dropped', value: 1, nodeId, linkId });
  };

  /** Split a packet into MTU-sized fragments (or one unit if it fits). */
  const toWireUnits = (template: Packet, isRetransmit: boolean): Packet[] => {
    const txId = txCounter++;
    const base = structuredClone(template);
    base.ttl = initialTtl;
    base.corrupted = false;
    // sentAt is a timestamp the receiver echoes back, so every ACK is an unambiguous RTT sample
    const sentAt = engine.now;
    if (base.size <= mtu) {
      if (isRetransmit) base.id = pktId++;
      base.meta = { txId, fragIndex: 0, fragCount: 1, sentAt };
      return [base];
    }
    const n = Math.ceil(base.size / (mtu - FRAG_HEADER_BYTES));
    const sizeChunk = Math.ceil(base.size / n);
    const payChunk = Math.ceil(base.payload.length / n);
    const units: Packet[] = [];
    for (let i = 0; i < n; i++) {
      const frag = structuredClone(base);
      frag.id = i === 0 && !isRetransmit ? base.id : pktId++;
      frag.payload = base.payload.slice(i * payChunk, (i + 1) * payChunk);
      frag.size = Math.min(sizeChunk, base.size - i * sizeChunk) + FRAG_HEADER_BYTES;
      frag.meta = { txId, fragIndex: i, fragCount: n, sentAt };
      units.push(frag);
    }
    return units;
  };

  /** Put one copy of a data packet on the wire and arm its retransmit timer. */
  const transmit = (st: SenderState, template: Packet, isRetransmit: boolean) => {
    if (ackLayer) {
      const prev = st.outstanding.get(template.seq);
      const attempt = (prev?.attempt ?? 0) + 1;
      st.outstanding.set(template.seq, {
        template,
        sentAt: engine.now,
        attempt,
        retransmitted: isRetransmit || !!prev?.retransmitted,
        laterAcks: 0,
      });
      engine.schedule(st.rto, { kind: 'TIMER_FIRE', data: { flowId: st.flow.id, seq: template.seq, attempt } });
    }
    for (const unit of toWireUnits(template, isRetransmit)) {
      engine.schedule(e2eDelay, { kind: 'NODE_ARRIVE', nodeId: st.flow.src, packet: unit, data: { injected: true } });
    }
  };

  /** Multiplicative decrease, at most once per window of data so one burst of loss halves once. */
  const backOff = (st: SenderState, o: Outstanding, timedOut: boolean) => {
    if (o.sentAt < st.lastDecreaseAt) return;
    if (slowStart) {
      // TCP Reno: remember half the window; a timeout restarts from 1, a fast retransmit resumes at half
      st.ssthresh = Math.max(2, st.cwnd / 2);
      st.cwnd = timedOut ? 1 : st.ssthresh;
    } else {
      st.cwnd = Math.max(1, st.cwnd / 2);
    }
    st.lastDecreaseAt = engine.now;
    emitCwnd(st);
  };

  /** RFC 6298: smoothed RTT + 4 × variation, floored at RTO_MIN_MS. */
  const sampleRtt = (st: SenderState, r: number) => {
    if (!adaptiveRto) return;
    if (st.srtt === undefined || st.rttvar === undefined) {
      st.srtt = r;
      st.rttvar = r / 2;
    } else {
      st.rttvar = 0.75 * st.rttvar + 0.25 * Math.abs(st.srtt - r);
      st.srtt = 0.875 * st.srtt + 0.125 * r;
    }
    st.rto = Math.min(RTO_MAX_MS, Math.max(RTO_MIN_MS, st.srtt + 4 * st.rttvar));
  };

  const pump = (st: SenderState) => {
    while (st.backlog.length > 0 && windowOpen(st)) transmit(st, st.backlog.shift()!, false);
  };

  // ---- Handlers ----
  engine.handlers.APP_GENERATE = (e, eng) => {
    const flow = e.data!.flow as FlowDef;
    const seq = (seqByFlow[flow.id] = (seqByFlow[flow.id] ?? -1) + 1);
    const pkt: Packet = {
      id: pktId++,
      flowId: flow.id,
      srcNode: flow.src,
      dstNode: flow.dst,
      payload: 'x'.repeat(Math.max(1, Math.floor(flow.payloadBytes / 8))),
      size: flow.payloadBytes,
      headers: [],
      ttl: initialTtl,
      corrupted: false,
      createdAt: eng.now,
      seq,
      isAck: false,
      meta: {},
    };
    eng.emitMetric({ time: eng.now, flowId: flow.id, kind: 'sent', value: 1 });

    // descend the end-to-end layers (top->bottom); per-hop layers run on each link
    let cur = pkt;
    for (const layer of e2eLayers) {
      const { packet, drop } = applyDown(layer, cur);
      cur = packet;
      if (drop) {
        eng.emitMetric({ time: eng.now, flowId: flow.id, kind: 'dropped', value: 1, nodeId: flow.src });
        return;
      }
    }

    const st = senders.get(flow.id)!;
    if (seq === 0) emitCwnd(st);
    st.backlog.push(cur);
    pump(st);
  };

  const receiveAck = (ack: Packet) => {
    const st = senders.get(ack.flowId);
    if (!st || ack.corrupted) return; // a corrupted ACK is unreadable — treat as lost
    if (typeof ack.meta.echo === 'number') sampleRtt(st, engine.now - ack.meta.echo);

    // cumulative part covers earlier ACKs that were lost on the way back
    const acked: number[] = [];
    for (const seq of st.outstanding.keys()) {
      if (seq === ack.ackFor || seq <= (ack.cumAck ?? -1)) acked.push(seq);
    }
    let newestSentAt = -Infinity;
    for (const seq of acked) {
      const o = st.outstanding.get(seq)!;
      if (seq === ack.ackFor && !o.retransmitted) {
        engine.emitMetric({ time: engine.now, flowId: ack.flowId, kind: 'rtt', value: engine.now - o.sentAt });
      }
      newestSentAt = Math.max(newestSentAt, o.sentAt);
      st.outstanding.delete(seq);
      // slow start: +1 per ACK (doubles per round trip); congestion avoidance: ~+1 per round trip
      st.cwnd = Math.min(maxWindow, st.cwnd + (slowStart && st.cwnd < st.ssthresh ? 1 : 1 / st.cwnd));
    }
    if (acked.length === 0) return;

    // fast retransmit: a packet that later packets overtook THRESHOLD times is presumed lost
    if (fastRetransmit) {
      for (const o of [...st.outstanding.values()]) {
        if (o.sentAt >= newestSentAt) continue;
        if (++o.laterAcks < FAST_RETRANSMIT_THRESHOLD) continue;
        if (!inOrder && o.attempt > MAX_RETRIES) continue;
        backOff(st, o, false);
        engine.emitMetric({ time: engine.now, flowId: ack.flowId, kind: 'retransmit', value: FAST_RETRANSMIT });
        transmit(st, o.template, true);
      }
    }
    emitCwnd(st);
    pump(st);
  };

  /** Hand one packet up to the application, classifying what the app actually got. */
  const handToApp = (rx: ReceiverState, pkt: Packet, bad: boolean, duplicate: boolean) => {
    const t = engine.now, flowId = pkt.flowId;
    if (duplicate) {
      engine.emitMetric({ time: t, flowId, kind: 'duplicate', value: 1 });
      return;
    }
    if (bad) {
      engine.emitMetric({ time: t, flowId, kind: 'undetected', value: 1, nodeId: pkt.dstNode });
      return;
    }
    if (pkt.seq < rx.highestHanded) engine.emitMetric({ time: t, flowId, kind: 'reordered', value: 1 });
    rx.highestHanded = Math.max(rx.highestHanded, pkt.seq);
    engine.emitMetric({ time: t, flowId, kind: 'delivered', value: 1 });
    // without ACKs there is no round trip; this is one-way delivery latency
    if (!ackLayer) engine.emitMetric({ time: t, flowId, kind: 'rtt', value: t - pkt.createdAt });
    metrics.addDeliveredBytes(flowId, senders.get(flowId)!.flow.payloadBytes);
  };

  const receiveData = (pkt: Packet) => {
    // ascend the end-to-end layers (bottom->top), verifying as we go
    let cur = pkt;
    for (let i = e2eLayers.length - 1; i >= 0; i--) {
      const { packet, reject } = applyUp(e2eLayers[i], cur);
      cur = packet;
      if (reject) {
        engine.emitMetric({ time: engine.now, flowId: pkt.flowId, kind: 'corrupted', value: 1, nodeId: pkt.dstNode });
        return;
      }
    }
    // damage that no CHECKSUM caught: the stack believes this packet is fine
    const bad = cur.corrupted;
    const rx = receivers.get(cur.flowId)!;
    const firstCopy = !rx.received.has(cur.seq);
    if (firstCopy) {
      rx.received.add(cur.seq);
      while (rx.received.has(rx.nextExpected)) rx.nextExpected++;
    }

    if (!hasSequence) {
      handToApp(rx, cur, bad, !firstCopy); // no seq numbers: every copy goes up, in arrival order
    } else if (firstCopy && !inOrder) {
      handToApp(rx, cur, bad, false);      // duplicates filtered, arrival order kept
    } else if (firstCopy) {
      rx.holding.set(cur.seq, { pkt: cur, bad });
      while (rx.holding.has(rx.nextRelease)) {
        const next = rx.holding.get(rx.nextRelease)!;
        rx.holding.delete(rx.nextRelease);
        handToApp(rx, next.pkt, next.bad, false);
        rx.nextRelease++;
      }
    }

    // duplicates are re-ACKed too, otherwise a lost ACK would retransmit forever
    if (ackLayer) {
      const ack: Packet = {
        id: pktId++,
        flowId: cur.flowId,
        srcNode: cur.dstNode,
        dstNode: cur.srcNode,
        payload: '',
        size: ACK_BYTES,
        headers: [],
        ttl: initialTtl,
        corrupted: false,
        createdAt: engine.now,
        seq: cur.seq,
        isAck: true,
        ackFor: cur.seq,
        cumAck: rx.nextExpected - 1,
        meta: { echo: cur.meta.sentAt },
      };
      engine.schedule(0, { kind: 'NODE_ARRIVE', nodeId: cur.dstNode, packet: ack, data: { injected: true } });
    }
  };

  /** Collect fragments; a packet only continues once every piece has arrived. */
  const reassemble = (unit: Packet): Packet | null => {
    const count = Number(unit.meta.fragCount ?? 1);
    if (count <= 1) return unit;
    const key = `${unit.flowId}:${unit.meta.txId}`;
    const r = reassembly.get(key) ?? { parts: new Array<Packet | undefined>(count), got: 0 };
    const idx = Number(unit.meta.fragIndex);
    if (!r.parts[idx]) { r.parts[idx] = unit; r.got++; }
    reassembly.set(key, r);
    if (r.got < count) return null;
    reassembly.delete(key);
    const parts = r.parts as Packet[];
    const whole = structuredClone(parts[0]);
    whole.payload = parts.map((p) => p.payload).join('');
    whole.size = parts.reduce((s, p) => s + p.size - FRAG_HEADER_BYTES, 0);
    whole.corrupted = parts.some((p) => p.corrupted);
    whole.meta = { sentAt: parts[0].meta.sentAt };
    return whole;
  };

  engine.handlers.NODE_ARRIVE = (e, eng) => {
    const at = e.nodeId!;
    let pkt = e.packet!;

    // per-hop layers unwrap and verify on every arrival (not on first injection, not ACKs)
    if (!e.data?.injected && !pkt.isAck) {
      for (let i = hopLayers.length - 1; i >= 0; i--) {
        const { packet, reject } = applyUp(hopLayers[i], pkt);
        pkt = packet;
        if (reject) {
          eng.emitMetric({ time: eng.now, flowId: pkt.flowId, kind: 'corrupted', value: 1, nodeId: at });
          return;
        }
      }
    }

    if (at === pkt.dstNode) {
      if (pkt.isAck) {
        receiveAck(pkt);
      } else {
        const whole = reassemble(pkt);
        if (whole) receiveData(whole);
      }
      return;
    }

    // forward via routing next-hop
    const nh = live.nextHop[at]?.[pkt.dstNode] ?? null;
    if (nh === null) {
      dataDrop(pkt, at);
      return;
    }
    const link = linkBetween(at, nh);
    if (!link || !link.up) {
      dataDrop(pkt, at, link?.id);
      return;
    }
    pkt.ttl -= 1;
    if (!pkt.isAck) {
      for (const layer of hopLayers) {
        const { packet, drop } = applyDown(layer, pkt);
        pkt = packet;
        if (drop) {
          dataDrop(pkt, at);
          return;
        }
      }
    }
    if (pkt.ttl <= 0) {
      dataDrop(pkt, at); // safety net against loops even if no DROP_IF checks TTL
      return;
    }
    eng.schedule(pkt.isAck ? 0 : hopDelay, { kind: 'ENTER_LINK', linkId: link.id, nodeId: nh, packet: pkt, data: { from: at } });
  };

  engine.handlers.ENTER_LINK = (e, eng) => {
    const pkt = e.packet!;
    const link = linkMap.get(e.linkId!)!;
    const from = e.data!.from as string;
    const to = e.nodeId!;

    // FIFO output queue: one packet serializes at a time, `queueSize` may wait, the rest tail-drop
    const dirKey = `${link.id}>${to}`;
    const busy = (linkBusy.get(dirKey) ?? []).filter((t) => t > eng.now);
    if (busy.length > link.queueSize) {
      linkBusy.set(dirKey, busy);
      eng.emitMove({
        packetId: pkt.id, flowId: pkt.flowId, linkId: link.id, fromNode: from, toNode: to,
        departAt: eng.now, arriveAt: eng.now + 1, isAck: pkt.isAck, dropped: true,
      });
      dataDrop(pkt, from, link.id);
      return;
    }
    const startTx = busy.length ? busy[busy.length - 1] : eng.now;
    const serialEnd = startTx + serializationDelayMs(pkt.size, link.bandwidthMbps);
    busy.push(serialEnd);
    linkBusy.set(dirKey, busy);
    eng.emitMetric({ time: eng.now, flowId: pkt.flowId, kind: 'queue', value: busy.length - 1, linkId: link.id });

    const jitter = (rng() * 2 - 1) * link.jitterMs;
    const arriveAt = serialEnd + Math.max(0, link.latencyMs + jitter);
    const willDrop = rng() * 100 < link.lossPct;
    const willCorrupt = !willDrop && rng() * 100 < link.corruptPct;

    eng.emitMove({
      packetId: pkt.id,
      flowId: pkt.flowId,
      linkId: link.id,
      fromNode: from,
      toNode: to,
      departAt: startTx,
      arriveAt,
      isAck: pkt.isAck,
      dropped: willDrop,
    });

    if (willDrop) {
      eng.scheduleAt(arriveAt, {
        kind: 'FAULT', // reuse: emit drop at arrival time
        data: { drop: true, flowId: pkt.flowId, isAck: pkt.isAck, linkId: link.id },
      });
      return;
    }
    if (willCorrupt) {
      pkt.corrupted = true;
      pkt.payload = damage(pkt.payload, rng);
    }
    eng.scheduleAt(arriveAt, { kind: 'NODE_ARRIVE', nodeId: to, packet: pkt });
  };

  engine.handlers.TIMER_FIRE = (e) => {
    const { flowId, seq, attempt } = e.data as { flowId: string; seq: number; attempt: number };
    const st = senders.get(flowId)!;
    const o = st.outstanding.get(seq);
    if (!o || o.attempt !== attempt) return; // already ACKed, or a newer copy owns the timer

    backOff(st, o, true);
    if (adaptiveRto) st.rto = Math.min(RTO_MAX_MS, st.rto * 2); // exponential backoff until a fresh RTT sample

    // an in-order stream can never skip a packet, so it keeps trying for the whole run
    if (rtxLayer && (inOrder || o.attempt <= MAX_RETRIES)) {
      engine.emitMetric({ time: engine.now, flowId, kind: 'retransmit', value: 1 });
      transmit(st, o.template, true);
    } else {
      st.outstanding.delete(seq); // give up on this one and free its window slot
      pump(st);
    }
  };

  engine.handlers.FAULT = (e) => {
    if (e.data?.drop) {
      if (!e.data.isAck) {
        engine.emitMetric({ time: engine.now, flowId: e.data.flowId as string, kind: 'dropped', value: 1, linkId: e.data.linkId as string });
      }
      return;
    }
    // scheduled topology fault: the link changes now, the routers find out over time
    const link = linkMap.get(e.linkId!);
    if (!link) return;
    link.up = e.data!.action === 'restore';
    const epoch = ++routingEpoch;
    const links = [...linkMap.values()];
    if (cfg.routing === 'ls') {
      // the routers at both ends flood an LSA; each router recomputes when it arrives
      const target = linkState(cfg.nodes, links);
      const fromA = latencyFrom(link.a, cfg.nodes, links);
      const fromB = latencyFrom(link.b, cfg.nodes, links);
      for (const r of cfg.nodes) {
        const t = Math.min(fromA[r], fromB[r]);
        if (Number.isFinite(t)) engine.schedule(t, { kind: 'ROUTING_TICK', data: { epoch, router: r, tables: target } });
      }
    } else {
      // every router re-runs Bellman-Ford from its current (now partly stale) vector, one round per period
      const res = distanceVector(cfg.nodes, links, live);
      res.history!.forEach((tables, k) => {
        engine.schedule(k * roundMs, { kind: 'ROUTING_TICK', data: { epoch, tables } });
      });
    }
  };

  engine.handlers.ROUTING_TICK = (e) => {
    const { epoch, router, tables } = e.data as { epoch: number; router?: string; tables: RoutingTables };
    if (epoch !== routingEpoch) return;
    for (const r of router ? [router] : cfg.nodes) {
      live.nextHop[r] = { ...tables.nextHop[r] };
      live.dist[r] = { ...tables.dist[r] };
    }
  };

  // ---- Seed the queue ----
  for (const flow of cfg.flows) {
    const gap = 1000 / flow.ratePps;
    for (let i = 0; i < flow.count; i++) {
      engine.schedule(i * gap, { kind: 'APP_GENERATE', data: { flow } });
    }
  }
  for (const fault of cfg.faults) {
    engine.scheduleAt(fault.atMs, {
      kind: 'FAULT',
      linkId: fault.linkId,
      data: { action: fault.action },
    } as Omit<SimEvent, 'time' | 'seqNo'>);
  }

  engine.run(cfg.durationMs);

  return { metrics, routingResult: computeRouting(), moves };
}

/** Flip one character of the payload — real bit damage a checksum can catch. */
function damage(payload: string, rng: () => number): string {
  if (payload.length === 0) return payload;
  const i = Math.floor(rng() * payload.length);
  return payload.slice(0, i) + String.fromCharCode(payload.charCodeAt(i) ^ 1) + payload.slice(i + 1);
}
