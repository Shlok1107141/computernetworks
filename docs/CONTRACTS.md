# CONTRACTS.md — Frozen Interfaces

> The equivalent of "freeze the packet format in Week 0." These interfaces are
> the seams between the three owners. Changing one is a **group decision** —
> ping the team before editing anything in this file, because someone is
> building against it right now.

## Ownership map

| Owner | Modules | Responsible for |
|---|---|---|
| **Person A** | `src/sim-core/*` | Engine, layer primitives, links, routing, metrics, network orchestrator, self-check |
| **Person B** | `src/ui/TopologyView.tsx`, `src/ui/Inspector.tsx` | The network visual + all per-link/node/flow knobs |
| **Person C** | `src/ui/StackBuilder.tsx`, `src/ui/Dashboard.tsx`, `LayerDesigner` (todo) | Authoring the stack, comparison harness, charts, export |

The **store** (`src/store/simStore.ts`) is shared and is the ONLY place UI and sim-core meet. UI never imports the engine directly.

## Contract 1 — sim-core public surface (Person A owns, B & C consume)

```ts
// network.ts
runSimulation(cfg: NetworkConfig): RunResult
//   RunResult = { metrics: Metrics, routingResult: RoutingResult, moves: PacketMoveEvent[] }

// routing.ts
distanceVector(nodes, links): RoutingResult
linkState(nodes, links): RoutingResult
//   RoutingResult = { nextHop, dist, rounds }

// metrics.ts
Metrics.summarize(flowIds): FlowSummary[]
Metrics.series(flowId, kind, bucketMs): { t, v }[]
Metrics.toCSV(): string
```

If Person A changes any signature above, B and C break. Coordinate first.

## Contract 2 — the types (types.ts, layer.ts, link.ts)

`Packet`, `Header`, `SimEvent`, `MetricSample`, `PacketMoveEvent`, `LayerDef`,
`Primitive`, `LinkDef`, `FlowDef`, `FaultDef`, `NetworkConfig`.

These are the shared vocabulary. Add fields freely (optional fields don't break
anyone); renaming or removing fields is a group decision.

Additions so far (all optional / additive):
- `Packet.cumAck` — on ACKs, highest seq received with no gaps.
- `LayerDef.scope` — `'end-to-end'` (default when absent) or `'per-hop'`.
- `MetricSample.kind` gained `'undetected' | 'duplicate' | 'reordered'`;
  `FlowSummary` gained `undetected`, `duplicates`, `reordered`.
- `layer.ts` exports `PRIMITIVE_KINDS`, `reliabilityLayers(stack)`, `delayOf(layers)`, `DEFAULT_DELAY_MS`.
- Primitive params: `DROP_IF {field, op, value}`, `ADD_HEADER {<field>: value}`, `DELAY {ms}`.

## Contract 3 — the store shape (all three consume)

`useSim()` exposes state (`nodes, links, stack, flows, routing, seed, …`),
last-run outputs (`metrics, routingResult, moves, hasRun`), and actions
(`run, updateLink, updateLayer, reorderLayer, addLayer, updateFlow, …`).

UI reads/writes ONLY through these. If you need new state, add it to the store,
note it here, and tell the team.

Added actions: `addPrimitive`, `removePrimitive`, `movePrimitive`, `updatePrimitive`, `setDurationMs`.

## Contract 4 — PacketMoveEvent (the animation seam, B depends on A)

```ts
interface PacketMoveEvent {
  packetId, flowId, linkId, fromNode, toNode,
  departAt, arriveAt,   // sim-time ms — TopologyView interpolates position between these
  isAck, dropped
}
```

TopologyView replays these on a scaled clock. As long as this shape holds, A can
change the engine internals however they like without touching the visual.
