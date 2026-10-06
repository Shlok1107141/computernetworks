# STATE.md — Living Board

> Update this at the end of every work session. "What's done, what's next,
> what's blocked." Keep it honest — it's how three people avoid colliding.

_Last updated: end of Phase 4 (2026-10-06)_

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

**Validation:** `npm test` → 18/18 groups pass. `npm run build` clean, `tsc -b` clean.
Every knob in the UI now changes the simulation.

## 🔭 Possible extensions (not required for the core idea)

| Item | Notes |
|---|---|
| Fast retransmit / adaptive RTO | Reliable becomes throughput-bound at ≥10% per-link loss in short runs — a real trade-off worth studying, and the obvious next protocol refinement. |
| DV round-by-round animation | DV jumps to converged; animating rounds would show DV vs LS convergence visually. |
| Multiple flows in the UI | Engine supports many flows; UI edits only `f1`. |
| Loss-sweep chart in the UI | `validation.ts` exists; only reachable from `npm test`. |
| Node drag-to-reposition | Positions fixed. |
| Code-split the bundle | Build warns about a ~590 KB chunk (recharts). Cosmetic. |
