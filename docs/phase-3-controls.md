# Phase 3 Teleoperation Controls & Command Dispatch

**Component:** `TeleopController.ts` & `TeleopOverlay.tsx`  
**Location:** `src/controls/`  
**Backend Receiver:** `vasimov/web/server/gateway.py`  
**Command Protocol:** `VAC1` (Fixed 32 bytes)  
**Date:** 2026-10-04  

---

## 1. Overview & Architectural Principles

The Android teleoperation system provides dual virtual on-screen joysticks and high-level state machine buttons.

```text
  [ Left Touch Joystick ]         [ Right Touch Joystick ]
  X: Lateral Vel (-0.3..+0.3)     X: Yaw Rate (-0.8..+0.8)
  Y: Forward Vel (-0.4..+0.8)
              │                              │
              └──────────────┬───────────────┘
                             │
                  [ TeleopController ]
                  ├─ Deadzone filtering (0.08)
                  ├─ Newest-command priority (no queuing)
                  ├─ Serialization latency instrumentation (T0 -> T1)
                  └─ VAC1 Binary Packing (32 bytes)
                             │
                             ▼
              [ StateTransportClient (ws://) ]
                             │
                             ▼
                  [ VASIMOV WebGateway ]
                             │
                             ▼
                  [ ControlHandler (EdgeCore) ]
```

---

## 2. Input Mapping & Contract Boundaries

| Input Control | Axis / Action | Physical Range | Mapped Parameter | Backend Contract Bounds |
| :--- | :--- | :--- | :--- | :--- |
| **Left Joystick** | Vertical ($Y$) | Up (+1.0) to Down (-1.0) | $v_x$ (Forward/Reverse) | $[-0.5, 1.0]$ m/s (Mapped: $[-0.4, 0.8]$ m/s) |
| **Left Joystick** | Horizontal ($X$) | Left (-1.0) to Right (+1.0) | $v_y$ (Lateral) | $[-0.3, 0.3]$ m/s |
| **Right Joystick**| Horizontal ($X$) | Left (-1.0) to Right (+1.0) | $w_z$ (Yaw Rate) | $[-0.8, 0.8]$ rad/s (Mapped: $[-0.6, 0.6]$ rad/s) |
| **STAND Button**  | Press | Transition to STAND | `CommandType.STAND (2)` | Arms 2.0s standing trajectory |
| **WALK Button**   | Press | Transition to MOVE | `CommandType.WALK (1)` | Engages locomotion policy |
| **CROUCH Button** | Press | Squat gesture | `CommandType.CROUCH (3)` | Arms crouch trajectory |
| **RECOVER Button**| Press | Clear faults & get up | `CommandType.RECOVERY (4)` | Resets base, arms STAND |
| **RESET Button**  | Press | Environment reset | `CommandType.RESET (5)` | Re-initializes simulation to keyframe |
| **E-STOP Button** | Press | Emergency stop | `CommandType.ESTOP (6)` | Immediate compliant DAMP |

---

## 3. Newest-Command Priority & Latency Instrumentation

To prevent latency buildup under network congestion or high touch-event frequency:
1. **No Queue Accumulation**: The client maintains a single active command state. When a new touch event occurs, older un-sent commands are discarded immediately.
2. **Deterministic Cadence**: Touch updates emit commands at a throttled rate (25 Hz = 40 ms interval) during active motion, and emit a final $(0, 0, 0)$ command upon touch release.
3. **Timestamp Tracking**:
   - $T_0$: User touch input timestamp (`Date.now()`).
   - $T_1$: Packet serialization completion (`Date.now()`).
   - $\Delta_{\text{prep}} = T_1 - T_0$ is measured empirically (target: $< 0.1$ ms).
