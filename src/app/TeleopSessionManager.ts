/**
 * TeleopSessionManager.ts
 * 
 * Central Coordinator for Live Real-Time Teleoperation & Robot Synchronization:
 * - Owns StateTransportClient (50 Hz binary VAS1 / VAC1 protocol)
 * - Owns StateBuffer (temporal jitter absorption, SLERP, 25-joint linear interpolation)
 * - Owns TeleopController (dual joysticks, newest-command priority, asymmetric limits)
 * - Owns DiagnosticsCollector (aggregates Connection, Simulation, Render, Sync metrics)
 * - Drives zero-allocation robot joint synchronization in the 60 FPS Three.js render loop.
 */

import { StateTransportClient, ConnectionState } from '../networking/StateTransportClient';
import { StateBuffer, InterpolatedRobotPose } from '../synchronization/StateBuffer';
import { TeleopController } from '../controls/TeleopController';
import { DiagnosticsCollector } from '../diagnostics/DiagnosticsCollector';
import { AsimovRobotModel } from '../model/AsimovRobotModel';
import { PerformanceMonitor } from '../benchmark/PerformanceMonitor';

export interface TeleopSessionOptions {
  host?: string;
  port?: number;
  autoConnect?: boolean;
  interpolationDelayMs?: number;
}

export class TeleopSessionManager {
  public readonly client: StateTransportClient;
  public readonly buffer: StateBuffer;
  public readonly teleop: TeleopController;
  public readonly diagnostics: DiagnosticsCollector;

  private robotModel: AsimovRobotModel | null = null;
  private latestPose: InterpolatedRobotPose | null = null;

  constructor(
    robotModel?: AsimovRobotModel,
    monitor?: PerformanceMonitor,
    options: TeleopSessionOptions = {}
  ) {
    if (robotModel) this.robotModel = robotModel;

    // 1. Initialize State Buffer (default 40ms jitter absorption window)
    this.buffer = new StateBuffer({
      interpolationDelayMs: options.interpolationDelayMs ?? 40,
      maxExtrapolationMs: 100,
    });

    // 2. Initialize State Transport Client
    const host = options.host || '10.222.5.132';
    const port = options.port || 8854;
    this.client = new StateTransportClient({
      host,
      port,
      autoReconnect: true,
      onStateReceived: (state) => {
        this.buffer.pushState(state);
      },
      onConnectionChange: (state: ConnectionState) => {
        if (state === 'CONNECTED') {
          // Flush stale pre-disconnect snapshots upon fresh handshake
          this.buffer.reset();
        }
      },
    });

    // 3. Initialize Teleoperation Controller
    this.teleop = new TeleopController(this.client);

    // 4. Initialize Diagnostics Collector
    this.diagnostics = new DiagnosticsCollector(this.client, this.buffer, monitor);

    // Auto-connect if requested
    if (options.autoConnect !== false) {
      this.client.connect();
    }
  }

  public setRobotModel(robotModel: AsimovRobotModel): void {
    this.robotModel = robotModel;
  }

  public setPerformanceMonitor(monitor: PerformanceMonitor): void {
    this.diagnostics.setSources({ performanceMonitor: monitor });
  }

  /**
   * Called every frame in the 60 FPS Three.js render loop.
   * Samples temporal state buffer and applies authoritative transforms to 3D model.
   * Zero GC allocations.
   */
  public update(): InterpolatedRobotPose | null {
    const pose = this.buffer.getInterpolatedPose();
    this.latestPose = pose;

    if (pose && this.robotModel) {
      this.robotModel.applyAuthoritativeState(pose);
    }

    return pose;
  }

  public getLatestPose(): InterpolatedRobotPose | null {
    return this.latestPose;
  }

  public connect(): void {
    this.client.connect();
  }

  public disconnect(): void {
    this.client.disconnect();
  }

  public updateServerAddress(host: string, port: number): void {
    this.client.setHost(host, port);
  }

  public dispose(): void {
    this.client.destroy();
    this.buffer.reset();
  }
}
