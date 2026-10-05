import * as THREE from 'three';

export interface CameraConfig {
  fov: number;
  near: number;
  far: number;
  position: THREE.Vector3;
  target: THREE.Vector3;
}

export type CameraMode = 'orbit' | 'third_person' | 'front_inspection' | 'first_person' | 'rapid_sweep';

/**
 * SceneManager
 * 
 * Formal scene ownership architecture:
 * Scene
 *  ├── Camera
 *  ├── Lighting (ambient, directional key with shadows, point/fill)
 *  ├── Objects (dynamic benchmark workloads / articulated models)
 *  └── World (arena floor, reference grid, boundaries)
 * 
 * Designed for future compatibility with VASIMOV RobotState -> SceneState streaming.
 */
export class SceneManager {
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;

  // Scene subgraphs
  public readonly worldGroup: THREE.Group;
  public readonly lightingGroup: THREE.Group;
  public readonly objectsGroup: THREE.Group;
  public readonly robotGroup: THREE.Group;

  // Lights
  private ambientLight: THREE.AmbientLight;
  private keyDirectionalLight: THREE.DirectionalLight;
  private fillDirectionalLight: THREE.DirectionalLight;
  private pointLights: THREE.PointLight[] = [];

  // Camera state
  private cameraMode: CameraMode = 'orbit';
  private cameraTarget: THREE.Vector3 = new THREE.Vector3(0, 1.0, 0);
  private cameraRadius: number = 6.0;
  private cameraHeight: number = 3.2;
  private cameraOrbitSpeed: number = 0.35; // radians per second

  // GTA-style interactive orbit tracking
  public orbitAzimuth: number = 0.0;
  public orbitElevation: number = 0.22;
  public orbitDistance: number = 2.4;

  public addOrbitOffset(deltaAzimuth: number, deltaElevation: number): void {
    this.orbitAzimuth += deltaAzimuth;
    this.orbitElevation = Math.max(-0.35, Math.min(1.15, this.orbitElevation + deltaElevation));
  }

  public resetOrbitOffset(): void {
    this.orbitAzimuth = 0.0;
    this.orbitElevation = 0.22;
    this.orbitDistance = 2.4;
  }

