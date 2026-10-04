import { RenderStats } from '../renderer/ThreeRenderer';

export interface FrameMetrics {
  timestampMs: number;
  frameDeltaMs: number;
  renderCpuTimeMs: number;
  estimatedGpuWaitMs: number;
  instantaneousFps: number;
}

export interface StutterReport {
  countGt20ms: number;
  countGt25ms: number;
  countGt33ms: number;
  countGt50ms: number;
  totalStalls: number;
  stallPercentage: number;
}

export interface SteadyStateSummary {
  sampleCount: number;
  durationSeconds: number;
  
  // VSync-Driven Frame Callback Timing (SurfaceFlinger presentation timestamps not independently captured)
  targetRefreshRateHz: number;
  averageFps: number; // VSync-driven frame callback rate (clamped to targetRefreshRateHz)
  minFps: number;
  maxFps: number;
  averageFrameTimeMs: number; // VSync-driven frame callback interval (target ~16.67 ms at 60 Hz)
  medianFrameTimeMs: number;
  p95FrameTimeMs: number;
  p99FrameTimeMs: number;
  frameTimeVariance: number;
  frameTimeStdDev: number;

  // CPU / Render Preparation Timing (JS execution, scene traversal, draw submission)
  averageCpuTimeMs: number;
  medianCpuTimeMs: number;
  p95CpuTimeMs: number;
  p99CpuTimeMs: number;
  cpuHeadroomMs: number; // targetFrameBudget - averageCpuTimeMs

  // Missed Vsyncs & Jank Analytics
  missedVsyncs: number;
  jankPercentage: number;
  stutters: StutterReport;
  renderStats: RenderStats;
  memoryEstimateMB: {
    textureVramMB: number;
    geometryCount: number;
    textureCount: number;
    programCount: number;
    jsHeapUsedMB?: number;
  };
}

export interface PeriodicSnapshot {
  elapsedSeconds: number;
  fps: number;
  avgFrameTimeMs: number;
  p95FrameTimeMs: number;
  stalls: number;
  renderCalls: number;
  triangles: number;
}

export type MonitorPhase = 'STANDBY' | 'WARMUP' | 'RECORDING' | 'SUSTAINED' | 'COMPLETE';

/**
 * PerformanceMonitor
 * 
 * High-precision frame timing, percentile analytics, stutter event detection,
 * memory tracking, and thermal degradation monitoring.
 */
export class PerformanceMonitor {
  private phase: MonitorPhase = 'STANDBY';
  private targetFps: number = 60;
  private targetFrameBudgetMs: number = 16.667;

  // Timers and sample windows
  private warmupDurationMs: number = 3000;
  private recordingDurationMs: number = 10000;
  private phaseStartTimeMs: number = 0;
  private lastFrameTimestampMs: number = 0;

  // Frame samples
  private startupFrameTimes: number[] = [];
  private steadyStateFrameTimes: number[] = [];
  private steadyStateCpuTimes: number[] = [];
  private recentFrameHistory: number[] = []; // Ring buffer of 120 recent frames for HUD sparkline
  private readonly maxRecentHistory = 120;

  // Stutter counters
  private countGt20ms = 0;
  private countGt25ms = 0;
  private countGt33ms = 0;
  private countGt50ms = 0;

  // Periodic snapshots for long-run thermal endurance tests
  private periodicSnapshots: PeriodicSnapshot[] = [];
  private lastPeriodicSampleTimeMs = 0;
  private readonly periodicSampleIntervalMs = 5000; // Sample every 5 seconds

  // Latest cached metrics for instantaneous HUD query
  private latestMetrics: FrameMetrics = {
    timestampMs: 0,
    frameDeltaMs: 16.67,
    renderCpuTimeMs: 1.0,
    estimatedGpuWaitMs: 15.67,
    instantaneousFps: 60.0,
  };

  private latestRenderStats: RenderStats = {
    calls: 0,
    triangles: 0,
    points: 0,
    lines: 0,
    geometries: 0,
    textures: 0,
    programs: 0,
    renderCpuTimeMs: 0,
    resolution: { width: 1280, height: 720 },
  };

  constructor(targetFps: number = 60) {
    this.setTargetFps(targetFps);
  }

  public setTargetFps(fps: number): void {
    this.targetFps = fps;
    this.targetFrameBudgetMs = 1000 / fps;
  }

  public getTargetFps(): number {
    return this.targetFps;
  }

  public getTargetBudgetMs(): number {
    return this.targetFrameBudgetMs;
  }

  public getPhase(): MonitorPhase {
    return this.phase;
  }

