/**
 * TeleopController.ts
 * 
 * Game-Like Teleoperation Control Dispatcher for Asimov 1.
 * Maps dual virtual joysticks to velocity commands (vx, vy, wz),
 * implements newest-command priority with zero queue accumulation,
 * provides precision / normal / sport speed scaling profiles,
 * response curve shaping (linear / exponential / cubic),
 * slew rate acceleration limiting, control lock, and deadman safety.
 */

import { CommandType } from '../protocol/AsimovStateProtocol';
import { StateTransportClient } from '../networking/StateTransportClient';

export type SpeedProfile = 'PRECISION' | 'NORMAL' | 'SPORT';
export type ResponseCurve = 'LINEAR' | 'EXPONENTIAL' | 'CUBIC';

export interface TeleopLimits {
  maxVxForward: number; // m/s (default: 0.8)
  maxVxReverse: number; // m/s (default: 0.4)
  maxVy: number; // m/s (default: 0.3)
  maxYawRate: number; // rad/s (default: 0.6)
  deadzone: number; // normalized radius (default: 0.08)
}

export interface SpeedProfileMultipliers {
  vxForward: number;
  vxReverse: number;
  vy: number;
  yawRate: number;
}

const SPEED_PROFILES: Record<SpeedProfile, SpeedProfileMultipliers> = {
  PRECISION: {
    vxForward: 0.35,  // 0.8 * 0.35 = 0.28 m/s
    vxReverse: 0.5,   // 0.4 * 0.5  = 0.20 m/s
    vy: 0.5,          // 0.3 * 0.5  = 0.15 m/s
    yawRate: 0.5,     // 0.6 * 0.5  = 0.30 rad/s
  },
  NORMAL: {
    vxForward: 0.75,  // 0.8 * 0.75 = 0.60 m/s
    vxReverse: 0.75,  // 0.4 * 0.75 = 0.30 m/s
    vy: 0.80,         // 0.3 * 0.80 = 0.24 m/s
    yawRate: 0.80,    // 0.6 * 0.80 = 0.48 rad/s
  },
  SPORT: {
    vxForward: 1.0,   // 0.80 m/s (max authorized by backend)
    vxReverse: 1.0,   // 0.40 m/s
    vy: 1.0,          // 0.30 m/s
    yawRate: 1.0,     // 0.60 rad/s
  },
};

export class TeleopController {
  private client: StateTransportClient;
  private limits: TeleopLimits;
  private speedProfile: SpeedProfile = 'SPORT';
  private responseCurve: ResponseCurve = 'EXPONENTIAL';
  private isLocked: boolean = false;

  // Slew rate limiting (acceleration clamping)
  private slewRateEnabled: boolean = false;
  private maxLinearAcceleration: number = 2.0; // m/s^2
  private maxAngularAcceleration: number = 3.0; // rad/s^2
  private lastUpdateTime: number = 0;

  // Joystick raw normalized state [-1, 1]
  private leftX: number = 0;
  private leftY: number = 0;
  private rightX: number = 0;

  // Current computed velocities
  private targetVx: number = 0;
  private targetVy: number = 0;
  private targetWz: number = 0;

  // Actual smoothed commanded velocities (with slew rate limiting)
  private currentVx: number = 0;
  private currentVy: number = 0;
  private currentWz: number = 0;

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

  public setSpeedProfile(profile: SpeedProfile): void {
    this.speedProfile = profile;
    this.recomputeVelocities();
  }

  public getSpeedProfile(): SpeedProfile {
    return this.speedProfile;
  }

  public setResponseCurve(curve: ResponseCurve): void {
    this.responseCurve = curve;
    this.recomputeVelocities();
  }

  public getResponseCurve(): ResponseCurve {
    return this.responseCurve;
  }

  public setControlLock(locked: boolean): void {
    this.isLocked = locked;
    if (locked) {
      this.reset();
    }
  }

  public isControlLocked(): boolean {
    return this.isLocked;
  }

  public setSlewRateLimiting(enabled: boolean, maxLinearAcc = 2.0, maxAngularAcc = 3.0): void {
    this.slewRateEnabled = enabled;
    this.maxLinearAcceleration = maxLinearAcc;
    this.maxAngularAcceleration = maxAngularAcc;
  }

  /**
   * Apply selected response curve to normalized input [-1, 1]
   */
  private applyCurve(val: number): number {
    if (Math.abs(val) < 1e-5) return 0;
    const sign = val >= 0 ? 1 : -1;
    const absVal = Math.abs(val);

    switch (this.responseCurve) {
      case 'LINEAR':
        return val;
      case 'EXPONENTIAL':
        // gamma = 1.5 gives smooth control near center while preserving full scale
        return sign * Math.pow(absVal, 1.5);
      case 'CUBIC':
        // 0.3 * x + 0.7 * x^3
        return sign * (0.3 * absVal + 0.7 * Math.pow(absVal, 3));
      default:
        return val;
    }
  }

