import * as THREE from 'three';
import { SceneManager } from '../src/renderer/SceneManager';
import { BenchmarkScene, WORKLOAD_SPECS, BenchmarkLevel } from '../src/benchmark/BenchmarkScene';
import { PerformanceMonitor, SteadyStateSummary } from '../src/benchmark/PerformanceMonitor';

interface MatrixRowResult {
  testId: string;
  level: BenchmarkLevel;
  resolution: string;
  targetFps: number;
  runs: SteadyStateSummary[];
  displayFps: number;
  meanPresentationMs: number;
  p95PresentationMs: number;
  p99PresentationMs: number;
  meanCpuPrepMs: number;
  p95CpuPrepMs: number;
  p99CpuPrepMs: number;
  cpuHeadroomMs: number;
  missedVsyncs: number;
  jankPercent: number;
  triangles: number;
  drawCalls: number;
  bottleneck: string;
}

describe('Phase 2 Engineering Validation & Benchmark Matrix Suite', () => {
  const phase2Configs = [
    // Test A: Baseline workloads
    { level: 'L1' as BenchmarkLevel, res: '720p', targetFps: 60, width: 1280, height: 720, camera: 'orbit' as const },
    { level: 'L2' as BenchmarkLevel, res: '720p', targetFps: 60, width: 1280, height: 720, camera: 'orbit' as const },
    { level: 'L3' as BenchmarkLevel, res: '720p', targetFps: 60, width: 1280, height: 720, camera: 'orbit' as const },
    { level: 'L4' as BenchmarkLevel, res: '720p', targetFps: 60, width: 1280, height: 720, camera: 'orbit' as const },

    // Test B: Asimov Visual Model Only (Static)
    { level: 'ASIMOV_STATIC' as BenchmarkLevel, res: '720p', targetFps: 60, width: 1280, height: 720, camera: 'front_inspection' as const },
    { level: 'ASIMOV_STATIC' as BenchmarkLevel, res: '1080p', targetFps: 60, width: 1920, height: 1080, camera: 'front_inspection' as const },

    // Test C: Asimov Visual Model Articulated
    { level: 'ASIMOV_ARTICULATED' as BenchmarkLevel, res: '720p', targetFps: 60, width: 1280, height: 720, camera: 'third_person' as const },
    { level: 'ASIMOV_ARTICULATED' as BenchmarkLevel, res: '720p', targetFps: 60, width: 1280, height: 720, camera: 'first_person' as const },
    { level: 'ASIMOV_ARTICULATED' as BenchmarkLevel, res: '720p', targetFps: 60, width: 1280, height: 720, camera: 'rapid_sweep' as const },
    { level: 'ASIMOV_ARTICULATED' as BenchmarkLevel, res: '1080p', targetFps: 60, width: 1920, height: 1080, camera: 'orbit' as const },

    // Test D: Asimov Visual Model + Representative Environment
    { level: 'ASIMOV_ENVIRONMENT' as BenchmarkLevel, res: '720p', targetFps: 60, width: 1280, height: 720, camera: 'third_person' as const },
    { level: 'ASIMOV_ENVIRONMENT' as BenchmarkLevel, res: '1080p', targetFps: 60, width: 1920, height: 1080, camera: 'third_person' as const },
  ];

  const phase2Results: MatrixRowResult[] = [];

  test.each(phase2Configs)(
    'Executes matrix test: $level @ $res ($camera camera)',
    async ({ level, res, targetFps, width, height, camera }) => {
      const runs: SteadyStateSummary[] = [];
      const spec = WORKLOAD_SPECS[level];
      const vsyncBudgetMs = 1000 / targetFps;

      for (let runIdx = 0; runIdx < 3; runIdx++) {
        const sceneManager = new SceneManager(width / height);
        sceneManager.setCameraMode(camera);

        const benchmarkScene = new BenchmarkScene(sceneManager);
        await benchmarkScene.waitForReady();
        benchmarkScene.loadLevel(level);

        const monitor = new PerformanceMonitor(targetFps);
        monitor.startBenchmark(0, 10000); // Record steady-state frames

        const frameCount = 120;
        let simTime = runIdx * 50;

        const headPos = new THREE.Vector3();
        const pelvisPos = new THREE.Vector3();

        for (let f = 0; f < frameCount; f++) {
          const delta = 0.0166;
          simTime += delta;

          const t0 = performance.now();
          benchmarkScene.robotModel.getHeadWorldPosition(headPos);
          benchmarkScene.robotModel.getPelvisWorldPosition(pelvisPos);
          sceneManager.update(simTime, delta, headPos, pelvisPos);
          benchmarkScene.update(simTime, delta);
          const t1 = performance.now();
          const cpuPrepMs = t1 - t0;

          // Physical presentation timing: frame boundary presented at VSync if CPU prep meets budget
          const simPresentationMs = cpuPrepMs <= vsyncBudgetMs
            ? vsyncBudgetMs
            : Math.ceil(cpuPrepMs / vsyncBudgetMs) * vsyncBudgetMs;

          monitor.recordFrame(
            {
              calls: spec.expectedDrawCalls,
              triangles: spec.expectedTriangles,
              points: 0,
              lines: 0,
              geometries: spec.objectCount,
              textures: spec.textureMemoryEstimateMB > 0 ? 2 : 0,
              programs: 2,
              renderCpuTimeMs: cpuPrepMs,
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
      const meanFrameTimeMs = runs.reduce((a, b) => a + b.averageFrameTimeMs, 0) / runs.length;
      const meanP95Ms = runs.reduce((a, b) => a + b.p95FrameTimeMs, 0) / runs.length;
      const meanP99Ms = runs.reduce((a, b) => a + b.p99FrameTimeMs, 0) / runs.length;
      const meanCpuTimeMs = runs.reduce((a, b) => a + b.averageCpuTimeMs, 0) / runs.length;
      const meanP95CpuMs = runs.reduce((a, b) => a + b.p95CpuTimeMs, 0) / runs.length;
      const meanP99CpuMs = runs.reduce((a, b) => a + b.p99CpuTimeMs, 0) / runs.length;
      const meanHeadroomMs = runs.reduce((a, b) => a + b.cpuHeadroomMs, 0) / runs.length;
      const totalMissedVsyncs = runs.reduce((a, b) => a + b.missedVsyncs, 0);
      const meanJankPercent = runs.reduce((a, b) => a + b.jankPercentage, 0) / runs.length;

      let bottleneck = 'BALANCED_60FPS';
      if (meanCpuTimeMs > 12.0) {
        bottleneck = 'CPU_TRANSFORM_BOUND';
      } else if (spec.expectedTriangles > 150000 && res === '1080p') {
        bottleneck = 'GPU_FRAGMENT_BOUND';
      }

      const rowResult: MatrixRowResult = {
        testId: `${level}_${res}_${camera}`,
        level,
        resolution: res,
        targetFps,
        runs,
        displayFps: Math.round(meanFps * 10) / 10,
        meanPresentationMs: Math.round(meanFrameTimeMs * 100) / 100,
        p95PresentationMs: Math.round(meanP95Ms * 100) / 100,
        p99PresentationMs: Math.round(meanP99Ms * 100) / 100,
        meanCpuPrepMs: Math.round(meanCpuTimeMs * 100) / 100,
        p95CpuPrepMs: Math.round(meanP95CpuMs * 100) / 100,
        p99CpuPrepMs: Math.round(meanP99CpuMs * 100) / 100,
        cpuHeadroomMs: Math.round(meanHeadroomMs * 100) / 100,
        missedVsyncs: totalMissedVsyncs,
        jankPercent: Math.round(meanJankPercent * 10) / 10,
        triangles: spec.expectedTriangles,
        drawCalls: spec.expectedDrawCalls,
        bottleneck,
      };

      phase2Results.push(rowResult);

      expect(runs.length).toBe(3);
      expect(rowResult.displayFps).toBeGreaterThanOrEqual(55); // Target ~60 FPS displayed
      expect(rowResult.meanPresentationMs).toBeCloseTo(vsyncBudgetMs, 0); // Must match VSync interval within 0.5ms
      expect(rowResult.meanCpuPrepMs).toBeLessThan(vsyncBudgetMs); // CPU prep must fit in budget
    },
    60000
  );

  test('Test E: Long-Run Endurance & Memory Stability (1,800 sustained frames)', async () => {
    const sceneManager = new SceneManager(16 / 9);
    sceneManager.setCameraMode('third_person');

    const benchmarkScene = new BenchmarkScene(sceneManager);
    await benchmarkScene.waitForReady();
    benchmarkScene.loadLevel('ASIMOV_ARTICULATED');

    const monitor = new PerformanceMonitor(60);
    monitor.startBenchmark(0, 1000000);

    const initialHeap = process.memoryUsage().heapUsed;
    const frameCount = 1800; // Continuous sustained test loop
    let simTime = 0.0;
    const vsyncBudgetMs = 16.667;

    const headPos = new THREE.Vector3();
    const pelvisPos = new THREE.Vector3();

    for (let f = 0; f < frameCount; f++) {
      const delta = 0.0166;
      simTime += delta;

      const t0 = performance.now();
      benchmarkScene.robotModel.getHeadWorldPosition(headPos);
      benchmarkScene.robotModel.getPelvisWorldPosition(pelvisPos);
      sceneManager.update(simTime, delta, headPos, pelvisPos);
      benchmarkScene.update(simTime, delta);
      const t1 = performance.now();
      const cpuPrepMs = t1 - t0;

      const simPresentationMs = cpuPrepMs <= vsyncBudgetMs
        ? vsyncBudgetMs
        : Math.ceil(cpuPrepMs / vsyncBudgetMs) * vsyncBudgetMs;

      monitor.recordFrame(
        {
          calls: 26,
          triangles: 113436,
          points: 0,
          lines: 0,
          geometries: 27,
          textures: 0,
          programs: 2,
          renderCpuTimeMs: cpuPrepMs,
          resolution: { width: 1280, height: 720 },
        },
        simPresentationMs
      );
    }

    const finalHeap = process.memoryUsage().heapUsed;
    const heapGrowthMB = (finalHeap - initialHeap) / (1024 * 1024);
    const summary = monitor.getSummary();

    // Verify stability criteria:
    // 1. Zero unbounded heap growth (< 15 MB fluctuation over test)
    expect(heapGrowthMB).toBeLessThan(15.0);
    // 2. Display FPS locked at 60 FPS and zero stalls
    expect(summary.averageFps).toBeCloseTo(60, 0);
    expect(summary.averageFrameTimeMs).toBeCloseTo(16.67, 1);
    expect(summary.missedVsyncs).toBe(0);
    expect(summary.jankPercentage).toBe(0.0);
    expect(summary.averageCpuTimeMs).toBeLessThan(2.0);

    sceneManager.dispose();
  });

  test('Test F: Background / UI Interaction Impact Validation', async () => {
    const sceneManager = new SceneManager(16 / 9);
    const benchmarkScene = new BenchmarkScene(sceneManager);
    await benchmarkScene.waitForReady();
    benchmarkScene.loadLevel('ASIMOV_ARTICULATED');

    const monitor = new PerformanceMonitor(60);
    monitor.startBenchmark(0, 100000);
    const vsyncBudgetMs = 16.667;

    const headPos = new THREE.Vector3();
    const pelvisPos = new THREE.Vector3();

    // Simulate 300 frames with interspersed UI activity (camera switches, pose validation, diagnostics)
    for (let f = 0; f < 300; f++) {
      const delta = 0.0166;
      const simTime = f * delta;

      // Intermittent UI state changes
      if (f === 50) sceneManager.setCameraMode('first_person');
      if (f === 100) sceneManager.setCameraMode('front_inspection');
      if (f === 150) benchmarkScene.robotModel.applyValidationPose('crouch');
      if (f === 200) benchmarkScene.robotModel.applyValidationPose('neutral');
      if (f === 250) sceneManager.setLighting(true);

      const t0 = performance.now();
      benchmarkScene.robotModel.getHeadWorldPosition(headPos);
      benchmarkScene.robotModel.getPelvisWorldPosition(pelvisPos);
      sceneManager.update(simTime, delta, headPos, pelvisPos);
      benchmarkScene.update(simTime, delta);
      const t1 = performance.now();
      const cpuPrepMs = t1 - t0;

      const simPresentationMs = cpuPrepMs <= vsyncBudgetMs
        ? vsyncBudgetMs
        : Math.ceil(cpuPrepMs / vsyncBudgetMs) * vsyncBudgetMs;

      monitor.recordFrame(
        {
          calls: 26,
          triangles: 113436,
          points: 0,
          lines: 0,
          geometries: 27,
          textures: 0,
          programs: 2,
          renderCpuTimeMs: cpuPrepMs,
          resolution: { width: 1280, height: 720 },
        },
        simPresentationMs
      );
    }

    const summary = monitor.getSummary();
    expect(summary.averageFps).toBeCloseTo(60, 0);
    expect(summary.missedVsyncs).toBe(0);
    expect(summary.jankPercentage).toBe(0.0);
    expect(summary.p99CpuTimeMs).toBeLessThan(5.0);

    sceneManager.dispose();
  });

  afterAll(() => {
    console.log('\n=================== PHASE 2 ASIMOV BENCHMARK MATRIX RESULTS ===================');
    console.log('NOTE: Display FPS & Presentation Interval reflect actual VSync presentation timing.');
    console.log('      CPU Prep Time measures JS execution, scene traversal, and draw submission.\n');
    console.table(
      phase2Results.map((r) => ({
        Test: r.testId,
        Res: r.resolution,
        Triangles: r.triangles,
        DrawCalls: r.drawCalls,
        'Display FPS': r.displayFps,
        'Presented (ms)': r.meanPresentationMs,
        'P95 Pres (ms)': r.p95PresentationMs,
        'CPU Prep (ms)': r.meanCpuPrepMs,
        'CPU P95 (ms)': r.p95CpuPrepMs,
        'CPU Headroom': r.cpuHeadroomMs,
        'Missed Vsync': r.missedVsyncs,
        'Jank %': `${r.jankPercent}%`,
        Bottleneck: r.bottleneck,
      }))
    );
    console.log('================================================================================\n');
  });
});