  public getPhaseProgress(): number {
    if (this.phase === 'WARMUP') {
      const elapsed = performance.now() - this.phaseStartTimeMs;
      return Math.min(1.0, elapsed / this.warmupDurationMs);
    }
    if (this.phase === 'RECORDING') {
      const elapsed = performance.now() - this.phaseStartTimeMs;
      return Math.min(1.0, elapsed / this.recordingDurationMs);
    }
    if (this.phase === 'COMPLETE') return 1.0;
    return 0.0;
  }

  /**
   * Start a standard benchmark run: Warm-up -> Recording -> Complete
   */
  public startBenchmark(warmupMs: number = 3000, durationMs: number = 10000): void {
    this.warmupDurationMs = warmupMs;
    this.recordingDurationMs = durationMs;
    this.reset();
    this.phase = 'WARMUP';
    this.phaseStartTimeMs = performance.now();
    this.lastFrameTimestampMs = performance.now();
  }

  /**
   * Start a sustained endurance run (e.g. 10-15 minutes)
   */
  public startSustainedRun(durationMs: number = 600000): void {
    this.warmupDurationMs = 3000;
    this.recordingDurationMs = durationMs;
    this.reset();
    this.phase = 'WARMUP';
    this.phaseStartTimeMs = performance.now();
    this.lastFrameTimestampMs = performance.now();
  }

  public reset(): void {
    this.phase = 'STANDBY';
    this.startupFrameTimes = [];
    this.steadyStateFrameTimes = [];
    this.steadyStateCpuTimes = [];
    this.recentFrameHistory = [];
    this.periodicSnapshots = [];
    this.countGt20ms = 0;
    this.countGt25ms = 0;
    this.countGt33ms = 0;
    this.countGt50ms = 0;
    this.lastPeriodicSampleTimeMs = 0;
  }

  /**
   * Record frame boundary and profile times
   */
  public recordFrame(renderStats: RenderStats, simulatedPresentationDeltaMs?: number): FrameMetrics {
    const now = performance.now();
    this.latestRenderStats = renderStats;

    if (this.lastFrameTimestampMs === 0) {
      this.lastFrameTimestampMs = now;
      return this.latestMetrics;
    }

    const frameDeltaMs = simulatedPresentationDeltaMs !== undefined
      ? simulatedPresentationDeltaMs
      : (now - this.lastFrameTimestampMs);
    this.lastFrameTimestampMs = now;

    // Filter out aberrant negative or multi-second pauses during context pause
    if (frameDeltaMs <= 0 || frameDeltaMs > 2000) {
      return this.latestMetrics;
    }

    const cpuTimeMs = renderStats.renderCpuTimeMs;
    const gpuWaitMs = Math.max(0, frameDeltaMs - cpuTimeMs);
    // VSync callback rate can never exceed the hardware display refresh rate
    const instantaneousFps = Math.min(this.targetFps, Math.round((1000 / Math.max(1.0, frameDeltaMs)) * 10) / 10);

    this.latestMetrics = {
      timestampMs: now,
      frameDeltaMs,
      renderCpuTimeMs: cpuTimeMs,
      estimatedGpuWaitMs: gpuWaitMs,
      instantaneousFps,
    };

    // Update ring buffer for HUD display
    this.recentFrameHistory.push(frameDeltaMs);
    if (this.recentFrameHistory.length > this.maxRecentHistory) {
      this.recentFrameHistory.shift();
    }

    // State machine transitions
    if (this.phase === 'WARMUP') {
      this.startupFrameTimes.push(frameDeltaMs);
      if (now - this.phaseStartTimeMs >= this.warmupDurationMs) {
        this.phase = 'RECORDING';
        this.phaseStartTimeMs = now;
        this.lastPeriodicSampleTimeMs = now;
      }
    } else if (this.phase === 'RECORDING' || this.phase === 'SUSTAINED') {
      this.steadyStateFrameTimes.push(frameDeltaMs);
      this.steadyStateCpuTimes.push(cpuTimeMs);

      // Detect and catalog stutter events
      if (frameDeltaMs > 20) this.countGt20ms++;
      if (frameDeltaMs > 25) this.countGt25ms++;
      if (frameDeltaMs > 33.33) this.countGt33ms++;
      if (frameDeltaMs > 50) this.countGt50ms++;

      // Periodic snapshots for long-run analysis
      if (now - this.lastPeriodicSampleTimeMs >= this.periodicSampleIntervalMs) {
        this.recordPeriodicSnapshot(now);
        this.lastPeriodicSampleTimeMs = now;
      }

      if (now - this.phaseStartTimeMs >= this.recordingDurationMs) {
        this.phase = 'COMPLETE';
      }
    }

    return this.latestMetrics;
  }

