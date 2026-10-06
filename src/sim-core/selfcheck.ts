// ============================================================
// sim-core/selfcheck.ts
// Runs the engine headlessly and asserts core invariants.
// This is the seed of the paper's "correctness validation":
// prove the engine behaves sensibly before trusting its numbers.
//   npx tsx src/sim-core/selfcheck.ts
// ============================================================

import { runSimulation, type NetworkConfig } from './network';
import { defaultTopology, reliableStack, tcpLikeStack, unreliableStack } from './presets';
import { distanceVector, linkState } from './routing';
import { checksum, makeLayer, type LayerDef, type LayerScope, type Primitive } from './layer';
import { compareStacks } from './comparison';
import { lossSweep, isMonotonicDecreasing } from './validation';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log('  ✓ ' + msg);
  } else {
    console.log('  ✗ FAIL: ' + msg);
    failures++;
  }
}

console.log('\n[1] Checksum determinism & sensitivity');
assert(checksum('hello') === checksum('hello'), 'same input → same checksum');
assert(checksum('hello') !== checksum('hellp'), 'one-char change → different checksum');

console.log('\n[2] Routing agreement (DV and LS must find identical shortest distances)');
{
  const { nodes, links } = defaultTopology();
  const dv = distanceVector(nodes, links);
  const ls = linkState(nodes, links);
  let agree = true;
  for (const a of nodes) for (const b of nodes) {
    if (dv.dist[a][b] !== ls.dist[a][b]) { agree = false; }
  }
  assert(agree, 'DV and LS agree on all pairwise shortest distances');
  assert(dv.dist['R1']['R6'] === 6, 'R1→R6 shortest cost is 6 (R1-R2-R3-R4-R6 = 2+1+1+2)');
}

console.log('\n[3] Link failure reroutes and increases cost');
{
  const { nodes, links } = defaultTopology();
  const before = linkState(nodes, links).dist['R1']['R6'];
  const killed = links.map((l) => (l.id === 'R4-R6' ? { ...l, up: false } : l));
  const after = linkState(nodes, killed).dist['R1']['R6'];
  assert(after > before, `cost rises after killing R4-R6 (${before} → ${after})`);
}

console.log('\n[4] End-to-end simulation delivers packets on a clean network');
{
  const { nodes, links } = defaultTopology();
  const cleanLinks = links.map((l) => ({ ...l, lossPct: 0, corruptPct: 0 }));
  const cfg: NetworkConfig = {
    nodes,
    links: cleanLinks,
    stack: reliableStack(),
    flows: [{ id: 'f1', src: 'R1', dst: 'R6', ratePps: 20, count: 20, payloadBytes: 512 }],
    faults: [],
    routing: 'ls',
    seed: 42,
    durationMs: 5000,
  };
  const { metrics } = runSimulation(cfg);
  const [s] = metrics.summarize(['f1']);
  assert(s.sent === 20, `all 20 packets sent (got ${s.sent})`);
  assert(s.delivered === 20, `all 20 delivered on clean net (got ${s.delivered})`);
  assert(s.deliveryRate === 1, 'delivery rate 100% on lossless network');
  assert(s.avgRttMs > 0, `RTT measured (${s.avgRttMs.toFixed(1)}ms)`);
}

console.log('\n[5] Loss reduces delivery; reproducible across identical seeds');
{
  const { nodes, links } = defaultTopology();
  const lossy = links.map((l) => ({ ...l, lossPct: 30, corruptPct: 0 }));
  const cfg: NetworkConfig = {
    nodes, links: lossy, stack: reliableStack(),
    flows: [{ id: 'f1', src: 'R1', dst: 'R6', ratePps: 20, count: 50, payloadBytes: 512 }],
    faults: [], routing: 'ls', seed: 7, durationMs: 8000,
  };
  const a = runSimulation(cfg).metrics.summarize(['f1'])[0];
  const b = runSimulation(cfg).metrics.summarize(['f1'])[0];
  assert(a.delivered < a.sent, `lossy net drops some packets (${a.delivered}/${a.sent} delivered)`);
  assert(a.delivered === b.delivered, `same seed → identical result (${a.delivered} === ${b.delivered})`);
}

