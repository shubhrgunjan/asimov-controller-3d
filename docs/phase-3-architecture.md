# Phase 3 Architecture Audit: Real-Time Teleoperation, State Synchronization & Local 3D Control

**Project:** Asimov Controller 3D (`asimov-controller-3d`)  
**Backend:** VASIMOV MuJoCo Simulation (`vasimov`)  
**Target Device:** Samsung Galaxy M14 5G (`SM-M146B/DS`, Exynos 1330 / Mali-G68 MP2, Android 14)  
**Date:** 2026-10-04  
**Status:** ARCHITECTURE AUDIT COMPLETE (Milestone P3.0)

---

## 1. Executive Summary

Phase 3 transitions `asimov-controller-3d` from a validated visual/kinematic rendering prototype into an authoritative, real-time Android teleoperation, visualization, and diagnostic client for the VASIMOV MuJoCo humanoid simulation.

The non-negotiable architectural requirement is:
**MuJoCo is the single source of truth.** The Android application executes zero robot physics and zero locomotion policy inference. High-frequency state streaming runs over an optimized binary protocol into an independent temporal state buffer, driving local Three.js joint transformations at 60 FPS without render-loop blocking or fake metrics.

```text
                   VASIMOV Backend (Server)
                              │
                    MuJoCo Physics @ 200 Hz
                              │
                     Menlo Policy @ 50 Hz
                              │
                    Authoritative State (50 Hz)
                              │
                    State Transport (WebSocket)
                              │
                 ┌────────────┴────────────┐
                 │                         │
     Binary State Stream (50 Hz)    Control Dispatch
                 │                         ▲
                 ▼                         │
          StateTransportClient     Touch Teleoperation
                 │                   (Joysticks/Buttons)
                 ▼                         │
            StateBuffer                    │
       (Sequence/Jitter/SLERP)             │
                 │                         │
                 ▼                         │
          Interpolated Pose                │
                 │                         │
                 ▼                         │
         AsimovRobotModel                  │
       (25 Joint Transforms)               │
                 │                         │
                 ▼                         │
          ThreeRenderer                    │
             (60 FPS)                      │
                 │                         │
                 ▼                         │
       Samsung Galaxy M14 5G ──────────────┘
```

---

## 2. Component Inventory & Audit

### 2.1 Existing Components in VASIMOV (`/home/shubhr/Shubhr/Projects/vasimov`)

| Component | Path | Status | Verification & Function |
| :--- | :--- | :--- | :--- |
| **MuJoCo Robot Model** | `model/asimov_1_vasimov.xml` | `VERIFIED` | 25 actuated joints, 84 sensors, pelvis 6-DoF base, mesh definitions. |
| **Joint Kinematic Adapter** | `adapter.py` | `VERIFIED` | 25 `FIRMWARE_JOINTS` <-> 25 `SIM_JOINTS`. Verified differential ankle kinematics ($K_{\text{pitch}}=2.02, K_{\text{roll}}=0.8$). |
| **Physics Simulation Loop** | `edge/sim.py` | `VERIFIED` | Steps at 200 Hz ($dt=0.005$s) with wall-clock pacing. Motor model PD update per step. |
| **Edge State Machine** | `edge/core.py` | `VERIFIED` | Operating modes: `DAMP`, `STAND`, `MOVE` (locomotion policy), `FAULT_DAMP`. |
| **Policy Engine** | `edge/policy.py`, `policies/` | `VERIFIED` | Official Menlo locomotion policy ONNX (78 observations $\to$ 23 actions $\to$ PD actuator targets). |
| **Recovery System** | `edge/sim.py`, `edge/core.py` | `VERIFIED` | Tilt > 60° trips fall fault $\to$ `safefall` compliant damping $\to$ `getup` recovery $\to$ `STAND` arming. |
| **Web Gateway & WS** | `web/server/gateway.py` | `OPERATIONAL` | HTTP on port `8852`, WebSocket on port `8854`. Currently broadcasts JSON `TelemetryFrame` at ~25 Hz. |
| **Control Handler** | `web/server/control_handler.py` | `VERIFIED` | Validated command lifecycle: `stand`, `walk` ($v_x, v_y, w_z$), `stop`, `damp`, `safefall`, `getup`, `reset`. |
| **Canonical Frame** | `web/server/canonical_frame.py` | `OPERATIONAL` | Builds comprehensive JSON telemetry frame (~15–20 KB per frame). |
| **Sim Console** | `tools/sim_console.py` | `VERIFIED` | Interactive launcher supporting `--web` and multi-mode operation. |

