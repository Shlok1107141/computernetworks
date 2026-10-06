# BUILD_LOG.md — Append-Only History

> Newest entry on top. One block per work session: date, who, what changed,
> what the next person should know. Never edit past entries — just append.

---

## Phase 1 — Foundation (kickoff)

**Who:** initial scaffold
**What shipped:**
- Vite + React + TypeScript project (`npm install` → `npm run dev`)
- `sim-core/` discrete-event engine, fully decoupled from React and independently testable
  - `engine.ts` — min-heap event queue + sim clock + run loop
  - `types.ts` — Packet, Header, SimEvent, MetricSample, PacketMoveEvent
  - `layer.ts` — 10 composable primitives; pure `applyDown` / `applyUp`
  - `link.ts` — bandwidth/latency/jitter/loss/corruption/queue/weight + seeded RNG (mulberry32)
  - `routing.ts` — Distance Vector + Link State (Dijkstra), both return next-hop + convergence measure
  - `metrics.ts` — summary stats, bucketed time series, CSV export
  - `network.ts` — orchestrator: flows, faults, routing, bidirectional encapsulation
  - `presets.ts` — reliable/unreliable stacks + default 6-node topology
  - `selfcheck.ts` — 6 invariant tests
- UI shell: `TopologyView` (replays real event timings), `StackBuilder`, `Inspector`, `Dashboard`
- `store/simStore.ts` — the single UI↔sim-core seam (zustand)
- Docs: CONTRACTS.md, STATE.md, this log

**Validation:** `npx tsx src/sim-core/selfcheck.ts` → 6/6 pass. `npm run build` clean.

**For the next person:** read CONTRACTS.md before touching a module you don't own.
The engine internals are yours to change as long as the Contract-1 signatures and
the PacketMoveEvent shape (Contract 4) hold.

---

## Phase 2 — Paper add-ons (in progress)

**What shipped:**
- **Add-on #2 (A/B comparison harness):** `comparison.ts` runs two stacks on identical
  seed + traffic and returns aligned summaries. UI in `Comparison.tsx`.
- **Add-on #3 (preset validation):** `validation.ts` sweeps loss rate and confirms a
  reliable stack out-delivers an unreliable one across the curve; added to self-check.
- **Add-on #4 (concurrent flows + congestion):** engine now drives an AIMD window —
  `cwnd` rises additively on delivery, halves on loss; emitted as a metric and charted.
- **Add-on #5 (fault-injection timeline):** faults are first-class in `NetworkConfig`;
  `FaultTimeline.tsx` lets you schedule kill/restore at a sim-time and see the reroute.
- **Add-on #1 (scenario save/reload):** full run config exports/imports as JSON, so a
  scenario is reproducible and shareable (pairs with the seeded RNG).

**For the next person:** see STATE.md for what's still stubbed (LayerDesigner primitive
editor is the main authoring gap).

---

## Phase 3 — Reliability that actually recovers + primitive editor (2026-10-06)

**What shipped:**
- **ACK packets are real reverse traffic.** With `ACK` in the stack, the receiver sends a
  40-byte ACK back through the network (routed, lossy, corruptible, violet in the replay).
  ACKs carry `ackFor` plus a cumulative `cumAck` (new optional `Packet` field) so one lost
  ACK is covered by the next. Avg RTT is now a true round trip for ACK stacks (~2× one-way);
  stacks without ACK still report one-way latency under the same metric.
- **Retransmit-on-timeout.** With `ACK` + `RETRANSMIT`, every transmission arms a
  `TIMER_FIRE` at the layer's `timeoutMs`; if the seq is still unACKed it is resent (new
  packet id, `retransmit` metric), up to `MAX_RETRIES` = 6. Receiver de-duplicates by seq,
  so `delivered` never exceeds `sent`; duplicates are re-ACKed.
- **WINDOW is a real sliding window.** With `ACK` + `WINDOW`, unACKed packets are capped at
  `min(floor(cwnd), windowSize)`; excess packets wait in a send backlog. cwnd grows
  `+1/cwnd` per new ACK, halves on timeout (at most once per window). The old omniscient
  AIMD counter is gone — stacks without ACK + WINDOW have no cwnd series.
