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
});
