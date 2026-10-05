import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SceneManager } from '../renderer/SceneManager';
import { getExpoHostAddress } from '../utils/NetworkDiscovery';

import { AsimovRobotModel, ValidationPoseName } from '../model/AsimovRobotModel';
import { ASIMOV_1_TRIANGLES } from '../model/asimov_1_model_data';
import { PAIR_LAB_BODIES, PAIR_LAB_CUBES, PAIR_LAB_MESHES, decodeMeshSpec } from '../model/pair_lab_model_data';
import { bindAuthoritativeMaterials, getAuthoritativeDataTexture } from '../model/pair_lab_textures';

export type BenchmarkLevel =
  | 'L1'
  | 'L2'
  | 'L3'
  | 'L4'
  | 'ASIMOV_STATIC'
  | 'ASIMOV_ARTICULATED'
  | 'ASIMOV_ENVIRONMENT';

export interface BenchmarkWorkloadSpec {
  level: BenchmarkLevel;
  name: string;
  expectedTriangles: number;
  expectedDrawCalls: number;
  objectCount: number;
  materialCount: number;
  textureMemoryEstimateMB: number;
  shadowConfig: string;
  description: string;
}

export const WORKLOAD_SPECS: Record<BenchmarkLevel, BenchmarkWorkloadSpec> = {
  L1: {
    level: 'L1',
    name: 'Minimal Baseline',
    expectedTriangles: 1450,
    expectedDrawCalls: 6,
    objectCount: 6,
    materialCount: 3,
    textureMemoryEstimateMB: 0,
    shadowConfig: 'Disabled',
    description: 'Simple lighting, 5 basic geometric meshes, Lambert materials, static ground',
  },
  L2: {
    level: 'L2',
    name: 'Moderate Grid',
    expectedTriangles: 32400,
    expectedDrawCalls: 46,
    objectCount: 46,
    materialCount: 8,
    textureMemoryEstimateMB: 0,
    shadowConfig: '1024×1024 PCF Soft',
    description: '45 meshes in concentric rings, PBR materials, real-time shadows, 3 lights',
  },
  L3: {
    level: 'L3',
    name: 'Heavy High-Poly',
    expectedTriangles: 96800,
    expectedDrawCalls: 162,
    objectCount: 162,
    materialCount: 16,
    textureMemoryEstimateMB: 16.0,
    shadowConfig: '2048×2048 PCF Soft',
    description: '160 high-density meshes, procedural GPU textures, multi-point lighting',
  },
  L4: {
    level: 'L4',
    name: 'Target Stress (Humanoid + Arena)',
    expectedTriangles: 182400,
    expectedDrawCalls: 218,
    objectCount: 218,
    materialCount: 24,
    textureMemoryEstimateMB: 24.0,
    shadowConfig: '2048×2048 PCF Soft + Dynamic Cascade',
    description: 'Articulated 28-link humanoid robot, walking kinematics, arena walls, 60 obstacles',
  },
  ASIMOV_STATIC: {
    level: 'ASIMOV_STATIC',
    name: 'Asimov 1 Visual Model (Neutral)',
    expectedTriangles: ASIMOV_1_TRIANGLES,
    expectedDrawCalls: 26,
    objectCount: 27,
    materialCount: 4,
    textureMemoryEstimateMB: 0,
    shadowConfig: '1024×1024 PCF Soft',
    description: 'Canonical Asimov 1 visual hierarchy (26 links, 25 joints), neutral standing pose',
  },
  ASIMOV_ARTICULATED: {
    level: 'ASIMOV_ARTICULATED',
    name: 'Asimov 1 Active Articulation',
    expectedTriangles: ASIMOV_1_TRIANGLES,
    expectedDrawCalls: 26,
    objectCount: 27,
    materialCount: 4,
    textureMemoryEstimateMB: 0,
    shadowConfig: '1024×1024 PCF Soft',
    description: 'Asimov 1 running continuous 25-joint motion sequence (crouch, arms, walking kinematics)',
  },
  ASIMOV_ENVIRONMENT: {
    level: 'ASIMOV_ENVIRONMENT',
    name: 'Asimov 1 + Target Arena Environment',
    expectedTriangles: ASIMOV_1_TRIANGLES + 5200,
    expectedDrawCalls: 58,
    objectCount: 59,
    materialCount: 6,
    textureMemoryEstimateMB: 5.3,
    shadowConfig: '1024×1024 PCF Soft',
    description: 'Asimov 1 articulated robot inside target arena with boundary walls, columns, and obstacles',
  },
};

/**
 * Creates deterministic procedural GPU DataTexture (RGBA8)
 */
