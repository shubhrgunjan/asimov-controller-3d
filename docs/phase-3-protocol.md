# Phase 3 Binary Protocol Specification (VAS1 & VAC1)

**Protocol Identifier:** `VAS1` (Robot State) / `VAC1` (Robot Command)  
**Version:** 1.0  
**Transport:** WebSocket (Binary frames) / UDP / WebRTC DataChannel  
**Byte Order:** Little-Endian (Standard x86_64, ARM64, WebAssembly, and TypedArray native order)  
**Date:** 2026-10-04  

---

## 1. Design Objectives

1. **Deterministic Size & Alignment**: Fixed 288-byte state packet (`VAS1`) and 32-byte command packet (`VAC1`). All fields are aligned on 2-byte, 4-byte, or 8-byte boundaries.
2. **Zero Allocation Parsing**: Deserialization on Android uses a single `DataView` or direct `Float32Array` sub-array views over the received `ArrayBuffer`, avoiding runtime heap allocations and garbage collection pauses.
3. **Loss & Jitter Resilience**: Explicit monotonic `sequence_number` and 64-bit `timestamp` allow the client state buffer to detect dropped, duplicated, or out-of-order packets.
4. **Authoritative Single-Source Mapping**: Joint order strictly follows `SIM_JOINTS` (0..24) from VASIMOV `adapter.py` and `AsimovJointHierarchy.ts`.

---

## 2. State Packet Specification (`VAS1`) — Server to Client

- **Magic Header**: `0x56 0x41 0x53 0x31` (`"VAS1"` ASCII)
- **Rate**: 50 Hz (20 ms interval)
- **Total Size**: Exactly **288 bytes**

### 2.1 Binary Layout Table

| Offset (Bytes) | Field Name | Data Type | Units / Encoding | Description |
| :--- | :--- | :--- | :--- | :--- |
| **0 – 3** | `magic` | `uint8[4]` | ASCII `"VAS1"` | Stream synchronization & packet validation identifier. |
| **4** | `protocol_version` | `uint8` | Integer (1) | Protocol major version. Rejects mismatched versions. |
| **5** | `flags` | `uint8` | Bitfield | Bit 0: `fault_latched`<br>Bit 1: `gantry_active`<br>Bit 2: `contact_left_foot`<br>Bit 3: `contact_right_foot`<br>Bits 4-7: Reserved |
| **6** | `robot_mode` | `uint8` | Enum (0..5) | 0: `DAMP`<br>1: `STAND`<br>2: `MOVE`<br>5: `FAULT_DAMP` |
| **7** | `policy_id` | `uint8` | Enum (0..4) | 0: `NONE`<br>1: `OFFICIAL_LOCOMOTION`<br>2: `SAFEFALL`<br>3: `GETUP`<br>4: `MANUAL_OVERRIDE` |
| **8** | `recovery_state` | `uint8` | Enum (0..4) | 0: `NORMAL`<br>1: `FALL_DETECTED`<br>2: `DAMPING_ACTIVE`<br>3: `GETUP_IN_PROGRESS`<br>4: `STAND_ARMED` |
| **9** | `safety_state` | `uint8` | Bitfield | Bit 0: `FALL_DETECTED`<br>Bit 1: `JOINT_LIMIT_REACHED`<br>Bit 2: `MOTOR_OVERTEMP`<br>Bit 3: `CAN_BUS_ERROR`<br>Bit 4: `WATCHDOG_TIMEOUT` |
| **10 – 11** | `reserved` | `uint16` | Padding (0x0000) | Alignment padding for 4-byte boundaries. |
| **12 – 15** | `sequence_number` | `uint32` | Monotonic counter | Incrementing packet sequence. Detects loss & reordering. |
| **16 – 23** | `timestamp` | `float64` | Seconds | Authoritative MuJoCo simulation time (`data.time`). |
| **24 – 35** | `base_position` | `float32[3]` | Meters | Pelvis position $(x, y, z)$ in world frame. |
| **36 – 51** | `base_orientation`| `float32[4]` | Quaternion | Pelvis orientation $(x, y, z, w)$ normalized. |
| **52 – 63** | `linear_velocity` | `float32[3]` | m/s | Pelvis linear velocity $(v_x, v_y, v_z)$ in world frame. |
| **64 – 75** | `angular_velocity`| `float32[3]` | rad/s | Pelvis angular velocity $(\omega_x, \omega_y, \omega_z)$ in world frame. |
| **76 – 175** | `joint_positions` | `float32[25]` | Radians | 25 joint positions in canonical `SIM_JOINTS` order (0..24). |
| **176 – 275**| `joint_velocities`| `float32[25]` | rad/s | 25 joint velocities in canonical `SIM_JOINTS` order (0..24). |
| **276 – 279**| `command_linear_x`| `float32` | m/s | Commanded forward velocity echo ($v_x$). |
| **280 – 283**| `command_linear_y`| `float32` | m/s | Commanded lateral velocity echo ($v_y$). |
| **284 – 287**| `command_yaw` | `float32` | rad/s | Commanded yaw rate echo ($w_z$). |

