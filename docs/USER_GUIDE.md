# Network Sandbox: How-to Guide

Network Sandbox is a one-page lab: you design a network protocol from building blocks, send
traffic through a simulated network, and measure what your design does.

- **Open it:** <https://shlok1107141.github.io/computernetworks/> (or `npm run dev` locally, then <http://localhost:5173>)
- **Watch first:** [2-minute demo video](https://shlok1107141.github.io/computernetworks/media/network-sandbox-demo.webm)
  building a reliable protocol in the Stack Builder, then breaking it.
- **Press F5 to reset everything.** Nothing is saved between page loads except scenario files you save yourself.

**Defaults after F5:** Reliable preset · seed 42 · run for 8 s · Link State routing · one flow R1 → R6
at 12 packets/s × 40 packets of 512 B · six routers, nine links, every link 10 Mbps, 20 ms (most links),
5 ms jitter, 2% loss, 1% corruption, queue of 8.

---

## Contents

1. [Core concepts](#1-core-concepts)
2. [The page at a glance](#2-the-page-at-a-glance)
3. [Top control bar](#3-top-control-bar)
4. [Stack Builder and the primitive editor](#4-stack-builder-and-the-primitive-editor)
5. [Network panel: topology, replay, packet inspector](#5-network-panel)
6. [Inspector](#6-inspector)
7. [Dashboard and metrics](#7-dashboard-and-metrics)
8. [Fault Timeline and scenarios](#8-fault-timeline-and-scenarios)
9. [A/B Stack Comparison and loss sweep](#9-ab-stack-comparison-and-loss-sweep)
10. [Hands-on exercises](#10-hands-on-exercises)
11. [Tips, troubleshooting and limits](#11-tips-troubleshooting-and-limits)

---

## 1. Core concepts

A protocol here is not code: it is a **stack of layers**, and each layer is a list of **primitives**
(building blocks such as CHECKSUM or ACK). TCP-like behaviour comes from combining blocks, so removing
one shows exactly what it was doing.

- **Discrete-event simulation.** The engine keeps a queue of timestamped events (packet created,
  enters a link, arrives at a router, timer fires) and jumps from one to the next. Eight simulated
  seconds compute in milliseconds. The replay is a playback of that recorded event list, not an animation.
- **Topology.** Routers and links. The number on each link is its routing cost. You can add and remove
  routers and links, and drag routers to rearrange the picture.
- **Flows.** A flow is a stream of packets from one router to another at a fixed rate. You start with one
  (`f1`) and can add more; each has its own colour.
- **Stack order.** Layers are listed top to bottom. A packet being sent goes through them top to bottom;
  a received packet is unwrapped in reverse.
- **Layer scope.** Each layer runs either **end-to-end** (once at the sender and once at the receiver,
  like TCP) or **every hop** (unwrapped, checked and re-wrapped at each router, like IP).
- **Seed.** Loss, corruption and jitter are random but seeded: the same seed and settings always give
  exactly the same run. Change the seed to check a result isn't luck.

**A packet's journey:**

| Where | What happens |
|---|---|
| Sender | End-to-end layers wrap it → WINDOW waits for a free slot → FRAGMENT splits it if over the MTU → DELAY adds processing time → every-hop layers wrap it → retransmit timer starts |
| Each router | Every-hop layers unwrap and check it (it may be dropped here) → route lookup, TTL − 1 → every-hop layers re-wrap it → it waits in the link's queue |
| Receiver | Every-hop layers unwrap → fragments reassembled → end-to-end layers unwrap → CHECKSUM discards damaged packets → SEQUENCE drops copies and restores order → delivered → ACK sent back |

## 2. The page at a glance

| Position | Panel | Use it to |
|---|---|---|
| Top | Control bar | Run, pick the routing algorithm, set seed and run length |
| Row 1, left | Stack Builder | Assemble the protocol you are testing |
| Row 1, middle | Network | Edit the topology, replay the last run, inspect packets |
| Row 1, right | Inspector | Tune whatever you last clicked: a link, layer, flow or router |
| Row 2, left | Dashboard | Read the results of the last run |
| Row 2, right | Fault Timeline & Scenarios | Schedule link failures; save or load a whole setup |
| Bottom | A/B Stack Comparison | Race two stacks on identical traffic; sweep loss |

**The basic loop:** set up a stack, links and flows → click **▶ Run simulation** → read the Dashboard and
replay the packets → change one thing → run again and compare.

## 3. Top control bar

Changes anywhere only take effect when you click **▶ Run simulation** again.

| Control | What it does | Default |
|---|---|---|
| **▶ Run simulation** | Runs the engine once with everything as currently set; refreshes the Dashboard and the replay | — |
| **Distance Vector / Link State** | How routers work out their routes. Both find the same routes on a stable network; they differ after a link fails (section 5) | Link State |
| **DV update every … ms** | Distance Vector only: how often routers exchange tables after a change | 100 ms |
| **split horizon** | Distance Vector only: a router tells a neighbour "unreachable" for routes that go through that neighbour (split horizon with poison reverse), which stops two-router loops | off |
| **seed** | The number behind all randomness | 42 |
| **run for** | Simulated seconds, 1 to 120. Packets not delivered by then count as not delivered | 8 s |
| **Tune flow** | Opens the first flow's settings in the Inspector | — |
| **▶ Watch the 2-min demo / How-to guide** | Open the demo video and this guide | — |

## 4. Stack Builder and the primitive editor

**Presets**

- **Reliable** — Application → Transport (SEQUENCE, CHECKSUM, ACK, RETRANSMIT, WINDOW) → Network
  (every hop: ADD_HEADER, DROP_IF ttl == 0). Fixed 500 ms timeout, window up to 4.
- **TCP-like** — the same blocks with TCP's refinements switched on: adaptive timeout, fast retransmit,
  Reno-style window (slow start + fast recovery), window up to 16.
- **Unreliable** — Application → Network only. No checks, no recovery.
- **+ Custom layer** — adds an end-to-end layer at the bottom with one ADD_HEADER.

On each layer card: the number is its position, the tag shows **end-to-end** or **every hop**, the chips list
its primitives. **↑ / ↓** move the layer, **✕** deletes it, a click opens its editor in the Inspector.

**The editor** (click a layer): primitives are listed in the order they run when sending. Each has
**↑ ↓ ✕**, a one-line description and its settings. Pick a primitive in the dropdown and click **+ Add**.
An orange note means it currently has no effect, and says why (e.g. "inactive: add ACK to the stack").

| Primitive | What it does | Needs / settings | Where you see it |
|---|---|---|---|
| ADD_HEADER | Adds a header; every packet grows by the layer's Header overhead | field = value | Packet size, goodput, packet inspector |
| CHECKSUM | Stamps a checksum of the payload; the receiver discards the packet on a mismatch | — | corrupt, caught |
| SEQUENCE | Numbers packets; the receiver drops duplicates and, with RETRANSMIT, delivers strictly in order | — | duplicates and out of order stay 0 |
| ACK | The receiver sends a 40 B acknowledgement back for each packet it accepts | — | Violet dots; avg RTT becomes a round trip |
| RETRANSMIT | Resends a packet if no ACK arrives in time (up to 6 retries; unlimited with SEQUENCE) | Needs ACK. **timeout**: *fixed* (the layer's Timeout) or *adaptive* (learned from round trips, never below 200 ms, doubling after each timeout). **fast retransmit**: *on* resends as soon as 3 later packets are acknowledged | retransmits (and how many were fast) |
| WINDOW | Limits unacknowledged packets in flight, up to Window size | Needs ACK. **growth**: *AIMD only* (about +1 per round trip, halve on loss); *Tahoe* (slow start, any loss → 1); *Reno* (slow start; a fast retransmit resumes at half the window, a timeout → 1) | Window chart in the Comparison |
| DROP_IF | Drops a packet when `ttl`, `size` or `seq` meets a condition; in an every-hop layer it is checked at every router | field, operator, value | dropped |
| DELAY | Adds processing time; in an every-hop layer, at every router | ms (default 10) | latency |
| FRAGMENT | Splits packets larger than the layer's MTU (8 B header per piece); the receiver rebuilds them; losing one piece loses the packet | MTU | More dots in the replay; delivery under loss |

If two layers carry the same primitive, the topmost one's settings are used. Old saved scenarios may contain
STRIP_HEADER; it has no effect, since headers are removed automatically on receive.

## 5. Network panel

**The graph.** Circles are routers, lines are links, the number on a line is its routing cost.
Click a link to tune it; click a router to see its routing table and edit the topology; drag a router to move it.
A dashed red line is a link that is down.

**Traffic row.** One chip per flow, in its colour. Click a chip to tune that flow; **+ Add flow** adds another.

**Topology row.**
- **+ Router** adds a router (R7, R8, …) in a free spot and selects it. Connect it with **+ Add link** in the Inspector.
- **Reset topology** restores the original six routers and nine links (and clears scheduled faults).

**Replay.**
- **▶ Replay packets** plays the last run back. Data dots take their flow's colour, violet dots are ACKs,
  faded red dots are packets being lost. A link killed by a scheduled fault turns red when it fails.
- **Pause**, the **slider** (jump to any moment) and **Speed** (0.5× / 1× / 3×).
- **In flight / Departed / Arrived / Dropped** count **link crossings**, not packets, ACKs included,
  so they never match the Dashboard.
- **Event log**: the last 7 events at the slider's position.

**Packet inspector.** Click any moving dot, or any event-log line. Playback pauses and a panel shows:
- the packet number, flow and sequence number (or, for an ACK, what it acknowledges), and fragment number if fragmented;
- this hop: from → to, departure and arrival time, size, TTL, and the outcome (arrives intact, damaged on this link,
  or lost and why: link loss or queue full);
- the **header stack, outermost first**, with every header's fields, e.g. `Network proto=ip` →
  `Transport cksum=41517` → `Transport seq=4` → `Application app=demo` → payload;
- the packet's **journey**: one button per hop; click one to see the packet on that hop.

A resent packet is a new packet number with the same sequence number. ACKs have no headers: they are 40-byte
control packets that skip the stack's layers.

**Route line.** The path the routing algorithm picks right now for the selected flow (or the first flow).

**Distance Vector vs Link State after a failure.** Link State routers hear about a failed link almost
instantly (the news floods at link speed). Distance Vector routers exchange tables once per update period and
can briefly loop packets until they agree; **split horizon** removes the two-router loops.

## 6. Inspector

Shows settings for whatever you clicked last. Every setting changes the next run.

**A link**

| Setting | Range | Effect |
|---|---|---|
| Bandwidth | 1–100 Mbps | Time to push a packet onto the link; low bandwidth with a high rate builds a queue |
| Latency | 0–200 ms | Fixed travel time |
| Jitter | 0–50 ms | Random ± variation per packet; enough of it reorders packets |
| Loss | 0–80 % | Chance each crossing is lost |
| Corruption | 0–80 % | Chance each crossing flips a bit in the payload |
| Queue size | 1–64 packets | How many can wait behind the one being sent; the rest are dropped |
| Routing weight | 1–20 | The link's routing cost |
| **Kill / Restore link** | — | Takes the link down for the next runs (it stays in the topology) |
| **Delete link** | — | Removes the link (and faults scheduled on it) |

**A layer:** Name · Runs at (End-to-end / Every hop) · Window size (1–32) · Timeout (100–3000 ms; with an
adaptive timeout only the starting value) · MTU (128–9000 B) · Header overhead (0–60 B) · the primitive editor.
A setting with no effect for this layer shows an orange note.

**A flow** (Tune flow or a traffic chip): from / to · Rate (1–500 packets/s) · Packet count (1–500) ·
Payload (64–4096 B) · **Remove flow** (when there is more than one).

**A router:** its routing table (next hop and cost to every other router). Under Distance Vector, a slider
steps through the exchange rounds that built it. Below: **Edit topology**
- **Connect to [router] + Add link** creates a link (10 Mbps, 20 ms, cost 1, 2% loss, 1% corruption); tune it right away.
- **Delete router** removes it and its links. It is disabled while a flow starts or ends there, or when only two routers remain.

## 7. Dashboard and metrics

One card per flow from the last run, plus **All flows** when there are several.

| Metric | Exactly what it counts |
|---|---|
| **delivery** | delivered ÷ sent |
| **delivered** | Packets the application received intact, each counted once |
| **dropped** | Every lost copy: link loss, queue overflow, no route or dead link, TTL, a DROP_IF rule. With retransmission, delivered + dropped can exceed sent. Lost ACKs are not counted |
| **corrupt, caught** | Damaged packets a CHECKSUM detected and discarded |
| **corrupt, missed** | Damaged packets accepted as fine because no checksum caught them (not counted as delivered) |
| **duplicates** | Extra copies handed to the application (only without SEQUENCE) |
| **out of order** | Packets handed over after a later-numbered one |
| **retransmits** | Resends; "(n fast)" counts fast retransmits |
| **avg RTT** | With ACK: send → ACK back, averaged (resent packets skipped) |
| **avg latency (one-way)** | Shown instead for stacks without ACK: creation → delivery |
| **goodput** | Delivered payload bits per second, in kbps |

The chart shows delivered and dropped per 250 ms (pick All flows or one flow). **Export metrics CSV** downloads
every recorded event (`time, flowId, kind, value, nodeId, linkId`; for `retransmit`, 1 = timeout, 2 = fast).

## 8. Fault Timeline and scenarios

- Pick a link, **kill** or **restore**, a time in ms, then **Add**. At that moment in every later run the link
  changes and routers start re-converging. **✕** removes a fault. Faults also apply to the Comparison.
- **Save scenario** downloads `scenario.json`: topology (routers, positions, links), stack, flows, faults,
  routing settings, seed and run length. **Load scenario** restores it; with the same seed it reproduces the
  same run on any machine.

## 9. A/B Stack Comparison and loss sweep

The comparison holds everything constant except the stack.

- **Current vs baseline** — your stack vs the Unreliable preset.
- **Reliable vs unreliable**, **TCP-like vs reliable** — preset pairs.
- The columns show the Dashboard metrics, all flows combined. The **window chart** plots each stack's
  congestion window (only stacks with ACK + WINDOW have one).
- **Loss sweep 0–30%** runs four stacks (yours, TCP-like, Reliable, Unreliable) at 0, 5 … 30% loss on every
  link with your current settings, and charts their delivery.

Results don't refresh by themselves; click again after changing anything.

## 10. Hands-on exercises

Press **F5** before each one. Expected numbers are what the defaults produce.

### 1. First run and replay
Click **▶ Run simulation**. Expect **100%** (40 delivered), 3 dropped, 1 corrupt caught, **4 retransmits**, avg RTT
about **102 ms**. Replay at **0.5×**: amber data dots go out, violet ACKs come back.

### 2. Reliable vs unreliable
Click **Reliable vs unreliable**: Reliable **100%** (RTT 102 ms) vs Unreliable **93%** (one-way 52 ms).
*Reliability recovers losses but costs a round trip of time.*

### 3. Why CHECKSUM matters
Click link **R3–R4**, set **Corruption 30%**, click **Reliable vs unreliable**: Unreliable **55%** with **15 corrupt,
missed**; Reliable **100%** (19 caught, 28 retransmits). Then click **2. Transport**, **✕** on CHECKSUM,
**Current vs baseline**: your stack falls to **75%** with **10 corrupt, missed**.
*Retransmission only fixes errors something detects.*

### 4. Why SEQUENCE matters
Set **R3–R4 Loss 30%** and run: 100%, **0 duplicates**. Remove SEQUENCE and run again: still 100%, but
**11 duplicates** and **11 out of order**.

### 5. End-to-end vs every hop
Click **3. Network**, set DROP_IF to **ttl < 5**, run: **0%**. Switch **Runs at** to **End-to-end**, run: **100%**.
*Packets start with TTL 8 and lose one per hop; the rule only fires where the layer is checked.*

### 6. Fragmentation
Add **FRAGMENT** to Transport, set **MTU 192 B**, run: 100%, about 3× as many dots. Set **R3–R4 Loss 20%**, run:
**65%**. Without FRAGMENT, the same loss gives **100%**. *Lose one piece, lose the packet.*

### 7. Look inside a packet
Run, scrub the replay to about 0.38 s and click an amber dot (or an event-log line). The inspector shows the header
stack outermost first: `Network proto=ip`, `Transport cksum=…`, `Transport seq=…`, `Application app=demo`, then the
payload, with size **546 B** (512 B payload + headers). Click the journey buttons to follow it hop by hop:
TTL falls 7 → 6 → 5 → 4. Click a violet dot too: an ACK shows what it acknowledges and carries no headers.

### 8. Congestion, and TCP's refinements
Tune flow: Rate **300**, Packet count **300**, Payload **1024**; R3–R4: Bandwidth **1 Mbps**, Queue size **2**.
- **Reliable vs unreliable**: Unreliable **38%** (181 drops), Reliable **55%** (9 drops) with a sawtooth window.
- **TCP-like vs reliable**: TCP-like **86%** vs **55%**; retransmits **33 (13 fast)**.

### 9. Tahoe vs Reno
Same setup as 8. Click **TCP-like preset**, click **2. Transport**, set WINDOW growth to **Tahoe** and click
**Current vs baseline**: about **82%** (10 fast retransmits). Set it back to **Reno**: **86%** (13 fast).
Watch the window chart: after a fast retransmit Tahoe drops to 1, while Reno resumes at half the window.
*Try other seeds: with a buffer this small, Tahoe's harsher back-off sometimes wins. Neither is always better.*

### 10. Distance Vector vs Link State, and split horizon
Click **Unreliable preset**; Tune flow: Rate **50**, Packet count **150**; Fault Timeline: **R3-R4 kill @ 1000 ms**, Add.
- **Link State**: run → **94%**.
- **Distance Vector**: run → **89%**. Replay just after t = 1.0 s: packets bounce R3 → R2 → R3 (20 such hops).
- Tick **split horizon**, run → **92%**, and no packet bounces back to R2.

Click router **R3** and drag the exchange-round slider to watch it learn the network round by round.

### 11. Edit the topology
- Click **+ Router** (R7 appears and is selected). **Connect to R6**, **+ Add link**; select R7 again, **Connect to R1**,
  **+ Add link**. Run: the route becomes **R1 → R7 → R6** (cost 2), 2 hops instead of 4, and RTT drops to about **81 ms**.
- **Reset topology**. Click **R3**, **Delete router**: traffic reroutes **R1 → R2 → R4 → R6** (RTT about 111 ms).
- Try deleting **R1**: it's refused, because flow f1 starts there.

### 12. Several flows and a loss sweep
Click **+ Add flow** (f2, R2 → R5) and run: both flows **100%**, two colours in the replay. Click **Loss sweep 0–30%**:
both reliable stacks stay at **100%** up to 5% loss; from 10% TCP-like falls below Reliable, and from 20% plain
Unreliable beats both within 8 s. *Under heavy random loss TCP mistakes loss for congestion and backs off too hard.*

### 13. Save and reload
Make any change, **Save scenario**, press F5, **Load scenario**, run: identical result.

### 14. Your own protocol (open challenges)
- Build the smallest stack that still delivers 100% at the defaults.
- With R3–R4 Loss 20%, find the Timeout that delivers most in 8 s; then try run for 30 s.
- Put CHECKSUM in the Network layer (every hop). Where is damage caught now? Use the packet inspector to see the header.
- Build a ring of routers with **+ Router** and predict the routes before checking the route line.

## 11. Tips, troubleshooting and limits

**Tips**
- Change one thing at a time and keep the seed fixed; then try two or three other seeds.
- Under heavy loss, raise **run for**: a reliable stack spends time waiting on timeouts.

| Symptom | Likely cause |
|---|---|
| Replay button greyed out | You haven't run since loading the page |
| Delivery 0% | A DROP_IF rule, a killed or deleted link, or a disconnected router is blocking every packet; check the route line |
| Retransmits climb, delivery stalls | The stack waits for a packet that can't arrive (in-order delivery never skips one) |
| A knob changes nothing | Its orange note says why |
| Can't delete a router | A flow starts or ends there; change the flow first |
| Numbers differ from this guide | A setting is still changed; press F5 |

**Limits**
- It models protocol design choices, not byte-exact TCP/IP, and has no physical-layer (radio) model.
- Loss recovery uses selective acknowledgements (a SACK-style "pipe"), so Reno's fast recovery is modelled as
  resuming at half the window, without classic dup-ACK window inflation.
- Distance Vector's split horizon removes two-router loops, not longer ones.
- The checksum is a simple sum: it catches flipped bits, not reordered bytes.
- Nothing persists across reloads except a saved scenario file.
