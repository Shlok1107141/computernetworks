// ============================================================
// store/simStore.ts
// The single bridge between sim-core (pure TS) and the React UI.
// UI never touches the engine directly — it reads/writes config
// here and calls run(). Keeps the CONTRACTS.md boundary clean.
// ============================================================

import { create } from 'zustand';
import type { LinkDef } from '../sim-core/link';
import { DEFAULT_DELAY_MS, type LayerDef, type Primitive, type PrimitiveKind } from '../sim-core/layer';
import type { FlowDef, FaultDef, NetworkConfig } from '../sim-core/network';
import { runSimulation } from '../sim-core/network';
import { defaultTopology, reliableStack, unreliableStack } from '../sim-core/presets';
import { distanceVector, linkState, type RoutingResult } from '../sim-core/routing';
import { Metrics } from '../sim-core/metrics';
import type { PacketMoveEvent } from '../sim-core/types';

export type NodePos = Record<string, { x: number; y: number }>;

interface SimState {
  nodes: string[];
  nodePos: NodePos;
  links: LinkDef[];
  stack: LayerDef[];
  flows: FlowDef[];
  faults: FaultDef[];
  routing: 'dv' | 'ls';
  seed: number;
  durationMs: number;

  // last-run outputs
  metrics: Metrics | null;
  routingResult: RoutingResult | null;
  moves: PacketMoveEvent[];
  hasRun: boolean;

  // selection for inspector
  selected: { type: 'link' | 'layer' | 'node' | 'flow'; id: string } | null;

  // actions
  setSelected: (s: SimState['selected']) => void;
  updateLink: (id: string, patch: Partial<LinkDef>) => void;
  updateLayer: (id: string, patch: Partial<LayerDef>) => void;
  reorderLayer: (id: string, dir: -1 | 1) => void;
  removeLayer: (id: string) => void;
  addLayer: () => void;
  addPrimitive: (layerId: string, kind: PrimitiveKind) => void;
  removePrimitive: (layerId: string, idx: number) => void;
  movePrimitive: (layerId: string, idx: number, dir: -1 | 1) => void;
  updatePrimitive: (layerId: string, idx: number, params: Primitive['params']) => void;
  updateFlow: (id: string, patch: Partial<FlowDef>) => void;
  setRouting: (r: 'dv' | 'ls') => void;
  setSeed: (n: number) => void;
  setDurationMs: (ms: number) => void;
  addFault: (f: FaultDef) => void;
  removeFault: (idx: number) => void;
  exportScenario: () => string;
  importScenario: (json: string) => void;
  loadReliable: () => void;
  loadUnreliable: () => void;
  run: () => void;
  liveRouting: () => RoutingResult;
}

const DEFAULT_POS: NodePos = {
  R1: { x: 60, y: 150 }, R2: { x: 200, y: 60 }, R3: { x: 200, y: 240 },
  R4: { x: 380, y: 60 }, R5: { x: 380, y: 240 }, R6: { x: 520, y: 150 },
};

const topo = defaultTopology();

function mapLayer(stack: LayerDef[], layerId: string, fn: (prims: Primitive[]) => Primitive[]): LayerDef[] {
  return stack.map((l) => (l.id === layerId ? { ...l, primitives: fn(l.primitives) } : l));
}

function defaultParams(kind: PrimitiveKind): Primitive['params'] {
  if (kind === 'ADD_HEADER') return { tag: 'custom' };
  if (kind === 'DROP_IF') return { field: 'ttl', op: '==', value: 0 };
  if (kind === 'DELAY') return { ms: DEFAULT_DELAY_MS };
  return {};
}