console.log('\n[6] Scheduled fault changes routing mid-run');
{
  const { nodes, links } = defaultTopology();
  const cfg: NetworkConfig = {
    nodes, links: links.map((l) => ({ ...l, lossPct: 0, corruptPct: 0 })),
    stack: reliableStack(),
    flows: [{ id: 'f1', src: 'R1', dst: 'R6', ratePps: 10, count: 30, payloadBytes: 256 }],
    faults: [{ atMs: 1000, linkId: 'R4-R6', action: 'kill' }],
    routing: 'ls', seed: 1, durationMs: 6000,
  };
  const { metrics } = runSimulation(cfg);
  const s = metrics.summarize(['f1'])[0];
  assert(s.delivered > 0, `packets still delivered after mid-run link kill (${s.delivered} delivered via reroute)`);
}

console.log('\n[7] AIMD congestion window moves (rises on delivery, halves on loss)');
{
  const { nodes, links } = defaultTopology();
  const cfg: NetworkConfig = {
    nodes, links: links.map((l) => ({ ...l, lossPct: 25, corruptPct: 0 })),
    stack: reliableStack(),
    flows: [{ id: 'f1', src: 'R1', dst: 'R6', ratePps: 25, count: 80, payloadBytes: 512 }],
    faults: [], routing: 'ls', seed: 9, durationMs: 10000,
  };
  const { metrics } = runSimulation(cfg);
  const cwnd = metrics.series('f1', 'cwnd', 200).map((p) => p.v);
  const maxC = Math.max(...cwnd);
  const minC = Math.min(...cwnd);
  assert(cwnd.length > 0, 'cwnd samples emitted');
  assert(maxC > 1, `window grew above 1 (peak ${maxC})`);
  assert(minC < maxC, `window both rose and fell — sawtooth present (min ${minC}, max ${maxC})`);
}

console.log('\n[8] A/B comparison: reliable out-delivers unreliable on identical traffic');
{
  const { nodes, links } = defaultTopology();
  const base = {
    nodes, links: links.map((l) => ({ ...l, lossPct: 5, corruptPct: 2 })),
    flows: [{ id: 'f1', src: 'R1', dst: 'R6', ratePps: 20, count: 60, payloadBytes: 512 }],
    faults: [], routing: 'ls' as const, seed: 55, durationMs: 8000,
  };
  const res = compareStacks(base,
    { label: 'reliable', stack: reliableStack() },
    { label: 'unreliable', stack: unreliableStack() });
  const rel = res.summaryA[0];
  const unrel = res.summaryB[0];
  assert(rel.deliveryRate >= unrel.deliveryRate + 0.1, `reliable beats unreliable by 10+ points (${(rel.deliveryRate*100).toFixed(0)}% vs ${(unrel.deliveryRate*100).toFixed(0)}%)`);
  assert(rel.retransmits > 0 && unrel.retransmits === 0, `only the reliable stack retransmits (${rel.retransmits} vs ${unrel.retransmits})`);
}

console.log('\n[9] Loss sweep is monotonic (validation experiment)');
{
  const sweep = lossSweep([0, 10, 20, 30, 40]);
  assert(sweep[0].reliableDelivery >= sweep[sweep.length-1].reliableDelivery, `delivery at 0% loss >= delivery at 40% loss (${(sweep[0].reliableDelivery*100).toFixed(0)}% vs ${(sweep[sweep.length-1].reliableDelivery*100).toFixed(0)}%)`);
  assert(isMonotonicDecreasing(sweep), 'delivery decreases (within noise) as loss rises');
}

