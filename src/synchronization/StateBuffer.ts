/**
 * StateBuffer.ts
 * 
 * High-Performance Client-Side Temporal Jitter Buffer and Interpolator.
 * Buffers 50 Hz authoritative robot state snapshots, absorbs mobile network jitter,
 * performs exact SLERP for base orientation and linear interpolation for 25 joints,
 * and supplies smooth 60 FPS render poses with zero garbage-collection allocations.
 */

import {
  AsimovRobotState,
  RobotMode,
  RecoveryState,
} from '../protocol/AsimovStateProtocol';

export interface InterpolatedRobotPose {
  timestamp: number;
  sequenceNumber: number;
  robotMode: RobotMode;
  recoveryState: RecoveryState;
  flags: number;
  basePosition: [number, number, number];
  baseOrientation: [number, number, number, number]; // [x, y, z, w]
  linearVelocity: [number, number, number];
  angularVelocity: [number, number, number];
  jointPositions: Float32Array; // 25 elements
  jointVelocities: Float32Array; // 25 elements
  isExtrapolated: boolean;
  stateAgeMs: number;
}

export interface StateBufferOptions {
  capacity?: number;
  interpolationDelayMs?: number; // default: 40ms (2 packet intervals @ 50 Hz)
  maxExtrapolationMs?: number; // default: 100ms
  adaptiveBuffer?: boolean;
}

export class StateBuffer {
  private capacity: number;
  private interpolationDelaySec: number;
  private maxExtrapolationSec: number;
  private adaptiveBuffer: boolean = false;

  private snapshots: AsimovRobotState[] = [];
  private lastSequenceNumber: number = 0;
  private lastTimestamp: number = 0;
  private staleCount: number = 0;
  private lastPushWallTime: number = 0;

  // Real-time jitter & starvation telemetry
  private lastArrivalWallTime: number = 0;
  private lastSenderTimestamp: number = 0;
  private estimatedJitterMs: number = 0;
  private starvationCount: number = 0;
  private extrapolationCount: number = 0;
  private playbackTime: number = 0;

  // Pre-allocated reusable pose output to avoid GC in the 60 FPS render loop
  private readonly cachedPose: InterpolatedRobotPose = {
    timestamp: 0,
    sequenceNumber: 0,
    robotMode: RobotMode.STAND,
    recoveryState: RecoveryState.NORMAL,
    flags: 0,
    basePosition: [0, 0, 0],
    baseOrientation: [0, 0, 0, 1],
    linearVelocity: [0, 0, 0],
    angularVelocity: [0, 0, 0],
    jointPositions: new Float32Array(25),
    jointVelocities: new Float32Array(25),
    isExtrapolated: false,
    stateAgeMs: 0,
  };

  constructor(options: StateBufferOptions = {}) {
    this.capacity = options.capacity || 24;
    this.interpolationDelaySec = (options.interpolationDelayMs || 60) / 1000.0;
    this.maxExtrapolationSec = (options.maxExtrapolationMs || 100) / 1000.0;
    this.adaptiveBuffer = options.adaptiveBuffer ?? false;
  }

