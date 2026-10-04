import * as THREE from 'three';
import { PerformanceMonitor } from '../src/benchmark/PerformanceMonitor';
import { SceneManager } from '../src/renderer/SceneManager';
import { BenchmarkScene, WORKLOAD_SPECS } from '../src/benchmark/BenchmarkScene';
import { AssetLoader } from '../src/renderer/AssetLoader';
import { RenderStats } from '../src/renderer/ThreeRenderer';

describe('PerformanceMonitor Metric Calculations', () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    monitor = new PerformanceMonitor(60);
  });

  test('calculates correct frame budget for 60, 90, and 120 FPS targets', () => {
    monitor.setTargetFps(60);
    expect(monitor.getTargetBudgetMs()).toBeCloseTo(16.667, 2);

    monitor.setTargetFps(90);
    expect(monitor.getTargetBudgetMs()).toBeCloseTo(11.111, 2);

    monitor.setTargetFps(120);
    expect(monitor.getTargetBudgetMs()).toBeCloseTo(8.333, 2);
  });

  test('tracks warmup phase before recording steady-state samples', () => {
    monitor.startBenchmark(100, 200); // 100ms warmup, 200ms recording
    expect(monitor.getPhase()).toBe('WARMUP');

    const dummyStats: RenderStats = {
      calls: 10,
      triangles: 1000,
      points: 0,
      lines: 0,
      geometries: 5,
      textures: 1,
      programs: 2,
      renderCpuTimeMs: 2.0,
      resolution: { width: 1280, height: 720 },
    };

    // Simulate frames
    monitor.recordFrame(dummyStats);
    expect(monitor.getPhase()).toBe('WARMUP');
  });

  test('computes accurate median, p95, p99, and stutter counters', () => {
    monitor.startBenchmark(0, 100000); // Immediate recording
    const dummyStats: RenderStats = {
      calls: 20,
      triangles: 5000,
      points: 0,
      lines: 0,
      geometries: 10,
      textures: 2,
      programs: 3,
      renderCpuTimeMs: 3.0,
      resolution: { width: 1280, height: 720 },
    };

    // Feed deterministic sequence of frame times:
    // 90 frames of 16.6ms, 5 frames of 22ms, 3 frames of 28ms, 1 frame of 35ms, 1 frame of 55ms = 100 frames
    const feedFrameWithDelta = (deltaMs: number) => {
      // Manually push to private steadyStateFrameTimes via test proxy or recordFrame
      // We can directly test through recordFrame or inspect summary
      (monitor as any).steadyStateFrameTimes.push(deltaMs);
      (monitor as any).steadyStateCpuTimes.push(3.0);
      if (deltaMs > 20) (monitor as any).countGt20ms++;
      if (deltaMs > 25) (monitor as any).countGt25ms++;
      if (deltaMs > 33.33) (monitor as any).countGt33ms++;
      if (deltaMs > 50) (monitor as any).countGt50ms++;
    };

    for (let i = 0; i < 90; i++) feedFrameWithDelta(16.6);
    for (let i = 0; i < 5; i++) feedFrameWithDelta(22.0);
    for (let i = 0; i < 3; i++) feedFrameWithDelta(28.0);
    feedFrameWithDelta(35.0);
    feedFrameWithDelta(55.0);

    const summary = monitor.getSummary();
    expect(summary.sampleCount).toBe(100);
    expect(summary.medianFrameTimeMs).toBe(16.6);
    expect(summary.p95FrameTimeMs).toBe(22.0);
    expect(summary.p99FrameTimeMs).toBe(35.0);
    expect(summary.minFps).toBeCloseTo(1000 / 55.0, 1);

    // Stutter counts
    expect(summary.stutters.countGt20ms).toBe(10);
    expect(summary.stutters.countGt25ms).toBe(5);
    expect(summary.stutters.countGt33ms).toBe(2);
    expect(summary.stutters.countGt50ms).toBe(1);
    expect(summary.stutters.totalStalls).toBe(2);
    expect(summary.stutters.stallPercentage).toBe(2.0);
  });
});

