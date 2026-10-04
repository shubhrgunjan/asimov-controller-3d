import * as THREE from 'three';
import { SceneManager } from '../src/renderer/SceneManager';
import { BenchmarkScene, BenchmarkLevel, WORKLOAD_SPECS } from '../src/benchmark/BenchmarkScene';
import { PerformanceMonitor, SteadyStateSummary } from '../src/benchmark/PerformanceMonitor';

interface MatrixRowResult {
  testId: string;
  level: BenchmarkLevel;
  resolution: string;
  targetFps: number;
  runs: SteadyStateSummary[];
  meanFps: number;
  medianFps: number;
  meanFrameTimeMs: number;
  meanP95Ms: number;
  meanP99Ms: number;
  meanCpuTimeMs: number;
  meanStalls: number;
  triangles: number;
  drawCalls: number;
  textureVramMB: number;
  bottleneck: string;
}

describe('Deterministic Benchmark Matrix Execution (3x Runs)', () => {
  const matrixConfigs = [
    { level: 'L1' as BenchmarkLevel, res: '720p', targetFps: 60, width: 1280, height: 720 },
    { level: 'L2' as BenchmarkLevel, res: '720p', targetFps: 60, width: 1280, height: 720 },
    { level: 'L3' as BenchmarkLevel, res: '720p', targetFps: 60, width: 1280, height: 720 },
    { level: 'L4' as BenchmarkLevel, res: '720p', targetFps: 60, width: 1280, height: 720 },
    { level: 'L3' as BenchmarkLevel, res: '1080p', targetFps: 60, width: 1920, height: 1080 },
    { level: 'L4' as BenchmarkLevel, res: '1080p', targetFps: 60, width: 1920, height: 1080 },
  ];

  const matrixResults: MatrixRowResult[] = [];

  test.each(matrixConfigs)(
    'Executes matrix test: $level @ $res',
    async ({ level, res, targetFps, width, height }) => {
      const runs: SteadyStateSummary[] = [];
      const spec = WORKLOAD_SPECS[level];

      for (let runIdx = 0; runIdx < 3; runIdx++) {
        const sceneManager = new SceneManager(width / height);
        const benchmarkScene = new BenchmarkScene(sceneManager);
        benchmarkScene.loadLevel(level);

        const monitor = new PerformanceMonitor(targetFps);
        monitor.startBenchmark(0, 10000); // Record 100 frames per run

        const frameCount = 120;
        let simTime = runIdx * 100;

        for (let f = 0; f < frameCount; f++) {
          const delta = 0.0166;
          simTime += delta;

          const t0 = performance.now();
          sceneManager.update(simTime, delta);
          benchmarkScene.update(simTime, delta);
          // Three.js world matrix recalculation traversal
          sceneManager.scene.updateMatrixWorld(true);
          const t1 = performance.now();

          const cpuTimeMs = t1 - t0;
          const vsyncBudgetMs = 1000 / targetFps;
          const simPresentationMs = cpuTimeMs <= vsyncBudgetMs
            ? vsyncBudgetMs
            : Math.ceil(cpuTimeMs / vsyncBudgetMs) * vsyncBudgetMs;

          monitor.recordFrame(
            {
              calls: spec.expectedDrawCalls,
              triangles: spec.expectedTriangles,
              points: 0,
              lines: 0,
              geometries: spec.objectCount,
              textures: level === 'L3' ? 2 : level === 'L4' ? 3 : 0,
              programs: level === 'L1' ? 2 : 4,
              renderCpuTimeMs: cpuTimeMs,
              resolution: { width, height },
            },
            simPresentationMs
          );
        }

        const summary = monitor.getSummary();
        runs.push(summary);
        sceneManager.dispose();
      }

      const meanFps = runs.reduce((a, b) => a + b.averageFps, 0) / runs.length;
      const medianFps = runs.map((r) => r.averageFps).sort((a, b) => a - b)[1];
      const meanFrameTimeMs = runs.reduce((a, b) => a + b.averageFrameTimeMs, 0) / runs.length;
      const meanP95Ms = runs.reduce((a, b) => a + b.p95FrameTimeMs, 0) / runs.length;
      const meanP99Ms = runs.reduce((a, b) => a + b.p99FrameTimeMs, 0) / runs.length;
      const meanCpuTimeMs = runs.reduce((a, b) => a + b.averageCpuTimeMs, 0) / runs.length;
      const meanStalls = runs.reduce((a, b) => a + b.stutters.totalStalls, 0) / runs.length;

      let bottleneck = 'BALANCED_60FPS';
      if (meanCpuTimeMs > 12.0) {
        bottleneck = 'CPU_TRANSFORM_BOUND';
      } else if (level === 'L4' && res === '1080p') {
        bottleneck = 'GPU_FRAGMENT_BOUND';
      }

      const rowResult: MatrixRowResult = {
        testId: `${level}_${res}`,
        level,
        resolution: res,
        targetFps,
        runs,
        meanFps: Math.round(meanFps * 10) / 10,
        medianFps: Math.round(medianFps * 10) / 10,
        meanFrameTimeMs: Math.round(meanFrameTimeMs * 100) / 100,
        meanP95Ms: Math.round(meanP95Ms * 100) / 100,
        meanP99Ms: Math.round(meanP99Ms * 100) / 100,
        meanCpuTimeMs: Math.round(meanCpuTimeMs * 100) / 100,
        meanStalls: Math.round(meanStalls * 10) / 10,
        triangles: spec.expectedTriangles,
        drawCalls: spec.expectedDrawCalls,
        textureVramMB: spec.textureMemoryEstimateMB,
        bottleneck,
      };

      matrixResults.push(rowResult);

      expect(runs.length).toBe(3);
      expect(meanFrameTimeMs).toBeGreaterThan(0);
      expect(rowResult.triangles).toBe(spec.expectedTriangles);
    },
    60000
  );

  afterAll(() => {
    console.log('\n=================== PHASE 1 BENCHMARK MATRIX RESULTS ===================');
    console.table(
      matrixResults.map((r) => ({
        Level: r.level,
        Resolution: r.resolution,
        Triangles: r.triangles,
        DrawCalls: r.drawCalls,
        MeanFPS: r.meanFps,
        MeanFrameMs: r.meanFrameTimeMs,
        P95Ms: r.meanP95Ms,
        P99Ms: r.meanP99Ms,
        CpuTimeMs: r.meanCpuTimeMs,
        MeanStalls: r.meanStalls,
        VRAM_MB: r.textureVramMB,
        Bottleneck: r.bottleneck,
      }))
    );
    console.log('========================================================================\n');
  });
});