  constructor(aspectRatio: number = 16 / 9) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0e14); // Deep slate dark mode

    // 1. Camera Initialization
    this.camera = new THREE.PerspectiveCamera(50, aspectRatio, 0.1, 100);
    this.camera.position.set(0, this.cameraHeight, this.cameraRadius);
    this.camera.lookAt(this.cameraTarget);

    // 2. Subgroups
    this.worldGroup = new THREE.Group();
    this.worldGroup.name = 'World';
    this.scene.add(this.worldGroup);

    this.lightingGroup = new THREE.Group();
    this.lightingGroup.name = 'Lighting';
    this.scene.add(this.lightingGroup);

    this.objectsGroup = new THREE.Group();
    this.objectsGroup.name = 'Objects';
    this.scene.add(this.objectsGroup);

    // Dedicated Robot Group that is NEVER disposed by scene clearing
    this.robotGroup = new THREE.Group();
    this.robotGroup.name = 'Robot_Authoritative';
    this.scene.add(this.robotGroup);

    // 3. Initialize High-Fidelity Indoor Lighting System
    // Natural hemisphere fill light (sky white + ground slate) eliminates pitch-black shadows everywhere
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x64748b, 1.4);
    hemiLight.position.set(0, 10, 0);
    this.lightingGroup.add(hemiLight);

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    this.lightingGroup.add(this.ambientLight);

    // Overhead Key Ceiling Sun Light with real-time shadow map
    this.keyDirectionalLight = new THREE.DirectionalLight(0xfff7ed, 1.6);
    this.keyDirectionalLight.position.set(0, 7.5, 2);
    this.keyDirectionalLight.castShadow = true;
    this.keyDirectionalLight.shadow.mapSize.width = 1024;
    this.keyDirectionalLight.shadow.mapSize.height = 1024;
    this.keyDirectionalLight.shadow.camera.near = 0.5;
    this.keyDirectionalLight.shadow.camera.far = 30;
    this.keyDirectionalLight.shadow.camera.left = -10;
    this.keyDirectionalLight.shadow.camera.right = 10;
    this.keyDirectionalLight.shadow.camera.top = 10;
    this.keyDirectionalLight.shadow.camera.bottom = -10;
    this.keyDirectionalLight.shadow.bias = -0.0005;
    this.lightingGroup.add(this.keyDirectionalLight);

    // Secondary Frontal Fill Light (illuminates front face of robot and furniture)
    this.fillDirectionalLight = new THREE.DirectionalLight(0xe0f2fe, 1.2);
    this.fillDirectionalLight.position.set(0, 4, 8);
    this.fillDirectionalLight.castShadow = false;
    this.lightingGroup.add(this.fillDirectionalLight);

    // Additional Back Light (for depth separation)
    const backLight = new THREE.DirectionalLight(0xf1f5f9, 0.8);
    backLight.position.set(0, 4, -8);
    this.lightingGroup.add(backLight);

    // Dynamic point lights for local illumination
    const p1 = new THREE.PointLight(0x38bdf8, 1.2, 12);
    p1.position.set(2, 3, 2);
    this.pointLights.push(p1);
    this.lightingGroup.add(p1);

    const p2 = new THREE.PointLight(0xf59e0b, 1.0, 12);
    p2.position.set(-2, 3, -2);
    this.pointLights.push(p2);
    this.lightingGroup.add(p2);
  }

  public setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  public setCameraMode(mode: CameraMode, radius: number = 6.0, height: number = 3.2, smooth: boolean = false): void {
    if (this.cameraMode !== mode) {
      this.isTransitioning = smooth;
    }
    this.cameraMode = mode;
    this.cameraRadius = radius;
    this.cameraHeight = height;
  }

  public setCameraTarget(target: THREE.Vector3): void {
    this.cameraTarget.copy(target);
  }

  public setLighting(full: boolean): void {
    this.ambientLight.intensity = full ? 0.4 : 0.7;
    this.keyDirectionalLight.intensity = full ? 1.2 : 0.8;
    this.fillDirectionalLight.visible = full;
    this.pointLights.forEach((p) => {
      p.visible = full;
    });
  }

  // Reusable vectors to prevent GC allocations during 60 FPS camera updates
  private readonly _vTarget: THREE.Vector3 = new THREE.Vector3();
  private readonly _vDesiredPos: THREE.Vector3 = new THREE.Vector3();
  private readonly _vHeadPos: THREE.Vector3 = new THREE.Vector3();
  private readonly _vPelvisPos: THREE.Vector3 = new THREE.Vector3();
  private readonly _vCurrentLookAt: THREE.Vector3 = new THREE.Vector3(0, 1.0, 0);
  private isTransitioning: boolean = false;

  public getCameraMode(): CameraMode {
    return this.cameraMode;
  }

  /**
   * Update camera trajectories and moving scene elements without memory allocations
   */
  public update(timeSeconds: number, deltaSeconds: number, robotHeadPos?: THREE.Vector3, robotPelvisPos?: THREE.Vector3): void {
    if (this.cameraMode === 'orbit') {
      const angle = timeSeconds * this.cameraOrbitSpeed;
      const x = Math.sin(angle) * this.cameraRadius;
      const z = Math.cos(angle) * this.cameraRadius;
      this._vDesiredPos.set(x, this.cameraHeight, z);
      this._vTarget.copy(this.cameraTarget);

      if (this.isTransitioning) {
        this.camera.position.lerp(this._vDesiredPos, 0.12);
        this._vCurrentLookAt.lerp(this._vTarget, 0.15);
        this.camera.lookAt(this._vCurrentLookAt);
        if (this.camera.position.distanceToSquared(this._vDesiredPos) < 0.01) {
          this.isTransitioning = false;
        }
      } else {
        this.camera.position.set(x, this.cameraHeight, z);
        this.camera.lookAt(this.cameraTarget);
      }
    } else if (this.cameraMode === 'third_person') {
      // 3rd-person chase camera with GTA-style interactive spherical orbit around pelvis
      const pelvis = robotPelvisPos || this._vPelvisPos.set(0, 0.63, 0);
      const cosEl = Math.cos(this.orbitElevation);
      const sinEl = Math.sin(this.orbitElevation);
      const sinAz = Math.sin(this.orbitAzimuth);
      const cosAz = Math.cos(this.orbitAzimuth);

      const camX = pelvis.x + this.orbitDistance * cosEl * sinAz;
      const camY = pelvis.y + 0.35 + this.orbitDistance * sinEl;
      const camZ = pelvis.z + this.orbitDistance * cosEl * cosAz;

      this._vDesiredPos.set(camX, camY, camZ);
      this._vTarget.set(pelvis.x, pelvis.y + 0.35, pelvis.z);
      this.camera.position.lerp(this._vDesiredPos, 0.20);
      this._vCurrentLookAt.lerp(this._vTarget, 0.25);
      this.camera.lookAt(this._vCurrentLookAt);
    } else if (this.cameraMode === 'front_inspection') {
      // Front eye-level inspection view
      this._vDesiredPos.set(0, 0.85, -2.2);
      this._vTarget.set(0, 0.75, 0);
      this.camera.position.lerp(this._vDesiredPos, 0.10);
      this._vCurrentLookAt.lerp(this._vTarget, 0.12);
      this.camera.lookAt(this._vCurrentLookAt);
    } else if (this.cameraMode === 'first_person') {
      // First person eye-level camera mounted on head
      const head = robotHeadPos || this._vHeadPos.set(0, 1.15, 0);
      this._vDesiredPos.set(head.x, head.y + 0.08, head.z - 0.05);
      this._vTarget.set(head.x, head.y + 0.08, head.z - 10.0);

      if (this.isTransitioning) {
        this.camera.position.lerp(this._vDesiredPos, 0.20);
        this._vCurrentLookAt.lerp(this._vTarget, 0.20);
        this.camera.lookAt(this._vCurrentLookAt);
        if (this.camera.position.distanceToSquared(this._vDesiredPos) < 0.01) {
          this.isTransitioning = false;
        }
      } else {
        this.camera.position.set(this._vDesiredPos.x, this._vDesiredPos.y, this._vDesiredPos.z);
        this.camera.lookAt(this._vTarget);
      }
    } else if (this.cameraMode === 'rapid_sweep') {
      // Rapid oscillation to test matrix update performance under sudden viewpoint changes
      const sweepAngle = Math.sin(timeSeconds * 4.0) * 1.2;
      const x = Math.sin(sweepAngle) * 2.8;
      const z = Math.cos(sweepAngle) * 2.8;
      this.camera.position.set(x, 1.2 + Math.cos(timeSeconds * 6.0) * 0.4, z);
      this.camera.lookAt(this.cameraTarget);
    }

    // Animate point light positions subtly without allocations
    if (this.pointLights.length >= 2) {
      this.pointLights[0].position.x = Math.sin(timeSeconds * 0.8) * 4;
      this.pointLights[0].position.z = Math.cos(timeSeconds * 0.8) * 4;
      this.pointLights[1].position.x = -Math.sin(timeSeconds * 0.6) * 4;
      this.pointLights[1].position.z = -Math.cos(timeSeconds * 0.6) * 4;
    }
  }

  /**
   * Safely dispose all geometries, materials, and textures in a group
   */
  public static disposeHierarchy(obj: THREE.Object3D): void {
    while (obj.children.length > 0) {
      const child = obj.children[0];
      SceneManager.disposeHierarchy(child);
      obj.remove(child);
    }

    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) {
        mesh.geometry.dispose();
      }
      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((mat) => {
            SceneManager.disposeMaterial(mat);
          });
        } else {
          SceneManager.disposeMaterial(mesh.material);
        }
      }
    }
  }

  private static disposeMaterial(material: THREE.Material): void {
    material.dispose();
    const standard = material as THREE.MeshStandardMaterial;
    if (standard.map) standard.map.dispose();
    if (standard.normalMap) standard.normalMap.dispose();
    if (standard.roughnessMap) standard.roughnessMap.dispose();
    if (standard.metalnessMap) standard.metalnessMap.dispose();
  }

  public clearObjects(): void {
    SceneManager.disposeHierarchy(this.objectsGroup);
  }

  public clearWorld(): void {
    SceneManager.disposeHierarchy(this.worldGroup);
  }

  public dispose(): void {
    this.clearObjects();
    this.clearWorld();
    SceneManager.disposeHierarchy(this.lightingGroup);
    this.scene.clear();
  }
}