function createProceduralDataTexture(width: number, height: number, pattern: 'checker' | 'normal' | 'noise'): THREE.DataTexture {
  const size = width * height;
  const data = new Uint8Array(4 * size);

  for (let i = 0; i < size; i++) {
    const x = i % width;
    const y = Math.floor(i / width);
    const stride = i * 4;

    if (pattern === 'checker') {
      const c = ((Math.floor(x / 32) + Math.floor(y / 32)) % 2 === 0) ? 220 : 40;
      data[stride] = c;
      data[stride + 1] = c;
      data[stride + 2] = c + 20;
      data[stride + 3] = 255;
    } else if (pattern === 'normal') {
      // Perturbed tangent space normal vector (128, 128, 255)
      const nx = Math.sin(x * 0.1) * 30 + 128;
      const ny = Math.cos(y * 0.1) * 30 + 128;
      data[stride] = Math.max(0, Math.min(255, nx));
      data[stride + 1] = Math.max(0, Math.min(255, ny));
      data[stride + 2] = 255;
      data[stride + 3] = 255;
    } else {
      // Deterministic pseudo-noise
      const val = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
      const c = Math.floor(Math.abs(val) * 255);
      data[stride] = c;
      data[stride + 1] = c;
      data[stride + 2] = c;
      data[stride + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Creates high-fidelity laboratory floor ceramic tile DataTexture with crisp 1m x 1m grid grout lines.
 */
function createLabFloorTexture(repeatX: number, repeatY: number): THREE.DataTexture {
  const width = 256;
  const height = 256;
  const size = width * height;
  const data = new Uint8Array(4 * size);
  const borderWidth = 6;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const isBorder = x < borderWidth || x >= width - borderWidth || y < borderWidth || y >= height - borderWidth;
      const isInnerBevel =
        !isBorder &&
        (x < borderWidth + 3 || x >= width - borderWidth - 3 || y < borderWidth + 3 || y >= height - borderWidth - 3);

      if (isBorder) {
        data[idx] = 71;
        data[idx + 1] = 85;
        data[idx + 2] = 105;
        data[idx + 3] = 255;
      } else if (isInnerBevel) {
        data[idx] = 148;
        data[idx + 1] = 163;
        data[idx + 2] = 184;
        data[idx + 3] = 255;
      } else {
        const noise = ((x * 13 + y * 23) % 7) - 3;
        data[idx] = Math.max(0, Math.min(255, 226 + noise));
        data[idx + 1] = Math.max(0, Math.min(255, 232 + noise));
        data[idx + 2] = Math.max(0, Math.min(255, 240 + noise));
        data[idx + 3] = 255;
      }
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.needsUpdate = true;
  return texture;
}

function createLabFloorRoughness(repeatX: number, repeatY: number): THREE.DataTexture {
  const width = 128;
  const height = 128;
  const size = width * height;
  const data = new Uint8Array(4 * size);
  const borderWidth = 3;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const isBorder = x < borderWidth || x >= width - borderWidth || y < borderWidth || y >= height - borderWidth;

      const r = isBorder ? 220 : 70;
      data[idx] = r;
      data[idx + 1] = r;
      data[idx + 2] = r;
      data[idx + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.needsUpdate = true;
  return texture;
}

export interface ArticulatedJoint {
  mesh: THREE.Object3D;
  axis: 'x' | 'y' | 'z';
  baseAngle: number;
  amplitude: number;
  frequency: number;
  phase: number;
}

/**
 * BenchmarkScene
 * 
 * Manages deterministic creation and dynamic updating of benchmark workloads.
 */
export class BenchmarkScene {
  private sceneManager: SceneManager;
  private currentLevel: BenchmarkLevel = 'L1';
  private animatedObjects: { mesh: THREE.Object3D; rotationSpeed: THREE.Vector3; initialPos: THREE.Vector3; bobbingFreq?: number }[] = [];
  private articulatedJoints: ArticulatedJoint[] = [];
  private textures: THREE.DataTexture[] = [];
  private texturesEnabled: boolean = true;
  private animationEnabled: boolean = true;

  public readonly robotModel: AsimovRobotModel = new AsimovRobotModel();
  public readonly dynamicObstacleGroup: THREE.Group = new THREE.Group();
  public readonly pairLabGroup: THREE.Group = new THREE.Group();
  private currentEnvironmentPreset: string = 'pair_lab';
  private floorMesh: THREE.Mesh | null = null;

  constructor(sceneManager: SceneManager) {
    this.sceneManager = sceneManager;
    this.pairLabGroup.name = 'PAIR_Lab_MUJOCO';
    this.dynamicObstacleGroup.name = 'MuJoCo_Dynamic_Environment';
    this.sceneManager.worldGroup.add(this.pairLabGroup);
    this.sceneManager.worldGroup.add(this.dynamicObstacleGroup);
    this.sceneManager.robotGroup.add(this.robotModel.rootGroup);
    this.robotModel.load().catch((err) => {
      console.warn('Failed to pre-load AsimovRobotModel:', err);
    });
    this.loadLevel('ASIMOV_ENVIRONMENT');
  }

  public async waitForReady(): Promise<void> {
    if (this.robotModel.isReady()) return;
    await this.robotModel.load();
  }

  public getLevel(): BenchmarkLevel {
    return this.currentLevel;
  }

  public getWorkloadSpec(): BenchmarkWorkloadSpec {
    return WORKLOAD_SPECS[this.currentLevel];
  }

  public setAnimationEnabled(enabled: boolean): void {
    this.animationEnabled = enabled;
  }

  public isAnimationEnabled(): boolean {
    return this.animationEnabled;
  }

  public setTexturesEnabled(enabled: boolean): void {
    if (this.texturesEnabled === enabled) return;
    this.texturesEnabled = enabled;
    // Reload current level with or without textures
    this.loadLevel(this.currentLevel);
  }

  public isTexturesEnabled(): boolean {
    return this.texturesEnabled;
  }

  /**
   * Builds the deterministic benchmark scene for the specified level.
   */
  public loadLevel(level: BenchmarkLevel): void {
    this.currentLevel = level;
    this.sceneManager.clearObjects();
    // Detach persistent environment groups before clearing temporary world objects to prevent destruction
    if (this.sceneManager.worldGroup.children.includes(this.pairLabGroup)) {
      this.sceneManager.worldGroup.remove(this.pairLabGroup);
    }
    if (this.sceneManager.worldGroup.children.includes(this.dynamicObstacleGroup)) {
      this.sceneManager.worldGroup.remove(this.dynamicObstacleGroup);
    }
    this.sceneManager.clearWorld();
    this.animatedObjects = [];
    this.articulatedJoints = [];

    // Clean old textures
    this.textures.forEach((t) => t.dispose());
    this.textures = [];

    // 1. Build Environment / World
    this.buildWorld(level);

    // 2. Build Workload Objects
    switch (level) {
      case 'L1':
        this.buildLevel1Minimal();
        break;
      case 'L2':
        this.buildLevel2Moderate();
        break;
      case 'L3':
        this.buildLevel3Heavy();
        break;
      case 'L4':
        this.buildLevel4TargetStress();
        break;
      case 'ASIMOV_STATIC':
        this.buildAsimovStatic();
        break;
      case 'ASIMOV_ARTICULATED':
        this.buildAsimovArticulated();
        break;
      case 'ASIMOV_ENVIRONMENT':
        this.buildAsimovEnvironment();
        break;
    }
  }

  /**
   * Deterministic Floor and World Boundaries
   */
  private buildWorld(level: BenchmarkLevel): void {
    const worldGroup = this.sceneManager.worldGroup;

    // Floor Quad (expansive floor for panoramic mobile view)
    const floorGeo = new THREE.PlaneGeometry(80, 80, 32, 32);
    floorGeo.rotateX(-Math.PI / 2);

    let floorMat: THREE.Material;
    if (level === 'L1') {
      floorMat = new THREE.MeshLambertMaterial({ color: 0x1e293b });
    } else {
      let floorTex: THREE.DataTexture | null = null;
      if (this.texturesEnabled && (level === 'L3' || level === 'L4')) {
        floorTex = createProceduralDataTexture(512, 512, 'checker');
        this.textures.push(floorTex);
      }
      floorMat = new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.8,
        metalness: 0.2,
        map: floorTex,
      });
    }

    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.receiveShadow = level !== 'L1';
    worldGroup.add(floorMesh);
    this.floorMesh = floorMesh;

    // Coordinate Grid Reference
    const grid = new THREE.GridHelper(80, 80, 0x38bdf8, 0x334155);
    grid.position.y = 0.005;
    worldGroup.add(grid);

    // In authentic ASIMOV_ENVIRONMENT (PAIR Lab), the dedicated solid floor slab and foundation are used
    if (level === 'ASIMOV_ENVIRONMENT') {
      floorMesh.visible = false;
      grid.visible = false;
    }
    // Ensure dynamic environment group and PAIR Lab group are mounted
    if (!worldGroup.children.includes(this.dynamicObstacleGroup)) {
      worldGroup.add(this.dynamicObstacleGroup);
    }
    if (!worldGroup.children.includes(this.pairLabGroup)) {
      worldGroup.add(this.pairLabGroup);
    }
  }

  /**
   * LEVEL 1 — MINIMAL
   * 5 simple meshes, basic Lambert materials, no shadows.
   */
  private buildLevel1Minimal(): void {
    const group = this.sceneManager.objectsGroup;
    this.sceneManager.setLighting(false);

    const m1 = new THREE.MeshLambertMaterial({ color: 0x38bdf8 });
    const m2 = new THREE.MeshLambertMaterial({ color: 0xf43f5e });
    const m3 = new THREE.MeshLambertMaterial({ color: 0x10b981 });

    // Center Pedestal
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.2, 16), m1);
    cyl.position.set(0, 0.6, 0);
    group.add(cyl);

    // 4 satellite meshes
    const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), m2);
    b1.position.set(2, 0.4, 0);
    group.add(b1);
    this.animatedObjects.push({ mesh: b1, rotationSpeed: new THREE.Vector3(0.5, 0.8, 0), initialPos: b1.position.clone() });

    const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), m2);
    b2.position.set(-2, 0.4, 0);
    group.add(b2);
    this.animatedObjects.push({ mesh: b2, rotationSpeed: new THREE.Vector3(0.8, 0.5, 0), initialPos: b2.position.clone() });

    const s1 = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 16), m3);
    s1.position.set(0, 0.5, 2);
    group.add(s1);
    this.animatedObjects.push({ mesh: s1, rotationSpeed: new THREE.Vector3(0, 1.0, 0), initialPos: s1.position.clone() });

    const s2 = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 16), m3);
    s2.position.set(0, 0.5, -2);
    group.add(s2);
    this.animatedObjects.push({ mesh: s2, rotationSpeed: new THREE.Vector3(0, -1.0, 0), initialPos: s2.position.clone() });
  }

  /**
   * LEVEL 2 — MODERATE
   * 45 meshes in concentric rings, PBR Standard materials, real-time shadows.
   */
  private buildLevel2Moderate(): void {
    const group = this.sceneManager.objectsGroup;
    this.sceneManager.setLighting(true);

    const materials: THREE.MeshStandardMaterial[] = [
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.3, metalness: 0.7 }),
      new THREE.MeshStandardMaterial({ color: 0xf43f5e, roughness: 0.4, metalness: 0.5 }),
      new THREE.MeshStandardMaterial({ color: 0x10b981, roughness: 0.2, metalness: 0.8 }),
      new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.5, metalness: 0.3 }),
      new THREE.MeshStandardMaterial({ color: 0xa855f7, roughness: 0.6, metalness: 0.4 }),
    ];

    const geometries = [
      new THREE.SphereGeometry(0.4, 24, 24),
      new THREE.BoxGeometry(0.6, 0.6, 0.6),
      new THREE.CylinderGeometry(0.3, 0.3, 0.8, 20),
      new THREE.TorusGeometry(0.35, 0.12, 16, 32),
      new THREE.ConeGeometry(0.4, 0.8, 20),
    ];

    // Inner ring (15 objects)
    for (let i = 0; i < 15; i++) {
      const angle = (i / 15) * Math.PI * 2;
      const radius = 2.8;
      const geo = geometries[i % geometries.length];
      const mat = materials[i % materials.length];
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(Math.cos(angle) * radius, 0.8, Math.sin(angle) * radius);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);

      this.animatedObjects.push({
        mesh,
        rotationSpeed: new THREE.Vector3((i % 3 + 1) * 0.4, (i % 2 + 1) * 0.5, 0),
        initialPos: mesh.position.clone(),
        bobbingFreq: 1.5 + (i % 4) * 0.2,
      });
    }

    // Outer ring (30 objects)
    for (let i = 0; i < 30; i++) {
      const angle = (i / 30) * Math.PI * 2;
      const radius = 5.5;
      const geo = geometries[(i + 2) % geometries.length];
      const mat = materials[(i + 1) % materials.length];
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(Math.cos(angle) * radius, 0.6, Math.sin(angle) * radius);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);

      this.animatedObjects.push({
        mesh,
        rotationSpeed: new THREE.Vector3(0, (i % 2 === 0 ? 1 : -1) * 0.6, 0.3),
        initialPos: mesh.position.clone(),
        bobbingFreq: 2.0 + (i % 3) * 0.3,
      });
    }
  }

  /**
   * LEVEL 3 — HEAVY
   * 160 dense meshes, procedural GPU textures, multi-layer PBR materials, heavy geometry.
   */
  private buildLevel3Heavy(): void {
    const group = this.sceneManager.objectsGroup;
    this.sceneManager.setLighting(true);

    let texAlbedo: THREE.DataTexture | null = null;
    let texNormal: THREE.DataTexture | null = null;
    if (this.texturesEnabled) {
      texAlbedo = createProceduralDataTexture(1024, 1024, 'checker');
      texNormal = createProceduralDataTexture(1024, 1024, 'normal');
      this.textures.push(texAlbedo, texNormal);
    }

    const materials: THREE.MeshStandardMaterial[] = [
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.3, metalness: 0.8, map: texAlbedo, normalMap: texNormal }),
      new THREE.MeshStandardMaterial({ color: 0xf43f5e, roughness: 0.4, metalness: 0.6, map: texAlbedo, normalMap: texNormal }),
      new THREE.MeshStandardMaterial({ color: 0x10b981, roughness: 0.25, metalness: 0.85, normalMap: texNormal }),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.5, metalness: 0.4, map: texAlbedo }),
    ];

    const geometries = [
      new THREE.TorusGeometry(0.35, 0.14, 24, 48), // ~2300 tris each
      new THREE.SphereGeometry(0.4, 32, 32),       // ~2000 tris each
      new THREE.CylinderGeometry(0.3, 0.3, 0.8, 32),
      new THREE.IcosahedronGeometry(0.45, 2),
    ];

    // Grid array: 160 objects (4 rings + center cluster)
    let count = 0;
    const rings = [
      { radius: 1.5, count: 16 },
      { radius: 3.2, count: 32 },
      { radius: 5.0, count: 48 },
      { radius: 7.0, count: 64 },
    ];

    for (const ring of rings) {
      for (let i = 0; i < ring.count; i++) {
        const angle = (i / ring.count) * Math.PI * 2;
        const geo = geometries[(count) % geometries.length];
        const mat = materials[(count) % materials.length];
        const mesh = new THREE.Mesh(geo, mat);

        const x = Math.cos(angle) * ring.radius;
        const z = Math.sin(angle) * ring.radius;
        mesh.position.set(x, 0.6 + (count % 3) * 0.4, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);

        this.animatedObjects.push({
          mesh,
          rotationSpeed: new THREE.Vector3(0.5, 0.7, 0.3),
          initialPos: mesh.position.clone(),
          bobbingFreq: 1.2 + (count % 5) * 0.2,
        });

        count++;
      }
    }
  }

  /**
   * LEVEL 4 — TARGET STRESS TEST (Humanoid Articulated Robot + Complex Arena)
   * 28 articulated kinematic joints + arena walls + 60 dynamic obstacles + dual cascades.
   */
  private buildLevel4TargetStress(): void {
    const group = this.sceneManager.objectsGroup;
    this.sceneManager.setLighting(true);

    let texAlbedo: THREE.DataTexture | null = null;
    let texNormal: THREE.DataTexture | null = null;
    if (this.texturesEnabled) {
      texAlbedo = createProceduralDataTexture(1024, 1024, 'checker');
      texNormal = createProceduralDataTexture(1024, 1024, 'normal');
      this.textures.push(texAlbedo, texNormal);
    }

    // 1. Build Articulated 28-Link Humanoid Model
    this.buildArticulatedHumanoid(group, texAlbedo, texNormal);

    // 2. Build Surrounding Arena Geometry (Columns & Obstacles: 190 objects)
    this.buildArenaEnvironment(group, texAlbedo, texNormal);
  }

  /**
   * Articulated Humanoid with 28 linked kinematic segments
   */
  private buildArticulatedHumanoid(
    parent: THREE.Group,
    albedo: THREE.DataTexture | null,
    normal: THREE.DataTexture | null
  ): void {
    const robotRoot = new THREE.Group();
    robotRoot.name = 'Humanoid_Robot_Root';
    robotRoot.position.set(0, 1.15, 0);
    parent.add(robotRoot);

    const alloyMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      metalness: 0.9,
      roughness: 0.2,
      map: albedo,
      normalMap: normal,
    });

    const darkAlloyMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.8,
      roughness: 0.3,
    });

    const jointMat = new THREE.MeshStandardMaterial({
      color: 0xf43f5e,
      metalness: 0.7,
      roughness: 0.3,
    });

    // --- Torso & Pelvis ---
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.22), darkAlloyMat);
    pelvis.castShadow = true;
    pelvis.receiveShadow = true;
    robotRoot.add(pelvis);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.44, 0.24), alloyMat);
    torso.position.set(0, 0.32, 0);
    torso.castShadow = true;
    torso.receiveShadow = true;
    pelvis.add(torso);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.1, 16), jointMat);
    neck.position.set(0, 0.26, 0);
    neck.castShadow = true;
    torso.add(neck);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 24, 24), alloyMat);
    head.position.set(0, 0.14, 0);
    head.castShadow = true;
    neck.add(head);

    // --- Arms (Left & Right) ---
    const createArm = (isLeft: boolean) => {
      const sign = isLeft ? 1 : -1;
      const shoulderJoint = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 16), jointMat);
      shoulderJoint.position.set(sign * 0.26, 0.18, 0);
      shoulderJoint.castShadow = true;
      torso.add(shoulderJoint);

      const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.28, 16), alloyMat);
      upperArm.position.set(0, -0.16, 0);
      upperArm.castShadow = true;
      shoulderJoint.add(upperArm);

      const elbowJoint = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 16), jointMat);
      elbowJoint.position.set(0, -0.16, 0);
      elbowJoint.castShadow = true;
      upperArm.add(elbowJoint);

      const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.26, 16), darkAlloyMat);
      forearm.position.set(0, -0.15, 0);
      forearm.castShadow = true;
      elbowJoint.add(forearm);

      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.08), alloyMat);
      hand.position.set(0, -0.15, 0);
      hand.castShadow = true;
      forearm.add(hand);

      // Arm animation descriptors
      this.articulatedJoints.push(
        { mesh: shoulderJoint, axis: 'x', baseAngle: 0, amplitude: 0.5, frequency: 2.2, phase: isLeft ? 0 : Math.PI },
        { mesh: elbowJoint, axis: 'x', baseAngle: 0.4, amplitude: 0.4, frequency: 2.2, phase: isLeft ? 0.3 : Math.PI + 0.3 }
      );
    };

    createArm(true);
    createArm(false);

    // --- Legs (Left & Right) ---
    const createLeg = (isLeft: boolean) => {
      const sign = isLeft ? 1 : -1;
      const hipJoint = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 16), jointMat);
      hipJoint.position.set(sign * 0.14, -0.1, 0);
      hipJoint.castShadow = true;
      pelvis.add(hipJoint);

      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.42, 20), alloyMat);
      thigh.position.set(0, -0.22, 0);
      thigh.castShadow = true;
      hipJoint.add(thigh);

      const kneeJoint = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 16), jointMat);
      kneeJoint.position.set(0, -0.22, 0);
      kneeJoint.castShadow = true;
      thigh.add(kneeJoint);

      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.42, 20), darkAlloyMat);
      shin.position.set(0, -0.22, 0);
      shin.castShadow = true;
      kneeJoint.add(shin);

      const ankleJoint = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 16), jointMat);
      ankleJoint.position.set(0, -0.22, 0);
      ankleJoint.castShadow = true;
      shin.add(ankleJoint);

      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.22), alloyMat);
      foot.position.set(0, -0.04, 0.05);
      foot.castShadow = true;
      foot.receiveShadow = true;
      ankleJoint.add(foot);

      // Leg gait kinematics
      this.articulatedJoints.push(
        { mesh: hipJoint, axis: 'x', baseAngle: 0, amplitude: 0.6, frequency: 2.2, phase: isLeft ? Math.PI : 0 },
        { mesh: kneeJoint, axis: 'x', baseAngle: -0.4, amplitude: 0.5, frequency: 2.2, phase: isLeft ? Math.PI + 0.5 : 0.5 },
        { mesh: ankleJoint, axis: 'x', baseAngle: 0.2, amplitude: 0.3, frequency: 2.2, phase: isLeft ? Math.PI : 0 }
      );
    };

    createLeg(true);
    createLeg(false);
  }

  /**
   * Surrounding Arena Perimeter & Obstacle Blocks
   */
  private buildArenaEnvironment(
    parent: THREE.Group,
    albedo: THREE.DataTexture | null,
    normal: THREE.DataTexture | null
  ): void {
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.7,
      metalness: 0.3,
      normalMap: normal,
    });

    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.3,
      metalness: 0.8,
    });

    const obstacleMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      roughness: 0.5,
      metalness: 0.5,
      map: albedo,
    });

    // 16 Perimeter Pillars
    const pillarGeo = new THREE.CylinderGeometry(0.25, 0.25, 3.5, 20);
    const radius = 9.0;
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(Math.cos(angle) * radius, 1.75, Math.sin(angle) * radius);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      parent.add(pillar);
    }

    // 16 Wall Segments
    const wallGeo = new THREE.BoxGeometry(3.2, 2.0, 0.2);
    for (let i = 0; i < 16; i++) {
      const angle = ((i + 0.5) / 16) * Math.PI * 2;
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.position.set(Math.cos(angle) * radius, 1.0, Math.sin(angle) * radius);
      wall.rotation.y = -angle + Math.PI / 2;
      wall.castShadow = true;
      wall.receiveShadow = true;
      parent.add(wall);
    }

    // 150 Clutter / Obstacle Blocks scattered deterministically across floor
    const boxGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const sphereGeo = new THREE.SphereGeometry(0.35, 20, 20);

    for (let i = 0; i < 150; i++) {
      const geo = i % 2 === 0 ? boxGeo : sphereGeo;
      const obstacle = new THREE.Mesh(geo, obstacleMat);
      // Deterministic layout in rings
      const r = 2.0 + (i % 6) * 1.0;
      const a = (i * 0.45);
      obstacle.position.set(Math.cos(a) * r, 0.25 + (i % 3) * 0.15, Math.sin(a) * r);
      obstacle.castShadow = true;
      obstacle.receiveShadow = true;
      parent.add(obstacle);

      this.animatedObjects.push({
        mesh: obstacle,
        rotationSpeed: new THREE.Vector3(0.2, 0.4, 0.1),
        initialPos: obstacle.position.clone(),
        bobbingFreq: 1.0 + (i % 4) * 0.2,
      });
    }
  }

  /**
   * ASIMOV 1 STATIC — Canonical visual model in neutral pose
   */
  private buildAsimovStatic(): void {
    this.sceneManager.setLighting(true);
    this.robotModel.resetToNeutralPose();
    this.robotModel.applyBasePose([0, 0, 0.630], [0, 0, 0, 1]);
    this.sceneManager.objectsGroup.add(this.robotModel.rootGroup);
  }

  /**
   * PAIR Lab MUJOCO Environment
   * Authoritative 1:1 visual environment loaded directly from PAIR_Lab.glb
   * (Exported directly from PAIR_Lab.blend without manual reconstruction).
   */
  public authoritativeGlbLoaded: boolean = false;
  private authoritativeLabModel: THREE.Group | null = null;
  private immediateEnvironmentModel: THREE.Group | null = null;

  public async loadAuthoritativePairLabEnvironment(glbPathOrUrl?: string): Promise<THREE.Group> {
    if (this.authoritativeLabModel && this.authoritativeLabModel.children.length > 0) {
      if (!this.pairLabGroup.children.includes(this.authoritativeLabModel)) {
        this.pairLabGroup.add(this.authoritativeLabModel);
      }
      return this.pairLabGroup;
    }

    const loader = new GLTFLoader();

    // Node / Testing environment: read from filesystem
    if (typeof window === 'undefined' && typeof process !== 'undefined') {
      try {
        if (typeof globalThis !== 'undefined' && !(globalThis as any).self) {
          (globalThis as any).self = globalThis;
        }
        const fs = require('fs');
        const path = require('path');
        const candidate = glbPathOrUrl || path.resolve(__dirname, '../../assets/pair_lab.glb');
        const targetFile = fs.existsSync(candidate) ? candidate : null;
        if (targetFile) {
          const buf = fs.readFileSync(targetFile);
          const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
          return new Promise<THREE.Group>((resolve) => {
            loader.parse(
              arrayBuf,
              '',
              (gltf) => {
                this.applyAuthoritativeModel(gltf.scene);
                resolve(this.pairLabGroup);
              },
              (err) => {
                console.info('GLTFLoader parse info:', err);
                resolve(this.pairLabGroup);
              }
            );
          });
        }
      } catch (e) {
        console.info('Node GLB loader info:', e);
      }
    }

    // In Web / React Native environment:
    // Only attempt network fetch if an explicit custom URL or path was supplied.
    // By default, the in-memory authoritative immediate environment is already mounted
    // with full geometry and authoritative textures with zero network latency.
    if (glbPathOrUrl && typeof fetch === 'function' && glbPathOrUrl.startsWith('http')) {
      return new Promise<THREE.Group>((resolve) => {
        fetch(glbPathOrUrl)
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.arrayBuffer();
          })
          .then((buf) => {
            loader.parse(
              buf,
              '',
              (gltf) => {
                this.applyAuthoritativeModel(gltf.scene);
                resolve(this.pairLabGroup);
              },
              (err) => {
                console.info('GLTFLoader parse info:', err);
                resolve(this.pairLabGroup);
              }
            );
          })
          .catch((fetchErr) => {
            console.info('Custom GLB fetch skipped:', fetchErr?.message || fetchErr);
            resolve(this.pairLabGroup);
          });
      });
    }

    return Promise.resolve(this.pairLabGroup);
  }

  /**
   * Constructs the canonical PAIR Lab environment immediately in-memory with zero network latency.
   * Utilizes pre-compiled authoritative geometry (PAIR_LAB_MESHES, PAIR_LAB_BODIES, PAIR_LAB_CUBES)
   * and GPU DataTextures so the floor, walls, tables, chairs, and obstacles render instantly on mobile.
   */
  public buildImmediatePairLabEnvironment(): THREE.Group {
    if (this.immediateEnvironmentModel && this.immediateEnvironmentModel.children.length > 0) {
      return this.immediateEnvironmentModel;
    }

    const container = new THREE.Group();
    container.name = 'Authoritative_Pair_Lab_Immediate';

    // 1. Authoritative Floor Plane (7.1720m width x 8.4186m length matching pair_lab.xml)
    const floorGeo = new THREE.PlaneGeometry(7.1720, 8.4186);
    floorGeo.rotateX(-Math.PI / 2);
    const floorTex = getAuthoritativeDataTexture('floor');
    if (floorTex) {
      floorTex.wrapS = THREE.RepeatWrapping;
      floorTex.wrapT = THREE.RepeatWrapping;
      floorTex.repeat.set(15, 18);
      floorTex.needsUpdate = true;
    }
    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTex || null,
      color: floorTex ? new THREE.Color(1, 1, 1) : new THREE.Color(0x334155),
      roughness: 0.82,
      metalness: 0.05,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.name = 'Floor';
    floorMesh.receiveShadow = true;
    floorMesh.position.set(0, 0, 0);
    container.add(floorMesh);

    // Subtle extended ground below horizon
    const subGroundGeo = new THREE.PlaneGeometry(50, 50);
    subGroundGeo.rotateX(-Math.PI / 2);
    const subGroundMat = new THREE.MeshStandardMaterial({
      color: 0x090d16,
      roughness: 0.95,
      metalness: 0.0,
    });
    const subGround = new THREE.Mesh(subGroundGeo, subGroundMat);
    subGround.position.set(0, -0.02, 0);
    container.add(subGround);

    // 2. Architectural Boundary Walls & Structural Pillars (1:1 with pair_lab.xml)
    const wallHeight = 2.4838;

    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.88,
      metalness: 0.02,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xbfe0f7,
      transparent: true,
      opacity: 0.35,
      roughness: 0.10,
      metalness: 0.10,
    });
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.85,
      metalness: 0.05,
    });
    const partitionMat = new THREE.MeshStandardMaterial({
      color: 0xd1d5db,
      roughness: 0.85,
      metalness: 0.05,
    });

    // North Wall (Solid) - MuJoCo pos [0, 3.5860, 1.2419], size [4.2093, 0.0372, 1.2419]
    // Runs along Three.js Z at X = -3.5860
    const northWall = new THREE.Mesh(new THREE.BoxGeometry(0.0744, wallHeight, 8.4186), wallMat);
    northWall.name = 'Wall_North';
    northWall.position.set(-3.5860, wallHeight / 2, 0);
    northWall.receiveShadow = true;
    container.add(northWall);

    // East Wall (Solid) - MuJoCo pos [4.2093, 0, 1.2419], size [0.0372, 3.5860, 1.2419]
    // Runs along Three.js X at Z = -4.2093
    const eastWall = new THREE.Mesh(new THREE.BoxGeometry(7.1720, wallHeight, 0.0744), wallMat);
    eastWall.name = 'Wall_East';
    eastWall.position.set(0, wallHeight / 2, -4.2093);
    eastWall.receiveShadow = true;
    container.add(eastWall);

    // South Wall (Glass Partition) - MuJoCo pos [0, -3.5860, 1.2419], size [4.2093, 0.0186, 1.2419]
    // Runs along Three.js Z at X = 3.5860
    const southWall = new THREE.Mesh(new THREE.BoxGeometry(0.0372, wallHeight, 8.4186), glassMat);
    southWall.name = 'Glass_Wall_South';
    southWall.position.set(3.5860, wallHeight / 2, 0);
    container.add(southWall);

    // West Wall (Glass Partition) - MuJoCo pos [-4.2093, 0, 1.2419], size [0.0186, 3.5860, 1.2419]
    // Runs along Three.js X at Z = 4.2093
    const westWall = new THREE.Mesh(new THREE.BoxGeometry(7.1720, wallHeight, 0.0372), glassMat);
    westWall.name = 'Glass_Wall_West';
    westWall.position.set(0, wallHeight / 2, 4.2093);
    container.add(westWall);

    // Side Room Partition - MuJoCo pos [2.7674, 2.9814, 1.2419], size [1.4419, 0.6047, 1.2419]
    const sideRoom = new THREE.Mesh(new THREE.BoxGeometry(1.2094, wallHeight, 2.8838), partitionMat);
    sideRoom.name = 'Side_Room';
    sideRoom.position.set(-2.9814, wallHeight / 2, -2.7674);
    sideRoom.receiveShadow = true;
    container.add(sideRoom);

    // Structural Pillars
    const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.4652, wallHeight, 0.2326), pillarMat);
    p1.name = 'Pillar_Big';
    p1.position.set(3.3535, wallHeight / 2, 4.0930);
    p1.castShadow = true;
    p1.receiveShadow = true;
    container.add(p1);

    const p2 = new THREE.Mesh(new THREE.BoxGeometry(0.4652, wallHeight, 0.2326), pillarMat);
    p2.name = 'Pillar_Mid';
    p2.position.set(3.3535, wallHeight / 2, -4.0930);
    p2.castShadow = true;
    p2.receiveShadow = true;
    container.add(p2);

    const p3 = new THREE.Mesh(new THREE.BoxGeometry(0.4652, wallHeight, 0.1024), pillarMat);
    p3.name = 'Pillar_Short';
    p3.position.set(1.5743, wallHeight / 2, -4.1581);
    p3.castShadow = true;
    p3.receiveShadow = true;
    container.add(p3);

    // 3. Compile Geometries & Materials from PAIR_LAB_MESHES
    const cachedGeometries = new Map<string, THREE.BufferGeometry>();
    const cachedMaterials = new Map<string, THREE.MeshStandardMaterial>();

    const matToTexKey: Record<string, string> = {
      'tripo_mat_3ce66be0': 'chair',
      'chair_mat': 'chair',
      'tripo_mat_4cb0bd4b': 'gaming_chair',
      'gaming_chair_mat': 'gaming_chair',
      'Material.001': 'table',
      'table_wood_mat': 'table',
      'tripo_mat_83625889': 'table_adjustable',
      'table_adj_mat': 'table_adjustable',
      'tripo_mat_3a807052': 'almirah',
      'almirah_mat': 'almirah',
      'tripo_mat_0eb0c7ea': 'beanbag',
      'beanbag_mat': 'beanbag',
      'tripo_mat_d417ecab': 'screen',
      'screen_mat': 'screen',
      'tripo_mat_4648c5fa': 'whiteboard',
      'whiteboard_mat': 'whiteboard',
      'Carpet': 'floor',
    };

    for (const [meshName, spec] of Object.entries(PAIR_LAB_MESHES)) {
      const geom = decodeMeshSpec(spec);
      cachedGeometries.set(meshName, geom);

      const texKey = matToTexKey[spec.mat] || spec.mat;
      const tex = getAuthoritativeDataTexture(texKey);
      const mat = new THREE.MeshStandardMaterial({
        map: tex || null,
        color: tex ? new THREE.Color(1, 1, 1) : new THREE.Color(0x94a3b8),
        roughness: 0.55,
        metalness: 0.05,
      });
      cachedMaterials.set(meshName, mat);
    }

    // 4. Instantiate Furniture Bodies
    for (const body of PAIR_LAB_BODIES) {
      const geom = cachedGeometries.get(body.mesh);
      const mat = cachedMaterials.get(body.mesh);
      if (!geom || !mat) continue;

      const mesh = new THREE.Mesh(geom, mat);
      mesh.name = body.name;
      mesh.position.set(body.pos[0], body.pos[1], body.pos[2]);
      mesh.rotation.y = body.rotY;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      container.add(mesh);
    }

    // 5. Instantiate Obstacle Cubes
    const cubeMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      roughness: 0.45,
      metalness: 0.15,
    });
    for (const cube of PAIR_LAB_CUBES) {
      const cubeGeo = new THREE.BoxGeometry(cube.size[0], cube.size[1], cube.size[2]);
      const mesh = new THREE.Mesh(cubeGeo, cubeMat);
      mesh.name = cube.name;
      mesh.position.set(cube.pos[0], cube.pos[1], cube.pos[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      container.add(mesh);
    }

    this.immediateEnvironmentModel = container;
    return container;
  }

  private applyAuthoritativeModel(scene: THREE.Group): void {
    // If scene does not include architectural boundaries (Floor, Walls), retain them from immediate model
    const hasFloor = Boolean(scene.getObjectByName('Floor'));
    if (!hasFloor && this.immediateEnvironmentModel) {
      // Retain architectural boundaries (Floor, subGround, Walls, Pillars, Cubes)
      // and only replace the furniture items
      const furnitureNames = new Set([
        'table_big', 'table_small_1', 'table_small_2', 'table_adjustable',
        'gaming_chair', 'almirah', 'screen', 'beanbag_1', 'beanbag_2', 'whiteboard_1',
        'chair_1', 'chair_2', 'chair_3', 'chair_4', 'chair_5', 'chair_6',
        'chair_7', 'chair_8', 'chair_9', 'chair_10', 'chair_11',
      ]);
      const toRemove: THREE.Object3D[] = [];
      this.immediateEnvironmentModel.traverse((child) => {
        if (furnitureNames.has(child.name)) {
          toRemove.push(child);
        }
      });
      for (const obj of toRemove) {
        if (obj.parent) obj.parent.remove(obj);
      }
      if (!this.pairLabGroup.children.includes(this.immediateEnvironmentModel)) {
        this.pairLabGroup.add(this.immediateEnvironmentModel);
      }
    } else {
      if (this.immediateEnvironmentModel && this.pairLabGroup.children.includes(this.immediateEnvironmentModel)) {
        this.pairLabGroup.remove(this.immediateEnvironmentModel);
      }
      while (this.pairLabGroup.children.length > 0) {
        const child = this.pairLabGroup.children[0];
        this.pairLabGroup.remove(child);
        if ((child as any).geometry) (child as any).geometry.dispose();
        if ((child as any).material) {
          if (Array.isArray((child as any).material)) (child as any).material.forEach((m: any) => m.dispose());
          else (child as any).material.dispose();
        }
      }
    }

    // 1. Remove unwanted artifacts (e.g. Cube.001 floating black block)
    const toRemoveArtifacts: THREE.Object3D[] = [];
    scene.traverse((child) => {
      if (
        child.name === 'Cube.001' ||
        (child.name.startsWith('Cube') && child.position.y > 1.5)
      ) {
        toRemoveArtifacts.push(child);
      }
    });
    for (const obj of toRemoveArtifacts) {
      obj.visible = false;
      if (obj.parent) {
        obj.parent.remove(obj);
      }
    }

    // 2. Bind authoritative DataTextures natively onto WebGL materials
    bindAuthoritativeMaterials(scene);

    scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    this.authoritativeLabModel = scene;
    this.pairLabGroup.add(scene);
    this.authoritativeGlbLoaded = true;
  }

  public buildPairLabEnvironment(): void {
    const group = this.pairLabGroup;
    group.visible = true;
    if (!this.sceneManager.worldGroup.children.includes(this.pairLabGroup)) {
      this.sceneManager.worldGroup.add(this.pairLabGroup);
    }

    // 1. If authoritative GLB has already been parsed and loaded, ensure it is attached
    if (this.authoritativeLabModel && this.authoritativeLabModel.children.length > 0) {
      if (!this.pairLabGroup.children.includes(this.authoritativeLabModel)) {
        this.pairLabGroup.add(this.authoritativeLabModel);
      }
      return;
    }

    // 2. SYNCHRONOUS IMMEDIATE DISPLAY:
    // Mount the in-memory canonical PAIR Lab model immediately so the phone renders
    // the floor, walls, tables, chairs, and obstacles instantly with ZERO black void.
    const immediate = this.buildImmediatePairLabEnvironment();
    if (!this.pairLabGroup.children.includes(immediate)) {
      this.pairLabGroup.add(immediate);
    }

    // 3. Asynchronously attempt GLB enrichment in background only if a custom URL is provided
    this.loadAuthoritativePairLabEnvironment();
  }

  /**
   * ASIMOV 1 ARTICULATED — Canonical visual model with continuous 25-joint motion
   */
  private buildAsimovArticulated(): void {
    this.sceneManager.setLighting(true);
    this.robotModel.setEnvironmentScale(1.0);
    this.robotModel.resetToNeutralPose();
    this.robotModel.applyBasePose([0, 0, 0.630], [0, 0, 0, 1]);
    if (!this.sceneManager.robotGroup.children.includes(this.robotModel.rootGroup)) {
      this.sceneManager.robotGroup.add(this.robotModel.rootGroup);
    }
  }

  /**
   * ASIMOV 1 ENVIRONMENT — Canonical robot in PAIR Lab (default) or loaded arena
   */
  private buildAsimovEnvironment(): void {
    this.sceneManager.setLighting(true);

    // 1. Maintain canonical Asimov 1 official dimensions (1.20m, 35kg, pelvis 0.630m)
    this.robotModel.setEnvironmentScale(1.0);
    this.robotModel.resetToNeutralPose();
    this.robotModel.applyBasePose([0, 0, 0.630], [0, 0, 0, 1]);
    if (!this.sceneManager.robotGroup.children.includes(this.robotModel.rootGroup)) {
      this.sceneManager.robotGroup.add(this.robotModel.rootGroup);
    }

    // 2. Build and mount PAIR Lab at canonical 1:1 metric scale matching MuJoCo physics
    this.pairLabGroup.scale.set(1.0, 1.0, 1.0);
    if (!this.sceneManager.worldGroup.children.includes(this.pairLabGroup)) {
      this.sceneManager.worldGroup.add(this.pairLabGroup);
    }
    this.pairLabGroup.visible = true;
    this.buildPairLabEnvironment();
  }

  /**
   * Update all animated objects and kinematic joint hierarchies
   */
  public update(timeSeconds: number, deltaSeconds: number): void {
    if (!this.animationEnabled) return;

    // Update Asimov 1 continuous kinematic motion sequence ONLY in synthetic articulated demo mode
    if (this.currentLevel === 'ASIMOV_ARTICULATED') {
      this.robotModel.updateContinuousArticulation(timeSeconds);
    }

    // 1. Update rotating and bobbing objects (for synthetic levels)
    for (const item of this.animatedObjects) {
      item.mesh.rotation.x += item.rotationSpeed.x * deltaSeconds;
      item.mesh.rotation.y += item.rotationSpeed.y * deltaSeconds;
      item.mesh.rotation.z += item.rotationSpeed.z * deltaSeconds;

      if (item.bobbingFreq) {
        item.mesh.position.y = item.initialPos.y + Math.sin(timeSeconds * item.bobbingFreq) * 0.15;
      }
    }

    // 2. Update articulated humanoid joints (for synthetic L4)
    for (const joint of this.articulatedJoints) {
      const angle = joint.baseAngle + Math.sin(timeSeconds * joint.frequency + joint.phase) * joint.amplitude;
      if (joint.axis === 'x') {
        joint.mesh.rotation.x = angle;
      } else if (joint.axis === 'y') {
        joint.mesh.rotation.y = angle;
      } else {
        joint.mesh.rotation.z = angle;
      }
    }
  }

  /**
   * Real-time synchronization of MuJoCo arena environment (obstacles, friction, terrain)
   */
  public syncEnvironment(envData: {
    name?: string;
    preset?: string;
    ground_friction?: number;
    obstacles?: Array<{
      name?: string;
      type: string;
      pos: [number, number, number];
      size: number[];
      rgba?: [number, number, number, number];
    }>;
  }): void {
    if (!envData) return;
    const presetName = envData.preset || envData.name || 'pair_lab';
    const changed = this.currentEnvironmentPreset !== presetName;
    this.currentEnvironmentPreset = presetName;

    // 1. Manage PAIR Lab vs other environments
    if (presetName === 'pair_lab') {
      if (!this.sceneManager.worldGroup.children.includes(this.pairLabGroup)) {
        this.sceneManager.worldGroup.add(this.pairLabGroup);
      }
      if (this.pairLabGroup.children.length === 0) {
        this.buildPairLabEnvironment();
      }
      this.pairLabGroup.visible = true;

      // Synchronize positions of any moved physical obstacles (e.g. cube_1 .. cube_5)
      const obstacles = envData.obstacles || [];
      for (const obs of obstacles) {
        if (!obs.name) continue;
        const target = this.pairLabGroup.getObjectByName(obs.name);
        if (target && obs.pos) {
          // MuJoCo (+X forward, +Y left, +Z up) -> Three.js (-Y, +Z, -X)
          target.position.set(-obs.pos[1], obs.pos[2], -obs.pos[0]);
        }
      }
      return;
    }

    // If preset is NOT pair_lab, hide pair_lab
    this.pairLabGroup.visible = false;

    // 2. Update Floor & Ground Appearance based on friction and preset
    const friction = envData.ground_friction ?? 1.0;
    if (this.floorMesh && this.floorMesh.material) {
      const mat = this.floorMesh.material as THREE.MeshStandardMaterial;
      if (friction < 0.4) {
        mat.color.setHex(0x38bdf8);
        mat.roughness = 0.1;
        mat.metalness = 0.85;
      } else if (presetName === 'playground') {
        mat.color.setHex(0x1e1e2f);
        mat.roughness = 0.6;
        mat.metalness = 0.3;
      } else {
        mat.color.setHex(0x0f172a);
        mat.roughness = 0.8;
        mat.metalness = 0.2;
      }
      mat.needsUpdate = true;
    }

    // 3. Clear previous dynamic obstacles if preset changed
    while (this.dynamicObstacleGroup.children.length > 0) {
      const obj = this.dynamicObstacleGroup.children[0] as THREE.Mesh;
      this.dynamicObstacleGroup.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    }

    // 4. Spawn obstacles matching the MuJoCo environment (for obstacles/playground)
    const obstacles = envData.obstacles || [];
    for (const obs of obstacles) {
      const pos = obs.pos || [0, 0, 0];
      const size = obs.size || [0.1, 0.1, 0.1];
      const rgba = obs.rgba || [0.88, 0.38, 0.15, 1.0];

      // Coordinate mapping: MuJoCo (+X forward, +Y left, +Z up) -> Three.js (+Y up, -Z forward, -X left)
      const threeX = -pos[1];
      const threeY = pos[2];
      const threeZ = -pos[0];

      let geo: THREE.BufferGeometry;
      if (obs.type === 'box') {
        const hx = size[0] || 0.1;
        const hy = size[1] || 0.1;
        const hz = size[2] || 0.1;
        geo = new THREE.BoxGeometry(hy * 2, hz * 2, hx * 2);
      } else if (obs.type === 'sphere') {
        const radius = size[0] || 0.1;
        geo = new THREE.SphereGeometry(radius, 24, 24);
      } else if (obs.type === 'cylinder') {
        const radius = size[0] || 0.08;
        const halfHeight = size[1] || 0.15;
        geo = new THREE.CylinderGeometry(radius, radius, halfHeight * 2, 24);
      } else {
        geo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
      }

      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(rgba[0], rgba[1], rgba[2]),
        roughness: 0.4,
        metalness: 0.5,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(threeX, threeY, threeZ);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.dynamicObstacleGroup.add(mesh);
    }
  }

  public getCurrentEnvironmentPreset(): string {
    return this.currentEnvironmentPreset;
  }
}