console.log('\n[10] Retransmit-on-timeout recovers every packet, given time');
{
  const { nodes, links } = defaultTopology();
  const base = {
    nodes, links: links.map((l) => ({ ...l, lossPct: 15, corruptPct: 0 })),
    flows: [{ id: 'f1', src: 'R1', dst: 'R6', ratePps: 20, count: 60, payloadBytes: 512 }],
    faults: [], routing: 'ls' as const, seed: 123, durationMs: 60000,
  };
  const rel = runSimulation({ ...base, stack: reliableStack() }).metrics.summarize(['f1'])[0];
  const unrel = runSimulation({ ...base, stack: unreliableStack() }).metrics.summarize(['f1'])[0];
  assert(rel.deliveryRate === 1, `reliable delivers 100% at 15% per-link loss (got ${(rel.deliveryRate*100).toFixed(0)}%, ${rel.retransmits} retransmits)`);
  assert(unrel.deliveryRate < 0.8, `unreliable cannot recover (${(unrel.deliveryRate*100).toFixed(0)}%)`);
  assert(rel.delivered <= rel.sent, `duplicates are not double-counted (${rel.delivered} delivered of ${rel.sent} sent)`);
}

console.log('\n[11] ACKs are real reverse traffic and make RTT a true round trip');
{
  const { nodes, links } = defaultTopology();
  const base = {
    nodes, links: links.map((l) => ({ ...l, lossPct: 0, corruptPct: 0, jitterMs: 0 })),
    flows: [{ id: 'f1', src: 'R1', dst: 'R6', ratePps: 10, count: 20, payloadBytes: 512 }],
    faults: [], routing: 'ls' as const, seed: 3, durationMs: 5000,
  };
  const rel = runSimulation({ ...base, stack: reliableStack() });
  const unrel = runSimulation({ ...base, stack: unreliableStack() });
  const ackHops = rel.moves.filter((m) => m.isAck);
  assert(ackHops.length > 0 && ackHops.every((m) => m.flowId === 'f1'), `ACK packets travel the network (${ackHops.length} ACK hops)`);
  assert(unrel.moves.every((m) => !m.isAck), 'a stack without ACK sends no ACKs');
  const rtt = rel.metrics.summarize(['f1'])[0].avgRttMs;
  const oneWay = unrel.metrics.summarize(['f1'])[0].avgRttMs;
  const ratio = rtt / oneWay;
  assert(ratio > 1.7 && ratio < 2.3, `RTT ≈ 2× one-way latency (${rtt.toFixed(1)}ms vs ${oneWay.toFixed(1)}ms)`);
}

console.log('\n[12] WINDOW caps unacknowledged data in flight, and the knobs are live');
{
  const { nodes, links } = defaultTopology();
  const clean = links.map((l) => ({ ...l, lossPct: 0, corruptPct: 0 }));
  const withLayer = (patch: { windowSize?: number; timeoutMs?: number }) =>
    reliableStack().map((l) => (l.name === 'Transport' ? { ...l, ...patch } : l));
  const base = {
    nodes, links: clean,
    flows: [{ id: 'f1', src: 'R1', dst: 'R6', ratePps: 100, count: 100, payloadBytes: 512 }],
    faults: [], routing: 'ls' as const, seed: 4, durationMs: 1500,
  };
  const maxConcurrentData = (moves: { departAt: number; arriveAt: number; isAck: boolean }[]) => {
    const pts: [number, number][] = [];
    for (const m of moves) if (!m.isAck) { pts.push([m.departAt, 1]); pts.push([m.arriveAt, -1]); }
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]); // arrivals before departures at the same instant
    let cur = 0, max = 0;
    for (const [, d] of pts) { cur += d; max = Math.max(max, cur); }
    return max;
  };
  const w2 = runSimulation({ ...base, stack: withLayer({ windowSize: 2 }) });
  const unrel = runSimulation({ ...base, stack: unreliableStack() });
  assert(maxConcurrentData(w2.moves) <= 2, `window 2 → at most 2 data packets in flight (max ${maxConcurrentData(w2.moves)})`);
  assert(maxConcurrentData(unrel.moves) > 2, `no window → unbounded in flight (max ${maxConcurrentData(unrel.moves)})`);

  const d1 = runSimulation({ ...base, stack: withLayer({ windowSize: 1 }) }).metrics.summarize(['f1'])[0].delivered;
  const d8 = runSimulation({ ...base, stack: withLayer({ windowSize: 8 }) }).metrics.summarize(['f1'])[0].delivered;
  assert(d8 > d1, `Window size knob changes throughput (window 1: ${d1}, window 8: ${d8} delivered in 1.5s)`);

  const lossy = { ...base, links: links.map((l) => ({ ...l, lossPct: 10, corruptPct: 0 })), durationMs: 8000, flows: [{ id: 'f1', src: 'R1', dst: 'R6', ratePps: 20, count: 60, payloadBytes: 512 }] };
  const fast = runSimulation({ ...lossy, stack: withLayer({ timeoutMs: 200 }) }).metrics.summarize(['f1'])[0];
  const slow = runSimulation({ ...lossy, stack: withLayer({ timeoutMs: 2000 }) }).metrics.summarize(['f1'])[0];
  assert(fast.deliveryRate > slow.deliveryRate, `Timeout knob changes recovery speed (200ms: ${(fast.deliveryRate*100).toFixed(0)}%, 2000ms: ${(slow.deliveryRate*100).toFixed(0)}%)`);
}

