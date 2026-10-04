# Phase 3 Networking & Backend State Transport

**Components:** VASIMOV `WebGateway` (`vasimov/web/server/gateway.py`) & Android Client  
**Ports:** HTTP `8852`, WebSocket `8854`  
**Streaming Cadence:** 50 Hz binary (`VAS1`, 288 bytes), ~25 Hz JSON (`TelemetryFrame`)  
**Command Cadence:** Dynamic 20–50 Hz binary (`VAC1`, 32 bytes) / REST `POST /api/control`  
**Date:** 2026-10-04  

---

## 1. Architecture Overview

The backend state transport provides continuous, non-blocking state synchronization between the authoritative MuJoCo simulation and remote visualization/control clients.

```text
 ┌────────────────────────────────────────────────────────┐
 │                 MuJoCo Physics (200 Hz)                │
 │                 Menlo Policy   (50 Hz)                 │
 └───────────────────────────┬────────────────────────────┘
                             │ (backend._lock < 0.05ms)
                             ▼
 ┌────────────────────────────────────────────────────────┐
 │           VASIMOV WebGateway (gateway.py)              │
 │  ┌──────────────────────────────────────────────────┐  │
 │  │ Broadcast Loop @ 50 Hz                           │  │
 │  │  ├─ Binary pack (VAS1, 288 bytes)                │  │
 │  │  │   └─ Push to binary_ws_clients (Android 3D)   │  │
 │  │  └─ JSON frame (TelemetryFrame, ~18 KB, 25 Hz)   │  │
 │  │      └─ Push to ws_clients (Web browser)         │  │
 │  └──────────────────────────────────────────────────┘  │
 └───────────────────────────┬────────────────────────────┘
                             │
                  WebSocket (ws://<host>:8854)
                             │
                             ▼
 ┌────────────────────────────────────────────────────────┐
 │            Android Client (asimov-controller-3d)       │
 │   StateTransportClient -> StateBuffer -> ThreeRenderer │
 └────────────────────────────────────────────────────────┘
```

---

## 2. Non-Blocking Concurrency Model

MuJoCo physics runs at 200 Hz ($dt = 0.005$s) in a dedicated thread with wall-clock pacing.
To ensure the network layer **never blocks physics**:
1. State sampling in `build_binary_state_packet()` acquires `backend._lock` only to copy primitive numeric values (`qpos`, `qvel`, `time`, `core.mode`, `error_flags`). This critical section completes in **< 0.05 ms** (less than 1% of the 5.0 ms physics step budget).
2. Binary struct packing and network I/O (`websockets.send()`) execute outside the lock on an asynchronous event loop (`_ws_loop`) running in a separate daemon thread.
3. Slow, jittery, or disconnected clients are pruned from the broadcast set without raising exceptions or stalling the physics loop.

---

## 3. Client Negotiation & Auto-Promotion

When an Android client connects to `ws://<host>:8854`:
1. It registers as a binary client either by:
   - Sending `{"action": "subscribe", "params": {"format": "binary"}}`, OR
   - Sending a binary command packet (`VAC1`, 32 bytes).
2. The server acknowledges and immediately routes subsequent 50 Hz binary `VAS1` state packets (288 bytes each) to the socket.
3. Traditional web browsers (such as `run_dashboard.sh`) that do not request binary streaming continue to receive the standard ~25 Hz JSON `TelemetryFrame` without disruption.

---

## 4. Control Command Routing (`VAC1`)

When the Android client teleoperates the robot via touch joysticks or state buttons, it transmits a 32-byte `VAC1` binary packet:
- `CommandType.WALK (1)` $\to$ `action = "walk"`, `params = {"vx", "vy", "wz"}` $\to$ Validated and applied to `EdgeCore.command_velocity()` (transitions `STAND` $\to$ `MOVE/POLICY`).
- `CommandType.STAND (2)` $\to$ `action = "stand"` $\to$ Arms 2.0s standing ramp trajectory.
- `CommandType.CROUCH (3)` $\to$ `action = "crouch"` $\to$ Engages coordinated crouch/squat gesture.
- `CommandType.RECOVERY (4)` $\to$ `action = "getup"` $\to$ Clears latched fall faults, restores upright height, and transitions to `STAND`.
- `CommandType.RESET (5)` $\to$ `action = "reset"` $\to$ Reinitializes MuJoCo to initial keyframe.
- `CommandType.ESTOP (6)` / `DAMP (7)` $\to$ `action = "damp"` $\to$ Engages compliant joint damping.

All commands pass through the official `ControlHandler` validation lifecycle, logging the command and enforcing policy velocity limits ($v_x \in [-0.5, 1.0]$, $v_y \in [-0.3, 0.3]$, $w_z \in [-0.8, 0.8]$).
