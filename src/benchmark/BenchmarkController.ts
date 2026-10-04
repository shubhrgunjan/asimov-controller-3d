import * as THREE from 'three';
import { ThreeRenderer, ResolutionMode, RenderStats } from '../renderer/ThreeRenderer';
import { SceneManager, CameraMode } from '../renderer/SceneManager';
import { BenchmarkScene, BenchmarkLevel, WORKLOAD_SPECS } from './BenchmarkScene';
import { PerformanceMonitor, SteadyStateSummary, MonitorPhase } from './PerformanceMonitor';
import { AssetLoader, AssetTestResult } from '../renderer/AssetLoader';
import { ValidationPoseName } from '../model/AsimovRobotModel';
import { TeleopSessionManager } from '../app/TeleopSessionManager';

export type BottleneckDiagnosis =
  | 'BALANCED_60FPS'
  | 'GPU_FRAGMENT_BOUND'
  | 'GPU_SHADOW_BOUND'
  | 'CPU_DISPATCH_BOUND'
  | 'CPU_TRANSFORM_BOUND'
  | 'EVALUATING';

export interface MatrixRunResult {
  testId: string;
  level: BenchmarkLevel;
  resolution: ResolutionMode;
  targetFps: number;
  runs: SteadyStateSummary[];
  aggregated: {
    meanFps: number;
    medianFps: number;
    meanFrameTimeMs: number;
    meanP95Ms: number;
    meanP99Ms: number;
    meanStalls: number;
    bottleneck: BottleneckDiagnosis;
  };
}

export type BenchmarkStateListener = () => void;

/**
 * BenchmarkController
 * 
 * Orchestrates the 3D rendering pipeline, deterministic scene switches,
 * live matrix execution, endurance thermal testing, and bottleneck diagnosis.
 */
export class BenchmarkController {
  public readonly renderer: ThreeRenderer;
  public readonly sceneManager: SceneManager;
  public readonly scene: BenchmarkScene;
  public readonly monitor: PerformanceMonitor;
  public readonly assetLoader: AssetLoader;
  public readonly teleopSession: TeleopSessionManager;

  public appMode: 'TELEOP' | 'BENCHMARK' = 'TELEOP';

  private isRunning: boolean = false;
  private animFrameId: number | null = null;
  private lastTimeSeconds: number = 0;
  private listeners: Set<BenchmarkStateListener> = new Set();

  // Reusable scratch vectors to avoid GC allocations in 60 FPS render loop
  private scratchHeadPos = new THREE.Vector3();
  private scratchPelvisPos = new THREE.Vector3();

  // Throttled UI notification timer to avoid React reconciliation overhead
  private lastUiNotifyTimeMs: number = 0;
  private readonly uiNotifyIntervalMs: number = 100; // 10 Hz UI refresh

  // Matrix automation state
  private isMatrixRunning: boolean = false;
  private matrixQueue: { level: BenchmarkLevel; resolution: ResolutionMode; targetFps: number }[] = [];
  private matrixResults: MatrixRunResult[] = [];
  private currentMatrixItemIndex: number = 0;
  private currentIterationIndex: number = 0;
  private readonly matrixIterations = 3;

  constructor(renderer: ThreeRenderer) {
    this.renderer = renderer;
    this.sceneManager = new SceneManager(renderer.getAspect());
    this.scene = new BenchmarkScene(this.sceneManager);
    this.monitor = new PerformanceMonitor(60);
    this.assetLoader = new AssetLoader();
    this.teleopSession = new TeleopSessionManager(this.scene.robotModel, this.monitor, {
      host: '10.222.5.132',
      port: 8854,
      autoConnect: false,
    });
  }

  public setAppMode(mode: 'TELEOP' | 'BENCHMARK'): void {
    this.appMode = mode;
    this.notifyListeners();
  }

  public getAppMode(): 'TELEOP' | 'BENCHMARK' {
    return this.appMode;
  }

  public subscribe(listener: BenchmarkStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    this.listeners.forEach((fn) => fn());
  }

