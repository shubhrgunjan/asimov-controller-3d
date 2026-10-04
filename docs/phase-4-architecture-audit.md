# ASIMOV CONTROLLER 3D
## PHASE 4 ARCHITECTURE AUDIT & OPERATOR APPLICATION ROADMAP

**Project:** `asimov-controller-3d` (Android Client) & `vasimov` (Authoritative Physics Backend)  
**Target Hardware:** Samsung Galaxy M14 5G (`SM-M146B/DS`, Exynos 1330 / Mali-G68 MP2, Android 14)  
**Milestone:** P4.0 Architecture Audit  
**Date:** October 2026  
**Status:** COMPLETE & AUTHORITATIVE  

---

## 1. Executive Summary & Phase 4 Mission

Phase 3 successfully delivered the authoritative real-time foundation:
- Backend-authoritative MuJoCo physics (200 Hz) with official Menlo locomotion policy (50 Hz).
- High-frequency 50 Hz Little-Endian binary state streaming (`VAS1`, 288 bytes).
- 25 Hz high-level control command dispatch (`VAC1`, 32 bytes).
- Zero-physics Android client with temporal jitter buffer (`StateBuffer`, 40 ms window).
- Acute shortest-arc quaternion SLERP and 25-joint linear interpolation.
- Decoupled Three.js 60 Hz VSync-driven frame callback loop with sub-millisecond JS execution (0.23–0.51 ms).
- Physical validation on Samsung Galaxy M14 5G hardware.

**Phase 4 Mission:**  
Phase 4 is **NOT a rewrite of Phase 3**.  
Phase 4 transforms the existing engineering prototype into a **production-grade, reliable, operator-facing Android application**. The interface must transition from a developer benchmark/debugging tool into a polished, game-like teleoperation client that an operator can use for extended operational sessions without UI lag, memory leaks, synchronization jitter, or cognitive overload.

---

## 2. Inventory of Validated Phase 3 Assets

The following components were built, verified, and validated in Phase 3 and will be **strictly preserved and reused**:

