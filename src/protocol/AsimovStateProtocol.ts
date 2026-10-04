/**
 * AsimovStateProtocol.ts
 * 
 * Versioned Binary State & Command Protocol (VAS1 & VAC1)
 * High-frequency 50 Hz binary transport between VASIMOV backend and Android Three.js client.
 * 
 * State packet size: 288 bytes
 * Command packet size: 32 bytes
 * Byte order: Little-Endian
 */

export const STATE_MAGIC_ASCII = 'VAS1';
export const COMMAND_MAGIC_ASCII = 'VAC1';
export const PROTOCOL_VERSION = 1;

export const STATE_PACKET_SIZE = 288;
export const COMMAND_PACKET_SIZE = 32;

export enum RobotMode {
  DAMP = 0,
  STAND = 1,
  MOVE = 2,
  FAULT_DAMP = 5,
}

export enum PolicyId {
  NONE = 0,
  OFFICIAL_LOCOMOTION = 1,
  SAFEFALL = 2,
  GETUP = 3,
  MANUAL_OVERRIDE = 4,
}

export enum RecoveryState {
  NORMAL = 0,
  FALL_DETECTED = 1,
  DAMPING_ACTIVE = 2,
  GETUP_IN_PROGRESS = 3,
  STAND_ARMED = 4,
}

export enum CommandType {
  WALK = 1,
  STAND = 2,
  CROUCH = 3,
  RECOVERY = 4,
  RESET = 5,
  ESTOP = 6,
  DAMP = 7,
}

export enum SafetyFlags {
  FALL_DETECTED = 0x01,
  JOINT_LIMIT_REACHED = 0x02,
  MOTOR_OVERTEMP = 0x04,
  CAN_BUS_ERROR = 0x08,
  WATCHDOG_TIMEOUT = 0x10,
}

export enum StateFlags {
  FAULT_LATCHED = 0x01,
  GANTRY_ACTIVE = 0x02,
  CONTACT_LEFT = 0x04,
  CONTACT_RIGHT = 0x08,
}

export interface AsimovRobotState {
  protocolVersion: number;
  flags: number;
  robotMode: RobotMode;
  policyId: PolicyId;
  recoveryState: RecoveryState;
  safetyState: number;
  sequenceNumber: number;
  timestamp: number; // authoritative MuJoCo seconds
  basePosition: [number, number, number];
  baseOrientation: [number, number, number, number]; // [x, y, z, w]
  linearVelocity: [number, number, number];
  angularVelocity: [number, number, number];
  jointPositions: Float32Array; // 25 elements
  jointVelocities: Float32Array; // 25 elements
  commandEcho: {
    linearX: number;
    linearY: number;
    yaw: number;
  };
}

export interface AsimovControlCommand {
  protocolVersion: number;
  commandType: CommandType;
  flags: number;
  sequenceNumber: number;
  timestamp: number; // client wall-clock seconds
  linearX: number; // m/s
  linearY: number; // m/s
  yawRate: number; // rad/s
}

/**
 * Validates and parses a raw 288-byte VAS1 packet into an AsimovRobotState.
 * Throws an Error if packet is malformed, truncated, or has invalid magic/version.
 */
export function parseStatePacket(buffer: ArrayBuffer | DataView): AsimovRobotState {
  const view = buffer instanceof DataView ? buffer : new DataView(buffer);

  if (view.byteLength !== STATE_PACKET_SIZE) {
    throw new Error(
      `Invalid state packet size: expected ${STATE_PACKET_SIZE} bytes, received ${view.byteLength}`
    );
  }

  // Validate Magic: 'VAS1' (0x56, 0x41, 0x53, 0x31)
  const m0 = view.getUint8(0);
  const m1 = view.getUint8(1);
  const m2 = view.getUint8(2);
  const m3 = view.getUint8(3);
  if (m0 !== 0x56 || m1 !== 0x41 || m2 !== 0x53 || m3 !== 0x31) {
    throw new Error(
      `Invalid state packet magic: got ${String.fromCharCode(m0, m1, m2, m3)}, expected VAS1`
    );
  }

  const version = view.getUint8(4);
  if (version !== PROTOCOL_VERSION) {
    throw new Error(
      `Protocol version mismatch: expected ${PROTOCOL_VERSION}, received ${version}`
    );
  }

  const flags = view.getUint8(5);
  const robotMode = view.getUint8(6) as RobotMode;
  const policyId = view.getUint8(7) as PolicyId;
  const recoveryState = view.getUint8(8) as RecoveryState;
  const safetyState = view.getUint8(9);
  // bytes 10-11: reserved uint16

  const sequenceNumber = view.getUint32(12, true);
  const timestamp = view.getFloat64(16, true);

  const basePosition: [number, number, number] = [
    view.getFloat32(24, true),
    view.getFloat32(28, true),
    view.getFloat32(32, true),
  ];

  const baseOrientation: [number, number, number, number] = [
    view.getFloat32(36, true),
    view.getFloat32(40, true),
    view.getFloat32(44, true),
    view.getFloat32(48, true),
  ];

  const linearVelocity: [number, number, number] = [
    view.getFloat32(52, true),
    view.getFloat32(56, true),
    view.getFloat32(60, true),
  ];

  const angularVelocity: [number, number, number] = [
    view.getFloat32(64, true),
    view.getFloat32(68, true),
    view.getFloat32(72, true),
  ];

  const jointPositions = new Float32Array(25);
  for (let i = 0; i < 25; i++) {
    jointPositions[i] = view.getFloat32(76 + i * 4, true);
  }

  const jointVelocities = new Float32Array(25);
  for (let i = 0; i < 25; i++) {
    jointVelocities[i] = view.getFloat32(176 + i * 4, true);
  }

  const commandEcho = {
    linearX: view.getFloat32(276, true),
    linearY: view.getFloat32(280, true),
    yaw: view.getFloat32(284, true),
  };

  return {
    protocolVersion: version,
    flags,
    robotMode,
    policyId,
    recoveryState,
    safetyState,
    sequenceNumber,
    timestamp,
    basePosition,
    baseOrientation,
    linearVelocity,
    angularVelocity,
    jointPositions,
    jointVelocities,
    commandEcho,
  };
}