  /**
   * Insert a new authoritative state snapshot into the buffer.
   * Rejects out-of-order, stale, or duplicate sequence numbers.
   * Handles timestamp discontinuities cleanly.
   */
  public pushState(state: AsimovRobotState): boolean {
    const seq = state.sequenceNumber;
    const time = state.timestamp;
    const wallNow = Date.now();
    this.lastPushWallTime = wallNow;

    // RFC 3550 Inter-Arrival Jitter Calculation
    if (this.lastArrivalWallTime > 0 && this.lastSenderTimestamp > 0) {
      const transitDiff = (wallNow - this.lastArrivalWallTime) - (time - this.lastSenderTimestamp) * 1000.0;
      const d = Math.abs(transitDiff);
      this.estimatedJitterMs += (d - this.estimatedJitterMs) / 16.0;

      if (this.adaptiveBuffer) {
        // Nominal interval is 20ms @ 50Hz. Delay = 20ms + 2 * Jitter, clamped between 20ms and 50ms
        const targetDelay = Math.min(50, Math.max(20, 20 + 2.0 * this.estimatedJitterMs));
        this.interpolationDelaySec = targetDelay / 1000.0;
      }
    }
    this.lastArrivalWallTime = wallNow;
    this.lastSenderTimestamp = time;

    // 1. Detect server reset or timestamp discontinuity
    // If timestamp jumps backwards by more than 1.0 second, reset buffer
    if (this.snapshots.length > 0 && time < this.lastTimestamp - 1.0) {
      this.reset();
    }

    // 2. Monotonic sequence check
    if (this.snapshots.length > 0) {
      // Reconnect / counter wrap detection (jump > 100,000)
      const isSequenceWrap = seq > 0 && this.lastSequenceNumber > 4000000000;
      if (!isSequenceWrap && seq <= this.lastSequenceNumber) {
        this.staleCount++;
        return false; // Stale or duplicate packet
      }
    }

    this.lastSequenceNumber = seq;
    this.lastTimestamp = time;

    // 3. Insert in chronological order (maintains sorted invariant)
    let insertIdx = this.snapshots.length;
    while (insertIdx > 0 && this.snapshots[insertIdx - 1].timestamp > time) {
      insertIdx--;
    }
    this.snapshots.splice(insertIdx, 0, state);

    // 4. Enforce capacity limit
    while (this.snapshots.length > this.capacity) {
      this.snapshots.shift();
    }

    return true;
  }

  /**
   * Advance continuous presentation playback clock (called every 60/120 Hz render frame)
   */
  public advancePlaybackTime(deltaSec: number): void {
    if (this.snapshots.length === 0) return;
    const newest = this.snapshots[this.snapshots.length - 1];
    const idealTime = newest.timestamp - this.interpolationDelaySec;

    if (this.playbackTime <= 0 || Math.abs(this.playbackTime - idealTime) > 0.35) {
      this.playbackTime = idealTime;
    } else {
      const drift = this.playbackTime - idealTime;
      let rate = 1.0;
      const deadband = 0.005; // 5ms deadband to prevent oscillation
      if (Math.abs(drift) > deadband) {
        const error = drift > 0 ? drift - deadband : drift + deadband;
        // Smooth proportional adjustment clamped between 0.90x and 1.10x
        rate = 1.0 - Math.max(-0.10, Math.min(0.10, error * 2.0));
      }
      this.playbackTime += deltaSec * rate;
    }
  }

  public getPlaybackTime(): number {
    return this.playbackTime;
  }

