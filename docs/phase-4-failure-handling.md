# Phase 4 — Failure & Safety Handling UX

## 1. Safety Architecture & Core Invariant

**Non-Negotiable Rule**: MuJoCo physics and backend policy runtime remain the single authoritative source of truth. Android client performs presentation, interpolation, and command generation. Android does NOT make autonomous safety decisions or torque overrides.

The client-side safety architecture enforces deterministic fail-safe behavior:
1. **Immediate Velocity Neutralization**: Whenever network connectivity is interrupted (`DISCONNECTED`, `RECONNECTING`, `FAILED`), joystick command velocities are instantly zeroed (`Vx = 0, Vy = 0, Wz = 0`).
2. **Command Dispatch Inhibition**: `StateTransportClient.sendCommand()` strictly gates on `ws.readyState === WebSocket.OPEN`. If closed or connecting, commands are rejected; no unbounded queues or stale accumulation.
3. **Temporal Buffer Reset**: Upon fresh connection handshake, `StateBuffer.reset()` flushes all pre-disconnect snapshots, preventing temporal warping or backward interpolation.

---

## 2. Failure Scenarios & Operator UX Matrix

| Scenario | System Detection | Operator Visual Indication | Client System Behavior | Recovery Action |
| :--- | :--- | :--- | :--- | :--- |
| **Backend Disconnect** | `WebSocket.onclose` / `onerror` | Red badge `● DISCONNECTED`, Safety Caution Banner | Velocities zeroed; commands inhibited | Auto-reconnect or tap `[ RECONNECT ]` |
| **Network Degradation** | Packet arrival $<20\text{ Hz}$ or age $>300\text{ ms}$ | Amber badge `● DEGRADED` on top bar | Buffer widens; operator alerted | Recovers automatically when packet rate resumes $\ge 40\text{ Hz}$ |
| **State Starvation** | Render clock $t_{\text{sample}} \ge t_{\text{newest}}$ | Extrapolation counter increments; HUD warning | Linear velocity extrapolation $\le 100\text{ ms}$; then holds last known pose | Resolves on next packet arrival |
| **Malformed Packet** | Buffer size $\ne 288\text{ B}$ or parsing error | Silent drop; `malformedPacketsRejected++` | Packet rejected; previous valid state retained | Automatic (does not crash client) |
| **Sequence Gaps** | $seq > expected$ | `sequenceGaps` & `packetLossPercent` update in HUD | State buffer sorts valid packets chronologically | Continuous |
| **Robot Fall / Recovery** | `recoveryState \ne NORMAL` | Status strip turns Amber: `FALL DETECTED` / `GET-UP RUNNING` | 3D visual model follows authoritative recovery kinematics | Backend runs SafeFall / GetUp policy |
| **Robot Safety Fault** | `safetyFlags & 0x01` | Status strip turns Crimson: `SAFETY: FAULT` | Operator alerted to hardware fault or e-stop latch | Tap `[ RESET ]` or `[ DAMP ]` |
| **E-STOP Trigger** | Operator touches `[ E-STOP ]` | Haptic touch, `CommandType.ESTOP` dispatched | Immediate authoritative emergency stop sent to VASIMOV | Authoritative backend latches fault |

---

## 3. Emergency Stop (E-STOP) Design

The physical E-STOP is located centrally at the bottom of the teleoperation screen:
- **Visual Distinction**: Sized $220 \times 44\text{ px}$, crimson red background (`#dc2626`) with dual rings and high-contrast typography `E - S T O P / EMERGENCY HALT`.
- **Accidental Touch Resistance**: Spaced distinctly below the mode buttons and flanked between the two virtual joysticks, preventing accidental brushing while thumbing joysticks.
- **Instant Response**: Directly serializes and transmits the 32-byte `VAC1` command with `commandType = CommandType.ESTOP` ($6$) without UI lag or queuing.
