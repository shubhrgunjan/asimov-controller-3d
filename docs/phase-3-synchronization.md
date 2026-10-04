# Phase 3 State Buffer & Temporal Interpolation

**Component:** `StateBuffer.ts`  
**Location:** `src/synchronization/StateBuffer.ts`  
**Authoritative Source:** VASIMOV MuJoCo Simulation  
**Target Render Cadence:** 60 FPS (~16.67 ms VSync interval)  
**Date:** 2026-10-04  

---

## 1. Architectural Motivation

MuJoCo physics runs authoritatively at 200 Hz, with state updates emitted over the network at ~50 Hz (20 ms interval). The Android Three.js client renders at 60 FPS (16.67 ms interval).

Because 50 Hz and 60 Hz are not harmonic multiples, and Wi-Fi networks inherently introduce packet delivery jitter, attempting to render immediately upon packet arrival causes severe visual stutter, missed VSyncs, and frame tearing.

```text
Incoming Packets @ 50 Hz  ──► [  Jitter Buffer  ]  ──► SLERP & Lerp  ──► Three.js Render @ 60 FPS
(~20ms, variable jitter)       (Rolling 40-60ms window)    (Continuous time)   (Smooth 16.67ms VSync)
```

---

## 2. Pipeline Stages

1. **Packet Arrival**: Raw binary packet received from WebSocket.
2. **Sequence Validation**: Packets with `sequence <= lastSequence` are discarded (prevents visual rewinds and handles network duplicates/reordering).
3. **Discontinuity Detection**: If `timestamp < lastTimestamp - 1.0` (server reset or reconnect), the state buffer flushes cleanly and reinitializes with the new snapshot.
4. **Buffer Storage**: Stored in a sorted temporal ring buffer (capacity: 16 snapshots = ~320 ms).
5. **Render Sampling**: At each 60 FPS render frame, the renderer queries:
   $$t_{\text{render}} = t_{\text{newest}} - \Delta_{\text{delay}}$$
   where $\Delta_{\text{delay}} = 40\text{ ms}$ (2 packet intervals).
6. **Interpolation**:
   - Locates bracket snapshots $S_0 (t_0)$ and $S_1 (t_1)$ such that $t_0 \le t_{\text{render}} \le t_1$.
   - Computes fractional blend factor $\alpha = \frac{t_{\text{render}} - t_0}{t_1 - t_0} \in [0, 1]$.
   - Base Position: $\vec{p}(\alpha) = (1 - \alpha)\vec{p}_0 + \alpha\vec{p}_1$.
   - Base Orientation: Spherical Linear Interpolation ($\text{SLERP}(q_0, q_1, \alpha)$) on unit quaternions with shortest-arc handling.
   - 25 Joint Angles: Component-wise linear interpolation across the 25 `Float32Array` values.
   - Velocities: Linear interpolation.
7. **Jitter & Loss Mitigation**:
   - Small packet drop (e.g. 1 frame dropped): Buffer continues interpolating across the wider gap between available snapshots without visual freeze.
   - Sustained packet delay ($t_{\text{render}} > t_{\text{newest}}$): Buffer holds the latest authoritative pose; extrapolation is strictly capped at 100 ms to prevent physics divergence.

---

## 3. Quaternion SLERP Implementation

Orientation interpolation uses exact quaternion spherical linear interpolation:
$$\cos \theta = q_0 \cdot q_1$$
1. If $\cos \theta < 0$, invert $q_1 = -q_1$ and $\cos \theta = -\cos \theta$ to traverse the acute spherical arc.
2. If $\cos \theta > 0.9995$ (nearly parallel orientations), fall back to Normalized Linear Interpolation (NLERP) to avoid numerical division by zero.
3. Otherwise:
   $$\theta = \arccos(\cos \theta)$$
   $$q(\alpha) = \frac{\sin((1 - \alpha)\theta)}{\sin \theta} q_0 + \frac{\sin(\alpha \theta)}{\sin \theta} q_1$$
   $$q_{\text{final}} = \frac{q(\alpha)}{\|q(\alpha)\|}$$
