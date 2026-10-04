/**
 * SafetyHandling.test.ts
 * 
 * Milestone P3.9: Failure and Safety Handling Suite.
 * Validates:
 * 1. Backend disconnect: immediate transition to disconnected state, zero stale command dispatch.
 * 2. Packet loss: smooth interpolation without visual rewinds or state tearing.
 * 3. Starvation: clamped extrapolation and safe freeze without unbounded drift.
 * 4. Reconnect: clean state buffer reset, zero blending with pre-disconnect snapshots.
 * 5. Malformed packet bursts: safe rejection, zero renderer/runtime crashes.
 * 6. E-stop: immediate compliant damping command generation.
 */

import { StateTransportClient } from '../src/networking/StateTransportClient';
import { StateBuffer } from '../src/synchronization/StateBuffer';
import { TeleopController } from '../src/controls/TeleopController';
import {
  CommandType,
  RobotMode,
  RecoveryState,
  PolicyId,
  AsimovRobotState,
  PROTOCOL_VERSION,
} from '../src/protocol/AsimovStateProtocol';

describe('Phase 3 Failure & Safety Handling Suite (P3.9)', () => {
  let mockWs: any;

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
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const createDummyState = (seq: number, time: number, posX: number = 0): AsimovRobotState => ({
    protocolVersion: PROTOCOL_VERSION,
    flags: 0,
    robotMode: RobotMode.MOVE,
    policyId: PolicyId.OFFICIAL_LOCOMOTION,
    recoveryState: RecoveryState.NORMAL,
    safetyState: 0,
    sequenceNumber: seq,
    timestamp: time,
    basePosition: [posX, 0, 0.78],
    baseOrientation: [0, 0, 0, 1],
    linearVelocity: [0.5, 0, 0],
    angularVelocity: [0, 0, 0],
    jointPositions: new Float32Array(25),
    jointVelocities: new Float32Array(25),
    commandEcho: { linearX: 0.5, linearY: 0.0, yaw: 0.0 },
  });

  test('P3.9.1: Disconnect halts command transmission and prevents stale dispatch', () => {
    const client = new StateTransportClient({ autoReconnect: false });
    client.connect();
    mockWs.onopen();

    const teleop = new TeleopController(client);
    expect(client.isConnected()).toBe(true);

    // Command dispatches successfully while connected
    teleop.updateLeftJoystick(0.0, 1.0);
    expect(mockWs.send).toHaveBeenCalledTimes(2); // 1 handshake + 1 command

    // Simulate backend disconnect
    mockWs.readyState = 3; // CLOSED
    mockWs.onclose();
    expect(client.isConnected()).toBe(false);

    // Subsequent joystick motion must NOT send commands
    mockWs.send.mockClear();
    teleop.updateLeftJoystick(0.0, 1.0);
    expect(mockWs.send).not.toHaveBeenCalled();

    // Trigger action returns false when disconnected
    const ok = teleop.triggerAction(CommandType.STAND);
    expect(ok).toBe(false);

    client.destroy();
  });

  test('P3.9.2: Packet loss does not cause visual rewind or state tearing', () => {
    const buffer = new StateBuffer({ interpolationDelayMs: 40 });

    // Stream sequence: 10, 11 (drop 12), 13 arrives
    const s10 = createDummyState(10, 1.00, 0.10);
    const s11 = createDummyState(11, 1.02, 0.11);
    const s13 = createDummyState(13, 1.06, 0.13); // packet 12 was lost

    buffer.pushState(s10);
    buffer.pushState(s11);
    buffer.pushState(s13);

    // Sample across the missing packet interval (target render times 1.025 and 1.045)
    const pose1 = buffer.getInterpolatedPose(1.025);
    expect(pose1).not.toBeNull();
    const x1 = pose1!.basePosition[0];

    const pose2 = buffer.getInterpolatedPose(1.045);
    expect(pose2).not.toBeNull();
    const x2 = pose2!.basePosition[0];

    // Movement must be monotonically forward (no visual rewind)
    expect(x2).toBeGreaterThanOrEqual(x1);
    expect(x1).toBeGreaterThanOrEqual(0.11);
    expect(x2).toBeLessThanOrEqual(0.13);
  });

  test('P3.9.3: Starvation clamps extrapolation and holds safe pose without runaway drift', () => {
    const buffer = new StateBuffer({
      interpolationDelayMs: 40,
      maxExtrapolationMs: 100,
    });

    buffer.pushState(createDummyState(1, 1.00, 0.0));
    buffer.pushState(createDummyState(2, 1.02, 0.01)); // linear velocity 0.5 m/s

    // Request render pose 50ms after last packet (within 100ms maxExtrapolation) -> safe extrapolation
    const extraPose = buffer.getInterpolatedPose(1.02 + 0.05);
    expect(extraPose).not.toBeNull();
    expect(extraPose!.isExtrapolated).toBe(true);
    expect(extraPose!.basePosition[0]).toBeGreaterThan(0.01);

    // Request render pose 500ms after last packet (> 100ms maxExtrapolation) -> extrapolation ceases, holds latest pose
    const starvePose = buffer.getInterpolatedPose(1.02 + 0.50);
    expect(starvePose).not.toBeNull();
    expect(starvePose!.isExtrapolated).toBe(false);
    expect(starvePose!.basePosition[0]).toBeCloseTo(0.01, 3);
  });

  test('P3.9.4: Clean reconnect flushes pre-disconnect state without blending', () => {
    const buffer = new StateBuffer();

    // Session 1: Robot at X = 10.0m, sim_time = 100.0s
    buffer.pushState(createDummyState(500, 100.0, 10.0));
    buffer.pushState(createDummyState(501, 100.02, 10.01));

    // Backend resets, reconnected session starts at X = 0.0m, sim_time = 0.02s
    const sNew1 = createDummyState(1, 0.02, 0.0);
    const accepted = buffer.pushState(sNew1);
    expect(accepted).toBe(true);

    // Buffer should have flushed old snapshots due to timestamp backward discontinuity
    expect(buffer.getDepth()).toBe(1);

    // Sample pose: must be close to 0.0m, NEVER blended with 10.0m
    const pose = buffer.getInterpolatedPose(0.02);
    expect(pose).not.toBeNull();
    expect(pose!.basePosition[0]).toBeCloseTo(0.0, 2);
  });

  test('P3.9.5: Malformed packet bursts are rejected without throwing or crashing', () => {
    const client = new StateTransportClient({ autoReconnect: false });
    client.connect();
    mockWs.onopen();

    // 1. Corrupt magic
    const badMagic = new Uint8Array(288);
    badMagic[0] = 0xff; // Wrong magic
    mockWs.onmessage({ data: badMagic.buffer });

    // 2. Truncated buffer
    const truncated = new Uint8Array(64);
    mockWs.onmessage({ data: truncated.buffer });

    // 3. Corrupted payload
    const badBuffer = new ArrayBuffer(288);
    mockWs.onmessage({ data: badBuffer });

    const metrics = client.getMetrics();
    expect(metrics.malformedPacketsRejected).toBe(3);
    expect(metrics.packetsReceived).toBe(0);

    client.destroy();
  });

  test('P3.9.6: E-stop trigger immediately issues compliant DAMP command', () => {
    const client = new StateTransportClient({ autoReconnect: false });
    client.connect();
    mockWs.onopen();

    const teleop = new TeleopController(client);
    mockWs.send.mockClear();

    const ok = teleop.triggerAction(CommandType.ESTOP);
    expect(ok).toBe(true);
    expect(mockWs.send).toHaveBeenCalledTimes(1);

    const sentBuffer: ArrayBuffer = mockWs.send.mock.calls[0][0];
    expect(sentBuffer.byteLength).toBe(32);

    const view = new DataView(sentBuffer);
    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    expect(magic).toBe('VAC1');
    const cmdType = view.getUint8(5);
    expect(cmdType).toBe(CommandType.ESTOP);

    client.destroy();
  });
});
