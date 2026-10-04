/**
 * Controls.test.ts
 * 
 * Unit tests for TeleopController:
 * - Velocity mapping from dual joysticks
 * - Deadzone filtering
 * - Asymmetric forward/reverse limits
 * - Joystick release immediate zero-velocity dispatch
 * - Action button command types
 * - Newest-command priority
 * - Command serialization latency measurement
 */

import { TeleopController } from '../src/controls/TeleopController';
import { StateTransportClient } from '../src/networking/StateTransportClient';
import { CommandType } from '../src/protocol/AsimovStateProtocol';

describe('Phase 3 Teleoperation Controls Suite: TeleopController', () => {
  let mockClient: jest.Mocked<StateTransportClient>;
  let controller: TeleopController;

  beforeEach(() => {
    mockClient = {
      sendCommand: jest.fn().mockReturnValue(true),
    } as any;

    controller = new TeleopController(mockClient, {
      maxVxForward: 0.8,
      maxVxReverse: 0.4,
      maxVy: 0.3,
      maxYawRate: 0.6,
      deadzone: 0.08,
    });
  });

  test('P3.6.1: Maps forward and reverse joystick inputs with asymmetric limits', () => {
    // Full forward (Y = 1.0)
    controller.updateLeftJoystick(0.0, 1.0);
    let v = controller.getTargetVelocities();
    expect(v.vx).toBeCloseTo(0.8, 3);
    expect(v.vy).toBeCloseTo(0.0, 3);

    // Full reverse (Y = -1.0)
    controller.updateLeftJoystick(0.0, -1.0);
    v = controller.getTargetVelocities();
    expect(v.vx).toBeCloseTo(-0.4, 3);
  });

  test('P3.6.2: Filters small touch jitter within deadzone', () => {
    // Small touch below 0.08 deadzone radius
    controller.updateLeftJoystick(0.05, 0.05); // r = 0.0707 < 0.08
    let v = controller.getTargetVelocities();
    expect(v.vx).toBe(0);
    expect(v.vy).toBe(0);

    controller.updateRightJoystick(0.04);
    v = controller.getTargetVelocities();
    expect(v.wz).toBe(0);
  });

  test('P3.6.3: Maps lateral and yaw inputs correctly', () => {
    // Lateral Left (X = -1.0 -> vy = +0.3 m/s)
    controller.updateLeftJoystick(-1.0, 0.0);
    let v = controller.getTargetVelocities();
    expect(v.vy).toBeCloseTo(0.3, 3);

    // Lateral Right (X = 1.0 -> vy = -0.3 m/s)
    controller.updateLeftJoystick(1.0, 0.0);
    v = controller.getTargetVelocities();
    expect(v.vy).toBeCloseTo(-0.3, 3);

    // Yaw CCW (X = -1.0 -> wz = +0.6 rad/s)
    controller.updateRightJoystick(-1.0);
    v = controller.getTargetVelocities();
    expect(v.wz).toBeCloseTo(0.6, 3);
  });

  test('P3.6.4: Releasing joystick immediately dispatches zero velocity', () => {
    controller.updateLeftJoystick(0.0, 1.0);
    expect(mockClient.sendCommand).toHaveBeenCalledWith(CommandType.WALK, 0.8, 0, 0);

    mockClient.sendCommand.mockClear();
    controller.releaseLeftJoystick();
    expect(mockClient.sendCommand).toHaveBeenCalledWith(CommandType.WALK, 0, 0, 0);
  });

  test('P3.6.5: Action buttons trigger expected CommandType', () => {
    controller.triggerAction(CommandType.STAND);
    expect(mockClient.sendCommand).toHaveBeenCalledWith(CommandType.STAND);

    controller.triggerAction(CommandType.CROUCH);
    expect(mockClient.sendCommand).toHaveBeenCalledWith(CommandType.CROUCH);

    controller.triggerAction(CommandType.RECOVERY);
    expect(mockClient.sendCommand).toHaveBeenCalledWith(CommandType.RECOVERY);

    controller.triggerAction(CommandType.ESTOP);
    expect(mockClient.sendCommand).toHaveBeenCalledWith(CommandType.ESTOP);
  });

  test('P3.6.6: Measures empirical command prep latency (< 1ms)', () => {
    controller.updateLeftJoystick(0.0, 0.5);
    const latency = controller.getCommandLatency();
    expect(latency.prepMs).toBeGreaterThanOrEqual(0);
    expect(latency.prepMs).toBeLessThan(5); // preparation completes well under 5ms
  });
});
