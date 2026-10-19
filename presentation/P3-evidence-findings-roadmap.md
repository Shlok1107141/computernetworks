# Person 3 — Evidence, Findings, and What's Next (~4 min)

**Running order:** P1 explained the design → P2 showed it live → **you prove it's right,
explain what the results mean, and close.**

---

## 1. How we know the numbers are right (1 min)

"A simulator is only useful if you can trust it, so the engine is tested on its own,
without the UI."

- `npm test` runs **23 groups of checks** and **runs automatically on every push to
  GitHub**. If any check fails, the site isn't published.
- What they prove:
  - **Basics:** checksums are deterministic, Distance Vector and Link State agree on every
    shortest path, a killed link reroutes, a clean network delivers 100%.
  - **Reproducibility:** the same seed gives identical results.
  - **Reliability:** reliable beats unreliable by 10+ points; retransmit recovers 100% at
    15% loss per link; ACKs make RTT a true round trip (~2× one-way).
  - **Window:** window 2 never has more than 2 unACKed packets in flight; the Window and
    Timeout knobs change outcomes.
  - **Checksum:** without it, damage slips through; with it, damage is caught.
  - **Sequence:** without it, the application gets duplicates and out-of-order data; with
    it, one in-order copy of each.
  - **Fragmentation:** each 512 B packet becomes 3 fragments at MTU 200, they reassemble,
    and fragmentation lowers delivery under loss.
  - **Where layers run:** an every-hop rule fires at the 4th router; the same rule
    end-to-end doesn't.
  - **Delay:** adds ~20 ms once end-to-end, ~80 ms over 4 hops.
  - **Queues:** slow links overflow small queues; queueing shows up as latency.
  - **Routing after a failure:** Distance Vector passes through an R2 ⇄ R3 loop and loses
    packets that Link State doesn't.
  - **TCP refinements:** an adaptive timeout beats a fixed 3-second one (100% vs 30%); fast
    retransmit replaces timeouts; TCP-like wins under congestion and loses under heavy
    random loss.

## 2. What the simulator taught us (2 min)

These are the trade-offs, and they're the interesting part.

1. **Reliability costs time.** RTT goes from 52 ms to 102 ms, because the sender has to
   wait for the ACK to come back.
2. **Retransmission can't fix errors nobody detects.** Without CHECKSUM, the reliable stack
   fell to 75% under corruption: damaged packets were accepted and ACKed, so they were
   never resent. Detection and recovery are separate jobs.
3. **End-to-end vs every hop.** An every-hop checksum catches damage at the next router,
   early. But only an end-to-end check guarantees the receiver got the right data. This is
   the classic *end-to-end argument* in networking, and you can switch between the two and
   watch the difference.
4. **Fragmentation multiplies loss.** At 20% loss on one link, splitting each packet into 3
   fragments dropped delivery from 100% to 65%. Lose one piece, lose the packet. That's why
   real networks try to avoid it.
5. **Congestion control trades delivery for fewer drops, and TCP's refinements pay off
   here.** Flooding a slow link: unreliable lost 181 packets; the windowed reliable stack
   lost 9 by slowing down; the TCP-like stack delivered 86% vs 55%.
6. **But TCP mistakes random loss for congestion.** At 20% loss on every link the TCP-like
   stack collapses: every loss doubles its timeout and shrinks its window. That's the
   classic "TCP over lossy wireless links" problem, reproduced here.
7. **Distance Vector pays for not knowing the whole map.** After R3–R4 fails, Link State
   routers hear about it almost instantly. Distance Vector routers trade stale tables for
   a few rounds, packets bounce between R2 and R3, and delivery drops from 94% to 89%.
   Switching on **split horizon** stops the bounce entirely and recovers most of the gap (92%).
8. **Tahoe vs Reno isn't a clean win.** Under congestion with a 2-packet buffer, Reno (fast
   recovery) delivers 86% vs Tahoe's 82% at seed 42, but on other seeds Tahoe's harsher
   back-off wins. The test suite checks the mechanism, not a winner.

## 3. Honest limits (30 s)

- It models *design choices*; it is not a byte-accurate copy of real TCP/IP.
- Loss recovery uses selective ACKs (a SACK-style pipe), so Reno's classic dup-ACK window
  inflation isn't modelled separately.
- Split horizon stops two-router loops only; longer loops would need route poisoning or hold-down timers.
- The checksum is a simple additive sum: it catches flipped bits, not reordered bytes.

## 4. What's next (30 s)

1. **Fairness:** Jain's fairness index for competing flows.
2. **Longer-loop protection** for Distance Vector: route poisoning and hold-down timers.
3. **A CRC checksum option**, to compare error-detection strength.
4. **Shareable scenario gallery:** the Review 1 "template library", online.

## 5. Close (15 s)

"It's a static site that publishes from GitHub on every push, so anyone can open the link,
load our saved scenario, use the same seed, and get our exact numbers."