  private recordPeriodicSnapshot(now: number): void {
    const elapsedSeconds = Math.round((now - this.phaseStartTimeMs) / 1000);
    // Compute stats over last window
    const recent = this.steadyStateFrameTimes.slice(-300);
    if (recent.length === 0) return;

    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const sorted = [...recent].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || avg;

    this.periodicSnapshots.push({
      elapsedSeconds,
      fps: Math.min(this.targetFps, Math.round((1000 / avg) * 10) / 10),
      avgFrameTimeMs: Math.round(avg * 100) / 100,
      p95FrameTimeMs: Math.round(p95 * 100) / 100,
      stalls: this.countGt33ms,
      renderCalls: this.latestRenderStats.calls,
      triangles: this.latestRenderStats.triangles,
    });
  }

  public getLatestMetrics(): FrameMetrics {
    return this.latestMetrics;
  }

  public getLatestRenderStats(): RenderStats {
    return this.latestRenderStats;
  }

  public getRecentHistory(): number[] {
    return this.recentFrameHistory;
  }

  public getPeriodicSnapshots(): PeriodicSnapshot[] {
    return this.periodicSnapshots;
  }

  /**
   * Returns current instantaneous & rolling window metrics for real-time diagnostics HUD
   */
  public getCurrentMetrics(): {
    fps: number;
    meanInterval: number;
    p95Interval: number;
    p99Interval: number;
    jankPercent: number;
    missedVsyncs: number;
    cpuTime: number;
    cpuHeadroom: number;
  } {
    const history = this.recentFrameHistory;
    if (history.length === 0) {
      return {
        fps: this.targetFps,
        meanInterval: this.targetFrameBudgetMs,
        p95Interval: this.targetFrameBudgetMs,
        p99Interval: this.targetFrameBudgetMs,
        jankPercent: 0,
        missedVsyncs: 0,
        cpuTime: this.latestMetrics.renderCpuTimeMs,
        cpuHeadroom: Math.max(0, this.targetFrameBudgetMs - this.latestMetrics.renderCpuTimeMs),
      };
    }

    const n = history.length;
    const sum = history.reduce((a, b) => a + b, 0);
    const mean = sum / n;
    const sorted = [...history].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(n * 0.95)] || mean;
    const p99 = sorted[Math.floor(n * 0.99)] || mean;

    const vsyncLimitMs = this.targetFrameBudgetMs * 1.45;
    const missed = history.filter((t) => t > vsyncLimitMs).length;
    const jankPercent = (missed / n) * 100;
    const fps = Math.min(this.targetFps, Math.round((1000 / Math.max(1.0, mean)) * 10) / 10);
    const cpuTime = this.latestMetrics.renderCpuTimeMs;
    const cpuHeadroom = Math.max(0, this.targetFrameBudgetMs - cpuTime);