// ---- helpers for custom stacks ----
const app = () => makeLayer('Application', [{ kind: 'ADD_HEADER', params: { app: 'demo' } }], { headerBytes: 8 });
const net = (extra: Primitive[] = [], scope: LayerScope = 'per-hop') =>
  makeLayer('Network', [{ kind: 'ADD_HEADER', params: { proto: 'ip' } }, ...extra], { headerBytes: 20, scope });
const transport = (kinds: Primitive['kind'][], over: Partial<LayerDef> = {}) =>
  makeLayer('Transport', kinds.map((kind) => ({ kind, params: {} })), { headerBytes: 20, ...over });
const flow60 = [{ id: 'f1', src: 'R1', dst: 'R6', ratePps: 20, count: 60, payloadBytes: 512 }];
const summary = (cfg: NetworkConfig) => runSimulation(cfg).metrics.summarize(['f1'])[0];

console.log('\n[13] CHECKSUM catches real payload damage; without it corruption slips through');
{
  const { nodes, links } = defaultTopology();
  const base = { nodes, links: links.map((l) => ({ ...l, lossPct: 0, corruptPct: 8 })), flows: flow60, faults: [], routing: 'ls' as const, seed: 21, durationMs: 20000 };
  const none = summary({ ...base, stack: unreliableStack() });
  const ck = summary({ ...base, stack: [app(), transport(['CHECKSUM']), net()] });
  const rel = summary({ ...base, stack: reliableStack() });
  assert(none.undetected > 0 && none.corrupted === 0, `no CHECKSUM → damaged packets accepted as good (${none.undetected} undetected)`);
  assert(ck.corrupted > 0 && ck.undetected === 0, `CHECKSUM → damage caught and discarded (${ck.corrupted} caught, ${ck.undetected} slipped)`);
  assert(rel.deliveryRate === 1 && rel.undetected === 0, `CHECKSUM + retransmit → every packet arrives intact (${(rel.deliveryRate*100).toFixed(0)}%)`);
}

console.log('\n[14] SEQUENCE filters duplicates and restores order');
{
  const { nodes, links } = defaultTopology();
  const base = { nodes, links: links.map((l) => ({ ...l, lossPct: 15, corruptPct: 0, jitterMs: 30 })), flows: flow60, faults: [], routing: 'ls' as const, seed: 8, durationMs: 30000 };
  const noSeq = summary({ ...base, stack: [app(), transport(['CHECKSUM', 'ACK', 'RETRANSMIT']), net()] });
  const seq = summary({ ...base, stack: reliableStack() });
  assert(noSeq.duplicates > 0, `without SEQUENCE, retransmitted copies reach the app twice (${noSeq.duplicates} duplicates)`);
  assert(noSeq.reordered > 0, `without SEQUENCE, the app sees packets out of order (${noSeq.reordered} reordered)`);
  assert(seq.duplicates === 0 && seq.reordered === 0, `with SEQUENCE + retransmit, the app gets one in-order copy each (${seq.duplicates} dup, ${seq.reordered} reordered)`);
}

