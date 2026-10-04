import * as THREE from 'three';
import { SceneManager } from '../renderer/SceneManager';

import { AsimovRobotModel, ValidationPoseName } from '../model/AsimovRobotModel';
import { ASIMOV_1_TRIANGLES } from '../model/asimov_1_model_data';

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

  constructor(sceneManager: SceneManager) {
    this.sceneManager = sceneManager;
    this.robotModel.load().catch((err) => {
      console.warn('Failed to pre-load AsimovRobotModel:', err);
    });
    this.loadLevel('L1');
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

    // Floor Quad
    const floorGeo = new THREE.PlaneGeometry(30, 30, 20, 20);
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

    // Coordinate Grid Reference
    const grid = new THREE.GridHelper(30, 30, 0x38bdf8, 0x334155);
    grid.position.y = 0.005;
    worldGroup.add(grid);
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
    this.sceneManager.objectsGroup.add(this.robotModel.rootGroup);
  }

  /**
   * ASIMOV 1 ARTICULATED — Canonical visual model with continuous 25-joint motion
   */
  private buildAsimovArticulated(): void {
    this.sceneManager.setLighting(true);
    this.sceneManager.objectsGroup.add(this.robotModel.rootGroup);
  }

  /**
   * ASIMOV 1 ENVIRONMENT — Canonical robot in target arena with obstacles and boundary walls
   */
  private buildAsimovEnvironment(): void {
    const group = this.sceneManager.objectsGroup;
    this.sceneManager.setLighting(true);

    // 1. Mount Asimov 1 Robot
    group.add(this.robotModel.rootGroup);

    // 2. Add Perimeter Arena Columns & Boundary Walls (Optimized ~5.2k triangles)
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.35,
      metalness: 0.8,
    });
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.7,
      metalness: 0.3,
    });
    const obstacleMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      roughness: 0.5,
      metalness: 0.5,
    });

    const pillarGeo = new THREE.CylinderGeometry(0.2, 0.2, 3.0, 16);
    const radius = 7.5;
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(Math.cos(angle) * radius, 1.5, Math.sin(angle) * radius);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      group.add(pillar);
    }

    const wallGeo = new THREE.BoxGeometry(3.6, 1.8, 0.15);
    for (let i = 0; i < 12; i++) {
      const angle = ((i + 0.5) / 12) * Math.PI * 2;
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.position.set(Math.cos(angle) * radius, 0.9, Math.sin(angle) * radius);
      wall.rotation.y = -angle + Math.PI / 2;
      wall.castShadow = true;
      wall.receiveShadow = true;
      group.add(wall);
    }

    // 20 Target arena calibration obstacles
    const boxGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
    for (let i = 0; i < 20; i++) {
      const obstacle = new THREE.Mesh(boxGeo, obstacleMat);
      const r = 2.0 + (i % 4) * 1.1;
      const a = i * 0.85;
      obstacle.position.set(Math.cos(a) * r, 0.2, Math.sin(a) * r);
      obstacle.castShadow = true;
      obstacle.receiveShadow = true;
      group.add(obstacle);
    }
  }

  /**
   * Update all animated objects and kinematic joint hierarchies
   */
  public update(timeSeconds: number, deltaSeconds: number): void {
    if (!this.animationEnabled) return;

    // Update Asimov 1 continuous kinematic motion sequence
    if (this.currentLevel === 'ASIMOV_ARTICULATED' || this.currentLevel === 'ASIMOV_ENVIRONMENT') {
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
}
