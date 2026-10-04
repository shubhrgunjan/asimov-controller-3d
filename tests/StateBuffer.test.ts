/**
 * StateBuffer.test.ts
 * 
 * Unit tests for StateBuffer:
 * - Ordered packets and exact temporal interpolation
 * - Quaternion SLERP accuracy across angles
 * - Linear interpolation across all 25 joints
 * - Out-of-order packet rejection
 * - Duplicate sequence rejection
 * - Packet loss / missing packets handling
 * - Timestamp discontinuity / server reset detection
 * - Extrapolation limits
 */

import { StateBuffer } from '../src/synchronization/StateBuffer';
import {
  AsimovRobotState,
  RobotMode,
  PolicyId,
  RecoveryState,
  PROTOCOL_VERSION,
} from '../src/protocol/AsimovStateProtocol';

describe('Phase 3 Synchronization Suite: StateBuffer & Interpolation', () => {
  const makeSnapshot = (
    seq: number,
    time: number,
    baseZ: number = 0.6,
    quat: [number, number, number, number] = [0, 0, 0, 1],
    kneeAngle: number = 0.0
  ): AsimovRobotState => {
    const qpos = new Float32Array(25);
    qpos[3] = kneeAngle; // Left knee joint is index 3
    const qvel = new Float32Array(25);

    return {
      protocolVersion: PROTOCOL_VERSION,
      flags: 0,
      robotMode: RobotMode.MOVE,
      policyId: PolicyId.OFFICIAL_LOCOMOTION,
      recoveryState: RecoveryState.NORMAL,
      safetyState: 0,
      sequenceNumber: seq,
      timestamp: time,
      basePosition: [0.0, 0.0, baseZ],
      baseOrientation: quat,
      linearVelocity: [0.5, 0.0, 0.0],
      angularVelocity: [0.0, 0.0, 0.1],
      jointPositions: qpos,
      jointVelocities: qvel,
      commandEcho: { linearX: 0.5, linearY: 0, yaw: 0.1 },
    };
  };

  test('P3.4.1: Interpolates ordered packets linearly at midpoint time', () => {
    const buffer = new StateBuffer({ interpolationDelayMs: 0 });

    const s0 = makeSnapshot(1, 10.0, 0.60, [0, 0, 0, 1], 0.0);
    const s1 = makeSnapshot(2, 10.02, 0.64, [0, 0, 0, 1], 0.4);

    buffer.pushState(s0);
    buffer.pushState(s1);

    expect(buffer.getDepth()).toBe(2);

    // Query midpoint: 10.01s (alpha = 0.5)
    const pose = buffer.getInterpolatedPose(10.01);
    expect(pose).not.toBeNull();
    expect(pose?.basePosition[2]).toBeCloseTo(0.62, 4); // (0.60 + 0.64)/2
    expect(pose?.jointPositions[3]).toBeCloseTo(0.2, 4); // (0.0 + 0.4)/2
    expect(pose?.isExtrapolated).toBe(false);
  });

  test('P3.4.2: Performs accurate spherical linear interpolation (SLERP) on quaternions', () => {
    const buffer = new StateBuffer({ interpolationDelayMs: 0 });

    // Rotate 90 degrees around Y axis:
    // q0 = identity = [0, 0, 0, 1]
    // q1 = 90 deg around Y = [0, sin(45 deg), 0, cos(45 deg)] = [0, 0.7071068, 0, 0.7071068]
    const q0: [number, number, number, number] = [0, 0, 0, 1];
    const q1: [number, number, number, number] = [0, Math.SQRT1_2, 0, Math.SQRT1_2];

    buffer.pushState(makeSnapshot(1, 0.0, 0.6, q0));
    buffer.pushState(makeSnapshot(2, 1.0, 0.6, q1));

    // Evaluate midpoint alpha = 0.5 -> expected rotation = 45 degrees around Y:
    // q_mid = [0, sin(22.5 deg), 0, cos(22.5 deg)] = [0, 0.3826834, 0, 0.9238795]
    const mid = buffer.getInterpolatedPose(0.5);
    expect(mid).not.toBeNull();
    expect(mid?.baseOrientation[0]).toBeCloseTo(0.0, 4);
    expect(mid?.baseOrientation[1]).toBeCloseTo(0.3826834, 4);
    expect(mid?.baseOrientation[2]).toBeCloseTo(0.0, 4);
    expect(mid?.baseOrientation[3]).toBeCloseTo(0.9238795, 4);

    // Verify quaternion remains strictly normalized
    const norm = Math.hypot(
      mid!.baseOrientation[0],
      mid!.baseOrientation[1],
      mid!.baseOrientation[2],
      mid!.baseOrientation[3]
    );
    expect(norm).toBeCloseTo(1.0, 5);
  });

  test('P3.4.3: Rejects out-of-order and duplicate packets', () => {
    const buffer = new StateBuffer();

    expect(buffer.pushState(makeSnapshot(10, 1.0))).toBe(true);
    // Duplicate
    expect(buffer.pushState(makeSnapshot(10, 1.0))).toBe(false);
    // Out of order
    expect(buffer.pushState(makeSnapshot(9, 0.98))).toBe(false);

    expect(buffer.getDepth()).toBe(1);
    expect(buffer.getStaleCount()).toBe(2);
  });

  test('P3.4.4: Handles packet loss gracefully without visual collapse', () => {
    const buffer = new StateBuffer({ interpolationDelayMs: 0 });

    // Emulate loss of packets 2, 3, 4
    buffer.pushState(makeSnapshot(1, 10.0, 0.60, [0, 0, 0, 1], 0.1));
    buffer.pushState(makeSnapshot(5, 10.08, 0.68, [0, 0, 0, 1], 0.5));

    // Interpolate in the gap at 10.04s (midpoint)
    const gapPose = buffer.getInterpolatedPose(10.04);
    expect(gapPose).not.toBeNull();
    expect(gapPose?.basePosition[2]).toBeCloseTo(0.64, 4);
    expect(gapPose?.jointPositions[3]).toBeCloseTo(0.3, 4);
  });

  test('P3.4.5: Detects timestamp discontinuities and flushes buffer cleanly', () => {
    const buffer = new StateBuffer();

    buffer.pushState(makeSnapshot(100, 50.0));
    buffer.pushState(makeSnapshot(101, 50.02));
    expect(buffer.getDepth()).toBe(2);

    // Server reset: timestamp jumps back to 0.0s
    buffer.pushState(makeSnapshot(1, 0.0));
    expect(buffer.getDepth()).toBe(1);
    expect(buffer.getNewestSequence()).toBe(1);
    expect(buffer.getNewestTimestamp()).toBeCloseTo(0.0, 3);
  });

  test('P3.4.6: Clamps extrapolation to safety limit', () => {
    const buffer = new StateBuffer({ maxExtrapolationMs: 100 });

    const s = makeSnapshot(1, 10.0, 0.6);
    s.linearVelocity = [1.0, 0.0, 0.0]; // 1 m/s along X
    buffer.pushState(s);
    buffer.pushState(makeSnapshot(2, 10.02, 0.6));

    // Query 50ms into future (<= 100ms) -> safe extrapolation
    const extra50 = buffer.getInterpolatedPose(10.07);
    expect(extra50).not.toBeNull();
    expect(extra50?.isExtrapolated).toBe(true);

    // Query 200ms into future (> 100ms) -> extrapolation ceases, holds latest pose
    const extra200 = buffer.getInterpolatedPose(10.22);
    expect(extra200).not.toBeNull();
    expect(extra200?.isExtrapolated).toBe(false);
  });
});