  /**
   * Left joystick updates forward/backward (Y) and lateral left/right (X)
   */
  public updateLeftJoystick(normX: number, normY: number): void {
    if (this.isLocked) return;
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
    if (this.isLocked) return;
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
    if (this.isLocked) {
      this.targetVx = 0;
      this.targetVy = 0;
      this.targetWz = 0;
      this.currentVx = 0;
      this.currentVy = 0;
      this.currentWz = 0;
      this.isMoving = false;
      return;
    }

    const mult = SPEED_PROFILES[this.speedProfile];
    const curvedY = this.applyCurve(this.leftY);
    const curvedX = this.applyCurve(this.leftX);
    const curvedYaw = this.applyCurve(this.rightX);

    // Forward / Reverse
    if (curvedY >= 0) {
      this.targetVx = (curvedY * this.limits.maxVxForward * mult.vxForward) || 0;
    } else {
      this.targetVx = (curvedY * this.limits.maxVxReverse * mult.vxReverse) || 0;
    }

    // Lateral (in MuJoCo, +Y is Left -> joystick left (-X) maps to +Vy)
    this.targetVy = (-curvedX * this.limits.maxVy * mult.vy) || 0;

    // Yaw (in MuJoCo, +Yaw is CCW -> joystick left (-X) maps to +Wz)
    this.targetWz = (-curvedYaw * this.limits.maxYawRate * mult.yawRate) || 0;

    // Hard bounds clamping to guarantee backend-authorized contracts
    this.targetVx = Math.max(-0.6, Math.min(0.8, this.targetVx));
    this.targetVy = Math.max(-0.5, Math.min(0.5, this.targetVy));
    this.targetWz = Math.max(-0.8, Math.min(0.8, this.targetWz));

    if (!this.slewRateEnabled) {
      this.currentVx = this.targetVx;
      this.currentVy = this.targetVy;
      this.currentWz = this.targetWz;
    }

    this.isMoving = Math.abs(this.targetVx) > 1e-4 || Math.abs(this.targetVy) > 1e-4 || Math.abs(this.targetWz) > 1e-4;
  }

  private updateSlew(now: number): void {
    if (!this.slewRateEnabled) {
      this.currentVx = this.targetVx;
      this.currentVy = this.targetVy;
      this.currentWz = this.targetWz;
      this.lastUpdateTime = now;
      return;
    }

    if (this.lastUpdateTime === 0) {
      this.lastUpdateTime = now;
      this.currentVx = this.targetVx;
      this.currentVy = this.targetVy;
      this.currentWz = this.targetWz;
      return;
    }

    const dt = Math.min(0.1, Math.max(0.001, (now - this.lastUpdateTime) / 1000.0));
    this.lastUpdateTime = now;

    const maxDeltaLin = this.maxLinearAcceleration * dt;
    const maxDeltaAng = this.maxAngularAcceleration * dt;

    // Slew Vx
    const diffVx = this.targetVx - this.currentVx;
    if (Math.abs(diffVx) <= maxDeltaLin) {
      this.currentVx = this.targetVx;
    } else {
      this.currentVx += Math.sign(diffVx) * maxDeltaLin;
    }

    // Slew Vy
    const diffVy = this.targetVy - this.currentVy;
    if (Math.abs(diffVy) <= maxDeltaLin) {
      this.currentVy = this.targetVy;
    } else {
      this.currentVy += Math.sign(diffVy) * maxDeltaLin;
    }

    // Slew Wz
    const diffWz = this.targetWz - this.currentWz;
    if (Math.abs(diffWz) <= maxDeltaAng) {
      this.currentWz = this.targetWz;
    } else {
      this.currentWz += Math.sign(diffWz) * maxDeltaAng;
    }
  }

  private maybeDispatch(inputTime: number): void {
    const now = Date.now();
    if (now - this.lastDispatchTime >= this.dispatchIntervalMs) {
      this.dispatchCurrentVelocity(inputTime);
    }
  }

  private forceZeroVelocity(): void {
    if (!this.isMoving) {
      this.currentVx = 0;
      this.currentVy = 0;
      this.currentWz = 0;
      this.dispatchCurrentVelocity(Date.now());
    }
  }

  private dispatchCurrentVelocity(inputTime: number): void {
    const now = Date.now();
    this.lastDispatchTime = now;
    this.updateSlew(now);

    // Measure serialization preparation time
    this.commandPrepLatencyMs = Math.max(0, this.lastDispatchTime - inputTime);

    this.client.sendCommand(
      CommandType.WALK,
      this.currentVx,
      this.currentVy,
      this.currentWz
    );
  }

  /**
   * Trigger state machine button action (E-STOP always succeeds even if locked)
   */
  public triggerAction(commandType: CommandType): boolean {
    if (this.isLocked && commandType !== CommandType.ESTOP) {
      return false;
    }

    const t0 = Date.now();
    this.lastDispatchTime = t0;

    const ok = this.client.sendCommand(commandType);
    this.commandPrepLatencyMs = Math.max(0, Date.now() - t0);
    return ok;
  }

  public getTargetVelocities(): { vx: number; vy: number; wz: number } {
    return {
      vx: this.currentVx,
      vy: this.currentVy,
      wz: this.currentWz,
    };
  }

  public getCommandLatency(): { prepMs: number; lastDispatchTime: number } {
    return {
      prepMs: this.commandPrepLatencyMs,
      lastDispatchTime: this.lastDispatchTime,
    };
  }

  public reset(): void {
    this.leftX = 0;
    this.leftY = 0;
    this.rightX = 0;
    this.targetVx = 0;
    this.targetVy = 0;
    this.targetWz = 0;
    this.currentVx = 0;
    this.currentVy = 0;
    this.currentWz = 0;
    this.isMoving = false;
  }
}