### 2.2 Existing Components in Android Client (`/home/shubhr/Shubhr/Projects/asimov-controller-3d`)

| Component | Path | Status | Verification & Function |
| :--- | :--- | :--- | :--- |
| **Asimov 1 GLB Asset** | `assets/asimov_1.glb`, `src/model/asimov_1_model_data.ts` | `VERIFIED` | Validated mobile-optimized asset (113,436 triangles, 26 links, 25 revolute joints). |
| **Joint Hierarchy & Limits** | `src/model/AsimovJointHierarchy.ts` | `VERIFIED` | Exact 25-joint definitions, axis directions, ranges, default quaternions, parent-child links. |
| **Robot Model Manager** | `src/model/AsimovRobotModel.ts` | `VERIFIED` | Three.js group loading, axis-angle rotation, hardware limit clamping, MuJoCo $\to$ Three.js coordinate mapping. |
| **Three.js Renderer** | `src/renderer/ThreeRenderer.ts` | `VERIFIED` | Decoupled render loop, presentation timing instrumentation, VSync monitoring. |
| **Scene & Camera Manager** | `src/renderer/SceneManager.ts` | `VERIFIED` | Cameras: `third_person`, `first_person`, `front_inspection`, `orbit`. PBR lighting & shadows. |
| **Performance Monitor** | `src/benchmark/PerformanceMonitor.ts` | `VERIFIED` | Separated domains: Presentation Performance (VSync interval, FPS, jank) vs CPU Prep Time. |
| **Test Suites** | `tests/*.test.ts` | `VERIFIED` | Model validation, benchmark suites, matrix runners (all passing). |

---

## 3. Gap Analysis: What Must Be Built, Reused, or Replaced

### 3.1 What Can Be Reused Without Modification
1. **Robot Visual Asset (`assets/asimov_1.glb`)**: Fully preserved. No GLB modifications in Phase 3.
2. **Kinematic Hierarchy (`AsimovJointHierarchy.ts`)**: 25 joint definitions, rotation axes, and ranges directly map to VASIMOV's `SIM_JOINTS`.
3. **Three.js Presentation Pipeline (`ThreeRenderer.ts`, `SceneManager.ts`)**: Proven stable 60 FPS presentation on Samsung Galaxy M14 5G.
4. **VASIMOV Control Lifecycle (`control_handler.py`)**: Proven lifecycle: `USER INPUT -> PARSED -> VALIDATED -> ACCEPTED/REJECTED -> APPLIED -> SIMULATOR RESULT`.
5. **VASIMOV Locomotion Policy & Recovery**: Official Menlo locomotion policy + OpenHorizon Safe-Fall/Get-Up recovery chain.

### 3.2 What Is Incomplete (Must Be Built)
1. **P3.1 State Protocol (`src/protocol/AsimovStateProtocol.ts` & `vasimov/web/server/binary_protocol.py`)**:
   - Fixed-size binary protocol (`VAS1`, ~256 bytes) transmitting sequence number, timestamp, state machine modes, base 6-DoF pose, linear/angular velocities, 25 joint positions, 25 joint velocities, and command echoes.
2. **P3.2 Backend State Transport (`vasimov/web/server/gateway.py`)**:
   - Stream binary state packets continuously at 50 Hz to connected WebSocket clients without blocking the 200 Hz MuJoCo physics loop.
