# STATE.md — Living Board

> Update this at the end of every work session. "What's done, what's next,
> what's blocked." Keep it honest — it's how three people avoid colliding.

_Last updated: end of Phase 5 — feature complete (2026-10-06)_

## ✅ Done

**Foundation (Phase 1)**
- Discrete-event engine, layer primitives, link model, DV + LS routing, metrics, orchestrator, presets, store, UI shell.

**Phase 2 — paper add-ons**
- Scenario save/reload, A/B comparison harness, loss-sweep validation, AIMD congestion, fault-injection timeline.

**Phase 3 — reliability that recovers**
- Real ACK reverse traffic (cumulative + selective), retransmit-on-timeout, ACK-clocked
  sliding window; Window size / Timeout knobs live; primitive editor in the Inspector.

**Phase 4 — conceptually complete**
- Every primitive does something: corruption damages the payload so `CHECKSUM` really
  catches it; `SEQUENCE` filters duplicates and (with `RETRANSMIT`) delivers in order;
  `FRAGMENT` splits by MTU and reassembles; `DELAY` adds processing time.
- Layer scope: end-to-end (TCP-like) or every hop (IP-like). Network presets are per-hop.
- Link FIFO output queues with tail drop: bandwidth and Queue size knobs are live.
- New metrics: corrupt caught / missed, duplicates, out of order.
- UI: run-duration knob, flow endpoints, router routing tables, scope toggle, DELAY param.
- `npm test`, GitHub Pages workflow, relative build paths.

**Phase 5 — feature complete**
- Routing convergence after faults: Link State routers switch as the LSA reaches them (link
  latency); Distance Vector re-converges from stale tables one exchange per period, with
  transient loops. DV vs LS now give different results; DV rounds can be stepped per router.
- TCP refinements as opt-in settings: adaptive timeout (RFC 6298 + timestamp echo, 200 ms
  floor, backoff), fast retransmit, slow start (Reno). New TCP-like preset.
- Multiple flows in the UI with per-flow colours; Dashboard totals; loss-sweep chart;
  draggable routers; replay shows scheduled faults; latency label honest without ACKs.
- Bundle split (first load 242 KB), lint clean.

**Validation:** `npm test` → 20/20 groups pass. `npm run build` clean, `tsc -b` clean,
`oxlint` clean. Every knob in the UI changes the simulation.

## 🔭 Possible extensions (beyond the project's scope)

| Item | Notes |
|---|---|
| Editable topology | Add/remove routers and links in the UI (the engine already takes any graph). |
| Fast recovery / SACK-based recovery | Reno's window inflation; would further help TCP-like on lossy links. |
| Fairness metrics | Jain's fairness index across competing flows. |
| Count-to-infinity mitigations | Split horizon / poison reverse for Distance Vector. |