    return {
      fps,
      meanInterval: Math.round(mean * 100) / 100,
      p95Interval: Math.round(p95 * 100) / 100,
      p99Interval: Math.round(p99 * 100) / 100,
      jankPercent: Math.round(jankPercent * 10) / 10,
      missedVsyncs: missed,
      cpuTime: Math.round(cpuTime * 100) / 100,
      cpuHeadroom: Math.round(cpuHeadroom * 100) / 100,
    };
  }

  /**
   * Generates complete steady-state statistical summary
   */
  public getSummary(): SteadyStateSummary {
    const samples = this.steadyStateFrameTimes;
    const cpuSamples = this.steadyStateCpuTimes;

    if (samples.length === 0) {
      return this.getEmptySummary();
    }

    const n = samples.length;
    const totalTimeMs = samples.reduce((acc, v) => acc + v, 0);
    const avgFrameTimeMs = totalTimeMs / n;
    const rawAvgFps = n / (totalTimeMs / 1000);
    const avgFps = Math.min(this.targetFps, Math.round(rawAvgFps * 10) / 10);

    // Sorted for percentiles
    const sorted = [...samples].sort((a, b) => a - b);
    const minFrameTime = sorted[0];
    const maxFrameTime = sorted[n - 1];

    const minFps = Math.min(this.targetFps, Math.round((1000 / maxFrameTime) * 10) / 10);
    const maxFps = Math.min(this.targetFps, Math.round((1000 / minFrameTime) * 10) / 10);

    const medianFrameTimeMs = sorted[Math.floor((n - 1) * 0.5)];
    const p95FrameTimeMs = sorted[Math.floor((n - 1) * 0.95)];
    const p99FrameTimeMs = sorted[Math.floor((n - 1) * 0.99)];

    // Variance and Standard Deviation
    const variance = samples.reduce((acc, v) => acc + Math.pow(v - avgFrameTimeMs, 2), 0) / n;
    const stdDev = Math.sqrt(variance);

    // CPU preparation averages and percentiles
    const sortedCpu = [...cpuSamples].sort((a, b) => a - b);
    const avgCpuTimeMs = cpuSamples.length > 0
      ? cpuSamples.reduce((acc, v) => acc + v, 0) / cpuSamples.length
      : 0;
    const medianCpuTimeMs = sortedCpu.length > 0 ? sortedCpu[Math.floor((sortedCpu.length - 1) * 0.5)] : 0;
    const p95CpuTimeMs = sortedCpu.length > 0 ? sortedCpu[Math.floor((sortedCpu.length - 1) * 0.95)] : 0;
    const p99CpuTimeMs = sortedCpu.length > 0 ? sortedCpu[Math.floor((sortedCpu.length - 1) * 0.99)] : 0;
    const cpuHeadroomMs = Math.round(Math.max(0, this.targetFrameBudgetMs - avgCpuTimeMs) * 100) / 100;

    // Missed Vsyncs & Jank
    const vsyncLimitMs = this.targetFrameBudgetMs * 1.45;
    const missedVsyncs = samples.filter((t) => t > vsyncLimitMs).length;
    const jankPercentage = Math.round((missedVsyncs / n) * 1000) / 10;

    const totalStalls = this.countGt33ms;
    const stallPercentage = (totalStalls / n) * 100;

    // Memory estimation
    const texCount = this.latestRenderStats.textures;
    // Estimate 1024x1024 RGBA8 + mipmaps ≈ 5.3 MB per texture
    const textureVramMB = Math.round(texCount * 5.33 * 10) / 10;

    let jsHeapUsedMB: number | undefined;
    if (typeof performance !== 'undefined' && (performance as any).memory) {
      jsHeapUsedMB = Math.round(((performance as any).memory.usedJSHeapSize / (1024 * 1024)) * 10) / 10;
    }

    return {
      sampleCount: n,
      durationSeconds: Math.round((totalTimeMs / 1000) * 10) / 10,
      targetRefreshRateHz: this.targetFps,
      averageFps: avgFps,
      minFps,
      maxFps,
      averageFrameTimeMs: Math.round(avgFrameTimeMs * 100) / 100,
      medianFrameTimeMs: Math.round(medianFrameTimeMs * 100) / 100,
      p95FrameTimeMs: Math.round(p95FrameTimeMs * 100) / 100,
      p99FrameTimeMs: Math.round(p99FrameTimeMs * 100) / 100,
      frameTimeVariance: Math.round(variance * 100) / 100,
      frameTimeStdDev: Math.round(stdDev * 100) / 100,
      averageCpuTimeMs: Math.round(avgCpuTimeMs * 100) / 100,
      medianCpuTimeMs: Math.round(medianCpuTimeMs * 100) / 100,
      p95CpuTimeMs: Math.round(p95CpuTimeMs * 100) / 100,
      p99CpuTimeMs: Math.round(p99CpuTimeMs * 100) / 100,
      cpuHeadroomMs,
      missedVsyncs,
      jankPercentage,
      stutters: {
        countGt20ms: this.countGt20ms,
        countGt25ms: this.countGt25ms,
        countGt33ms: this.countGt33ms,
        countGt50ms: this.countGt50ms,
        totalStalls,
        stallPercentage: Math.round(stallPercentage * 100) / 100,
      },
      renderStats: this.latestRenderStats,
      memoryEstimateMB: {
        textureVramMB,
        geometryCount: this.latestRenderStats.geometries,
        textureCount: texCount,
        programCount: this.latestRenderStats.programs,
        jsHeapUsedMB,
      },
    };
  }

  private getEmptySummary(): SteadyStateSummary {
    return {
      sampleCount: 0,
      durationSeconds: 0,
      targetRefreshRateHz: this.targetFps,
      averageFps: 0,
      minFps: 0,
      maxFps: 0,
      averageFrameTimeMs: 0,
      medianFrameTimeMs: 0,
      p95FrameTimeMs: 0,
      p99FrameTimeMs: 0,
      frameTimeVariance: 0,
      frameTimeStdDev: 0,
      averageCpuTimeMs: 0,
      medianCpuTimeMs: 0,
      p95CpuTimeMs: 0,
      p99CpuTimeMs: 0,
      cpuHeadroomMs: this.targetFrameBudgetMs,
      missedVsyncs: 0,
      jankPercentage: 0,
      stutters: {
        countGt20ms: 0,
        countGt25ms: 0,
        countGt33ms: 0,
        countGt50ms: 0,
        totalStalls: 0,
        stallPercentage: 0,
      },
      renderStats: this.latestRenderStats,
      memoryEstimateMB: {
        textureVramMB: 0,
        geometryCount: 0,
        textureCount: 0,
        programCount: 0,
      },
    };
  }
}
