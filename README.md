# Custom Protocol Stack Simulator

A lab-ready, browser-native network sandbox. Compose a protocol stack from
composable primitives, tune every layer/link/flow knob, run real discrete-event
traffic, watch packets move hop-to-hop, and measure the result — no code to run
a protocol, no hardware, no backend.

## Run it

```bash
npm install
npm run dev        # dev server at http://localhost:5173
npm test           # 18 groups of invariant checks over the simulation core
npm run build      # static production build in dist/ (deploy anywhere)
```

## What you can do

- **Build a protocol without code.** A stack is an ordered list of layers; a layer is an
  ordered list of primitives. Select a layer to add, reorder, remove, and configure them.
- **Choose where each layer runs.** *End-to-end* layers run once at the source and once
  at the destination (like TCP). *Every-hop* layers are unwrapped, checked, and re-wrapped
  at every router (like IP).
- **Tune everything:** per link (bandwidth, latency, jitter, loss, corruption, queue size,
  routing weight), per layer (window, timeout, MTU, header bytes), per flow (endpoints,
  rate, count, payload), plus seed and run length.
- **Replay** the actual event timeline packet by packet, with live counters and an event log.
- **Experiment:** schedule link failures mid-run, compare two stacks on identical traffic,
  export metrics as CSV, and save/load whole scenarios as JSON.

## The primitives

| Primitive | Effect |
|---|---|
| `ADD_HEADER` | Pushes a header; adds the layer's header bytes to every packet |
| `CHECKSUM` | Checksums the payload; the receiver discards damaged packets |
| `SEQUENCE` | Numbers packets; receiver drops duplicates, and with `RETRANSMIT` delivers in order |
| `ACK` | Receiver sends an ACK (cumulative + selective) back through the network |
| `RETRANSMIT` | Resends a packet if no ACK arrives within the layer's timeout (needs `ACK`) |
| `WINDOW` | Caps unACKed packets with an AIMD congestion window, up to the window size (needs `ACK`) |
| `DROP_IF` | Drops a packet when `ttl`/`size`/`seq` meets a condition |
| `DELAY` | Adds processing time (once, or at every hop for a per-hop layer) |
| `FRAGMENT` | Splits packets larger than the layer's MTU; the receiver reassembles them |

## Metrics

`delivery` (intact packets delivered ÷ sent) · `delivered` · `dropped` (every lost copy:
link loss, queue overflow, TTL, no route, `DROP_IF`) · `corrupt, caught` (discarded by a
checksum) · `corrupt, missed` (damaged but accepted) · `duplicates` · `out of order` ·
`retransmits` · `avg RTT` (true round trip with ACKs, one-way latency without) ·
`goodput` (delivered payload bits/s).

## Architecture

- `src/sim-core/` — pure TypeScript discrete-event engine (no React), independently testable.
  - `engine.ts` event queue + clock · `layer.ts` primitives · `link.ts` link model + seeded RNG
  - `routing.ts` Distance Vector + Link State · `metrics.ts` stats/CSV
  - `network.ts` orchestrator: per-hop/end-to-end processing, fragmentation, link queues,
    ACK/retransmit/window · `comparison.ts` A/B harness · `validation.ts` loss sweep ·
    `selfcheck.ts` tests
- `src/ui/` — React views (TopologyView, StackBuilder, Inspector, Dashboard, Comparison, FaultTimeline)
- `src/store/simStore.ts` — the only seam between UI and sim-core
- `docs/` — CONTRACTS.md (interfaces), STATE.md (board), BUILD_LOG.md (history)
- `presentation/` — the three-person talk scripts (design, live demo, findings)

## Publish on GitHub Pages

1. Push this folder (`pss-app/`) as the root of a GitHub repository, on the `main` branch.
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Every push to `main` runs `npm test`, builds, and publishes to
   `https://<your-username>.github.io/<repo-name>/` (see the Actions tab for progress).

The build uses relative asset paths, so it also works on Netlify, Vercel, or any static host
(build command `npm run build`, output folder `dist`).

## For the team

Read `docs/CONTRACTS.md` before editing a module you don't own, and update
`docs/STATE.md` + `docs/BUILD_LOG.md` at the end of each session.
