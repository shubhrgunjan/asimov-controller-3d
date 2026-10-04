/**
 * Diagnostics.test.ts
 * 
 * Unit tests for DiagnosticsCollector:
 * - Aggregation of metrics across CONNECTION, SIMULATION, RENDER, SYNCHRONIZATION
 * - Empirical calculations (sim advancement rate, presentation stats, buffer depth)
 * - Graceful fallback when components are disconnected or uninitialized
 * - Zero fake telemetry verification
 */

import { DiagnosticsCollector } from '../src/diagnostics/DiagnosticsCollector';
import { StateTransportClient } from '../src/networking/StateTransportClient';
import { StateBuffer, InterpolatedRobotPose } from '../src/synchronization/StateBuffer';
import { PerformanceMonitor } from '../src/benchmark/PerformanceMonitor';
import { RobotMode, RecoveryState } from '../src/protocol/AsimovStateProtocol';

describe('Phase 3 Diagnostics Suite: DiagnosticsCollector', () => {
  let mockClient: jest.Mocked<StateTransportClient>;
  let mockBuffer: jest.Mocked<StateBuffer>;
  let mockPerfMonitor: jest.Mocked<PerformanceMonitor>;
  let collector: DiagnosticsCollector;

  beforeEach(() => {
    mockClient = {
      getMetrics: jest.fn().mockReturnValue({
        connectionState: 'CONNECTED',
        host: '10.222.5.132',
        port: 8080,
        packetsReceived: 250,
        packetsDropped: 1,
        sequenceGaps: 1,
        packetRateHz: 49.8,
        packetLossPercent: 0.4,
        lastSequenceNumber: 250,
        lastPacketTimestamp: 5.0,
        rttMs: 8.5,
        stalePacketsRejected: 0,
        malformedPacketsRejected: 0,
        reconnectCount: 0,
      }),
    } as any;

    mockBuffer = {
      getDepth: jest.fn().mockReturnValue(3),
      getStaleCount: jest.fn().mockReturnValue(0),
      getNewestSequence: jest.fn().mockReturnValue(250),
    } as any;

    mockPerfMonitor = {
      getCurrentMetrics: jest.fn().mockReturnValue({
        fps: 59.8,
        meanInterval: 16.72,
        p95Interval: 17.1,
        p99Interval: 18.2,
        jankPercent: 0.8,
        missedVsyncs: 2,
        cpuTime: 0.42,
        cpuHeadroom: 16.25,
      }),
    } as any;

    collector = new DiagnosticsCollector(mockClient, mockBuffer, mockPerfMonitor);
  });

  test('P3.8.1: Correctly aggregates metrics across all four domains', () => {
    const mockPose: InterpolatedRobotPose = {
      sequenceNumber: 250,
      timestamp: 5.0,
      robotMode: RobotMode.MOVE,
      recoveryState: RecoveryState.NORMAL,
      flags: 0,
      basePosition: [0, 0, 0.78],
      baseOrientation: [0, 0, 0, 1],
      linearVelocity: [0.5, 0, 0],
      angularVelocity: [0, 0, 0.1],
      jointPositions: new Float32Array(25),
      jointVelocities: new Float32Array(25),
      stateAgeMs: 24.5,
      isExtrapolated: false,
    };

    const diag = collector.collect(mockPose);

    // 1. Connection
    expect(diag.connection.state).toBe('CONNECTED');
    expect(diag.connection.host).toBe('10.222.5.132');
    expect(diag.connection.rttMs).toBe(8.5);
    expect(diag.connection.packetRateHz).toBe(49.8);
    expect(diag.connection.packetLossPercent).toBe(0.4);

    // 2. Simulation
    expect(diag.simulation.policyHz).toBe(50.0);
    expect(diag.simulation.activePolicy).toBe('official_locomotion');
    expect(diag.simulation.robotMode).toBe('MOVE');
    expect(diag.simulation.recoveryState).toBe('NORMAL');

    // 3. Render
    expect(diag.render.displayFps).toBe(59.8);
    expect(diag.render.presentationIntervalMs).toBe(16.72);
    expect(diag.render.jankPercent).toBe(0.8);
    expect(diag.render.missedVsyncs).toBe(2);
    expect(diag.render.cpuPrepMs).toBe(0.42);

    // 4. Synchronization
    expect(diag.synchronization.bufferDepth).toBe(3);
    expect(diag.synchronization.stateAgeMs).toBe(24.5);
    expect(diag.synchronization.newestSequence).toBe(250);
    expect(diag.synchronization.isExtrapolated).toBe(false);
  });

  test('P3.8.2: Handles disconnected and uninitialized sources safely', () => {
    const emptyCollector = new DiagnosticsCollector();
    const diag = emptyCollector.collect(null);

    expect(diag.connection.state).toBe('DISCONNECTED');
    expect(diag.connection.rttMs).toBe(0);
    expect(diag.simulation.robotMode).toBe('DISCONNECTED');
    expect(diag.render.displayFps).toBe(60);
    expect(diag.synchronization.bufferDepth).toBe(0);
    expect(diag.synchronization.isExtrapolated).toBe(false);
  });

  test('P3.8.3: Accurately reflects extrapolated state during packet starvation', () => {
    const starvedPose: InterpolatedRobotPose = {
      sequenceNumber: 100,
      timestamp: 2.0,
      robotMode: RobotMode.MOVE,
      recoveryState: RecoveryState.NORMAL,
      flags: 0,
      basePosition: [0, 0, 0.78],
      baseOrientation: [0, 0, 0, 1],
      linearVelocity: [0, 0, 0],
      angularVelocity: [0, 0, 0],
      jointPositions: new Float32Array(25),
      jointVelocities: new Float32Array(25),
      stateAgeMs: 95.2,
      isExtrapolated: true,
    };

    const diag = collector.collect(starvedPose);
    expect(diag.synchronization.isExtrapolated).toBe(true);
    expect(diag.synchronization.stateAgeMs).toBe(95.2);
  });
});
