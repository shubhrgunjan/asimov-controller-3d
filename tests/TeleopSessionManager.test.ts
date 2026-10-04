/**
 * TeleopSessionManager.test.ts
 * 
 * Unit tests for TeleopSessionManager:
 * - End-to-end coordination between transport, buffer, teleop, and 3D model
 * - Zero-allocation frame update pipeline
 * - Push-to-buffer routing and reconnect reset handling
 * - Clean disposal
 */

import { TeleopSessionManager } from '../src/app/TeleopSessionManager';
import { AsimovRobotModel } from '../src/model/AsimovRobotModel';
import {
  RobotMode,
  RecoveryState,
  PolicyId,
  AsimovRobotState,
  PROTOCOL_VERSION,
} from '../src/protocol/AsimovStateProtocol';

describe('Phase 3 Integration Suite: TeleopSessionManager', () => {
  let mockWs: any;
  let mockRobot: AsimovRobotModel;

  beforeEach(() => {
    mockWs = {
      readyState: 1, // OPEN
      send: jest.fn(),
      close: jest.fn(),
      binaryType: 'arraybuffer',
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
    };

    (global as any).WebSocket = jest.fn(() => mockWs);
    (global.WebSocket as any).OPEN = 1;
    (global.WebSocket as any).CONNECTING = 0;
    (global.WebSocket as any).CLOSING = 2;
    (global.WebSocket as any).CLOSED = 3;

    mockRobot = {
      applyAuthoritativeState: jest.fn(),
      getHeadWorldPosition: jest.fn(),
      getPelvisWorldPosition: jest.fn(),
    } as any;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const createDummyState = (seq: number, time: number): AsimovRobotState => ({
    protocolVersion: PROTOCOL_VERSION,
    flags: 0,
    robotMode: RobotMode.MOVE,
    policyId: PolicyId.OFFICIAL_LOCOMOTION,
    recoveryState: RecoveryState.NORMAL,
    safetyState: 0,
    sequenceNumber: seq,
    timestamp: time,
    basePosition: [0, 0, 0.78],
    baseOrientation: [0, 0, 0, 1],
    linearVelocity: [0.5, 0, 0],
    angularVelocity: [0, 0, 0],
    jointPositions: new Float32Array(25),
    jointVelocities: new Float32Array(25),
    commandEcho: { linearX: 0.5, linearY: 0.0, yaw: 0.0 },
  });

  test('P3.10.1: Coordinates state packet reception into buffer and model updates', () => {
    const session = new TeleopSessionManager(mockRobot, undefined, {
      autoConnect: false,
      interpolationDelayMs: 0,
    });

    // Push states to buffer
    session.buffer.pushState(createDummyState(1, 10.0));
    session.buffer.pushState(createDummyState(2, 10.02));

    expect(session.buffer.getDepth()).toBe(2);

    // Call update frame
    const pose = session.update();
    expect(pose).not.toBeNull();
    expect(mockRobot.applyAuthoritativeState).toHaveBeenCalledWith(pose);

    session.dispose();
  });

  test('P3.10.2: Reconnect resets state buffer to prevent temporal blending', () => {
    const session = new TeleopSessionManager(mockRobot, undefined, {
      autoConnect: true,
    });

    session.buffer.pushState(createDummyState(500, 100.0));
    expect(session.buffer.getDepth()).toBe(1);

    // Simulate WebSocket open event (handshake complete)
    mockWs.onopen();

    // Buffer must have been reset cleanly
    expect(session.buffer.getDepth()).toBe(0);

    session.dispose();
  });
});