console.log('\n[15] FRAGMENT splits by MTU and reassembles; losing one piece loses the packet');
{
  const { nodes, links } = defaultTopology();
  const fragStack = () => [app(), makeLayer('Transport', [{ kind: 'FRAGMENT', params: {} }], { headerBytes: 0, mtu: 200 }), net()];
  const clean = { nodes, links: links.map((l) => ({ ...l, lossPct: 0, corruptPct: 0 })), flows: flow60, faults: [], routing: 'ls' as const, seed: 5, durationMs: 8000 };
  const whole = runSimulation({ ...clean, stack: unreliableStack() });
  const frag = runSimulation({ ...clean, stack: fragStack() });
  const ratio = frag.moves.length / whole.moves.length;
  assert(ratio >= 3, `MTU 200 turns each 512 B packet into 3+ fragments on the wire (${ratio.toFixed(1)}× link crossings)`);
  assert(frag.metrics.summarize(['f1'])[0].deliveryRate === 1, 'fragments reassemble into whole packets on a clean network');
  const lossy = { ...clean, links: links.map((l) => ({ ...l, lossPct: 5, corruptPct: 0 })) };
  const w = summary({ ...lossy, stack: unreliableStack() });
  const f = summary({ ...lossy, stack: fragStack() });
  assert(f.deliveryRate < w.deliveryRate, `fragmenting under loss delivers less (${(f.deliveryRate*100).toFixed(0)}% vs ${(w.deliveryRate*100).toFixed(0)}% unfragmented)`);
}

console.log('\n[16] Layer scope: per-hop layers run at every router, end-to-end layers only at the ends');
{
  const { nodes, links } = defaultTopology();
  const clean = { nodes, links: links.map((l) => ({ ...l, lossPct: 0, corruptPct: 0 })), flows: flow60, faults: [], routing: 'ls' as const, seed: 2, durationMs: 8000 };
  const ttlRule: Primitive = { kind: 'DROP_IF', params: { field: 'ttl', op: '<', value: 5 } };
  const perHop = summary({ ...clean, stack: [app(), net([ttlRule], 'per-hop')] });
  const e2e = summary({ ...clean, stack: [app(), net([ttlRule], 'end-to-end')] });
  assert(perHop.delivered === 0, `per-hop DROP_IF ttl<5 fires at the 4th router (${perHop.delivered} delivered)`);
  assert(e2e.delivered === 60, `same rule end-to-end only checks at the source (${e2e.delivered} delivered)`);

  const corrupt = { ...clean, links: links.map((l) => ({ ...l, lossPct: 0, corruptPct: 10 })) };
  const res = runSimulation({ ...corrupt, stack: [app(), net([{ kind: 'CHECKSUM', params: {} }], 'per-hop')] });
  const caughtAt = new Set(res.metrics.samples.filter((s) => s.kind === 'corrupted').map((s) => s.nodeId));
  assert([...caughtAt].some((n) => n !== 'R6'), `per-hop CHECKSUM catches damage at intermediate routers (${[...caughtAt].sort().join(', ')})`);
}