### 2.2 Canonical Joint Order (Indices 0..24)
```text
 0: left_hip_pitch_joint
 1: left_hip_roll_joint
 2: left_hip_yaw_joint
 3: left_knee_joint
 4: left_ankle_pitch_joint
 5: left_ankle_roll_joint
 6: right_hip_pitch_joint
 7: right_hip_roll_joint
 8: right_hip_yaw_joint
 9: right_knee_joint
10: right_ankle_pitch_joint
11: right_ankle_roll_joint
12: left_shoulder_pitch_joint
13: left_shoulder_roll_joint
14: left_shoulder_yaw_joint
15: left_elbow_joint
16: left_wrist_yaw_joint
17: right_shoulder_pitch_joint
18: right_shoulder_roll_joint
19: right_shoulder_yaw_joint
20: right_elbow_joint
21: right_wrist_yaw_joint
22: waist_yaw_joint
23: neck_yaw_joint
24: neck_pitch_joint
```

---

## 3. Command Packet Specification (`VAC1`) — Client to Server

- **Magic Header**: `0x56 0x41 0x43 0x31` (`"VAC1"` ASCII)
- **Rate**: 20–50 Hz (only when active joystick/button input occurs)
- **Total Size**: Exactly **32 bytes**

### 3.1 Binary Layout Table

| Offset (Bytes) | Field Name | Data Type | Units / Encoding | Description |
| :--- | :--- | :--- | :--- | :--- |
| **0 – 3** | `magic` | `uint8[4]` | ASCII `"VAC1"` | Command validation identifier. |
| **4** | `protocol_version` | `uint8` | Integer (1) | Protocol version. |
| **5** | `command_type` | `uint8` | Enum (1..7) | 1: `WALK`<br>2: `STAND`<br>3: `CROUCH`<br>4: `RECOVERY`<br>5: `RESET`<br>6: `ESTOP`<br>7: `DAMP` |
| **6 – 7** | `flags` | `uint16` | Bitfield | Reserved for future modifier flags. |
| **8 – 11** | `sequence_number` | `uint32` | Monotonic counter | Client command sequence. |
| **12 – 19**| `timestamp` | `float64` | Seconds | Client wall-clock timestamp (used to compute RTT & latency). |
| **20 – 23**| `linear_x` | `float32` | m/s | Commanded forward velocity. Valid range: `[-0.5, 1.0]`. |
| **24 – 27**| `linear_y` | `float32` | m/s | Commanded lateral velocity. Valid range: `[-0.3, 0.3]`. |
| **28 – 31**| `yaw_rate` | `float32` | rad/s | Commanded yaw rate. Valid range: `[-0.8, 0.8]`. |

---

## 4. Sequence & Timestamp Semantics

1. **Monotonic Sequences**:
   - `sequence_number` starts at 1 and increases by 1 with each emitted packet.
   - Client rejects packets where `sequence <= last_received_sequence` unless sequence rollover occurs (> $2^{31}$ gap).
2. **Timestamps**:
   - Server state timestamp uses MuJoCo simulation time (`float64` seconds).
   - Client state buffer interpolates between the two nearest frames ($t_0 \le t_{\text{target}} \le t_1$).
3. **Malformed Packet Handling**:
   - Any packet whose length $\ne 288$ bytes is rejected without parsing.
   - Any packet with invalid magic bytes or unsupported version is rejected.
   - Dropped packets increment the client diagnostic metric `stale_packet_count`.
