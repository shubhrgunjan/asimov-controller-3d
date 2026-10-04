/**
 * TeleopController.ts
 * 
 * Game-Like Teleoperation Control Dispatcher for Asimov 1.
 * Maps dual virtual joysticks to velocity commands (vx, vy, wz),
 * implements newest-command priority with zero queue accumulation,
 * and measures empirical touch-to-serialization latency.
 */

import { CommandType } from '../protocol/AsimovStateProtocol';
import { StateTransportClient } from '../networking/StateTransportClient';

export interface TeleopLimits {
  maxVxForward: number; // m/s (default: 0.8)
  maxVxReverse: number; // m/s (default: 0.4)
  maxVy: number; // m/s (default: 0.3)
  maxYawRate: number; // rad/s (default: 0.6)
  deadzone: number; // normalized radius (default: 0.08)
}

export class TeleopController {
  private client: StateTransportClient;
  private limits: TeleopLimits;

  // Joystick raw normalized state [-1, 1]
  private leftX: number = 0;
  private leftY: number = 0;
  private rightX: number = 0;

  // Current computed velocities
  private targetVx: number = 0;
  private targetVy: number = 0;
  private targetWz: number = 0;

  // Dispatch throttle & timing
  private lastDispatchTime: number = 0;
  private dispatchIntervalMs: number = 40; // 25 Hz command rate
  private isMoving: boolean = false;

  // Empirical latency tracking
  private lastTouchInputTime: number = 0;
  private commandPrepLatencyMs: number = 0;

  constructor(client: StateTransportClient, customLimits: Partial<TeleopLimits> = {}) {
    this.client = client;
    this.limits = {
      maxVxForward: customLimits.maxVxForward ?? 0.8,
      maxVxReverse: customLimits.maxVxReverse ?? 0.4,
      maxVy: customLimits.maxVy ?? 0.3,
      maxYawRate: customLimits.maxYawRate ?? 0.6,
      deadzone: customLimits.deadzone ?? 0.08,
    };
  }

  /**
   * Left joystick updates forward/backward (Y) and lateral left/right (X)
   */
  public updateLeftJoystick(normX: number, normY: number): void {
    const t0 = Date.now();
    this.lastTouchInputTime = t0;

    const r = Math.hypot(normX, normY);
    if (r < this.limits.deadzone) {
      this.leftX = 0;
      this.leftY = 0;
    } else {
      this.leftX = Math.max(-1, Math.min(1, normX));
      this.leftY = Math.max(-1, Math.min(1, normY));
    }

    this.recomputeVelocities();
    this.maybeDispatch(t0);
  }

  /**
   * Right joystick updates yaw rate (X)
   */
  public updateRightJoystick(normX: number): void {
    const t0 = Date.now();
    this.lastTouchInputTime = t0;

    if (Math.abs(normX) < this.limits.deadzone) {
      this.rightX = 0;
    } else {
      this.rightX = Math.max(-1, Math.min(1, normX));
    }

    this.recomputeVelocities();
    this.maybeDispatch(t0);
  }

  public releaseLeftJoystick(): void {
    this.leftX = 0;
    this.leftY = 0;
    this.recomputeVelocities();
    this.forceZeroVelocity();
  }

  public releaseRightJoystick(): void {
    this.rightX = 0;
    this.recomputeVelocities();
    this.forceZeroVelocity();
  }

  private recomputeVelocities(): void {
    // Forward / Reverse
    if (this.leftY >= 0) {
      this.targetVx = (this.leftY * this.limits.maxVxForward) || 0;
    } else {
      this.targetVx = (this.leftY * this.limits.maxVxReverse) || 0;
    }

    // Lateral (in MuJoCo, +Y is Left -> joystick left (-X) maps to +Vy)
    this.targetVy = (-this.leftX * this.limits.maxVy) || 0;

    // Yaw (in MuJoCo, +Yaw is CCW -> joystick left (-X) maps to +Wz)
    this.targetWz = (-this.rightX * this.limits.maxYawRate) || 0;

    this.isMoving = Math.abs(this.targetVx) > 1e-4 || Math.abs(this.targetVy) > 1e-4 || Math.abs(this.targetWz) > 1e-4;
  }

  private maybeDispatch(inputTime: number): void {
    const now = Date.now();
    if (now - this.lastDispatchTime >= this.dispatchIntervalMs) {
      this.dispatchCurrentVelocity(inputTime);
    }
  }

  private forceZeroVelocity(): void {
    if (!this.isMoving) {
      this.dispatchCurrentVelocity(Date.now());
    }
  }

  private dispatchCurrentVelocity(inputTime: number): void {
    this.lastDispatchTime = Date.now();

    // Measure serialization preparation time
    this.commandPrepLatencyMs = Math.max(0, this.lastDispatchTime - inputTime);

    this.client.sendCommand(
      CommandType.WALK,
      this.targetVx,
      this.targetVy,
      this.targetWz
    );
  }

  /**
   * Trigger state machine button action
   */
  public triggerAction(commandType: CommandType): boolean {
    const t0 = Date.now();
    this.lastDispatchTime = t0;

    const ok = this.client.sendCommand(commandType);
    this.commandPrepLatencyMs = Math.max(0, Date.now() - t0);
    return ok;
  }

  public getTargetVelocities(): { vx: number; vy: number; wz: number } {
    return {
      vx: this.targetVx,
      vy: this.targetVy,
      wz: this.targetWz,
    };
  }

  public getCommandLatency(): { prepMs: number; lastDispatchTime: number } {
    return {
      prepMs: this.commandPrepLatencyMs,
      lastDispatchTime: this.lastDispatchTime,
    };
  }
}