  /**
   * Start 3D Render Loop
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTimeSeconds = performance.now() / 1000;
    this.loop();
  }

  /**
   * Stop 3D Render Loop
   */
  public stop(): void {
    this.isRunning = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  private loop = (): void => {
    if (!this.isRunning) return;

    const nowSeconds = performance.now() / 1000;
    const deltaSeconds = Math.min(0.1, nowSeconds - this.lastTimeSeconds);
    this.lastTimeSeconds = nowSeconds;

    // 1. Update Camera and Lighting with live robot anchors (zero allocations)
    this.scene.robotModel.getHeadWorldPosition(this.scratchHeadPos);
    this.scene.robotModel.getPelvisWorldPosition(this.scratchPelvisPos);
    this.sceneManager.update(nowSeconds, deltaSeconds, this.scratchHeadPos, this.scratchPelvisPos);

    // 2. Update Dynamic Workload / Kinematic Joints
    if (this.appMode === 'TELEOP') {
      this.teleopSession.update();
    } else {
      this.scene.update(nowSeconds, deltaSeconds);
    }

    // 3. Render Three.js Scene and swap EGL buffer
    const renderStats = this.renderer.render(this.sceneManager.scene, this.sceneManager.camera);

    // 4. Record Frame Metrics
    this.monitor.recordFrame(renderStats);

    // 5. Handle Automated Matrix Progression
    if (this.isMatrixRunning) {
      this.stepMatrix();
    }

    // 6. Throttled UI Notification
    const nowMs = performance.now();
    if (nowMs - this.lastUiNotifyTimeMs >= this.uiNotifyIntervalMs) {
      this.lastUiNotifyTimeMs = nowMs;
      this.notifyListeners();
    }

    this.animFrameId = requestAnimationFrame(this.loop);
  };

  /**
   * Change Benchmark Level (L1, L2, L3, L4, ASIMOV_STATIC, ASIMOV_ARTICULATED, ASIMOV_ENVIRONMENT)
   */
  public setLevel(level: BenchmarkLevel): void {
    this.scene.loadLevel(level);
    // Camera framing adjustments
    if (level === 'L1') {
      this.sceneManager.setCameraMode('orbit', 4.5, 2.5);
    } else if (level === 'L4') {
      this.sceneManager.setCameraMode('orbit', 8.5, 4.0);
    } else if (level.startsWith('ASIMOV')) {
      this.sceneManager.setCameraMode('orbit', 3.8, 1.4);
    } else {
      this.sceneManager.setCameraMode('orbit', 6.0, 3.2);
    }
    this.notifyListeners();
  }

  public getLevel(): BenchmarkLevel {
    return this.scene.getLevel();
  }

  /**
   * Change Resolution (720p, 1080p, native)
   */
  public setResolution(mode: ResolutionMode): void {
    this.renderer.setResolution(mode);
    this.sceneManager.setAspect(this.renderer.getAspect());
    this.notifyListeners();
  }

  public getResolution(): ResolutionMode {
    return this.renderer.getResolutionMode();
  }

  /**
   * Toggle Real-time Shadows
   */
  public toggleShadows(): boolean {
    const next = !this.renderer.isShadowsEnabled();
    this.renderer.setShadows(next, this.sceneManager.scene);
    this.notifyListeners();
    return next;
  }

  public isShadowsEnabled(): boolean {
    return this.renderer.isShadowsEnabled();
  }

  /**
   * Toggle Textures
   */
  public toggleTextures(): boolean {
    const next = !this.scene.isTexturesEnabled();
    this.scene.setTexturesEnabled(next);
    this.notifyListeners();
    return next;
  }

  public isTexturesEnabled(): boolean {
    return this.scene.isTexturesEnabled();
  }

  /**
   * Toggle Animation
   */
  public toggleAnimation(): boolean {
    const next = !this.scene.isAnimationEnabled();
    this.scene.setAnimationEnabled(next);
    this.notifyListeners();
    return next;
  }

  public isAnimationEnabled(): boolean {
    return this.scene.isAnimationEnabled();
  }

  /**
   * Set Target FPS (60, 90, 120)
   */
  public setTargetFps(fps: number): void {
    this.monitor.setTargetFps(fps);
    this.notifyListeners();
  }

  /**
   * Trigger Manual Benchmark Window
   */
  public triggerBenchmarkRun(warmupMs: number = 3000, durationMs: number = 10000): void {
    this.monitor.startBenchmark(warmupMs, durationMs);
    this.notifyListeners();
  }

  /**
   * Start 10-Minute Sustained Thermal Test
   */
  public triggerSustainedRun(durationMs: number = 600000): void {
    this.monitor.startSustainedRun(durationMs);
    this.notifyListeners();
  }

  /**
   * Set Active Camera Mode (orbit, third_person, front_inspection, first_person, rapid_sweep)
   */
  public setCameraMode(mode: CameraMode): void {
    this.sceneManager.setCameraMode(mode);
    this.notifyListeners();
  }

  public getCameraMode(): CameraMode {
    return this.sceneManager.getCameraMode();
  }

  /**
   * Apply Joint Validation Test Pose (Section 6)
   */
  public applyValidationPose(pose: ValidationPoseName): void {
    this.scene.robotModel.applyValidationPose(pose);
    this.notifyListeners();
  }

  /**
   * Run Asset Test (Section 22)
   */
  public async runAssetTest(): Promise<AssetTestResult> {
    const result = await this.assetLoader.testRoboticJointAsset();
    if (result.success && result.rootObject) {
      // Temporarily mount asset in the scene to verify GPU rendering
      this.sceneManager.objectsGroup.add(result.rootObject);
      this.notifyListeners();
    }
    return result;
  }

  /**
   * Automated Matrix Suite:
   * Phase 1 synthetic baselines (L1 - L4) +
   * Phase 2 Asimov Visual Model validation (Static, Articulated, Environment @ 720p & 1080p)
   */
  public startMatrixExecution(): void {
    this.matrixQueue = [
      { level: 'L1', resolution: '720p', targetFps: 60 },
      { level: 'L2', resolution: '720p', targetFps: 60 },
      { level: 'L3', resolution: '720p', targetFps: 60 },
      { level: 'L4', resolution: '720p', targetFps: 60 },
      { level: 'ASIMOV_STATIC', resolution: '720p', targetFps: 60 },
      { level: 'ASIMOV_ARTICULATED', resolution: '720p', targetFps: 60 },
      { level: 'ASIMOV_ENVIRONMENT', resolution: '720p', targetFps: 60 },
      { level: 'ASIMOV_ENVIRONMENT', resolution: '1080p', targetFps: 60 },
    ];
    this.matrixResults = [];
    this.currentMatrixItemIndex = 0;
    this.currentIterationIndex = 0;
    this.isMatrixRunning = true;

    this.configureCurrentMatrixStep();
  }

  private configureCurrentMatrixStep(): void {
    const item = this.matrixQueue[this.currentMatrixItemIndex];
    if (!item) {
      this.isMatrixRunning = false;
      this.notifyListeners();
      return;
    }

    this.setLevel(item.level);
    this.setResolution(item.resolution);
    this.setTargetFps(item.targetFps);
    // Warmup 2s, record 6s per test iteration for brisk automated matrix sweep
    this.monitor.startBenchmark(2000, 6000);
    this.notifyListeners();
  }

  private stepMatrix(): void {
    if (this.monitor.getPhase() !== 'COMPLETE') return;

    const item = this.matrixQueue[this.currentMatrixItemIndex];
    const summary = this.monitor.getSummary();

    let existing = this.matrixResults.find(
      (m) => m.level === item.level && m.resolution === item.resolution
    );

    if (!existing) {
      const testId = `${item.level}_${item.resolution}`;
      existing = {
        testId,
        level: item.level,
        resolution: item.resolution,
        targetFps: item.targetFps,
        runs: [],
        aggregated: {
          meanFps: 0,
          medianFps: 0,
          meanFrameTimeMs: 0,
          meanP95Ms: 0,
          meanP99Ms: 0,
          meanStalls: 0,
          bottleneck: 'EVALUATING',
        },
      };
      this.matrixResults.push(existing);
    }

    existing.runs.push(summary);

    this.currentIterationIndex++;
    if (this.currentIterationIndex < this.matrixIterations) {
      // Repeat same configuration
      this.monitor.startBenchmark(1500, 6000);
    } else {
      // Aggregate 3 runs
      const runs = existing.runs;
      const meanFps = runs.reduce((a, b) => a + b.averageFps, 0) / runs.length;
      const medianFps = runs.map((r) => r.averageFps).sort((a, b) => a - b)[Math.floor(runs.length / 2)];
      const meanFrameTimeMs = runs.reduce((a, b) => a + b.averageFrameTimeMs, 0) / runs.length;
      const meanP95Ms = runs.reduce((a, b) => a + b.p95FrameTimeMs, 0) / runs.length;
      const meanP99Ms = runs.reduce((a, b) => a + b.p99FrameTimeMs, 0) / runs.length;
      const meanStalls = runs.reduce((a, b) => a + b.stutters.totalStalls, 0) / runs.length;
      const bottleneck = this.diagnoseBottleneck(summary);

      existing.aggregated = {
        meanFps: Math.round(meanFps * 10) / 10,
        medianFps: Math.round(medianFps * 10) / 10,
        meanFrameTimeMs: Math.round(meanFrameTimeMs * 100) / 100,
        meanP95Ms: Math.round(meanP95Ms * 100) / 100,
        meanP99Ms: Math.round(meanP99Ms * 100) / 100,
        meanStalls: Math.round(meanStalls * 10) / 10,
        bottleneck,
      };

      // Advance to next queue configuration
      this.currentIterationIndex = 0;
      this.currentMatrixItemIndex++;

      if (this.currentMatrixItemIndex < this.matrixQueue.length) {
        this.configureCurrentMatrixStep();
      } else {
        this.isMatrixRunning = false;
        console.log('\n=================== PHYSICAL DEVICE BENCHMARK MATRIX RESULTS ===================');
        console.table(
          this.matrixResults.map((r) => {
            const avgCpu = r.runs.length > 0 ? r.runs.reduce((a, b) => a + b.averageCpuTimeMs, 0) / r.runs.length : 0;
            const avgP95Cpu = r.runs.length > 0 ? r.runs.reduce((a, b) => a + b.p95CpuTimeMs, 0) / r.runs.length : 0;
            const avgHeadroom = r.runs.length > 0 ? r.runs.reduce((a, b) => a + b.cpuHeadroomMs, 0) / r.runs.length : 0;
            const totalMissed = r.runs.reduce((a, b) => a + b.missedVsyncs, 0);
            const avgJank = r.runs.length > 0 ? r.runs.reduce((a, b) => a + b.jankPercentage, 0) / r.runs.length : 0;
            return {
              Test: r.testId,
              Level: r.level,
              Res: r.resolution,
              'Display FPS': r.aggregated.meanFps,
              'Presented (ms)': r.aggregated.meanFrameTimeMs,
              'P95 Pres (ms)': r.aggregated.meanP95Ms,
              'P99 Pres (ms)': r.aggregated.meanP99Ms,
              'CPU Prep (ms)': Math.round(avgCpu * 100) / 100,
              'CPU P95 (ms)': Math.round(avgP95Cpu * 100) / 100,
              'CPU Headroom': Math.round(avgHeadroom * 100) / 100,
              'Missed Vsync': totalMissed,
              'Jank %': `${avgJank.toFixed(1)}%`,
              Bottleneck: r.aggregated.bottleneck,
            };
          })
        );
        console.log('================================================================================\n');
        this.notifyListeners();
      }
    }
  }

  public isMatrixActive(): boolean {
    return this.isMatrixRunning;
  }

  public getMatrixResults(): MatrixRunResult[] {
    return this.matrixResults;
  }

  public getMatrixProgress(): { current: number; total: number; label: string } {
    const total = this.matrixQueue.length * this.matrixIterations;
    const current = this.currentMatrixItemIndex * this.matrixIterations + this.currentIterationIndex;
    const item = this.matrixQueue[this.currentMatrixItemIndex];
    const label = item ? `${item.level} @ ${item.resolution} (Run ${this.currentIterationIndex + 1}/3)` : 'Complete';
    return { current, total, label };
  }

  /**
   * GPU/CPU Bottleneck Analysis (Section 16)
   */
  public diagnoseBottleneck(summary: SteadyStateSummary): BottleneckDiagnosis {
    const targetBudgetMs = this.monitor.getTargetBudgetMs();

    if (summary.averageFps >= (this.monitor.getTargetFps() - 1.5) && summary.p95FrameTimeMs <= targetBudgetMs * 1.15) {
      return 'BALANCED_60FPS';
    }

    const cpuTime = summary.averageCpuTimeMs;
    const frameTime = summary.averageFrameTimeMs;
    const gpuTime = Math.max(0, frameTime - cpuTime);

    // If CPU execution consumes majority of budget
    if (cpuTime > targetBudgetMs * 0.7) {
      if (summary.renderStats.calls > 150) {
        return 'CPU_DISPATCH_BOUND';
      }
      return 'CPU_TRANSFORM_BOUND';
    }

    // If GPU presentation wait time dominates
    if (gpuTime > targetBudgetMs * 0.65) {
      if (this.isShadowsEnabled()) {
        return 'GPU_SHADOW_BOUND';
      }
      return 'GPU_FRAGMENT_BOUND';
    }

    return 'GPU_FRAGMENT_BOUND';
  }

  public dispose(): void {
    this.stop();
    this.teleopSession.dispose();
    this.sceneManager.dispose();
    this.renderer.dispose();
    this.listeners.clear();
  }
}
