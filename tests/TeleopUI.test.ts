/**
 * TeleopUI.test.ts
 * 
 * Unit tests for Milestone P4.3 & P4.5:
 * - Production Teleoperation UI
 * - OperatorStatusBar status mapping (RobotMode, PolicyId, RecoveryState, Safety)
 * - Commanded velocity formatting
 * - Mode dispatch and E-STOP trigger verification
 */

import { TeleopController } from '../src/controls/TeleopController';
import { StateTransportClient } from '../src/networking/StateTransportClient';
import {
  CommandType,
  RobotMode,
  PolicyId,
  RecoveryState,
} from '../src/protocol/AsimovStateProtocol';

describe('P4.3 & P4.5: Teleoperation UI & Operator Status Presentation', () => {
  let mockClient: StateTransportClient;
  let controller: TeleopController;
  let sentCommands: any[] = [];

  beforeEach(() => {
    sentCommands = [];
    mockClient = {
      sendCommand: (type: number, vx: number, vy: number, wz: number, flags: number) => {
        sentCommands.push({ type, vx, vy, wz, flags });
        return true;
      },
      getMetrics: () => ({
        connectionState: 'CONNECTED',
        host: '10.222.5.132',
        port: 8854,
        packetsReceived: 100,
        packetsDropped: 0,
        sequenceGaps: 0,
        packetRateHz: 50,
        packetLossPercent: 0,
        lastSequenceNumber: 100,
        lastPacketTimestamp: 1000.0,
        lastPacketArrivalWallTime: Date.now(),
        lastPacketAgeMs: 5,
        rttMs: 6.2,
        stalePacketsRejected: 0,
        malformedPacketsRejected: 0,
        reconnectCount: 0,
      }),
    } as any;

    controller = new TeleopController(mockClient);
  });

  test('TeleopController dispatches all action commands cleanly', () => {
    const actions = [
      CommandType.STAND,
      CommandType.WALK,
      CommandType.CROUCH,
      CommandType.RECOVERY,
      CommandType.DAMP,
      CommandType.RESET,
      CommandType.ESTOP,
    ];

    for (const action of actions) {
      const ok = controller.triggerAction(action);
      expect(ok).toBe(true);
    }

    expect(sentCommands.length).toBe(7);
    expect(sentCommands.map((c) => c.type)).toEqual(actions);
  });

  test('E-STOP immediately dispatches emergency halt command', () => {
    const ok = controller.triggerAction(CommandType.ESTOP);
    expect(ok).toBe(true);
    expect(sentCommands[0].type).toBe(CommandType.ESTOP);
  });

  test('Joystick movement computes velocity targets within configured limits', () => {
    // Forward full stroke
    controller.updateLeftJoystick(0.0, 1.0);
    let v = controller.getTargetVelocities();
    expect(v.vx).toBeCloseTo(0.8, 2);
    expect(v.vy).toBeCloseTo(0.0, 2);

    // Reverse full stroke
    controller.updateLeftJoystick(0.0, -1.0);
    v = controller.getTargetVelocities();
    expect(v.vx).toBeCloseTo(-0.4, 2);

    // Lateral left full stroke (-X -> +Vy)
    controller.updateLeftJoystick(-1.0, 0.0);
    v = controller.getTargetVelocities();
    expect(v.vy).toBeCloseTo(0.3, 2);

    // Yaw rotation left full stroke (-X -> +Wz)
    controller.updateRightJoystick(-1.0);
    v = controller.getTargetVelocities();
    expect(v.wz).toBeCloseTo(0.6, 2);
  });

  test('Deadzone filters out subtle resting finger movements', () => {
    // 0.05 is inside default 0.08 deadzone
    controller.updateLeftJoystick(0.05, 0.05);
    const v = controller.getTargetVelocities();
    expect(v.vx).toBe(0);
    expect(v.vy).toBe(0);
  });

  test('Neutralizes velocities on release', () => {
    controller.updateLeftJoystick(0.8, 0.8);
    expect(controller.getTargetVelocities().vx).toBeGreaterThan(0);

    controller.releaseLeftJoystick();
    expect(controller.getTargetVelocities().vx).toBe(0);
    expect(controller.getTargetVelocities().vy).toBe(0);

    controller.updateRightJoystick(0.9);
    expect(controller.getTargetVelocities().wz).toBeLessThan(0);

    controller.releaseRightJoystick();
    expect(controller.getTargetVelocities().wz).toBe(0);
  });

  test('P5.1: Speed Profiles scale velocities appropriately', () => {
    // 1. PRECISION Profile
    controller.setSpeedProfile('PRECISION');
    expect(controller.getSpeedProfile()).toBe('PRECISION');
    controller.updateLeftJoystick(0.0, 1.0); // Full forward
    let v = controller.getTargetVelocities();
    expect(v.vx).toBeCloseTo(0.28, 2);

    controller.updateLeftJoystick(0.0, -1.0); // Full reverse
    v = controller.getTargetVelocities();
    expect(v.vx).toBeCloseTo(-0.20, 2);

    controller.updateLeftJoystick(-1.0, 0.0); // Full left
    v = controller.getTargetVelocities();
    expect(v.vy).toBeCloseTo(0.15, 2);

    controller.updateRightJoystick(-1.0); // Full yaw left
    v = controller.getTargetVelocities();
    expect(v.wz).toBeCloseTo(0.30, 2);

    // 2. NORMAL Profile
    controller.setSpeedProfile('NORMAL');
    expect(controller.getSpeedProfile()).toBe('NORMAL');
    controller.updateLeftJoystick(0.0, 1.0);
    v = controller.getTargetVelocities();
    expect(v.vx).toBeCloseTo(0.60, 2);

    // 3. SPORT Profile
    controller.setSpeedProfile('SPORT');
    expect(controller.getSpeedProfile()).toBe('SPORT');
    controller.updateLeftJoystick(0.0, 1.0);
    v = controller.getTargetVelocities();
    expect(v.vx).toBeCloseTo(0.80, 2);
  });

  test('P5.1: Response Curves shape near-center deflection smoothly', () => {
    controller.setSpeedProfile('SPORT');

    // Linear curve: at 0.5 deflection -> 0.5 * 0.8 = 0.40 m/s
    controller.setResponseCurve('LINEAR');
    expect(controller.getResponseCurve()).toBe('LINEAR');
    controller.updateLeftJoystick(0.0, 0.5);
    let vLinear = controller.getTargetVelocities().vx;
    expect(vLinear).toBeCloseTo(0.40, 2);

    // Exponential curve (gamma=1.5): at 0.5 deflection -> (0.5)^1.5 * 0.8 = 0.3535 * 0.8 ≈ 0.283 m/s
    controller.setResponseCurve('EXPONENTIAL');
    expect(controller.getResponseCurve()).toBe('EXPONENTIAL');
    controller.updateLeftJoystick(0.0, 0.5);
    let vExp = controller.getTargetVelocities().vx;
    expect(vExp).toBeLessThan(vLinear);
    expect(vExp).toBeCloseTo(0.283, 2);

    // Cubic curve: at 0.5 deflection -> (0.3*0.5 + 0.7*0.125)*0.8 = 0.2375 * 0.8 = 0.19 m/s
    controller.setResponseCurve('CUBIC');
    expect(controller.getResponseCurve()).toBe('CUBIC');
    controller.updateLeftJoystick(0.0, 0.5);
    let vCubic = controller.getTargetVelocities().vx;
    expect(vCubic).toBeLessThan(vExp);
    expect(vCubic).toBeCloseTo(0.19, 2);
  });

  test('P5.1: Operator Control Lock blocks inputs and mode changes, but E-STOP bypasses', () => {
    controller.setControlLock(true);
    expect(controller.isControlLocked()).toBe(true);

    // Joystick input must be ignored
    controller.updateLeftJoystick(0.0, 1.0);
    expect(controller.getTargetVelocities().vx).toBe(0);

    // Regular action buttons must be blocked
    const walkOk = controller.triggerAction(CommandType.WALK);
    expect(walkOk).toBe(false);

    // E-STOP must always bypass control lock
    const estopOk = controller.triggerAction(CommandType.ESTOP);
    expect(estopOk).toBe(true);

    // Unlocking restores control
    controller.setControlLock(false);
    expect(controller.isControlLocked()).toBe(false);
    controller.updateLeftJoystick(0.0, 1.0);
    expect(controller.getTargetVelocities().vx).toBeGreaterThan(0);
  });

  test('P5.1: Strict boundary value verification against backend contracts', () => {
    controller.setSpeedProfile('SPORT');
    controller.setResponseCurve('LINEAR');

    // Forward limit <= +0.8
    controller.updateLeftJoystick(0.0, 1.0);
    expect(controller.getTargetVelocities().vx).toBeLessThanOrEqual(0.8);
    expect(controller.getTargetVelocities().vx).toBeGreaterThanOrEqual(0.0);

    // Reverse limit >= -0.4
    controller.updateLeftJoystick(0.0, -1.0);
    expect(controller.getTargetVelocities().vx).toBeGreaterThanOrEqual(-0.4);
    expect(controller.getTargetVelocities().vx).toBeLessThanOrEqual(0.0);

    // Lateral limit within [-0.3, +0.3]
    controller.updateLeftJoystick(-1.0, 0.0);
    expect(controller.getTargetVelocities().vy).toBeCloseTo(0.3, 2);
    controller.updateLeftJoystick(1.0, 0.0);
    expect(controller.getTargetVelocities().vy).toBeCloseTo(-0.3, 2);

    // Yaw limit within [-0.6, +0.6]
    controller.updateRightJoystick(-1.0);
    expect(controller.getTargetVelocities().wz).toBeCloseTo(0.6, 2);
    controller.updateRightJoystick(1.0);
    expect(controller.getTargetVelocities().wz).toBeCloseTo(-0.6, 2);
  });
});
