# Person 1 — What We Built and What Changed (~4 min)

**Running order:** P1 explains the idea and what changed → P2 shows it live → P3 proves it
works, shares the findings and the roadmap. You set up the vocabulary the other two use.

---

## 1. The pitch (30 s)

"We built a **Custom Protocol Stack Simulator**: a browser-based lab where you design a
network protocol by snapping together building blocks, run real traffic through a
simulated network, and measure what your design actually does. No code to write a
protocol, no hardware, no server; it's a static website."

## 2. The core idea: a protocol is data (1 min)

- A **stack** is a list of **layers**; a **layer** is a list of **primitives**.
- There are 9 primitives you can add: `ADD_HEADER`, `CHECKSUM`, `SEQUENCE`, `ACK`,
  `RETRANSMIT`, `WINDOW`, `DROP_IF`, `DELAY`, `FRAGMENT`.
- TCP-like behaviour isn't hard-coded anywhere. It *emerges* from the combination
  `SEQUENCE + CHECKSUM + ACK + RETRANSMIT + WINDOW`. Remove one and you see exactly what
  that block was buying you.
- Each layer also has a **scope**:
  - **End-to-end:** runs once at the sender and once at the receiver, like TCP.
  - **Every hop:** re-checked at every router, like IP.

## 3. How it works underneath (1 min)

- A **discrete-event engine**: a priority queue of timestamped events (packet created,
  enters link, arrives at node, timer fires, link fails). There is no animation timing;
  the replay you'll see is a read-out of the real event log.
- **Seeded randomness:** loss, corruption and jitter come from a seeded generator. Same
  seed + same settings = identical results, every time.
- **Clean split:** the engine is pure TypeScript with no UI, tested on its own. The React
  UI talks to it through a single store.
- A packet's life:
  - **Sender:** end-to-end layers wrap it → fragment if too big → every-hop layers wrap it → link.
  - **Each router:** every-hop layers unwrap and check it → route, decrement TTL → re-wrap → next link.
  - **Receiver:** unwrap → reassemble → end-to-end layers check it → in-order delivery → ACK back.

## 4. What changed since the last review (1.5 min)

"At the last review, the stack *looked* complete but a lot of it didn't do anything. Here's
before → after."

| Area | Before | Now |
|---|---|---|
| Retransmit | Did nothing | Resends on timeout; reliable now beats unreliable (100% vs 93% at defaults) |
| ACKs | Never sent | Real ACK packets travel back through the network (violet dots) |
| Window / congestion | Fake counter, knobs did nothing | Real sliding window: grows on ACKs, halves on timeouts; knobs change results |
| Checksum | Never caught anything | Corruption really damages data; checksum catches it |
| Sequence numbers | Stamped, never read | Drops duplicates, delivers in order |
| Fragmentation, Delay | Did nothing | Split by MTU and reassemble; processing delay |
| Where layers run | Endpoints only | Each layer: end-to-end or every hop |
| Link queues | Queue size knob did nothing | Real queues: limited bandwidth causes queueing delay and overflow drops |
| Building a protocol | Read-only chips | Full editor: add, reorder, remove and configure primitives |
| Metrics | 6 | 11, including corruption caught vs missed, duplicates, out of order, retransmits |
| Other UI | — | Run-duration knob, choose flow endpoints, router routing tables |
| Tests | 9 groups | 18 groups, run automatically on every push |
| Hosting | — | Publishes to GitHub Pages automatically |

"Every knob on the page now changes the simulation. Nothing is decorative."

**Handoff:** "That's the design. [P2] will now build and break protocols live, so you can
see each of these changes do its job."
