# ASIMOV CONTROLLER 3D
## PHASE 5 FAILURE MATRIX: REAL PROCESS INTERRUPTION & SAFETY HARNESS

**Author:** Asimov Robotics Engineering Team  
**Date:** October 2026  
**Status:** IMPLEMENTED & EMPIRICALLY VERIFIED  
**Hardware / OS:** Linux 6.8 / Node.js 20+ / Python 3.12 (MuJoCo 200 Hz Core)  

---

## 1. Executive Summary

Milestone P5.2 validates the end-to-end safety lifecycle under real process failure and unexpected transport interruption. In physical robotics teleoperation, sudden communications blackout or server restarts must never lead to runaway velocities, buffered stale command execution, or automatic movement resumption without operator intent.

---

## 2. Real Process Failure Test Execution

Verified via [`tests/RealProcessFailure.test.ts`](file:///home/shubhr/Shubhr/Projects/asimov-controller-3d/tests/RealProcessFailure.test.ts) exercising the live Python backend (`tools.sim_console`):

```text
========================================================================================
                          REAL PROCESS INTERRUPTION TIMELINE
========================================================================================
Time (ms)  Event Description                                     Observed System State
----------------------------------------------------------------------------------------
T + 0      Spawn VASIMOV backend process                         PID assigned, 200 Hz sim
T + 3400   Gateway opens WebSocket (:8854)                      0.0.0.0:8854 listening
T + 3800   Client connects, receives VAS1 packets                State: CONNECTED
T + 4200   Operator commands forward motion (vx = 0.60 m/s)      VAC1 sent, accepted
T + 5000   SIGTERM dispatched to backend process                 Process terminated
T + 5400   WebSocket connection drops                            State: RECONNECTING
T + 5450   TeleopController clamps velocities to zero            vx=0, vy=0, wz=0
T + 5500   Stale sendCommand() attempted                         Returns FALSE (dropped)
T + 7000   Backend process restarted                             PID assigned, server up
T + 10400  Client automatically re-establishes session           State: CONNECTED
T + 10500  Post-reconnect velocity check                         vx=0.00, vy=0.00, wz=0.00
T + 11500  Operator intentionally deflects joystick              vx ramps to 0.40 m/s
========================================================================================
```

---

## 3. Failure & Safety Invariants Verified

| Invariant | Requirement | Empirical Test Result | Status |
| :--- | :--- | :--- | :---: |
| **I-1: Zero Stale Queuing** | Client must never queue movement commands while disconnected. | `client.sendCommand()` immediately discards payload and returns `false`. | **VERIFIED IN TEST** |
| **I-2: Immediate Zero Clamp** | When link drops, active velocity targets must clamp to zero. | `controller.reset()` sets all velocity targets to `0.0`. | **VERIFIED IN TEST** |
| **I-3: Reconnect Handshake** | Reconnection flushes old state buffers before ingestion. | `StateBuffer.reset()` called on open, preventing visual jumps. | **VERIFIED IN TEST** |
| **I-4: Intentional Re-engagement** | Robot must not move after reconnect until user touches joystick. | Target velocities remain `0.0` until explicit `updateLeftJoystick()`. | **VERIFIED IN TEST** |
| **I-5: Singular Socket Invariant** | Reconnect retry loop must never create duplicate WebSocket handles. | Previous socket event handlers nulled and closed prior to retry. | **VERIFIED IN TEST** |

---

## 4. Manual Physical Testing Procedure (Galaxy M14)

```text
PROCEDURE P5-ANDROID-SAFETY:
1. Connect Samsung Galaxy M14 to local Wi-Fi.
2. Launch Asimov Controller 3D application.
3. Select LAB backend profile and tap [CONNECT].
4. Verify 3D robot renders in live stance and status bar displays "● CONNECTED".
5. Deflect left joystick forward to initiate walking gait.
6. Pull host Ethernet/Wi-Fi cable or disable phone Wi-Fi via Quick Settings.
7. Observe UI:
   - Warning banner appears: "ROBOT DISCONNECTED — COMMAND DISPATCH INHIBITED"
   - Virtual joystick snaps to center.
   - Commanded velocity readout drops to 0.00 m/s.
8. Re-enable Wi-Fi.
9. Observe UI:
   - Client automatically reconnects within 2-3 seconds.
   - Status bar transitions back to "● CONNECTED".
   - Robot holds static standing posture.
   - Commanded velocities remain 0.00 m/s.
10. Deflect joystick forward again to confirm intentional re-engagement restores locomotion.
```
