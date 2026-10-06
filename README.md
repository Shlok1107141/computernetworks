# Custom Protocol Stack Simulator

A lab-ready, browser-native network sandbox. Compose a protocol stack from
composable primitives, tune every layer/link/flow knob, run real discrete-event
traffic, watch packets move hop-to-hop, and measure the result — no code to run
a protocol, no hardware, no backend.

**Live site:** https://shlok1107141.github.io/computernetworks/

## Run it

```bash
npm install
npm run dev        # dev server at http://localhost:5173
npm test           # 20 groups of invariant checks over the simulation core
npm run build      # static production build in dist/ (deploy anywhere)
```

## What you can do

- **Build a protocol without code.** A stack is an ordered list of layers; a layer is an
  ordered list of primitives. Select a layer to add, reorder, remove, and configure them.
  Three presets to start from: Reliable, TCP-like, Unreliable.
- **Choose where each layer runs.** *End-to-end* layers run once at the source and once
  at the destination (like TCP). *Every-hop* layers are unwrapped, checked, and re-wrapped
  at every router (like IP).
- **Tune everything:** per link (bandwidth, latency, jitter, loss, corruption, queue size,
  routing weight), per layer (window, timeout, MTU, header bytes), per flow (endpoints,
  rate, count, payload), plus seed, run length and the Distance Vector update period.
- **Run several flows at once**, each with its own colour, competing for the same links.
- **Compare routing:** Distance Vector and Link State re-converge differently after a link
  fails; step through Distance Vector's exchange rounds on any router.
- **Replay** the actual event timeline packet by packet, with live counters, an event log,
  and links turning red at the moment a scheduled failure hits. Drag routers to rearrange.
- **Experiment:** schedule link failures mid-run, compare two stacks on identical traffic,
  sweep loss from 0–30% across four stacks, export metrics as CSV, save/load scenarios.

## The primitives

| Primitive | Effect | Settings |
|---|---|---|
| `ADD_HEADER` | Pushes a header; adds the layer's header bytes to every packet | field = value |
| `CHECKSUM` | Checksums the payload; the receiver discards damaged packets | — |
| `SEQUENCE` | Numbers packets; receiver drops duplicates, and with `RETRANSMIT` delivers in order | — |
| `ACK` | Receiver sends an ACK (cumulative + selective, with a timestamp echo) back through the network | — |
| `RETRANSMIT` | Resends a packet if no ACK arrives in time (needs `ACK`) | timeout fixed / adaptive (RFC 6298, 200 ms floor, backoff); fast retransmit off / on (3 later ACKs) |
| `WINDOW` | Caps unACKed packets with a congestion window, up to the window size (needs `ACK`) | growth AIMD / slow start then AIMD (Reno) |
| `DROP_IF` | Drops a packet when `ttl`/`size`/`seq` meets a condition | field, operator, value |
| `DELAY` | Adds processing time (once, or at every hop for a per-hop layer) | ms |
| `FRAGMENT` | Splits packets larger than the layer's MTU; the receiver reassembles them | layer MTU |

## Metrics

`delivery` (intact packets delivered ÷ sent) · `delivered` · `dropped` (every lost copy:
link loss, queue overflow, TTL, no route, `DROP_IF`) · `corrupt, caught` (discarded by a
checksum) · `corrupt, missed` (damaged but accepted) · `duplicates` · `out of order` ·
`retransmits` (and how many were fast) · `avg RTT` with ACKs / `avg latency (one-way)`
without · `goodput` (delivered payload bits/s). With several flows, an "All flows" total too.

## Architecture

- `src/sim-core/` — pure TypeScript discrete-event engine (no React), independently testable.
  - `engine.ts` event queue + clock · `layer.ts` primitives · `link.ts` link model + seeded RNG
  - `routing.ts` Distance Vector (synchronous Bellman-Ford, with re-convergence from stale
    tables) + Link State (Dijkstra) · `metrics.ts` stats/CSV
  - `network.ts` orchestrator: per-hop/end-to-end processing, fragmentation, link queues,
    ACK/retransmit/window, routing convergence after faults · `comparison.ts` A/B harness ·
    `validation.ts` loss sweeps · `selfcheck.ts` tests
- `src/ui/` — React views (TopologyView, StackBuilder, Inspector, Dashboard, Comparison, FaultTimeline)
- `src/store/simStore.ts` — the only seam between UI and sim-core
- `docs/` — CONTRACTS.md (interfaces), STATE.md (board), BUILD_LOG.md (history)
- `presentation/` — the three-person talk scripts (design, live demo, findings)

## Publish on GitHub Pages

1. Push this folder as the root of a GitHub repository, on the `main` branch.
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Every push to `main` runs `npm test`, builds, and publishes to
   `https://<your-username>.github.io/<repo-name>/` (see the Actions tab for progress).

The build uses relative asset paths, so it also works on Netlify, Vercel, or any static host
(build command `npm run build`, output folder `dist`).

## For the team

Read `docs/CONTRACTS.md` before editing a module you don't own, and update
`docs/STATE.md` + `docs/BUILD_LOG.md` at the end of each session.