3. **P3.3 Android Network Client (`src/networking/StateTransportClient.ts`)**:
   - Low-latency WebSocket client with auto-reconnect, packet validation, sequence tracking, and RTT measurement.
4. **P3.4 State Buffer + Interpolation (`src/synchronization/StateBuffer.ts`)**:
   - Client-side temporal state buffer (depth 2–4 frames @ 50 Hz) with Hermite/linear position interpolation and quaternion SLERP, preventing visual jitter and state tearing.
5. **P3.5 Live Robot Synchronization (`src/robot/LiveRobotSync.ts`)**:
   - Feed interpolated snapshots directly into `AsimovRobotModel` root position/quaternion and 25 joint angles on each 60 FPS render tick.
6. **P3.6 Teleoperation Controls (`src/controls/TeleopControls.tsx`)**:
   - Dual virtual on-screen joysticks (Left: $v_x, v_y$; Right: $w_z$) and action buttons (`WALK`, `STAND`, `CROUCH`, `RECOVERY`, `RESET`, `E-STOP`) with newest-command priority.
7. **P3.7 Camera System Integration**:
   - Camera switching between `third_person`, `first_person`, `front_inspection`, and `orbit` anchored to the live simulated robot pelvis/head.
8. **P3.8 Diagnostics HUD (`src/diagnostics/DiagnosticsHUD.tsx`)**:
   - Low-frequency developer HUD overlay showing real connection stats (RTT, packet rate, loss), simulation stats (sim Hz, policy Hz, mode), render metrics (presentation FPS, intervals, jank), and synchronization metrics (state age, buffer depth).
9. **P3.9 Failure & Safety Handling**:
   - Clean handling of network drops, packet loss recovery without rewinds, clean state reinitialization on reconnect, and backend watchdog E-stop integration.

### 3.3 What Must Be Replaced
- **High-Frequency JSON Streaming**: The legacy controller parsed ~20 KB JSON strings in React component state at 25 Hz. This caused heavy JS garbage collection, frame drops, and thread starvation. **Replaced by:** Compact 256-byte binary ArrayBuffer parsed outside React state in a dedicated non-React data structure.
- **Render Coupled to Network Arrival**: The pattern `packet arrives -> render frame` is strictly prohibited. **Replaced by:** Network packets enter `StateBuffer`; independent 60 FPS Three.js render loop samples interpolated state at presentation intervals.

### 3.4 What Must Not Be Duplicated
- **No Client Physics**: The Android client must not calculate forward/inverse dynamics, ground reaction forces, balance control, or foot collision resolution.
- **No Client Policy Inference**: Locomotion policy inference runs strictly on the VASIMOV server. Android sends only high-level velocity vectors ($v_x, v_y, \omega_z$).
- **No Parallel Joint Enumerations**: Joint ordering in the binary packet follows the canonical `SIM_JOINTS` tuple (indices 0..24) identical to `adapter.py` and `AsimovJointHierarchy.ts`.

---

## 4. Architectural Conflicts & Resolution