  /**
   * Evaluates the interpolated robot pose for a given target timestamp.
   * If targetTime is omitted, evaluates at continuous playback clock or (newestTimestamp - interpolationDelaySec).
   * Returns null if buffer is empty.
   */
  public getInterpolatedPose(targetTime?: number): InterpolatedRobotPose | null {
    const len = this.snapshots.length;
    if (len === 0) return null;

    const newest = this.snapshots[len - 1];
    const oldest = this.snapshots[0];

    // Determine target evaluation time
    const t = targetTime !== undefined
      ? targetTime
      : this.playbackTime > 0
      ? this.playbackTime
      : newest.timestamp - this.interpolationDelaySec;

    const out = this.cachedPose;
    const wallNow = Date.now();
    out.stateAgeMs = this.lastPushWallTime > 0 ? wallNow - this.lastPushWallTime : 0;

    // 1. Edge Case: Buffer has only 1 snapshot
    if (len === 1) {
      this.copySnapshotToPose(newest, out);
      out.isExtrapolated = false;
      return out;
    }

    // 2. Target is before or at the oldest snapshot
    if (t <= oldest.timestamp) {
      this.copySnapshotToPose(oldest, out);
      out.isExtrapolated = false;
      return out;
    }

    // 3. Target is at or beyond the newest snapshot (packet delay/jitter)
    if (t >= newest.timestamp) {
      this.starvationCount++;
      const deltaBeyond = t - newest.timestamp;
      this.copySnapshotToPose(newest, out);

      if (deltaBeyond > 0 && deltaBeyond <= this.maxExtrapolationSec) {
        this.extrapolationCount++;
        if (targetTime !== undefined) {
          out.basePosition[0] += newest.linearVelocity[0] * deltaBeyond;
          out.basePosition[1] += newest.linearVelocity[1] * deltaBeyond;
          out.basePosition[2] += newest.linearVelocity[2] * deltaBeyond;
        }
        out.isExtrapolated = true;
      } else {
        out.isExtrapolated = false;
      }
      return out;
    }

    // 4. Normal Case: Find bracket [S0, S1] such that S0.time <= t <= S1.time
    let i0 = 0;
    for (let i = 0; i < len - 1; i++) {
      if (this.snapshots[i].timestamp <= t && t <= this.snapshots[i + 1].timestamp) {
        i0 = i;
        break;
      }
    }

    const s0 = this.snapshots[i0];
    const s1 = this.snapshots[i0 + 1];
    const dt = s1.timestamp - s0.timestamp;
    const alpha = dt > 1e-6 ? Math.max(0.0, Math.min(1.0, (t - s0.timestamp) / dt)) : 0.0;

    // Interpolate Base Position using Cubic Hermite Spline (C1 velocity-continuous trajectory)
    if (dt > 1e-6) {
      const a2 = alpha * alpha;
      const a3 = a2 * alpha;
      const h00 = 2 * a3 - 3 * a2 + 1;
      const h10 = a3 - 2 * a2 + alpha;
      const h01 = -2 * a3 + 3 * a2;
      const h11 = a3 - a2;

      for (let k = 0; k < 3; k++) {
        const p0 = s0.basePosition[k];
        const p1 = s1.basePosition[k];
        const m0 = s0.linearVelocity[k] * dt;
        const m1 = s1.linearVelocity[k] * dt;
        out.basePosition[k] = h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1;
      }
    } else {
      out.basePosition[0] = s0.basePosition[0];
      out.basePosition[1] = s0.basePosition[1];
      out.basePosition[2] = s0.basePosition[2];
    }

    // Interpolate Base Orientation (Exact Quaternion SLERP)
    this.slerpQuaternions(s0.baseOrientation, s1.baseOrientation, alpha, out.baseOrientation);

    // Interpolate Base Velocities
    out.linearVelocity[0] = s0.linearVelocity[0] + alpha * (s1.linearVelocity[0] - s0.linearVelocity[0]);
    out.linearVelocity[1] = s0.linearVelocity[1] + alpha * (s1.linearVelocity[1] - s0.linearVelocity[1]);
    out.linearVelocity[2] = s0.linearVelocity[2] + alpha * (s1.linearVelocity[2] - s0.linearVelocity[2]);

    out.angularVelocity[0] = s0.angularVelocity[0] + alpha * (s1.angularVelocity[0] - s0.angularVelocity[0]);
    out.angularVelocity[1] = s0.angularVelocity[1] + alpha * (s1.angularVelocity[1] - s0.angularVelocity[1]);
    out.angularVelocity[2] = s0.angularVelocity[2] + alpha * (s1.angularVelocity[2] - s0.angularVelocity[2]);

    // Interpolate all 25 Joint Positions and Velocities (Linear Lerp)
    const jp0 = s0.jointPositions;
    const jp1 = s1.jointPositions;
    const jv0 = s0.jointVelocities;
    const jv1 = s1.jointVelocities;

    for (let j = 0; j < 25; j++) {
      out.jointPositions[j] = jp0[j] + alpha * (jp1[j] - jp0[j]);
      out.jointVelocities[j] = jv0[j] + alpha * (jv1[j] - jv0[j]);
    }

    // Status taken from newer snapshot
    out.timestamp = t;
    out.sequenceNumber = s1.sequenceNumber;
    out.robotMode = s1.robotMode;
    out.recoveryState = s1.recoveryState;
    out.flags = s1.flags;
    out.isExtrapolated = false;

    return out;
  }

