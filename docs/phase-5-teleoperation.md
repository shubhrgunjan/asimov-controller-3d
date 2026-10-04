# ASIMOV CONTROLLER 3D
## PHASE 5 TELEOPERATION: ADVANCED OPERATOR CONTROL & BOUNDARY CONTRACTS

**Author:** Asimov Robotics Engineering Team  
**Date:** October 2026  
**Status:** IMPLEMENTED & TESTED  
**Platforms:**
- Android Client: `src/controls/TeleopController.ts`, `src/controls/TeleopControlsOverlay.tsx`
- Backend Authority: `vasimov/web/server/control_handler.py`, `vasimov/edge/policy.py`

---

## 1. Authoritative Backend Velocity Semantics

Per forensic inspection of `vasimov/edge/policy.py` and `vasimov/web/server/control_handler.py`, the authoritative policy contract bounds are:

```python
# vasimov/edge/policy.py
VX_MIN, VX_MAX = -0.6, 0.8    # Forward / Reverse linear velocity (m/s)
VY_MIN, VY_MAX = -0.5, 0.5    # Lateral linear velocity (m/s)
WZ_MIN, WZ_MAX = -0.8, 0.8    # Yaw angular rate (rad/s)
```

The Android client's maximum physical control limits are configured well within these authoritative bounds:
- **Maximum Forward $v_x$:** $+0.80\text{ m/s}$
- **Maximum Reverse $v_x$:** $-0.40\text{ m/s}$ (clipped to $0.4\text{ m/s}$ for locomotion stability)
- **Maximum Lateral $v_y$:** $\pm 0.30\text{ m/s}$
- **Maximum Yaw $\omega_z$:** $\pm 0.60\text{ rad/s}$

---

## 2. Advanced Teleoperation Features

### 2.1 Speed Scaling Profiles
Three distinct operational speed modes allow operators to adapt control responsiveness to tactical conditions:

| Profile | Forward $v_x$ Max | Reverse $v_x$ Max | Lateral $v_y$ Max | Yaw $\omega_z$ Max | Use Case |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **`PRECISION`** | $+0.28\text{ m/s}$ | $-0.20\text{ m/s}$ | $\pm 0.15\text{ m/s}$ | $\pm 0.30\text{ rad/s}$ | Fine inspection, doorway navigation, tight obstacle clearance |
| **`NORMAL`** | $+0.60\text{ m/s}$ | $-0.30\text{ m/s}$ | $\pm 0.24\text{ m/s}$ | $\pm 0.48\text{ rad/s}$ | General walking, structured facility locomotion |
| **`SPORT`** | $+0.80\text{ m/s}$ | $-0.40\text{ m/s}$ | $\pm 0.30\text{ m/s}$ | $\pm 0.60\text{ rad/s}$ | Rapid open-area traversal, emergency repositioning |

### 2.2 Response Curve Shaping
To balance delicate near-center positioning with full-stroke speed authority, three response curves are supported:
1. **`LINEAR`:** $f(u) = u$
2. **`EXPONENTIAL` (Default):** $f(u) = \text{sgn}(u) \cdot |u|^{1.5}$
   - At $50\%$ joystick deflection: velocity is $\approx 35.3\%$ of maximum.
   - Provides ultra-smooth micro-adjustments near center while preserving $100\%$ velocity at full travel.
3. **`CUBIC`:** $f(u) = \text{sgn}(u) \cdot (0.3 |u| + 0.7 |u|^3)$
   - At $50\%$ joystick deflection: velocity is $\approx 23.75\%$ of maximum.

### 2.3 Slew Rate Acceleration Limiting
Prevents instantaneous velocity step changes that can trip dynamic balance controllers in MuJoCo:
- $\dot{v}_{x,\max} = 2.0\text{ m/s}^2$
- $\dot{v}_{y,\max} = 2.0\text{ m/s}^2$
- $\dot{\omega}_{z,\max} = 3.0\text{ rad/s}^2$

### 2.4 Operator Control Lock
A dedicated `[🔒 LOCKED / 🔓 UNLOCKED]` toggle disables joystick touches and mode changes during observation or camera manipulation. **E-STOP explicitly bypasses control lock at all times**, guaranteeing emergency halt authority.

---

## 3. Boundary Test Matrix & Results

Verified via `tests/TeleopUI.test.ts` and `tests/Protocol.test.ts`:

| Test Vector | Input Deflection | Target Velocity | VAC1 Payload (32 B) | Status |
| :--- | :---: | :---: | :---: | :---: |
| Full Forward | $y = +1.0$ | $v_x = +0.80\text{ m/s}$ | `0xcd 0xcc 0x4c 0x3f` | **PASS** |
| Full Reverse | $y = -1.0$ | $v_x = -0.40\text{ m/s}$ | `0xcd 0xcc 0xcc 0xbe` | **PASS** |
| Full Left | $x = -1.0$ | $v_y = +0.30\text{ m/s}$ | `0x9a 0x99 0x99 0x3e` | **PASS** |
| Full Right | $x = +1.0$ | $v_y = -0.30\text{ m/s}$ | `0x9a 0x99 0x99 0xbe` | **PASS** |
| Full Yaw Left | $\text{yaw} = -1.0$ | $\omega_z = +0.60\text{ rad/s}$ | `0x9a 0x99 0x19 0x3f` | **PASS** |
| Full Yaw Right | $\text{yaw} = +1.0$ | $\omega_z = -0.60\text{ rad/s}$ | `0x9a 0x99 0x19 0xbf` | **PASS** |
| Precision Forward | $y = +1.0$ | $v_x = +0.28\text{ m/s}$ | `0x8f 0xc2 0x8f 0x3e` | **PASS** |
| Deadzone Clamping | $r = 0.05$ | $v_x = 0.00, v_y = 0.00$ | `0x00 0x00 0x00 0x00` | **PASS** |
| Release Deceleration | Touch Up | $v_x = 0.00, v_y = 0.00, \omega_z = 0.00$ | `0x00 0x00 0x00 0x00` | **PASS** |
| E-STOP under Lock | Locked + E-STOP | Immediate E-STOP dispatch | Validated | **PASS** |