- **Window size and Timeout knobs are live** (when the layer owns the active primitive).
  Inspector now marks every inactive knob/primitive with the reason.
- **Primitive editor** in the Inspector's layer view: add any primitive, reorder, remove,
  and edit params for `DROP_IF` (field/op/value) and `ADD_HEADER` (field = value).
  Store actions: `addPrimitive`, `removePrimitive`, `movePrimitive`, `updatePrimitive`.
- Reliable preset now includes `ACK` + `RETRANSMIT`. Retransmits shown in Dashboard + Comparison.
- Goodput now counts application payload bytes only (previously included header bytes).
- `layer.ts` exports `PRIMITIVE_KINDS` and `reliabilityLayers(stack)` (shared by engine + UI).

**Semantics change to know:** `dropped` counts every lost copy of a data packet on the
wire, including copies later recovered by retransmit — so for a reliable stack
`delivered + dropped` can exceed `sent`. Lost ACKs are not counted as `dropped`.

**Finding worth putting in the paper:** reliability is not free. On the default 6-node
topology, reliable beats unreliable at low/moderate loss within an 8 s run (100% vs 93% at
the UI defaults; 88% vs 70% at 5% loss + 2% corruption), and reaches 100% at 10–20%
per-link loss given enough time. At ≥10% loss *within a fixed 8 s window*, the
ACK-clocked, timeout-driven sender becomes throughput-bound and can deliver less than
blind sending. Fast retransmit / adaptive RTO would move that crossover.

**Validation:** `npx tsx src/sim-core/selfcheck.ts` → 12/12 groups pass (new: [10]
retransmit recovers 100%, [11] ACK reverse traffic + RTT ≈ 2× one-way, [12] window caps
in-flight data, Window/Timeout knobs change outcomes). [8] now asserts a strict 10-point gap.

---

## Phase 4 — Conceptually complete (2026-10-06)

**What shipped:**
- **Layer scope.** `LayerDef.scope`: `'end-to-end'` (default) runs once at source and
  destination; `'per-hop'` is unwrapped/verified on arrival at every node and re-wrapped
  on departure. Network presets are per-hop, so `DROP_IF ttl` is checked at every router
  and a per-hop `CHECKSUM` behaves like a link-layer CRC.
- **Real corruption.** Link corruption flips a payload bit. `CHECKSUM` detects it
  (`corrupted` = caught). Damage no checksum caught is accepted and counted `undetected`
  (and still ACKed — the receiver believes it).
- **SEQUENCE.** Without it, retransmitted copies reach the app twice (`duplicate`) and
  late packets arrive `reordered`. With it, duplicates are dropped; with `SEQUENCE` +
  `RETRANSMIT` the receiver delivers strictly in order (head-of-line buffering), and the
  sender never gives up on a packet (an ordered stream can't skip one).
- **FRAGMENT.** Packets larger than the FRAGMENT layer's MTU are split (8 B fragment
  header each) and reassembled at the destination; one lost fragment loses the packet.
- **DELAY** `{ms}` adds processing time: once at the source, or at every hop.
- **Link queues.** Each link direction serializes one packet at a time; up to `queueSize`
  wait, the rest tail-drop. Bandwidth now creates queueing delay and congestion loss.
- `applyUp` unwraps headers symmetrically (reverse order) and restores packet size.
  `STRIP_HEADER` is kept for old scenarios but no longer offered — decapsulation is automatic.
- UI: scope toggle + "every hop" tag, DELAY param, MTU live with FRAGMENT, router routing
  tables on node click, flow endpoints, run-duration knob, new metric rows.
- Tooling: `npm test`, `tsx` dev dependency, `base: './'`, GitHub Actions Pages workflow.

**Validation:** `npm test` → 18/18 groups ([13] checksum, [14] sequence, [15] fragment,
[16] scope, [17] delay, [18] queues are new).
