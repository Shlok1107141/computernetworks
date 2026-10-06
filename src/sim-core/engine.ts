// ============================================================
// sim-core/engine.ts
// The discrete-event simulation engine. A real event queue and
// clock — NOT animation timing. The UI renders this clock; the
// clock does not depend on the UI. This separation is what makes
// the metrics honest and the engine independently testable.
// ============================================================

import type { SimEvent, MetricSample, PacketMoveEvent } from './types';

/** Min-heap keyed on (time, seqNo) for stable ordering. */
class EventQueue {
  private heap: SimEvent[] = [];

  get size() {
    return this.heap.length;
  }

  push(e: SimEvent) {
    this.heap.push(e);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): SimEvent | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  private less(i: number, j: number): boolean {
    const a = this.heap[i], b = this.heap[j];
    if (a.time !== b.time) return a.time < b.time;
    return a.seqNo < b.seqNo;
  }

  private bubbleUp(i: number) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.less(i, parent)) {
        [this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]];
        i = parent;
      } else break;
    }
  }

  private bubbleDown(i: number) {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this.less(l, smallest)) smallest = l;
      if (r < n && this.less(r, smallest)) smallest = r;
      if (smallest !== i) {
        [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
        i = smallest;
      } else break;
    }
  }
}

export type MetricSink = (m: MetricSample) => void;
export type MoveSink = (m: PacketMoveEvent) => void;
export type EventHandler = (e: SimEvent, engine: Engine) => void;

export class Engine {
  private queue = new EventQueue();
  private seqCounter = 0;
  public now = 0;
  public handlers: Partial<Record<SimEvent['kind'], EventHandler>> = {};
  public metricSink: MetricSink = () => {};
  public moveSink: MoveSink = () => {};

  /** Schedule an event `delay` ms into the future. */
  schedule(delay: number, e: Omit<SimEvent, 'time' | 'seqNo'>) {
    this.queue.push({ ...e, time: this.now + Math.max(0, delay), seqNo: this.seqCounter++ });
  }

  scheduleAt(time: number, e: Omit<SimEvent, 'time' | 'seqNo'>) {
    this.queue.push({ ...e, time: Math.max(this.now, time), seqNo: this.seqCounter++ });
  }

  emitMetric(m: MetricSample) {
    this.metricSink(m);
  }

  emitMove(m: PacketMoveEvent) {
    this.moveSink(m);
  }

  /** Run until the queue empties or `until` sim-time is reached. */
  run(until: number = Infinity): void {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const e = this.peekNext();
      if (!e || e.time > until) break;
      const ev = this.queue.pop()!;
      this.now = ev.time;
      const handler = this.handlers[ev.kind];
      if (handler) handler(ev, this);
    }
    if (until !== Infinity) this.now = until;
  }

  private peekNext(): SimEvent | undefined {
    // cheap peek: pop+repush would break stability, so we track via a wrapper
    // Instead we re-implement a peek by popping once and restoring.
    const e = this.queue.pop();
    if (e) this.queue.push(e);
    return e;
  }

  hasWork(): boolean {
    return this.queue.size > 0;
  }
}