| Component | Source File | Status in Phase 3 | Phase 4 Reuse Strategy |
| :--- | :--- | :---: | :--- |
| **State & Command Protocol** | [`src/protocol/AsimovStateProtocol.ts`](file:///home/shubhr/Shubhr/Projects/asimov-controller-3d/src/protocol/AsimovStateProtocol.ts)<br>[`vasimov/.../binary_protocol.py`](file:///home/shubhr/Shubhr/Projects/vasimov/web/server/binary_protocol.py) | **VERIFIED** (100% test pass) | **Keep untouched.** Fixed 288-byte `VAS1` state packet and 32-byte `VAC1` command packet with Little-Endian packing. |
| **Binary Network Transport** | [`src/networking/StateTransportClient.ts`](file:///home/shubhr/Shubhr/Projects/asimov-controller-3d/src/networking/StateTransportClient.ts) | **VERIFIED** (7/7 tests pass) | **Reuse as core transport.** Encapsulates WebSocket, monotonic sequence tracking, RTT calculation, and auto-reconnect. |
| **State Buffer & Interpolator**| [`src/synchronization/StateBuffer.ts`](file:///home/shubhr/Shubhr/Projects/asimov-controller-3d/src/synchronization/StateBuffer.ts) | **VERIFIED** (6/6 tests pass) | **Reuse as core sync buffer.** Ring buffer of 16 snapshots with acute SLERP and 25-joint lerp. Add parameter tuning (20/30/40ms/adaptive). |
| **Robot Kinematics & Model** | [`src/model/AsimovRobotModel.ts`](file:///home/shubhr/Shubhr/Projects/asimov-controller-3d/src/model/AsimovRobotModel.ts)<br>[`src/model/AsimovJointHierarchy.ts`](file:///home/shubhr/Shubhr/Projects/asimov-controller-3d/src/model/AsimovJointHierarchy.ts) | **VERIFIED** (7/7 tests pass) | **Keep untouched.** Coordinate mapping (MuJoCo Z-up $\to$ Three.js Y-up), 25 revolute joint bounds, zero-allocation scratch vectors. |
| **Authoritative Visual Model**| [`assets/asimov_1.glb`](file:///home/shubhr/Shubhr/Projects/asimov-controller-3d/assets/asimov_1.glb) | **VALIDATED** (113,436 tris, 26 links) | **Strictly preserved.** Never modify, re-export, or decimate the validated GLB asset. |
| **Hardware EGL Renderer** | [`src/renderer/ThreeRenderer.ts`](file:///home/shubhr/Shubhr/Projects/asimov-controller-3d/src/renderer/ThreeRenderer.ts) | **VERIFIED** (60 FPS on Galaxy M14) | **Reuse directly.** OpenGL ES 3.2 via `expo-gl`, `gl.endFrameEXP()`, ACESFilmic tone mapping, PCFSoft shadows. |
| **Scene & Camera Rig** | [`src/renderer/SceneManager.ts`](file:///home/shubhr/Shubhr/Projects/asimov-controller-3d/src/renderer/SceneManager.ts) | **VERIFIED** (4 camera presets) | **Reuse camera system.** `third_person`, `first_person`, `front_inspection`, `orbit` with smooth spherical target tracking. |
| **Teleoperation Controller** | [`src/controls/TeleopController.ts`](file:///home/shubhr/Shubhr/Projects/asimov-controller-3d/src/controls/TeleopController.ts) | **VERIFIED** (25 Hz dispatch) | **Reuse control logic.** Deadzone mapping, asymmetric velocity limits ($+0.8 / -0.4$ m/s), newest-command priority. |
| **Touch Virtual Joystick** | [`src/controls/VirtualJoystick.tsx`](file:///home/shubhr/Shubhr/Projects/asimov-controller-3d/src/controls/VirtualJoystick.tsx) | **VERIFIED** (PanResponder) | **Reuse joystick component.** Zero allocation touch mapping with spring-return center. |
| **Diagnostics Telemetry** | [`src/diagnostics/DiagnosticsCollector.ts`](file:///home/shubhr/Shubhr/Projects/asimov-controller-3d/src/diagnostics/DiagnosticsCollector.ts) | **VERIFIED** (Zero fake telemetry) | **Preserve for developer overlay.** 4 domains (Connection, Sim, Render, Sync) polled at 3 Hz. |

---

## 3. Gap Analysis: What the Operator Application Is Missing

While Phase 3 proved technical feasibility, the user experience remains that of an engineering benchmark tool. The table below outlines the specific operational gaps:

| Feature Area | Current Phase 3 Implementation | Required Phase 4 Production State | Severity |
| :--- | :--- | :--- | :---: |
| **Application Navigation** | Boots directly into `GLView` and immediately connects to a hardcoded IP address. Top bar has a `LIVE TELEOP \| BENCHMARK` tab. | Structured application state machine: `BOOT -> HOME -> CONNECTING -> CONNECTED -> TELEOP`. Benchmark suite is sequestered into a developer menu. | **CRITICAL** |
| **Home / Landing Screen** | None. App immediately launches full 3D rendering context. | Dedicated Operator Home Screen with connection status card, server endpoint selection, target profiles (Local, Lab, WAN), and quick connect button. | **CRITICAL** |
| **Connection Configuration**| IP and port are configured in a crude modal inside the teleop overlay; resets on app reload. | Persistent settings manager (`SettingsManager`) saving endpoint, profiles, auto-reconnect, and default camera preferences. | **HIGH** |
| **Operator Status Layer** | Raw engineering numbers (p95 latency, buffer depth, triangle counts) in developer HUD overlay. | Clean, high-contrast operator status bar: Robot Model, Mode (`MOVE`/`STAND`), Policy (`MENLO`), Recovery (`NORMAL`/`GETUP`), Safety (`OK`/`FAULT`), and Connection indicator. | **HIGH** |
| **Remote Robot Camera** | Not integrated in client (backend has MJPEG `/api/camera/stream` and `/api/camera/frame`). | Optional secondary observation feed: PiP / Split / Camera-only mode showing remote MuJoCo camera without blocking 3D rendering. | **MEDIUM** |
| **Synchronization Tuning** | Hardcoded 40 ms interpolation delay in `StateBuffer`. | Configurable / experimental synchronization modes: 20 ms, 30 ms, 40 ms, and adaptive jitter tracking. | **MEDIUM** |
| **Failure & Reconnect UX** | Text turns yellow/red in small pill; no visual recovery overlay on connection loss. | Clear full-screen / contextual failure card: "CONNECTION LOST — Robot Hold Active — [RECONNECT]". | **HIGH** |
| **Settings Screen** | Rudimentary inline host/port prompt. | Dedicated Settings Page with operational settings (Rendering quality, Jitter window, Reconnect policy) and Developer toggle. | **MEDIUM** |

---

## 4. File-by-File Classification

### 4.1 Production-Ready (To Be Preserved Untouched or Extended Surgically)
1. `src/protocol/AsimovStateProtocol.ts`: Core binary protocol definitions. **Status: 100% Production Ready.**
2. `src/model/AsimovRobotModel.ts`: Three.js robot hierarchy and authoritative pose applicator. **Status: 100% Production Ready.**
3. `src/model/AsimovJointHierarchy.ts`: 25-joint definitions and hardware limits. **Status: 100% Production Ready.**
4. `src/model/asimov_1_model_data.ts`: Mesh names and canonical ordering. **Status: 100% Production Ready.**
5. `src/renderer/ThreeRenderer.ts`: Hardware OpenGL ES 3.2 rendering surface. **Status: 100% Production Ready.**
6. `src/renderer/SceneManager.ts`: Lighting, floor grid, camera tracking presets. **Status: 100% Production Ready.**
7. `src/networking/StateTransportClient.ts`: 50 Hz binary WebSocket client. **Status: Production Ready** (add `DEGRADED`/`FAILED` state enum support).
8. `src/synchronization/StateBuffer.ts`: SLERP and joint lerp buffer. **Status: Production Ready** (add runtime delay adjustment).
9. `src/controls/TeleopController.ts`: Velocity command dispatch logic. **Status: 100% Production Ready.**
10. `src/controls/VirtualJoystick.tsx`: Dual on-screen touch joysticks. **Status: 100% Production Ready.**
11. `src/diagnostics/DiagnosticsCollector.ts`: Telemetry aggregation. **Status: Production Ready** (remains backend for developer HUD).
12. `assets/asimov_1.glb`: Robot GLB visual asset. **Status: Invariant (Do Not Touch).**

### 4.2 To Be Refactored & Enhanced
1. `src/app/App.tsx`:
   - *Current:* Hardcoded mode switch between Benchmark and Teleop overlay.
   - *Phase 4:* Implement clean app shell with application state machine (`BOOT`, `HOME`, `TELEOPERATION`, `SETTINGS`).
2. `src/app/TeleopSessionManager.ts`:
   - *Current:* Initializes client, buffer, teleop controller, and diagnostics.
   - *Phase 4:* Add session lifecycle listeners, persistent settings binding, camera stream coordination, and clean disconnect/reconnect state transitions.
3. `src/controls/TeleopControlsOverlay.tsx`:
   - *Current:* Engineering-style overlay with mixed settings and buttons.
   - *Phase 4:* Refactor into sleek, touch-first operator HUD: Operator status header, prominent E-stop with confirm safety, clean camera selector, and responsive joystick anchors.
4. `src/diagnostics/DiagnosticsHUD.tsx`:
   - *Current:* Top-left floating collapsible HUD always visible in teleop.
   - *Phase 4:* Demote to an on-demand developer drawer/sheet toggled via Settings or hidden gesture, keeping the main view clean.

### 4.3 Debug & Benchmark Only (To Be Isolated / Maintained for Regression)
1. `src/app/BenchmarkHUD.tsx`: Phase 1 & 2 benchmark HUD. Retain for developer benchmark screen only.
2. `src/app/BenchmarkControls.tsx`: Phase 1 & 2 workload triggers. Retain for developer benchmark screen only.
3. `src/benchmark/BenchmarkScene.ts`: Synthetic benchmark geometries (L1..L4 cubes/spheres). Retain for developer benchmark screen only.
4. `src/benchmark/BenchmarkController.ts`: Decouple teleop session from benchmark scene controller so teleoperation does not instantiate synthetic test objects.
5. `tests/Phase1...`, `tests/Phase2...`, `tests/Phase3...`: Retain 100% pass rate as regression gate.

---

## 5. Architectural Weaknesses in Phase 3 Prototype

1. **Conflated Orchestration (`BenchmarkController`):**  
   `BenchmarkController` instantiates `BenchmarkScene` (which loads cubes/spheres/synthetic test objects) even when running in `TELEOP` mode. In Phase 4, the production application must instantiate only `SceneManager` and `AsimovRobotModel`, avoiding synthetic benchmark object overhead.
2. **Immediate Unmanaged Startup:**  
   `App.tsx` initializes `GLView` and connects to the network during initial mount without user confirmation or server discovery. If the backend is offline, the app enters an unhandled error state.
3. **Hardcoded IP & Port:**  
   Defaults to `10.222.5.132:8854`. If the user is on a different Wi-Fi subnet or using `localhost`, they must open a modal to change it on every app launch.
4. **Developer Telemetry in Operator's Face:**  
   Showing buffer depth, packet jitter, and p95 frame intervals on the primary operational screen distracts the operator. The operator needs: **Is the robot moving? What policy is active? Is it safe?**
5. **No Independent Video Ingestion:**  
   The operator only has the local 3D synthetic view. In actual field teleoperation, situational awareness requires seeing what the physical/simulated robot camera sees.

---

## 6. Phase 4 Target Architecture

```text
                                 ┌────────────────────────────────────────────────────────┐
                                 │                    VASIMOV BACKEND                     │
                                 │                                                        │
                                 │   MuJoCo Physics (200 Hz)   Locomotion Policy (50 Hz)  │
                                 │              │                         │               │
                                 │              ▼                         ▼               │
                                 │      Authoritative State      MJPEG Camera Stream      │
                                 │       (VAS1 @ 50 Hz)           (/api/camera/stream)    │
                                 └──────────────┬─────────────────────────┬───────────────┘
                                                │                         │
                                        Binary WebSocket              HTTP MJPEG
                                        (Port 8854, WS)               (Port 8854, HTTP)
                                                │                         │
                                                ▼                         ▼
┌───────────────────────────────────────────────┴─────────────────────────┴───────────────────────────────────────────────┐
│                                           ASIMOV CONTROLLER 3D (ANDROID CLIENT)                                           │
│                                                                                                                           │
│   ┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
│   │                                            APPLICATION SHELL (App.tsx)                                            │   │
│   │                                                                                                                   │   │
│   │        BOOT  ───►  HOME (Server Select & Connect)  ◄───►  SETTINGS (Config, Camera, Latency, Dev Mode)             │   │
│   │                     │                                                                                             │   │
│   │                     ▼                                                                                             │   │
│   │                CONNECTING                                                                                         │   │
│   │                     │                                                                                             │   │
│   │                     ▼                                                                                             │   │
│   │                TELEOPERATION SCREEN (Authoritative 3D View + Operator Overlay)                                    │   │
│   │                ┌─────────────────────────────────────────────────────────────────────────────────────────────┐    │   │
│   │                │ Top: Operator Status Bar (Robot Mode, Active Policy, Safety State, Network Dot)             │    │   │
│   │                │ Mid: Direct Three.js 60 FPS View (3RD / FPV / FRONT / ORBIT) + Optional Video PiP/Split     │    │   │
│   │                │ Bottom: Dual Touch Joysticks (Left: vx, vy; Right: yaw) + Action Grid (STAND, WALK, CROUCH) │    │   │
│   │                │ Center: Prominent Safety E-STOP                                                             │    │   │
│   │                └─────────────────────────────────────────────────────────────────────────────────────────────┘    │   │
│   └───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                                           │
│   ┌────────────────────────────────────────── TELEOPERATION SESSION CORE ─────────────────────────────────────────────┐   │
│   │                                                                                                                   │   │
│   │    StateTransportClient (50 Hz Ingest)                                                                            │   │
│   │            │                                                                                                      │   │
│   │            ▼                                                                                                      │   │
│   │       StateBuffer (20–40ms configurable jitter window, Acute SLERP, 25-Joint Lerp)                                │   │
│   │            │                                                                                                      │   │
│   │            ▼                                                                                                      │   │
│   │    AsimovRobotModel (25 Joint Rotations, 6-DoF Base Pose)                                                         │   │
│   │            │                                                                                                      │   │
│   │            ▼                                                                                                      │   │
│   │    ThreeRenderer & SceneManager (Direct OpenGL ES 3.2, 60 Hz VSync-Driven Callback Loop)                          │   │
│   │                                                                                                                   │   │
│   │    TeleopController (Dual Joystick Input ──► 25 Hz Binary VAC1 ──► Backend)                                       │   │
│   │                                                                                                                   │   │
│   │    DiagnosticsCollector (Empirical Metrics ──► Dedicated On-Demand Developer Drawer)                              │   │
│   └───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Risks & Mitigation Strategies

| Risk | Impact | Technical Mitigation Strategy |
| :--- | :---: | :--- |
| **React Re-render Thrashing** | High (FPS drop, jank) | **Zero state packets in React.** 50 Hz `VAS1` state packets flow directly from WebSocket into `Float32Array` in `StateBuffer`. React components update only via a throttled 3 Hz emitter (`DiagnosticsCollector` / `OperatorStatusEmitter`). |
| **Render Loop Starvation** | High (Stutter, freezing) | Render loop (`requestAnimationFrame`) runs completely decoupled from WebSocket arrival. If network drops, `StateBuffer` holds the last valid pose without throwing or freezing the 3D scene. |
| **Unbounded Command Queue** | Critical (Delayed robot action) | `TeleopController` enforces **newest-command priority**. Commands are never queued; if network is congested, older commands are discarded immediately. |
| **Accidental E-Stop / Lockup** | Critical (Unexpected shutdown) | E-Stop button is visually distinct (bright safety red, isolated center placement, haptic feedback confirmation). |
| **Remote Video Latency Contention**| Medium (Network choke) | Video runs over standard HTTP/MJPEG on a separate worker or dedicated image element. Frame drops in video do not impact the 3D state stream or control dispatch. |
| **Memory / Socket Leak on Reconnect** | High (OOM over 15 min) | `StateTransportClient` ensures strict single-socket invariant: old sockets are closed, listeners removed, and timers cleared before allocating a new connection. `StateBuffer` capacity is hard-clamped at 16 snapshots. |

---

## 8. Dependencies & Libraries

To preserve optimal performance and avoid bloat, Phase 4 maintains the existing lightweight dependency footprint:
- **Core:** `react` 19.2.3, `react-native` 0.86.3, `expo` 57.0.26
- **3D Graphics:** `three` ^0.174.0, `expo-gl` 57.0.2
- **Persistence:** Local file/storage abstraction (`AsyncStorage` or lightweight persistent JSON config) for connection profiles and operator preferences.
- **Testing:** `jest` 30.5.2, `ts-jest` 29.4.14, `@types/three`

*Rule:* Do NOT introduce heavy UI component libraries (such as NativeBase or React Native Paper) or React Three Fiber. Retain Vanilla CSS/StyleSheet and direct Three.js.

---

## 9. Phase 4 Milestone Implementation Roadmap

| Milestone | Title | Focus & Core Deliverables |
| :--- | :--- | :--- |
| **P4.0** | **Architecture Audit** | Produce this comprehensive audit document; confirm all Phase 3 invariants. |
| **P4.1** | **Application Shell** | Application state machine (`BOOT`, `HOME`, `TELEOPERATION`, `SETTINGS`), clean landing screen, server profile picker. |
| **P4.2** | **Session Management** | Production connection lifecycle (`CONNECTING`, `CONNECTED`, `DEGRADED`, `RECONNECTING`, `FAILED`), auto-reconnect, clean socket disposal. |
| **P4.3** | **Teleoperation UI** | Polished touch interface: ergonomic dual joysticks, state buttons (`STAND`, `WALK`, `CROUCH`, `RECOVER`), distinct safety E-Stop. |
| **P4.4** | **3D View & Camera UX** | Smooth camera preset switching (`3RD`, `FPV`, `FRONT`, `ORBIT`), camera framing adjustments, orientation reticle. |
| **P4.5** | **Operator Status Bar** | Clean status layer: Robot Mode, Policy, Recovery State, Command Echo, Network Indicator (no raw dev stats). |
| **P4.6** | **Latency Optimization**| StateBuffer jitter window experiment framework: benchmark 20 ms, 30 ms, 40 ms, and adaptive windowing. |
| **P4.7** | **Remote Camera View** | Ingest backend camera feed (`/api/camera/stream`), provide PiP / Split / Full 3D toggles without render hitching. |
| **P4.8** | **Settings & Dev HUD** | Dedicated Settings screen (Host, Port, Jitter delay, 720p/1080p, Camera default), on-demand developer HUD drawer. |
| **P4.9** | **Failure & Safety UX** | Hardened disconnect handling, command suppression on signal loss, graceful recovery transitions, visual banners. |
| **P4.10**| **Validation & Build** | 15-minute endurance test on Samsung Galaxy M14 5G, test suite verification (100% pass), production release APK/bundle. |

---

## 10. Conclusion

The Phase 4 architecture preserves 100% of Phase 3's proven engineering accomplishments while establishing the modular structure required for a robust operator tool.

We now proceed to **Milestone P4.1 — Application Shell**.