console.log('\n[17] DELAY adds processing time once end-to-end, or at every hop');
{
  const { nodes, links } = defaultTopology();
  const base = { nodes, links: links.map((l) => ({ ...l, lossPct: 0, corruptPct: 0, jitterMs: 0 })), flows: flow60, faults: [], routing: 'ls' as const, seed: 6, durationMs: 8000 };
  const delay: Primitive = { kind: 'DELAY', params: { ms: 20 } };
  const plain = summary({ ...base, stack: unreliableStack() }).avgRttMs;
  const once = summary({ ...base, stack: [makeLayer('Application', [{ kind: 'ADD_HEADER', params: { app: 'demo' } }, delay], { headerBytes: 8 }), net()] }).avgRttMs;
  const hop = summary({ ...base, stack: [app(), net([delay], 'per-hop')] }).avgRttMs;
  assert(Math.abs(once - plain - 20) < 1, `end-to-end DELAY 20ms adds ~20ms (${plain.toFixed(1)} → ${once.toFixed(1)}ms)`);
  assert(Math.abs(hop - plain - 80) < 1, `per-hop DELAY 20ms over 4 hops adds ~80ms (${plain.toFixed(1)} → ${hop.toFixed(1)}ms)`);
}

console.log('\n[18] Link queues: bandwidth limits throughput, a full queue tail-drops');
{
  const { nodes, links } = defaultTopology();
  const flood = [{ id: 'f1', src: 'R1', dst: 'R6', ratePps: 300, count: 300, payloadBytes: 1024 }];
  const slowLinks = (queueSize: number) => links.map((l) => ({ ...l, lossPct: 0, corruptPct: 0, bandwidthMbps: 1, queueSize }));
  const base = { nodes, flows: flood, faults: [], routing: 'ls' as const, seed: 1, durationMs: 8000, stack: unreliableStack() };
  const small = summary({ ...base, links: slowLinks(2) });
  const big = summary({ ...base, links: slowLinks(64) });
  const fast = summary({ ...base, links: links.map((l) => ({ ...l, lossPct: 0, corruptPct: 0, bandwidthMbps: 100, queueSize: 2 })) });
  assert(small.dropped > 0, `1 Mbps links overflow a 2-packet queue (${small.dropped} tail drops)`);
  assert(big.dropped < small.dropped, `a bigger queue absorbs the burst (${big.dropped} vs ${small.dropped} drops)`);
  assert(fast.dropped === 0, `100 Mbps links never queue up (${fast.dropped} drops)`);
  assert(big.avgRttMs > fast.avgRttMs * 2, `queueing delay shows up in latency (${big.avgRttMs.toFixed(0)}ms vs ${fast.avgRttMs.toFixed(0)}ms)`);
}

console.log('\n[19] Routing re-convergence: Link State floods at link speed, Distance Vector loops while it catches up');
{
  const { nodes, links } = defaultTopology();
  const dv0 = distanceVector(nodes, links);
  const re = distanceVector(nodes, links.map((l) => (l.id === 'R3-R4' ? { ...l, up: false } : l)), dv0);
  const looped = re.history!.some((h) => h.nextHop['R3']['R6'] === 'R2' && h.nextHop['R2']['R6'] === 'R3');
  assert(looped, `DV re-convergence passes through an R2 ⇄ R3 loop (${re.rounds} rounds)`);
  const run = (routing: 'ls' | 'dv') => runSimulation({
    nodes, links: links.map((l) => ({ ...l, lossPct: 0, corruptPct: 0 })), stack: unreliableStack(),
    flows: [{ id: 'f1', src: 'R1', dst: 'R6', ratePps: 50, count: 150, payloadBytes: 512 }],
    faults: [{ atMs: 1000, linkId: 'R3-R4', action: 'kill' }], routing, seed: 3, durationMs: 8000,
  });
  const ls = run('ls'), dv = run('dv');
  const bounces = (r: typeof ls) => r.moves.filter((m) => m.fromNode === 'R3' && m.toNode === 'R2').length;
  const lsS = ls.metrics.summarize(['f1'])[0], dvS = dv.metrics.summarize(['f1'])[0];
  assert(bounces(ls) === 0 && bounces(dv) > 0, `only DV bounces packets back R3 → R2 during convergence (LS ${bounces(ls)}, DV ${bounces(dv)})`);
  assert(dvS.delivered < lsS.delivered, `DV loses packets during convergence that LS does not (${dvS.delivered} vs ${lsS.delivered} delivered)`);
}

