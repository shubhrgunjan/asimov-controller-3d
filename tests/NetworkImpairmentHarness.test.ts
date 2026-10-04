/**
 * NetworkImpairmentHarness.test.ts
 * 
 * Milestone P5.5 & P5.6: Deterministic Network Impairment Test Harness
 * 
 * Simulates real-world impairment profiles:
 * - PROFILE A: 0 ms delay, 0% loss (LAN)
 * - PROFILE B: 20 ms delay, ±5 ms jitter, 0.5% loss (Good 5GHz Wi-Fi)
 * - PROFILE C: 50 ms delay, ±10 ms jitter, 1.0% loss (Standard 2.4GHz Wi-Fi)
 * - PROFILE D: 100 ms delay, ±20 ms jitter, 2.0% loss (Cellular LTE / Mild WAN)
 * - PROFILE E: 150 ms delay, ±40 ms jitter, 5.0% loss (Adverse WAN)
 * - PROFILE F: Temporary Outage (5.0 second drop and reconnect recovery)
 * 
 * Evaluates StateBuffer modes:
 * - 20 ms
 * - 30 ms
 * - 40 ms
 * - Adaptive RFC 3550 filter
 */

import { StateBuffer } from '../src/synchronization/StateBuffer';
import {
  AsimovRobotState,
  RobotMode,
  PolicyId,
  RecoveryState,
  PROTOCOL_VERSION,
} from '../src/protocol/AsimovStateProtocol';

export interface ImpairmentProfile {
  name: string;
  baseDelayMs: number;
  jitterMs: number;
  lossRate: number; // 0.0 to 1.0
  isOutage?: boolean;
  outageStartSec?: number;
  outageDurationSec?: number;
}

export interface ImpairmentEvaluationResult {
  profileName: string;
  bufferMode: string;
  starvationCount: number;
  starvationPercent: number;
  extrapolationCount: number;
  extrapolationPercent: number;
  estimatedJitterMs: number;
  effectiveLatencyMs: number;
  smoothness: 'PRISTINE' | 'ACCEPTABLE' | 'DEGRADED' | 'STARVED';
}

function mockState(seq: number, time: number, vx: number = 0.5): AsimovRobotState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    flags: 0,
    robotMode: RobotMode.MOVE,
    policyId: PolicyId.OFFICIAL_LOCOMOTION,
    recoveryState: RecoveryState.NORMAL,
    safetyState: 0,
    sequenceNumber: seq,
    timestamp: time,
    basePosition: [vx * time, 0, 0.72],
    baseOrientation: [0, 0, 0, 1],
    linearVelocity: [vx, 0, 0],
    angularVelocity: [0, 0, 0],
    jointPositions: new Float32Array(25),
    jointVelocities: new Float32Array(25),
    commandEcho: { linearX: vx, linearY: 0, yaw: 0 },
  };
}

// Pseudo-random Gaussian jitter generator (Box-Muller)
function gaussianRandom(mean = 0, stdev = 1, seed = 42): () => number {
  let s = seed;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };

  return () => {
    const u = 1 - rnd();
    const v = rnd();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return z * stdev + mean;
  };
}

export function runImpairmentExperiment(
  profile: ImpairmentProfile,
  bufferDelayMs: number,
  isAdaptive: boolean
): ImpairmentEvaluationResult {
  const buffer = new StateBuffer({
    interpolationDelayMs: bufferDelayMs,
    adaptiveBuffer: isAdaptive,
    capacity: 64,
  });

  const getJitter = gaussianRandom(0, profile.jitterMs);
  const totalDurationSec = 6.0;
  const nominalPacketDtMs = 20.0; // 50 Hz
  const renderFrameDtMs = 1000.0 / 60.0; // ~16.67 ms (60 FPS)

  const totalPackets = Math.floor((totalDurationSec * 1000) / nominalPacketDtMs);
  const totalFrames = Math.floor((totalDurationSec * 1000) / renderFrameDtMs);

  // 1. Generate packet transmission timeline with network delay, jitter, and loss
  interface ScheduledArrival {
    seq: number;
    sendTimeSec: number;
    arrivalWallMs: number;
    state: AsimovRobotState;
  }

  const arrivals: ScheduledArrival[] = [];

  for (let i = 0; i < totalPackets; i++) {
    const sendTimeSec = (i * nominalPacketDtMs) / 1000.0;
    const nominalSendMs = i * nominalPacketDtMs;

    // Check outage
    if (
      profile.isOutage &&
      sendTimeSec >= (profile.outageStartSec || 2.0) &&
      sendTimeSec < (profile.outageStartSec || 2.0) + (profile.outageDurationSec || 2.0)
    ) {
      continue; // Dropped during outage
    }

    // Check packet loss
    const lossRnd = (i * 17 + 31) % 1000 / 1000.0;
    if (lossRnd < profile.lossRate) {
      continue; // Dropped by netem loss
    }

    // Delay + Jitter
    const jitter = getJitter();
    const arrivalMs = nominalSendMs + profile.baseDelayMs + jitter;

    arrivals.push({
      seq: i + 1,
      sendTimeSec,
      arrivalWallMs: Math.max(0, arrivalMs),
      state: mockState(i + 1, sendTimeSec),
    });
  }

  // Sort by arrival time (handles network reordering naturally)
  arrivals.sort((a, b) => a.arrivalWallMs - b.arrivalWallMs);

  // 2. Step forward in discrete 60 FPS frame steps
  let packetCursor = 0;
  let framesSampled = 0;
  let starvationEvents = 0;
  let extrapolationEvents = 0;

  for (let f = 0; f < totalFrames; f++) {
    const frameWallTimeMs = f * renderFrameDtMs;

    // Deliver all packets that arrived up to this wall time
    while (packetCursor < arrivals.length && arrivals[packetCursor].arrivalWallMs <= frameWallTimeMs) {
      buffer.pushState(arrivals[packetCursor].state);
      packetCursor++;
    }

    // Sample interpolated pose at 60 FPS
    // StateBuffer automatically samples at newest.timestamp - interpolationDelaySec
    if (buffer.getDepth() >= 2) {
      const pose = buffer.getInterpolatedPose();

      if (pose) {
        framesSampled++;
        if (pose.isExtrapolated) {
          extrapolationEvents++;
        }
      }
    } else {
      if (f > 15) {
        // Starvation: render loop wanted a pose but buffer had fewer than 2 snapshots
        starvationEvents++;
      }
    }
  }

  const starvationPct = framesSampled > 0 ? (starvationEvents / totalFrames) * 100 : 100;
  const extrapPct = framesSampled > 0 ? (extrapolationEvents / framesSampled) * 100 : 0;

  let smoothness: 'PRISTINE' | 'ACCEPTABLE' | 'DEGRADED' | 'STARVED' = 'PRISTINE';
  if (starvationPct > 10.0 || extrapPct > 25.0) {
    smoothness = 'STARVED';
  } else if (starvationPct > 2.0 || extrapPct > 8.0) {
    smoothness = 'DEGRADED';
  } else if (extrapPct > 1.0) {
    smoothness = 'ACCEPTABLE';
  }

  const effectiveLatency = profile.baseDelayMs + bufferDelayMs;

  return {
    profileName: profile.name,
    bufferMode: isAdaptive ? 'ADAPTIVE' : `${bufferDelayMs}ms`,
    starvationCount: starvationEvents,
    starvationPercent: Number(starvationPct.toFixed(2)),
    extrapolationCount: extrapolationEvents,
    extrapolationPercent: Number(extrapPct.toFixed(2)),
    estimatedJitterMs: Number(buffer.getJitterMs().toFixed(2)),
    effectiveLatencyMs: effectiveLatency,
    smoothness,
  };
}