/**
 * Serializes an AsimovRobotState into a 288-byte ArrayBuffer (primarily used for unit testing).
 */
export function serializeStatePacket(state: AsimovRobotState): ArrayBuffer {
  const buffer = new ArrayBuffer(STATE_PACKET_SIZE);
  const view = new DataView(buffer);

  // Magic 'VAS1'
  view.setUint8(0, 0x56);
  view.setUint8(1, 0x41);
  view.setUint8(2, 0x53);
  view.setUint8(3, 0x31);

  view.setUint8(4, state.protocolVersion);
  view.setUint8(5, state.flags);
  view.setUint8(6, state.robotMode);
  view.setUint8(7, state.policyId);
  view.setUint8(8, state.recoveryState);
  view.setUint8(9, state.safetyState);
  view.setUint16(10, 0, true); // reserved

  view.setUint32(12, state.sequenceNumber, true);
  view.setFloat64(16, state.timestamp, true);

  view.setFloat32(24, state.basePosition[0], true);
  view.setFloat32(28, state.basePosition[1], true);
  view.setFloat32(32, state.basePosition[2], true);

  view.setFloat32(36, state.baseOrientation[0], true);
  view.setFloat32(40, state.baseOrientation[1], true);
  view.setFloat32(44, state.baseOrientation[2], true);
  view.setFloat32(48, state.baseOrientation[3], true);

  view.setFloat32(52, state.linearVelocity[0], true);
  view.setFloat32(56, state.linearVelocity[1], true);
  view.setFloat32(60, state.linearVelocity[2], true);

  view.setFloat32(64, state.angularVelocity[0], true);
  view.setFloat32(68, state.angularVelocity[1], true);
  view.setFloat32(72, state.angularVelocity[2], true);

  for (let i = 0; i < 25; i++) {
    view.setFloat32(76 + i * 4, state.jointPositions[i] ?? 0.0, true);
    view.setFloat32(176 + i * 4, state.jointVelocities[i] ?? 0.0, true);
  }

  view.setFloat32(276, state.commandEcho.linearX, true);
  view.setFloat32(280, state.commandEcho.linearY, true);
  view.setFloat32(284, state.commandEcho.yaw, true);

  return buffer;
}

/**
 * Serializes an AsimovControlCommand into a fixed 32-byte VAC1 packet.
 */
export function serializeCommandPacket(cmd: AsimovControlCommand): ArrayBuffer {
  const buffer = new ArrayBuffer(COMMAND_PACKET_SIZE);
  const view = new DataView(buffer);

  // Magic 'VAC1' (0x56, 0x41, 0x43, 0x31)
  view.setUint8(0, 0x56);
  view.setUint8(1, 0x41);
  view.setUint8(2, 0x43);
  view.setUint8(3, 0x31);

  view.setUint8(4, cmd.protocolVersion);
  view.setUint8(5, cmd.commandType);
  view.setUint16(6, cmd.flags, true);
  view.setUint32(8, cmd.sequenceNumber, true);
  view.setFloat64(12, cmd.timestamp, true);
  view.setFloat32(20, cmd.linearX, true);
  view.setFloat32(24, cmd.linearY, true);
  view.setFloat32(28, cmd.yawRate, true);

  return buffer;
}

/**
 * Unpacks a 32-byte VAC1 packet into an AsimovControlCommand.
 */
export function parseCommandPacket(buffer: ArrayBuffer | DataView): AsimovControlCommand {
  const view = buffer instanceof DataView ? buffer : new DataView(buffer);

  if (view.byteLength !== COMMAND_PACKET_SIZE) {
    throw new Error(
      `Invalid command packet size: expected ${COMMAND_PACKET_SIZE} bytes, received ${view.byteLength}`
    );
  }

  const m0 = view.getUint8(0);
  const m1 = view.getUint8(1);
  const m2 = view.getUint8(2);
  const m3 = view.getUint8(3);
  if (m0 !== 0x56 || m1 !== 0x41 || m2 !== 0x43 || m3 !== 0x31) {
    throw new Error(
      `Invalid command packet magic: got ${String.fromCharCode(m0, m1, m2, m3)}, expected VAC1`
    );
  }

  const version = view.getUint8(4);
  if (version !== PROTOCOL_VERSION) {
    throw new Error(
      `Command version mismatch: expected ${PROTOCOL_VERSION}, received ${version}`
    );
  }

  const commandType = view.getUint8(5) as CommandType;
  const flags = view.getUint16(6, true);
  const sequenceNumber = view.getUint32(8, true);
  const timestamp = view.getFloat64(12, true);
  const linearX = view.getFloat32(20, true);
  const linearY = view.getFloat32(24, true);
  const yawRate = view.getFloat32(28, true);

  return {
    protocolVersion: version,
    commandType,
    flags,
    sequenceNumber,
    timestamp,
    linearX,
    linearY,
    yawRate,
  };
}