console.log('\n[20] Adaptive timeout and fast retransmit (TCP-like) — and what they cost');
{
  const { nodes, links } = defaultTopology();
  const flow = [{ id: 'f1', src: 'R1', dst: 'R6', ratePps: 20, count: 60, payloadBytes: 512 }];
  const lossy = { nodes, links: links.map((l) => ({ ...l, lossPct: 8, corruptPct: 0 })), flows: flow, faults: [], routing: 'ls' as const, seed: 31, durationMs: 8000 };
  const slowTimer = (rto: string, fast: string) => reliableStack().map((l) => l.name !== 'Transport' ? l : {
    ...l, timeoutMs: 3000, primitives: l.primitives.map((p) => p.kind === 'RETRANSMIT' ? { ...p, params: { rto, fast } } : p),
  });
  const fixed = summary({ ...lossy, stack: slowTimer('fixed', 'off') });
  const adaptive = summary({ ...lossy, stack: slowTimer('adaptive', 'off') });
  assert(adaptive.deliveryRate > fixed.deliveryRate, `adaptive timeout learns the ~100 ms RTT instead of waiting 3000 ms (${(adaptive.deliveryRate*100).toFixed(0)}% vs ${(fixed.deliveryRate*100).toFixed(0)}%)`);

  // fast retransmit needs packets close together (bulk traffic), averaged over seeds
  const withFast = (fast: string) => tcpLikeStack().map((l) => l.name !== 'Transport' ? l : {
    ...l, primitives: l.primitives.map((p) => p.kind === 'RETRANSMIT' ? { ...p, params: { ...p.params, fast } } : p),
  });
  const bulk = { ...lossy, links: links.map((l) => ({ ...l, lossPct: 3, corruptPct: 0 })), flows: [{ id: 'f1', src: 'R1', dst: 'R6', ratePps: 200, count: 400, payloadBytes: 512 }] };
  const total = (fast: string) => {
    let fastRtx = 0, timeouts = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const s = summary({ ...bulk, seed, stack: withFast(fast) });
      fastRtx += s.fastRetransmits; timeouts += s.retransmits - s.fastRetransmits;
    }
    return { fastRtx, timeouts };
  };
  const on = total('on'), off = total('off');
  assert(on.fastRtx > 0 && off.fastRtx === 0, `bulk traffic: fast retransmit fires on later ACKs (${on.fastRtx} over 6 runs)`);
  assert(on.timeouts < off.timeouts, `so fewer losses wait for the timer (${on.timeouts} vs ${off.timeouts} timeouts)`);

  const congested = { nodes, links: links.map((l) => (l.id === 'R3-R4' ? { ...l, bandwidthMbps: 1, queueSize: 2 } : l)), flows: [{ id: 'f1', src: 'R1', dst: 'R6', ratePps: 300, count: 300, payloadBytes: 1024 }], faults: [], routing: 'ls' as const, seed: 42, durationMs: 8000 };
  const tcpC = summary({ ...congested, stack: tcpLikeStack() }), relC = summary({ ...congested, stack: reliableStack() });
  assert(tcpC.deliveryRate > relC.deliveryRate, `under congestion TCP-like beats classic reliable (${(tcpC.deliveryRate*100).toFixed(0)}% vs ${(relC.deliveryRate*100).toFixed(0)}%)`);

  const heavy = { ...lossy, links: links.map((l) => ({ ...l, lossPct: 20, corruptPct: 0 })), seed: 123 };
  const tcpH = summary({ ...heavy, stack: tcpLikeStack() }), relH = summary({ ...heavy, stack: reliableStack() });
  assert(tcpH.deliveryRate < relH.deliveryRate, `under heavy random loss, backing off as if congested hurts TCP-like (${(tcpH.deliveryRate*100).toFixed(0)}% vs ${(relH.deliveryRate*100).toFixed(0)}%)`);
}

console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : '❌ ' + failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures === 0 ? 0 : 1);