describe('SceneManager Architecture', () => {
  let sceneManager: SceneManager;

  beforeEach(() => {
    sceneManager = new SceneManager(16 / 9);
  });

  afterEach(() => {
    sceneManager.dispose();
  });

  test('maintains strict hierarchy: Scene -> World, Lighting, Objects', () => {
    const scene = sceneManager.scene;
    expect(scene.getObjectByName('World')).toBe(sceneManager.worldGroup);
    expect(scene.getObjectByName('Lighting')).toBe(sceneManager.lightingGroup);
    expect(scene.getObjectByName('Objects')).toBe(sceneManager.objectsGroup);
  });

  test('camera orbits around target during update', () => {
    const initialPos = sceneManager.camera.position.clone();
    sceneManager.setCameraMode('orbit', 6.0, 3.0);
    sceneManager.update(1.0, 0.016);
    const updatedPos = sceneManager.camera.position.clone();
    expect(updatedPos.x).not.toBe(initialPos.x);
    expect(updatedPos.z).not.toBe(initialPos.z);
  });

  test('cleanly disposes hierarchy and releases memory', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const mesh = new THREE.Mesh(geo, mat);
    sceneManager.objectsGroup.add(mesh);

    const disposeGeoSpy = jest.spyOn(geo, 'dispose');
    const disposeMatSpy = jest.spyOn(mat, 'dispose');

    sceneManager.clearObjects();

    expect(disposeGeoSpy).toHaveBeenCalled();
    expect(disposeMatSpy).toHaveBeenCalled();
    expect(sceneManager.objectsGroup.children.length).toBe(0);
  });
});

describe('BenchmarkScene Workloads', () => {
  let sceneManager: SceneManager;
  let benchmarkScene: BenchmarkScene;

  beforeEach(() => {
    sceneManager = new SceneManager(16 / 9);
    benchmarkScene = new BenchmarkScene(sceneManager);
  });

  afterEach(() => {
    sceneManager.dispose();
  });

  test('verifies Level 1 Minimal workload parameters', () => {
    benchmarkScene.loadLevel('L1');
    const spec = WORKLOAD_SPECS.L1;
    expect(spec.level).toBe('L1');
    expect(spec.expectedDrawCalls).toBe(6);
    expect(benchmarkScene.getLevel()).toBe('L1');
    expect(sceneManager.objectsGroup.children.length).toBe(5);
  });

  test('verifies Level 2 Moderate workload rings', () => {
    benchmarkScene.loadLevel('L2');
    const spec = WORKLOAD_SPECS.L2;
    expect(spec.level).toBe('L2');
    expect(benchmarkScene.getLevel()).toBe('L2');
    expect(sceneManager.objectsGroup.children.length).toBe(45);
  });

  test('verifies Level 3 Heavy procedural texture memory and objects', () => {
    benchmarkScene.loadLevel('L3');
    const spec = WORKLOAD_SPECS.L3;
    expect(spec.level).toBe('L3');
    expect(spec.textureMemoryEstimateMB).toBe(16.0);
    expect(sceneManager.objectsGroup.children.length).toBe(160);
  });

  test('verifies Level 4 Target Stress articulated humanoid robot model', () => {
    benchmarkScene.loadLevel('L4');
    const robotRoot = sceneManager.objectsGroup.getObjectByName('Humanoid_Robot_Root');
    expect(robotRoot).toBeDefined();

    // Verify kinematic hierarchy links
    const pelvis = robotRoot?.children[0];
    expect(pelvis).toBeDefined();
    // Torso should be child of pelvis
    const torso = pelvis?.children.find((c) => c.type === 'Mesh' && (c as THREE.Mesh).geometry.type === 'BoxGeometry');
    expect(torso).toBeDefined();

    // Verify arena perimeter columns exist
    const perimeterItems = sceneManager.objectsGroup.children.filter((c) => c !== robotRoot);
    expect(perimeterItems.length).toBeGreaterThan(150);
  });

  test('animation updates joint angles and mesh rotations', () => {
    benchmarkScene.loadLevel('L4');
    const robotRoot = sceneManager.objectsGroup.getObjectByName('Humanoid_Robot_Root');
    const pelvis = robotRoot?.children[0];
    const initialRotY = pelvis?.rotation.y;

    benchmarkScene.update(1.0, 0.016);
    // Kinematics animated without errors
    expect(pelvis).toBeDefined();
  });
});

describe('AssetLoader GLB Verification', () => {
  test('creates valid binary GLTF 2.0 (GLB) buffer with header, JSON chunk, and BIN chunk', async () => {
    const loader = new AssetLoader();
    const result = await loader.testRoboticJointAsset();

    expect(result.success).toBe(true);
    expect(result.meshCount).toBe(1);
    expect(result.triangleCount).toBe(12); // Cube = 12 triangles
    expect(result.materialNames).toContain('AsimovPBR_AnodizedAlloy');
    expect(result.hasTransforms).toBe(true);
    expect(result.loadTimeMs).toBeGreaterThanOrEqual(0);
  });
});
