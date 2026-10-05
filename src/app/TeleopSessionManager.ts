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
import { LocalPhysicsEngine } from '../physics/LocalPhysicsEngine';

export interface TeleopSessionOptions {
  host?: string;
  port?: number;
  autoConnect?: boolean;
  interpolationDelayMs?: number;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
}

export class TeleopSessionManager {
  public readonly client: StateTransportClient;
  public readonly buffer: StateBuffer;
  public readonly teleop: TeleopController;
  public readonly diagnostics: DiagnosticsCollector;

  private robotModel: AsimovRobotModel | null = null;
  private latestPose: InterpolatedRobotPose | null = null;
  public readonly localPhysics = new LocalPhysicsEngine();

  constructor(
    robotModel?: AsimovRobotModel,
    monitor?: PerformanceMonitor,
    options: TeleopSessionOptions = {}
  ) {
    if (robotModel) {
      this.robotModel = robotModel;
      this.localPhysics.setRobotModel(robotModel);
    }

    // 1. Initialize State Buffer (default 40ms jitter absorption window)
    this.buffer = new StateBuffer({
      interpolationDelayMs: options.interpolationDelayMs ?? 40,
      maxExtrapolationMs: 100,
    });

    // 2. Initialize State Transport Client
    const host = options.host || '127.0.0.1';
    const port = options.port || 8854;
    this.client = new StateTransportClient({
      host,
      port,
      autoReconnect: true,
      reconnectIntervalMs: options.reconnectIntervalMs,
      maxReconnectAttempts: options.maxReconnectAttempts,
      onStateReceived: (state) => {
        this.buffer.pushState(state);
      },
      onEnvironmentReceived: (envData) => {
        this.handleEnvironmentUpdate(envData);
      },
      onConnectionChange: (state: ConnectionState) => {
        if (state === 'CONNECTED') {
          // Flush stale pre-disconnect snapshots upon fresh handshake
          this.buffer.reset();
          this.startEnvironmentSync();
        } else if (state === 'DISCONNECTED' || state === 'RECONNECTING' || state === 'FAILED') {
          // Immediately kill stale velocity targets
          this.teleop?.reset();
          this.stopEnvironmentSync();
        }
        for (const listener of this.connectionListeners) {
          try {
            listener(state);
          } catch (err) {
            console.error('[TeleopSessionManager] Listener error:', err);
          }
        }
      },
    });

    // 3. Initialize Teleoperation Controller
    this.teleop = new TeleopController(this.client);

    // 4. Initialize Diagnostics Collector
    this.diagnostics = new DiagnosticsCollector(this.client, this.buffer, monitor);

    // Auto-connect if requested (default to false in Phase 4 for operator explicit connection)
    if (options.autoConnect === true) {
      this.client.connect();
    }
  }

  private connectionListeners: Set<(state: ConnectionState) => void> = new Set();