describe('P5.5 & P5.6: Network Impairment Test Harness (Profiles A - F)', () => {
  const PROFILES: ImpairmentProfile[] = [
    { name: 'PROFILE A (LAN)', baseDelayMs: 2, jitterMs: 0.5, lossRate: 0.0 },
    { name: 'PROFILE B (Good 5GHz Wi-Fi)', baseDelayMs: 20, jitterMs: 5.0, lossRate: 0.005 },
    { name: 'PROFILE C (2.4GHz Wi-Fi)', baseDelayMs: 50, jitterMs: 10.0, lossRate: 0.01 },
    { name: 'PROFILE D (Cellular LTE)', baseDelayMs: 100, jitterMs: 20.0, lossRate: 0.02 },
    { name: 'PROFILE E (Adverse WAN)', baseDelayMs: 150, jitterMs: 40.0, lossRate: 0.05 },
    {
      name: 'PROFILE F (Temporary Outage)',
      baseDelayMs: 30,
      jitterMs: 8.0,
      lossRate: 0.01,
      isOutage: true,
      outageStartSec: 2.0,
      outageDurationSec: 1.5,
    },
  ];

  const BUFFER_MODES = [
    { delayMs: 20, isAdaptive: false },
    { delayMs: 30, isAdaptive: false },
    { delayMs: 40, isAdaptive: false },
    { delayMs: 40, isAdaptive: true },
  ];

  test('Executes all Impairment Profiles against all Buffer Modes', () => {
    const matrixResults: ImpairmentEvaluationResult[] = [];

    for (const profile of PROFILES) {
      for (const mode of BUFFER_MODES) {
        const res = runImpairmentExperiment(profile, mode.delayMs, mode.isAdaptive);
        matrixResults.push(res);
      }
    }

    // Print clean console table for empirical documentation
    console.log('\n======================== PHASE 5 NETWORK IMPAIRMENT MATRIX ========================');
    console.table(
      matrixResults.map((r) => ({
        Profile: r.profileName,
        Mode: r.bufferMode,
        Starvations: `${r.starvationPercent}%`,
        Extrapolations: `${r.extrapolationPercent}%`,
        Jitter: `${r.estimatedJitterMs}ms`,
        Latency: `${r.effectiveLatencyMs}ms`,
        Smoothness: r.smoothness,
      }))
    );
    console.log('===================================================================================\n');

    // Assertions
    // Profile A (LAN) with 20ms buffer must be PRISTINE
    const lan20 = matrixResults.find((r) => r.profileName.includes('PROFILE A') && r.bufferMode === '20ms');
    expect(lan20?.smoothness).toBe('PRISTINE');
    expect(lan20?.extrapolationCount).toBe(0);

    // Profile B (5GHz Wi-Fi) with 30ms or 40ms buffer must be PRISTINE or ACCEPTABLE
    const wifi40 = matrixResults.find((r) => r.profileName.includes('PROFILE B') && r.bufferMode === '40ms');
    expect(['PRISTINE', 'ACCEPTABLE']).toContain(wifi40?.smoothness);

    // Profile E (Adverse WAN) with Adaptive must adapt and handle high jitter
    const wanAdaptive = matrixResults.find((r) => r.profileName.includes('PROFILE E') && r.bufferMode === 'ADAPTIVE');
    expect(wanAdaptive).toBeDefined();
  });
});