  /**
   * Exact unit-quaternion SLERP with acute angle preservation
   */
  private slerpQuaternions(
    q0: [number, number, number, number],
    q1: [number, number, number, number],
    alpha: number,
    out: [number, number, number, number]
  ): void {
    let x0 = q0[0], y0 = q0[1], z0 = q0[2], w0 = q0[3];
    let x1 = q1[0], y1 = q1[1], z1 = q1[2], w1 = q1[3];

    // Compute dot product (cosine of angle)
    let dot = x0 * x1 + y0 * y1 + z0 * z1 + w0 * w1;

    // If dot product is negative, invert one quaternion to take acute path
    if (dot < 0.0) {
      x1 = -x1;
      y1 = -y1;
      z1 = -z1;
      w1 = -w1;
      dot = -dot;
    }

    // If nearly identical, fall back to Normalized Lerp (NLERP)
    if (dot > 0.9995) {
      const rx = x0 + alpha * (x1 - x0);
      const ry = y0 + alpha * (y1 - y0);
      const rz = z0 + alpha * (z1 - z0);
      const rw = w0 + alpha * (w1 - w0);
      const len = Math.sqrt(rx * rx + ry * ry + rz * rz + rw * rw) || 1.0;
      out[0] = rx / len;
      out[1] = ry / len;
      out[2] = rz / len;
      out[3] = rw / len;
      return;
    }

    // Standard SLERP
    const theta0 = Math.acos(Math.max(-1.0, Math.min(1.0, dot)));
    const sinTheta0 = Math.sin(theta0);
    const theta = theta0 * alpha;
    const sinTheta = Math.sin(theta);

    const s0 = Math.cos(theta) - dot * sinTheta / sinTheta0;
    const s1 = sinTheta / sinTheta0;

    out[0] = s0 * x0 + s1 * x1;
    out[1] = s0 * y0 + s1 * y1;
    out[2] = s0 * z0 + s1 * z1;
    out[3] = s0 * w0 + s1 * w1;
  }

  private copySnapshotToPose(src: AsimovRobotState, out: InterpolatedRobotPose): void {
    out.timestamp = src.timestamp;
    out.sequenceNumber = src.sequenceNumber;
    out.robotMode = src.robotMode;
    out.recoveryState = src.recoveryState;
    out.flags = src.flags;

    out.basePosition[0] = src.basePosition[0];
    out.basePosition[1] = src.basePosition[1];
    out.basePosition[2] = src.basePosition[2];

    out.baseOrientation[0] = src.baseOrientation[0];
    out.baseOrientation[1] = src.baseOrientation[1];
    out.baseOrientation[2] = src.baseOrientation[2];
    out.baseOrientation[3] = src.baseOrientation[3];

    out.linearVelocity[0] = src.linearVelocity[0];
    out.linearVelocity[1] = src.linearVelocity[1];
    out.linearVelocity[2] = src.linearVelocity[2];

    out.angularVelocity[0] = src.angularVelocity[0];
    out.angularVelocity[1] = src.angularVelocity[1];
    out.angularVelocity[2] = src.angularVelocity[2];

    out.jointPositions.set(src.jointPositions);
    out.jointVelocities.set(src.jointVelocities);
  }

  public reset(): void {
    this.snapshots = [];
    this.lastSequenceNumber = 0;
    this.lastTimestamp = 0;
    this.lastArrivalWallTime = 0;
    this.lastSenderTimestamp = 0;
    this.estimatedJitterMs = 0;
    this.playbackTime = 0;
  }

  public getDepth(): number {
    return this.snapshots.length;
  }

  public getStaleCount(): number {
    return this.staleCount;
  }

  public getNewestTimestamp(): number {
    return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1].timestamp : 0;
  }

  public getOldestTimestamp(): number {
    return this.snapshots.length > 0 ? this.snapshots[0].timestamp : 0;
  }

  public getNewestSequence(): number {
    return this.lastSequenceNumber;
  }

  public setInterpolationDelay(delayMs: number): void {
    this.interpolationDelaySec = Math.max(0.005, delayMs / 1000.0);
  }

  public getInterpolationDelayMs(): number {
    return this.interpolationDelaySec * 1000.0;
  }

  public getJitterMs(): number {
    return Math.round(this.estimatedJitterMs * 10) / 10;
  }

  public getStarvationCount(): number {
    return this.starvationCount;
  }

  public getExtrapolationCount(): number {
    return this.extrapolationCount;
  }

  public setAdaptiveBuffer(enabled: boolean): void {
    this.adaptiveBuffer = enabled;
  }

  public isAdaptiveBuffer(): boolean {
    return this.adaptiveBuffer;
  }
}
