# Person 2 — Live Demo (~7 min)

**Running order:** P1 explained the design → **you show each change working** → P3 explains
what the results mean and what's next.

## Ground rules

- **Press F5 before every demo.** It resets everything to defaults: Reliable preset,
  seed 42, run for 8 s, Link State, R1 → R6 at 12 packets/s × 40 packets.
- The numbers below are what you'll get at those defaults. If they differ, someone
  changed a setting; press F5.
- "Run" means the **▶ Run simulation** button; results appear in the **Dashboard**.
- The **A/B Stack Comparison** buttons are at the bottom of the page. **Reliable vs
  unreliable** compares the two presets; **Current vs baseline** compares the stack you
  built against the unreliable preset.

---

## Demo 1: A tour of the stack (1 min) — *protocol = building blocks*

1. Click **2. Transport**. The Inspector shows its 5 primitives, each with a one-line
   description, ↑ ↓ ✕ controls, and a **+ Add** menu.
   > "This is the protocol editor. TCP-like behaviour is just these five blocks."
2. Click **3. Network**. Point at **Runs at: Every hop**.
   > "Network is checked at every router, like IP. Transport only at the ends, like TCP."
3. Click router **R3** in the graph. It shows a routing table (next hop and cost to every
   router).

## Demo 2: Watch it run (45 s) — *real events, real ACKs*

1. **Run**, then **▶ Replay packets** at **0.5×**.
2. Amber dots are data, **violet dots are ACKs** coming back, red are losses. The counters
   and event log read straight from the engine's event list.

## Demo 3: The headline result (45 s) — *reliability works*

1. Click **Reliable vs unreliable**.
2. Expect **Reliable 100% (40/40), 4 retransmits** vs **Unreliable 93% (37/40)**.
   > "The 3 packets unreliable lost, reliable resent. Note the RTT: 102 ms vs 52 ms.
   > Reliable waits for the ACK to come back, so it measures a real round trip."

## Demo 4: Why CHECKSUM matters (1.5 min)

1. F5. Click the **R3–R4** link → **Corruption 30%**.
2. **Reliable vs unreliable** → Unreliable **55%** with **15 "corrupt, missed"**.
   Reliable **100%**: **19 caught**, **28 retransmits**.
   > "Unreliable passed damaged data to the application without noticing. Reliable caught
   > every damaged packet and resent it."
3. Click **2. Transport** → **✕** on **CHECKSUM** → **Current vs baseline**. The current
   stack drops to **75%** with **10 corrupt, missed**.
   > "Retransmit is still there, but it can't fix errors nobody detects. Each block has a
   > job; remove one and you see the gap."

## Demo 5: End-to-end vs every hop (1 min)

1. F5. Click **3. Network**. In **DROP_IF**, change it to **ttl < 5**. **Run** →
   **0% delivered**.
   > "Packets start with TTL 8 and lose one per hop. At the 4th router TTL is 4, so the
   > rule fires there."
2. Switch **Runs at** to **End-to-end**. **Run** → **100%**.
   > "Same rule, but now it's only checked at the sender, where TTL is still 8. Where a
   > layer runs changes what it does."

## Demo 6: Fragmentation (1 min)

1. F5. Click **2. Transport** → in the add menu pick **FRAGMENT** → **+ Add**. Set **MTU**
   to **192 B** (the slider moves in 64 B steps). **Run** → still 100%. Replay it: about
   3× as many dots (each 512-byte packet now travels as 3 fragments).
2. Click **R3–R4** → **Loss 20%** → **Run** → delivery drops to **65%**.
   > "Lose any one fragment and the whole packet is lost."
3. Compare: F5, set R3–R4 **Loss 20%** only, **Run** → **100%** without fragmentation.

## Demo 7: Congestion (1 min) — *why the window exists*

1. F5. Click **Tune flow** → **Rate 300**, **Packet count 300**, **Payload 1024**.
2. Click **R3–R4** → **Bandwidth 1 Mbps**, **Queue size 2**.
3. **Reliable vs unreliable**:
   - Unreliable floods the link: **181 drops**, 38%.
   - Reliable: **9 drops**, 55%, and a sawtooth in the window chart.
   > "The window backs off when the link overflows. That's congestion control in
   > action."

## Demo 8: Failure and reproducibility (30 s)

1. F5. In **Fault Timeline**: link **R3-R4**, **kill**, **@ 1000 ms**, **Add**. **Run** →
   still 100%. Replay: before t = 1.0 s packets go R2 → R3 → R4; after it they switch to
   R2 → R4 → R6.
2. Click **Save scenario**.
   > "This file plus the seed reproduces this exact run on any machine, including the
   > hosted site."

**Handoff:** "So every block does a real job. [P3] will show how we know these numbers are
right, what they taught us, and what's next."