| Identified Conflict | Root Cause | Engineering Resolution |
| :--- | :--- | :--- |
| **Coordinate System Discrepancy** | MuJoCo is $+X$ forward, $+Y$ left, $+Z$ up (Z-up). Three.js is $+X$ right, $+Y$ up, $-Z$ forward (Y-up). | `AsimovRobotModel` already has its model container oriented $(-90^\circ, 0, 90^\circ)$. Base translation converts: $X_{\text{Three}} = -Y_{\text{MuJoCo}}$, $Y_{\text{Three}} = Z_{\text{MuJoCo}}$, $Z_{\text{Three}} = -X_{\text{MuJoCo}}$. Quaternions are rotated into Three.js basis via frame change conjugation: $q_{\text{Three}} = q_{\text{coord}} \cdot q_{\text{MuJoCo}} \cdot q_{\text{coord}}^{-1}$. |
| **Cadence Discrepancy (50 Hz vs 60 Hz)** | Backend state broadcast is ~50 Hz (20 ms interval); Android display renders at 60 Hz (16.67 ms interval). | `StateBuffer` maintains a rolling temporal window ($t_{\text{render}} = t_{\text{current}} - \Delta_{\text{interp}}$). Render loop evaluates state at exact fractional timestamps using SLERP for quaternions and linear interpolation for joint angles, ensuring continuous smooth motion without stepping artifacts. |
| **Packet Jitter & Network Bursts** | Mobile Wi-Fi introduces variable packet delivery delay (jitter). | State buffer maintains a shallow 40–60 ms buffer depth (2–3 packets). If packets bunch up, buffer absorbs jitter; if a packet drops, buffer interpolates to the next snapshot or holds velocity extrapolate up to a conservative safety threshold (100 ms). |
| **React State Overhead** | React re-renders for 50 Hz state packets cause extreme JS thread jank. | Decoupled runtime architecture: Networking and `StateBuffer` store state in a typed `Float32Array`. Render loop reads directly from buffer. React UI subscribes only to a throttled diagnostics emitter (2–4 Hz). |

---

## 5. Milestone Execution Roadmap

| Milestone | Target Deliverables | Verification Strategy |
| :--- | :--- | :--- |
| **P3.0** | Architecture Audit & Gap Analysis Document. | Comprehensive audit approved. |
| **P3.1** | Versioned binary state protocol (`VAS1`, 256 bytes) in Python & TypeScript. | Unit tests for serialization, deserialization, sequence validation, malformed packets. |
| **P3.2** | VASIMOV backend binary state streaming @ 50 Hz without blocking physics. | WebSocket streaming test measuring steady 50 Hz packet delivery and zero physics loop degradation. |
| **P3.3** | Android network client (`StateTransportClient.ts`) with reconnect and RTT tracking. | Network client tests with simulated latency, disconnects, reconnects. |
| **P3.4** | Client state buffer (`StateBuffer.ts`) with sequence sorting & SLERP interpolation. | Synthetic jitter, packet loss, out-of-order, and timestamp discontinuity test suite. |
| **P3.5** | Live Asimov robot synchronization in Three.js for all 25 joints and 6-DoF base. | Pose verification tests (neutral, crouch, walking, recovery) matching MuJoCo ground truth. |
| **P3.6** | Dual joystick touch teleoperation + state machine buttons (`STAND`, `WALK`, `ESTOP`). | Measured touch-to-command serialization latency and newest-command priority tests. |
| **P3.7** | Local 4-preset camera system (Third-person, FPV, Front inspection, Orbit). | Camera switching verification without render hitching or transform divergence. |
| **P3.8** | Diagnostics HUD with empirical connection, simulation, sync, and render metrics. | Verified zero fake metrics; diagnostics overhead < 0.1 ms JS prep time. |
| **P3.9** | Failure and safety handling (connection loss, packet loss recovery, E-stop). | Robustness tests simulating abrupt server crash, packet burst drops, and reconnect. |
| **P3.10** | Full-system validation on physical Samsung Galaxy M14 5G hardware. | 10–15 min sustained run measuring 60 FPS presentation, RTT, thermals, and memory. |

---

## 6. Definition of Done for Phase 3

Phase 3 is complete only when:
1. Android client connects reliably over LAN Wi-Fi to VASIMOV on port 8854.
2. Simulated robot pose (6-DoF base + 25 joints) updates live on the phone at 60 FPS.
3. Touch controls command velocity and state transitions entering the official locomotion/recovery policies.
4. Camera presets switch seamlessly without interrupting rendering.
5. Real diagnostics display empirical presentation FPS, VSync intervals, RTT, and packet loss.
6. The system survives network jitter, packet drops, and reconnects safely.
7. Physical device validation on Samsung Galaxy M14 5G confirms 60 FPS with no thermal collapse.