export const useSim = create<SimState>((set, get) => ({
  nodes: topo.nodes,
  nodePos: DEFAULT_POS,
  links: topo.links,
  stack: reliableStack(),
  flows: [{ id: 'f1', src: 'R1', dst: 'R6', ratePps: 12, count: 40, payloadBytes: 512 }],
  faults: [],
  routing: 'ls',
  seed: 42,
  durationMs: 8000,

  metrics: null,
  routingResult: null,
  moves: [],
  hasRun: false,
  selected: null,

  setSelected: (s) => set({ selected: s }),

  updateLink: (id, patch) =>
    set((st) => ({ links: st.links.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),

  updateLayer: (id, patch) =>
    set((st) => ({ stack: st.stack.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),

  reorderLayer: (id, dir) =>
    set((st) => {
      const idx = st.stack.findIndex((l) => l.id === id);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= st.stack.length) return {};
      const copy = [...st.stack];
      [copy[idx], copy[j]] = [copy[j], copy[idx]];
      return { stack: copy };
    }),

  removeLayer: (id) => set((st) => ({ stack: st.stack.filter((l) => l.id !== id) })),

  addLayer: () =>
    set((st) => ({
      stack: [
        ...st.stack,
        {
          id: 'L' + Math.random().toString(16).slice(2, 8),
          name: 'Custom Layer ' + (st.stack.length + 1),
          primitives: [{ kind: 'ADD_HEADER', params: { tag: 'custom' } }],
          windowSize: 4, timeoutMs: 500, mtu: 1500, headerBytes: 12, scope: 'end-to-end',
        } as LayerDef,
      ],
    })),

  addPrimitive: (layerId, kind) =>
    set((st) => ({
      stack: mapLayer(st.stack, layerId, (prims) => [...prims, { kind, params: defaultParams(kind) }]),
    })),

  removePrimitive: (layerId, idx) =>
    set((st) => ({ stack: mapLayer(st.stack, layerId, (prims) => prims.filter((_, i) => i !== idx)) })),

  movePrimitive: (layerId, idx, dir) =>
    set((st) => ({
      stack: mapLayer(st.stack, layerId, (prims) => {
        const j = idx + dir;
        if (j < 0 || j >= prims.length) return prims;
        const copy = [...prims];
        [copy[idx], copy[j]] = [copy[j], copy[idx]];
        return copy;
      }),
    })),

  updatePrimitive: (layerId, idx, params) =>
    set((st) => ({
      stack: mapLayer(st.stack, layerId, (prims) => prims.map((p, i) => (i === idx ? { ...p, params } : p))),
    })),

  updateFlow: (id, patch) =>
    set((st) => ({ flows: st.flows.map((f) => (f.id === id ? { ...f, ...patch } : f)) })),

  setRouting: (r) => set({ routing: r }),
  setSeed: (n) => set({ seed: n }),
  setDurationMs: (ms) => set({ durationMs: Math.max(500, ms) }),

  addFault: (f) => set((st) => ({ faults: [...st.faults, f] })),
  removeFault: (idx) => set((st) => ({ faults: st.faults.filter((_, i) => i !== idx) })),

  exportScenario: () => {
    const st = get();
    return JSON.stringify(
      {
        nodes: st.nodes, nodePos: st.nodePos, links: st.links, stack: st.stack,
        flows: st.flows, faults: st.faults, routing: st.routing, seed: st.seed, durationMs: st.durationMs,
      },
      null, 2
    );
  },
  importScenario: (json) => {
    try {
      const p = JSON.parse(json);
      set({
        nodes: p.nodes ?? get().nodes,
        nodePos: p.nodePos ?? get().nodePos,
        links: p.links ?? get().links,
        stack: p.stack ?? get().stack,
        flows: p.flows ?? get().flows,
        faults: p.faults ?? [],
        routing: p.routing ?? get().routing,
        seed: p.seed ?? get().seed,
        durationMs: p.durationMs ?? get().durationMs,
        hasRun: false,
      });
    } catch {
      // ignore malformed input; UI shows nothing changed
    }
  },

  loadReliable: () => set({ stack: reliableStack() }),
  loadUnreliable: () => set({ stack: unreliableStack() }),

  liveRouting: () => {
    const st = get();
    return st.routing === 'dv'
      ? distanceVector(st.nodes, st.links)
      : linkState(st.nodes, st.links);
  },

  run: () => {
    const st = get();
    const cfg: NetworkConfig = {
      nodes: st.nodes,
      links: st.links,
      stack: st.stack,
      flows: st.flows,
      faults: st.faults,
      routing: st.routing,
      seed: st.seed,
      durationMs: st.durationMs,
    };
    const res = runSimulation(cfg);
    set({
      metrics: res.metrics,
      routingResult: res.routingResult,
      moves: res.moves,
      hasRun: true,
    });
  },
}));
