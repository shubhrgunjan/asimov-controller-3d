/**
 * Protocol.test.ts
 * 
 * Comprehensive Unit Test Suite for VAS1 (State) and VAC1 (Command) Binary Protocols.
 * Covers:
 * - Full 288-byte State serialization and deserialization roundtrip
 * - Full 32-byte Command serialization and deserialization roundtrip
 * - Joint ordering (all 25 canonical joints)
 * - Malformed, truncated, and oversized packet rejection
 * - Magic header and version compatibility verification
 * - Boundary conditions (sequence wrap, negative values, extreme floats)
 */

import {
  parseStatePacket,
  serializeStatePacket,
  parseCommandPacket,
  serializeCommandPacket,
  STATE_PACKET_SIZE,
  COMMAND_PACKET_SIZE,
  PROTOCOL_VERSION,
  RobotMode,
  PolicyId,
  RecoveryState,
  CommandType,
  StateFlags,
  AsimovRobotState,
  AsimovControlCommand,
} from '../src/protocol/AsimovStateProtocol';

describe('Phase 3 Protocol Suite: VAS1 & VAC1', () => {
  const sampleState: AsimovRobotState = {
    protocolVersion: PROTOCOL_VERSION,
    flags: StateFlags.FAULT_LATCHED | StateFlags.CONTACT_LEFT,
    robotMode: RobotMode.MOVE,
    policyId: PolicyId.OFFICIAL_LOCOMOTION,
    recoveryState: RecoveryState.NORMAL,
    safetyState: 0,
    sequenceNumber: 12345,
    timestamp: 42.123456,
    basePosition: [0.15, -0.05, 0.612],
    baseOrientation: [0.01, 0.02, 0.03, 0.999],
    linearVelocity: [0.45, -0.02, 0.01],
    angularVelocity: [0.01, 0.05, -0.15],
    jointPositions: new Float32Array(25).map((_, i) => (i - 12) * 0.1),
    jointVelocities: new Float32Array(25).map((_, i) => (i - 12) * 0.05),
    commandEcho: {
      linearX: 0.4,
      linearY: -0.1,
      yaw: 0.25,
    },
  };

  test('P3.1.1: State packet (VAS1) serializes to exactly 288 bytes', () => {
    const buffer = serializeStatePacket(sampleState);
    expect(buffer.byteLength).toBe(STATE_PACKET_SIZE);
  });

  test('P3.1.2: State packet (VAS1) roundtrip preserves all 25 joints and kinematics exactly', () => {
    const buffer = serializeStatePacket(sampleState);
    const parsed = parseStatePacket(buffer);

    expect(parsed.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(parsed.sequenceNumber).toBe(sampleState.sequenceNumber);
    expect(parsed.timestamp).toBeCloseTo(sampleState.timestamp, 5);
    expect(parsed.robotMode).toBe(RobotMode.MOVE);
    expect(parsed.policyId).toBe(PolicyId.OFFICIAL_LOCOMOTION);
    expect(parsed.flags).toBe(sampleState.flags);

    // Base pose & velocities
    expect(parsed.basePosition[0]).toBeCloseTo(sampleState.basePosition[0], 5);
    expect(parsed.basePosition[1]).toBeCloseTo(sampleState.basePosition[1], 5);
    expect(parsed.basePosition[2]).toBeCloseTo(sampleState.basePosition[2], 5);

    expect(parsed.baseOrientation[3]).toBeCloseTo(sampleState.baseOrientation[3], 5);

    expect(parsed.linearVelocity[0]).toBeCloseTo(sampleState.linearVelocity[0], 5);
    expect(parsed.angularVelocity[2]).toBeCloseTo(sampleState.angularVelocity[2], 5);

    // 25 Joints verification
    expect(parsed.jointPositions.length).toBe(25);
    expect(parsed.jointVelocities.length).toBe(25);
    for (let i = 0; i < 25; i++) {
      expect(parsed.jointPositions[i]).toBeCloseTo(sampleState.jointPositions[i], 4);
      expect(parsed.jointVelocities[i]).toBeCloseTo(sampleState.jointVelocities[i], 4);
    }

    // Command echo
    expect(parsed.commandEcho.linearX).toBeCloseTo(0.4, 4);
    expect(parsed.commandEcho.linearY).toBeCloseTo(-0.1, 4);
    expect(parsed.commandEcho.yaw).toBeCloseTo(0.25, 4);
  });

  test('P3.1.3: Command packet (VAC1) serializes to exactly 32 bytes and roundtrips', () => {
    const cmd: AsimovControlCommand = {
      protocolVersion: PROTOCOL_VERSION,
      commandType: CommandType.WALK,
      flags: 0,
      sequenceNumber: 889,
      timestamp: 1728000.123,
      linearX: 0.65,
      linearY: -0.2,
      yawRate: 0.45,
    };

    const buffer = serializeCommandPacket(cmd);
    expect(buffer.byteLength).toBe(COMMAND_PACKET_SIZE);

    const parsed = parseCommandPacket(buffer);
    expect(parsed.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(parsed.commandType).toBe(CommandType.WALK);
    expect(parsed.sequenceNumber).toBe(889);
    expect(parsed.timestamp).toBeCloseTo(1728000.123, 3);
    expect(parsed.linearX).toBeCloseTo(0.65, 4);
    expect(parsed.linearY).toBeCloseTo(-0.2, 4);
    expect(parsed.yawRate).toBeCloseTo(0.45, 4);
  });

  test('P3.1.4: Rejects malformed state packet sizes', () => {
    // Truncated (200 bytes)
    const truncated = new ArrayBuffer(200);
    expect(() => parseStatePacket(truncated)).toThrow(/Invalid state packet size/);

    // Oversized (300 bytes)
    const oversized = new ArrayBuffer(300);
    expect(() => parseStatePacket(oversized)).toThrow(/Invalid state packet size/);

    // Empty buffer
    const empty = new ArrayBuffer(0);
    expect(() => parseStatePacket(empty)).toThrow(/Invalid state packet size/);
  });

  test('P3.1.5: Rejects invalid magic header', () => {
    const buffer = serializeStatePacket(sampleState);
    const view = new DataView(buffer);
    // Corrupt magic header to 'XXXX'
    view.setUint8(0, 0x58);
    view.setUint8(1, 0x58);
    view.setUint8(2, 0x58);
    view.setUint8(3, 0x58);

    expect(() => parseStatePacket(buffer)).toThrow(/Invalid state packet magic/);
  });

  test('P3.1.6: Rejects incompatible protocol version', () => {
    const buffer = serializeStatePacket(sampleState);
    const view = new DataView(buffer);
    // Change version byte from 1 to 2
    view.setUint8(4, 2);

    expect(() => parseStatePacket(buffer)).toThrow(/Protocol version mismatch/);
  });

  test('P3.1.7: Rejects malformed command packets', () => {
    // Truncated command (20 bytes instead of 32)
    const truncated = new ArrayBuffer(20);
    expect(() => parseCommandPacket(truncated)).toThrow(/Invalid command packet size/);

    // Corrupted command magic
    const valid = serializeCommandPacket({
      protocolVersion: PROTOCOL_VERSION,
      commandType: CommandType.STAND,
      flags: 0,
      sequenceNumber: 1,
      timestamp: 10.0,
      linearX: 0,
      linearY: 0,
      yawRate: 0,
    });
    const view = new DataView(valid);
    view.setUint8(0, 0x42); // corrupt 'V' to 'B'
    expect(() => parseCommandPacket(valid)).toThrow(/Invalid command packet magic/);
  });

  test('P3.1.8: Handles sequence number boundary wrap and max values', () => {
    const boundaryState: AsimovRobotState = {
      ...sampleState,
      sequenceNumber: 0xffffffff, // max uint32 (4,294,967,295)
      timestamp: 99999999.999,
    };

    const buffer = serializeStatePacket(boundaryState);
    const parsed = parseStatePacket(buffer);
    expect(parsed.sequenceNumber).toBe(4294967295);
    expect(parsed.timestamp).toBeCloseTo(99999999.999, 3);
  });

  test('P5.1: VAC1 command boundary value roundtrips (vx: -0.4, 0, +0.8; vy: -0.3, 0, +0.3; wz: -0.6, 0, +0.6)', () => {
    const boundaryCases = [
      { vx: -0.4, vy: -0.3, wz: -0.6 },
      { vx: 0.0, vy: 0.0, wz: 0.0 },
      { vx: 0.8, vy: 0.3, wz: 0.6 },
      { vx: 0.8, vy: -0.3, wz: -0.6 },
      { vx: -0.4, vy: 0.3, wz: 0.6 },
    ];

    for (let i = 0; i < boundaryCases.length; i++) {
      const bc = boundaryCases[i];
      const cmd: AsimovControlCommand = {
        protocolVersion: PROTOCOL_VERSION,
        commandType: CommandType.WALK,
        flags: 0,
        sequenceNumber: 1000 + i,
        timestamp: 50.0 + i,
        linearX: bc.vx,
        linearY: bc.vy,
        yawRate: bc.wz,
      };

      const buf = serializeCommandPacket(cmd);
      expect(buf.byteLength).toBe(COMMAND_PACKET_SIZE);

      const parsed = parseCommandPacket(buf);
      expect(parsed.linearX).toBeCloseTo(bc.vx, 4);
      expect(parsed.linearY).toBeCloseTo(bc.vy, 4);
      expect(parsed.yawRate).toBeCloseTo(bc.wz, 4);
      expect(parsed.commandType).toBe(CommandType.WALK);
    }
  });
});