  public addConnectionListener(listener: (state: ConnectionState) => void): () => void {
    this.connectionListeners.add(listener);
    // Immediately emit current state
    listener(this.client.getMetrics().connectionState);
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  public getConnectionState(): ConnectionState {
    return this.client.getMetrics().connectionState;
  }

  public setInterpolationDelay(delayMs: number): void {
    this.buffer.setInterpolationDelay(delayMs);
  }

  public setRobotModel(robotModel: AsimovRobotModel): void {
    this.robotModel = robotModel;
    this.localPhysics.setRobotModel(robotModel);
  }

  public setPerformanceMonitor(monitor: PerformanceMonitor): void {
    this.diagnostics.setSources({ performanceMonitor: monitor });
  }

  /**
   * Called every frame in the 60 FPS Three.js render loop.
   * Seamlessly arbitrates between:
   * 1. Live Authoritative 50 Hz MuJoCo simulation stream (when connected to PC)
   * 2. Standalone Real Physics & Kinematics Engine (gravity, floor normal constraint, inverted pendulum gait)
   * Zero GC allocations.
   */
  public update(deltaSeconds: number = 0.016): InterpolatedRobotPose | null {
    this.buffer.advancePlaybackTime(deltaSeconds);
    const authoritativePose = this.buffer.getInterpolatedPose();

    if (authoritativePose && this.robotModel) {
      // 1. Live Authoritative MuJoCo Physics Stream
      this.latestPose = authoritativePose;
      this.robotModel.applyAuthoritativeState(authoritativePose);

      // Keep local physics engine coordinates aligned with authoritative base pose
      this.localPhysics.worldPos.set(
        -authoritativePose.basePosition[1],
        authoritativePose.basePosition[2],
        -authoritativePose.basePosition[0]
      );
      return authoritativePose;
    }

    // 2. Real Standalone Local Physics & Locomotion Simulator
    // Translates user joystick inputs into physical momentum, inverted pendulum gait, and grounded foot contact
    const targetVels = this.teleop.getTargetVelocities();
    const simulatedPose = this.localPhysics.step(
      deltaSeconds,
      targetVels.vx,
      targetVels.vy,
      targetVels.wz
    );

    this.latestPose = simulatedPose;
    return simulatedPose;
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

  private scene: any = null;
  private envSyncInterval: any = null;
  private currentEnvironment: any = { preset: 'pair_lab', name: 'pair_lab' };
  private environmentListeners: Set<(env: any) => void> = new Set();

  public setScene(scene: any): void {
    this.scene = scene;
    if (this.currentEnvironment && this.scene && typeof this.scene.syncEnvironment === 'function') {
      this.scene.syncEnvironment(this.currentEnvironment);
    }
  }

  public addEnvironmentListener(listener: (env: any) => void): () => void {
    this.environmentListeners.add(listener);
    if (this.currentEnvironment) listener(this.currentEnvironment);
    return () => {
      this.environmentListeners.delete(listener);
    };
  }

  public getCurrentEnvironment(): any {
    return this.currentEnvironment;
  }

  public handleEnvironmentUpdate(env: any): void {
    if (!env) return;
    const currentName = this.currentEnvironment?.preset || this.currentEnvironment?.name;
    const newName = env.preset || env.name;
    const changed = !this.currentEnvironment || currentName !== newName;
    this.currentEnvironment = env;
    if (this.scene && typeof this.scene.syncEnvironment === 'function') {
      this.scene.syncEnvironment(env);
    }
    if (changed) {
      for (const l of this.environmentListeners) {
        try { l(env); } catch (_) {}
      }
    }
  }

  public startEnvironmentSync(scene?: any): void {
    if (scene) this.scene = scene;
    if (this.envSyncInterval) clearInterval(this.envSyncInterval);

    // Initial query over active WebSocket immediately
    this.client.queryEnvironment();

    const poll = async () => {
      // 1. Send WebSocket query (bypasses Android cleartext restrictions)
      this.client.queryEnvironment();

      // 2. Auxiliary HTTP fetch
      const host = this.client.getMetrics().host || '127.0.0.1';
      try {
        const res = await fetch(`http://${host}:8852/api/state`, { method: 'GET' });
        if (res.ok) {
          const data = await res.json();
          if (data && data.environment) {
            this.handleEnvironmentUpdate(data.environment);
          }
        }
      } catch (_) {}
    };

    poll();
    this.envSyncInterval = setInterval(poll, 1500);
  }

  public stopEnvironmentSync(): void {
    if (this.envSyncInterval) {
      clearInterval(this.envSyncInterval);
      this.envSyncInterval = null;
    }
  }

  public async setEnvironmentPreset(preset: string): Promise<boolean> {
    // 1. Dispatch over WebSocket immediately
    this.client.setEnvironmentPreset(preset);

    // 2. Also send over HTTP fallback
    const host = this.client.getMetrics().host || '127.0.0.1';
    try {
      await fetch(`http://${host}:8852/api/control/environment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset }),
      });
    } catch (_) {}

    // 3. Immediately query updated environment
    setTimeout(() => {
      this.client.queryEnvironment();
    }, 150);

    return true;
  }

  public async triggerEmote(name: string): Promise<boolean> {
    // 1. Dispatch over WebSocket
    const ws = (this.client as any).ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ action: 'emote', params: { name } }));
      } catch (_) {}
    }

    // 2. Dispatch over HTTP fallback
    const host = this.client.getMetrics().host || '127.0.0.1';
    try {
      const res = await fetch(`http://${host}:8852/api/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'emote', params: { name } }),
      });
      return res.ok;
    } catch (_) {
      return true; // WebSocket already sent
    }
  }

  public dispose(): void {
    this.stopEnvironmentSync();
    this.environmentListeners.clear();
    this.connectionListeners.clear();
    this.client.destroy();
    this.buffer.reset();
  }
}
