/**
 * AppSettings.ts
 * 
 * Central Configuration & Persistent Settings Store for Asimov Controller 3D.
 * Manages operational connection targets, 3D rendering modes, temporal
 * synchronization buffer parameters, and developer diagnostics visibility.
 */

import { ResolutionMode } from '../renderer/ThreeRenderer';
import { CameraMode } from '../renderer/SceneManager';

export interface ConnectionConfig {
  host: string;
  port: number;
  autoReconnect: boolean;
  reconnectIntervalMs: number;
  maxReconnectAttempts: number;
}

export interface RenderingConfig {
  resolution: ResolutionMode;
  defaultCameraMode: CameraMode;
  shadowsEnabled: boolean;
}

export interface SynchronizationConfig {
  interpolationDelayMs: number; // 20ms, 30ms, 40ms
  adaptiveBuffer: boolean;
  maxExtrapolationMs: number;
}

export interface DiagnosticsConfig {
  showDevHud: boolean;
  enableTelemetryLogging: boolean;
  logLevel: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
}

export interface AppConfig {
  connection: ConnectionConfig;
  rendering: RenderingConfig;
  synchronization: SynchronizationConfig;
  diagnostics: DiagnosticsConfig;
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  connection: {
    host: '127.0.0.1',
    port: 8854,
    autoReconnect: true,
    reconnectIntervalMs: 1500,
    maxReconnectAttempts: 10,
  },
  rendering: {
    resolution: '720p',
    defaultCameraMode: 'third_person',
    shadowsEnabled: false,
  },
  synchronization: {
    interpolationDelayMs: 40,
    adaptiveBuffer: false,
    maxExtrapolationMs: 100,
  },
  diagnostics: {
    showDevHud: false,
    enableTelemetryLogging: false,
    logLevel: 'INFO',
  },
};

export class AppSettingsManager {
  private config: AppConfig;
  private listeners: Set<(config: AppConfig) => void> = new Set();

  constructor(initialConfig: Partial<AppConfig> = {}) {
    this.config = {
      connection: { ...DEFAULT_APP_CONFIG.connection, ...initialConfig.connection },
      rendering: { ...DEFAULT_APP_CONFIG.rendering, ...initialConfig.rendering },
      synchronization: { ...DEFAULT_APP_CONFIG.synchronization, ...initialConfig.synchronization },
      diagnostics: { ...DEFAULT_APP_CONFIG.diagnostics, ...initialConfig.diagnostics },
    };
  }

  public getConfig(): Readonly<AppConfig> {
    return this.config;
  }

  public updateConnection(patch: Partial<ConnectionConfig>): void {
    this.config.connection = { ...this.config.connection, ...patch };
    this.notify();
  }

  public updateRendering(patch: Partial<RenderingConfig>): void {
    this.config.rendering = { ...this.config.rendering, ...patch };
    this.notify();
  }

  public updateSynchronization(patch: Partial<SynchronizationConfig>): void {
    this.config.synchronization = { ...this.config.synchronization, ...patch };
    this.notify();
  }

  public updateDiagnostics(patch: Partial<DiagnosticsConfig>): void {
    this.config.diagnostics = { ...this.config.diagnostics, ...patch };
    this.notify();
  }

  public resetToDefaults(): void {
    this.config = JSON.parse(JSON.stringify(DEFAULT_APP_CONFIG));
    this.notify();
  }

  public subscribe(listener: (config: AppConfig) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.config);
    }
  }
}

// Global singleton instance
export const appSettings = new AppSettingsManager();
