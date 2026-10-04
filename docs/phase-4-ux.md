# Phase 4 — Operator Application UX & Visual Design Architecture

## 1. Overview & Operator Philosophy

Phase 4 transforms the Asimov Controller 3D engineering prototype into a production-grade, operator-facing mobile robotics application. The visual experience is modeled after real aerospace and mission-critical teleoperation systems:
- **Zero Vibe-Coding**: Every pixel and visual element serves an operational purpose.
- **Unobstructed Situational Awareness**: The 3D viewport remains the visual centerpiece; teleoperation HUD elements occupy peripheral margins with high-contrast, outdoor-readable palettes (`#070a10` slate dark theme).
- **Physical Safety Guarantees**: Dangerous or volatile commands require intentional, tactile confirmation; connection disruptions automatically neutralize joystick commands and display prominent caution banners.

---

## 2. Navigation Architecture

```
          [ BOOT / INIT ]
                 │
                 ▼
          [ HOME SCREEN ]
          (Operator Landing, Profiles, Quick Connect)
                 │
         [ CONNECT TO ROBOT ]
                 │
                 ▼
       [ CONNECTING OVERLAY ]
      (Handshake Verification)
                 │
                 ▼
     [ LIVE TELEOPERATION VIEW ]
   ┌─────────────────────────────┐
   │    Operator Status Bar      │
   │  (Mode, Policy, Safety,     │
   │   Velocity & Camera Switch) │
   │                             │
   │      3D ROBOT VIEWPORT      │
   │   (Authoritative 50Hz VAS1) │
   │                             │
   │     Teleop Control Deck     │
   │ (Translation & Yaw Joysticks│
   │  Mode Buttons & Prominent   │
   │           E-STOP)           │
   └─────────────────────────────┘
          │               ▲
     [ SETTINGS ] ────────┘
```

---

## 3. Operator Status Layer

Located across the top perimeter of the screen, the `OperatorStatusBar` aggregates real-time authoritative simulation and safety telemetry:

| Telemetry Element | Visual Presentation | Authoritative Backend Source |
| :--- | :--- | :--- |
| **Robot Identity** | `ASIMOV 1` | Verified canonical model |
| **Robot Mode** | `STAND`, `MOVE`, `CROUCH`, `DAMP`, `FAULT DAMP` | `AsimovRobotState.robotMode` |
| **Active Policy** | `MENLO LOCOMOTION`, `SAFE-FALL`, `GET-UP`, `STANDBY` | `AsimovRobotState.policyId` |
| **Recovery State** | `NORMAL`, `FALL DETECTED`, `GET-UP RUNNING`, `STAND ARMED` | `AsimovRobotState.recoveryState` |
| **Safety Interlock** | `NORMAL` (Emerald) vs `FAULT` (Crimson) | `AsimovRobotState.flags & 0x01` |
| **Command Readout** | `Vx: +0.42 m/s · Vy: +0.03 m/s · Wz: +0.17 rad/s` | `TeleopController.getTargetVelocities()` |
| **Connection Quality** | `50 Hz · 6.2 ms RTT` / `RECONNECTING...` | `StateTransportClient.getMetrics()` |
| **Camera View Switcher** | `CHASE` \| `FPV` \| `FRONT` \| `ORBIT` | Local `SceneManager` |

---

## 4. Teleoperation Control Deck

### Dual Virtual Joysticks
1. **Left Joystick — Translation**:
   - Up / Down: Forward Linear Velocity $V_x$ (0 to $+0.80\text{ m/s}$), Reverse Linear Velocity (0 to $-0.40\text{ m/s}$).
   - Left / Right: Lateral Velocity $V_y$ ($-0.30\text{ to }+0.30\text{ m/s}$).
   - Radius: $136\text{ px}$, Knob: $52\text{ px}$, Deadzone: $0.08$.
2. **Right Joystick — Rotation**:
   - Left / Right: Yaw Rate $W_z$ ($-0.60\text{ to }+0.60\text{ rad/s}$).
   - Radius: $136\text{ px}$, Knob: $52\text{ px}$, Deadzone: $0.08$.

### Safety Emergency Stop (E-STOP)
- **Visual Distinction**: Large, high-visibility crimson button (`#dc2626`) with hazard border and secondary caution subtext `EMERGENCY HALT`.
- **Command Transmission**: Dispatches `CommandType.ESTOP` immediately upon touch down.
- **Fail-Safe Disconnect Behavior**: If network connectivity drops or packet starvation occurs, joystick velocity targets are instantly zeroed and command serialization is inhibited.

---

## 5. Camera System UX

The local Three.js camera system supports 4 operational modes without network transmission:
1. **Third Person / Chase**: Smoothly tracks behind the robot pelvis with damping ($z = +1.8\text{ m}, y = +0.55\text{ m}$).
2. **First Person / FPV**: Mounts at the robot head link and looks straight ahead with high responsiveness.
3. **Front Inspection**: Positions $2.2\text{ m}$ in front of the robot facing aft for joint diagnostics.
4. **Orbit**: Continuous rotational inspection at configurable radius ($6.0\text{ m}$) and height ($3.2\text{ m}$).

**Smooth Gliding Transitions**: Switching camera modes smoothly lerps the camera position and look-at target vector over ~250 ms, eliminating disorienting viewpoint snaps.
