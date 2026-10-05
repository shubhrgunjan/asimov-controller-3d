// Polyfill navigator.userAgent for Three.js GLTFLoader on React Native / Hermes
if (typeof navigator !== 'undefined' && !(navigator as any).userAgent) {
  Object.defineProperty(navigator, 'userAgent', {
    value: 'ReactNative',
    configurable: true,
    writable: true,
  });
}

import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  ASIMOV_JOINTS,
  JointDefinition,
  ASIMOV_TOTAL_TRIANGLES,
  ASIMOV_TOTAL_JOINTS,
  ASIMOV_HEAD_BODY,
  CANONICAL_SIM_JOINTS,
} from './AsimovJointHierarchy';
import { ASIMOV_1_MOBILE_GLB_BASE64 } from './asimov_1_model_data';
import { InterpolatedRobotPose } from '../synchronization/StateBuffer';

export type ValidationPoseName =
  | 'neutral'
  | 'left_knee'
  | 'right_knee'
  | 'both_knees'
  | 'crouch'
  | 'hip_pitch'
  | 'hip_roll'
  | 'ankle_pitch'
  | 'ankle_roll'
  | 'shoulder'
  | 'elbow'
  | 'walking_gait';

export interface RobotDimensions {
  totalHeightMeters: number;
  pelvisHeightMeters: number;
  shoulderWidthMeters: number;
  hipWidthMeters: number;
  armSpanMeters: number;
  triangleCount: number;
  meshCount: number;
  jointCount: number;
}

interface JointNodeRef {
  def: JointDefinition;
  node: THREE.Object3D;
  basePosition: THREE.Vector3;
  baseQuaternion: THREE.Quaternion;
  axisVector: THREE.Vector3;
  scratchQuat: THREE.Quaternion;
  currentAngle: number;
}

/**
 * AsimovRobotModel
 * 
 * High-fidelity Three.js representation of the Asimov 1 humanoid robot.
 * Directly maps canonical MuJoCo kinematic joint hierarchy, pivots, axes, and limits.
 */
export class AsimovRobotModel {
  public readonly rootGroup: THREE.Group;
  public readonly modelContainer: THREE.Group;

  private jointNodes: Map<string, JointNodeRef> = new Map();
  private canonicalJointNodes: (JointNodeRef | null)[] = new Array(25).fill(null);
  private isLoaded: boolean = false;
  private headNode: THREE.Object3D | null = null;
  private pelvisNode: THREE.Object3D | null = null;

  // Pre-allocated coordinate transformation quaternions
  private readonly scratchBaseQuat: THREE.Quaternion = new THREE.Quaternion();
  private readonly coordQuat: THREE.Quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, Math.PI / 2));
  private readonly coordQuatInv: THREE.Quaternion = this.coordQuat.clone().invert();

  // Cached dimension metrics
  private dimensions: RobotDimensions = {
    totalHeightMeters: 1.22,
    pelvisHeightMeters: 0.63,
    shoulderWidthMeters: 0.193,
    hipWidthMeters: 0.135,
    armSpanMeters: 0.85,
    triangleCount: ASIMOV_TOTAL_TRIANGLES,
    meshCount: 26,
    jointCount: ASIMOV_TOTAL_JOINTS,
  };

  // 1:1 Canonical physics coordinate mapping matching MuJoCo
  private environmentScale: number = 1.0;

  public setEnvironmentScale(scale: number): void {
    this.environmentScale = scale;
    this.modelContainer.scale.set(scale, scale, scale);
    this.rootGroup.position.set(0, 0.630 * scale, 0);
  }

  public getEnvironmentScale(): number {
    return this.environmentScale;
  }

  constructor() {
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'Asimov1_Robot_Root';

    this.modelContainer = new THREE.Group();
    this.modelContainer.name = 'Asimov1_Kinematic_Container';

    // Coordinate Transform: Map MuJoCo (+Z Up, +X Forward, +Y Left)
    // to Three.js (+Y Up, -Z Forward, +X Right / -X Left)
    // Euler XYZ (-90 deg, 0, 90 deg):
    // MuJoCo X (Forward) -> Three.js -Z
    // MuJoCo Y (Left)    -> Three.js -X
    // MuJoCo Z (Up)      -> Three.js +Y
    this.modelContainer.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    this.modelContainer.scale.set(this.environmentScale, this.environmentScale, this.environmentScale);
    this.rootGroup.add(this.modelContainer);

    // Default to canonical standing base height scaled to environment:
    // so robot feet touch the floor at Y=0.0m rather than being buried underground
    this.rootGroup.position.set(0, 0.630 * this.environmentScale, 0);

    // Build complete procedural 25-joint Asimov 1 immediately so robot is ALWAYS 100% visible on mobile & PC
    this.buildProceduralModel();
  }

  /**
   * Build complete procedural 25-joint Asimov 1 model matching ASIMOV_BODIES and ASIMOV_JOINTS.
   * Guarantees instantaneous, zero-delay rendering with full articulation on all devices.
   */
  private buildProceduralModel(): void {
    const alloyMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      metalness: 0.20,
      roughness: 0.40,
    });
    const darkAlloyMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.15,
      roughness: 0.50,
    });
    const jointMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.25,
      roughness: 0.40,
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
    });
    const footMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.70,
      metalness: 0.10,
    });

    const bodyMap = new Map<string, THREE.Group>();

    // 1. Root Pelvis Link
    const pelvisLink = new THREE.Group();
    pelvisLink.name = 'pelvis_link';
    this.modelContainer.add(pelvisLink);
    bodyMap.set('pelvis_link', pelvisLink);
    this.pelvisNode = pelvisLink;

    // Pelvis visual body
    const pelvisBody = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 0.14), darkAlloyMat);
    pelvisBody.castShadow = true;
    pelvisBody.receiveShadow = true;
    pelvisLink.add(pelvisBody);

    const pelvisCore = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.02), glowMat);
    pelvisCore.position.set(0.091, 0, 0);
    pelvisLink.add(pelvisCore);

    // 2. Build canonical kinematic tree from ASIMOV_JOINTS
    for (const [jName, jDef] of Object.entries(ASIMOV_JOINTS)) {
      const childGroup = new THREE.Group();
      childGroup.name = jDef.nodeName;
      childGroup.position.set(jDef.defaultPos[0], jDef.defaultPos[1], jDef.defaultPos[2]);
      childGroup.quaternion.set(jDef.defaultQuat[0], jDef.defaultQuat[1], jDef.defaultQuat[2], jDef.defaultQuat[3]);

      const parentNode = bodyMap.get(jDef.parentBody) || pelvisLink;
      parentNode.add(childGroup);
      bodyMap.set(jDef.nodeName, childGroup);

      // Dedicated visual segment per body part
      let visual: THREE.Object3D | null = null;

      if (jDef.nodeName.includes('knee')) {
        // Shin segment
        const shin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.24), alloyMat);
        shin.position.set(0, 0, -0.12);
        shin.castShadow = true;
        shin.receiveShadow = true;
        const kneeCap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.08, 16), jointMat);
        kneeCap.rotation.z = Math.PI / 2;
        kneeCap.castShadow = true;
        childGroup.add(kneeCap);
        visual = shin;
      } else if (jDef.nodeName.includes('hip_yaw')) {
        // Thigh segment
        const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.20), alloyMat);
        thigh.position.set(0, 0, -0.10);
        thigh.castShadow = true;
        thigh.receiveShadow = true;
        visual = thigh;
      } else if (jDef.nodeName.includes('ankle_roll')) {
        // Foot sole
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.035), footMat);
        foot.position.set(0.03, 0, -0.015);
        foot.castShadow = true;
        foot.receiveShadow = true;
        visual = foot;
      } else if (jDef.nodeName === 'waist_yaw_link') {
        // Upper torso & chest armor
        const chest = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.26), darkAlloyMat);
        chest.position.set(0, 0, 0.13);
        chest.castShadow = true;
        chest.receiveShadow = true;
        const chestArmor = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.10), alloyMat);
        chestArmor.position.set(0.07, 0, 0.15);
        chestArmor.castShadow = true;
        chest.add(chestArmor);
        visual = chest;
      } else if (jDef.nodeName === 'neck_pitch_link') {
        // Humanoid head & cyan visor
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.15, 0.15), darkAlloyMat);
        head.position.set(0.02, 0, 0.08);
        head.castShadow = true;
        head.receiveShadow = true;
        const visor = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.12, 0.04), glowMat);
        visor.position.set(0.09, 0, 0.09);
        head.add(visor);
        visual = head;
        this.headNode = childGroup;
      } else if (jDef.nodeName.includes('elbow')) {
        // Forearm
        const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.16, 12), alloyMat);
        forearm.position.set(0, 0, -0.08);
        forearm.rotation.x = Math.PI / 2;
        forearm.castShadow = true;
        visual = forearm;
      } else if (jDef.nodeName.includes('shoulder_yaw')) {
        // Upper arm
        const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.16, 12), darkAlloyMat);
        upperArm.position.set(0, 0, -0.08);
        upperArm.rotation.x = Math.PI / 2;
        upperArm.castShadow = true;
        visual = upperArm;
      } else if (jDef.nodeName.includes('wrist')) {
        // Hand gripper
        const hand = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.07), jointMat);
        hand.position.set(0.02, 0, -0.035);
        hand.castShadow = true;
        visual = hand;
      } else {
        // General joint actuator cylinder
        const jMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 12), jointMat);
        jMesh.castShadow = true;
        visual = jMesh;
      }

      if (visual) {
        childGroup.add(visual);
      }

      const ref: JointNodeRef = {
        def: jDef,
        node: childGroup,
        basePosition: childGroup.position.clone(),
        baseQuaternion: childGroup.quaternion.clone(),
        axisVector: new THREE.Vector3(jDef.axis[0], jDef.axis[1], jDef.axis[2]).normalize(),
        scratchQuat: new THREE.Quaternion(),
        currentAngle: 0.0,
      };
      this.jointNodes.set(jName, ref);
    }

    // Populate canonical SIM_JOINTS array (0..24)
    for (let i = 0; i < CANONICAL_SIM_JOINTS.length; i++) {
      this.canonicalJointNodes[i] = this.jointNodes.get(CANONICAL_SIM_JOINTS[i]) || null;
    }

    this.isLoaded = true;
    this.measurePhysicalDimensions();
  }

  /**
   * Initialize and parse the optimized binary GLB asset (with graceful fallback to procedural model)
   */
  public async load(customGlbBuffer?: ArrayBuffer): Promise<void> {
    try {
      const loader = new GLTFLoader();

      let buffer: ArrayBuffer;
      if (customGlbBuffer) {
        buffer = customGlbBuffer;
      } else {
        buffer = this.base64ToArrayBuffer(ASIMOV_1_MOBILE_GLB_BASE64);
      }

      const gltf = await new Promise<GLTF>((resolve, reject) => {
        loader.parse(
          buffer,
          '',
          (parsed) => resolve(parsed),
          (err) => reject(err)
        );
      });

      const scene = gltf.scene;

      // Apply mobile shadow and rendering flags
      let meshCount = 0;
      let triCount = 0;

      scene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          meshCount++;
          const mesh = child as THREE.Mesh;
          mesh.castShadow = true;
          mesh.receiveShadow = true;

          if (mesh.geometry) {
            const idx = mesh.geometry.getIndex();
            triCount += idx ? idx.count / 3 : mesh.geometry.attributes.position.count / 3;
          }

          if (mesh.material) {
            const mat = mesh.material as THREE.MeshStandardMaterial;
            mat.roughness = 0.40;
            mat.metalness = 0.20;
          }
        }
      });

      this.dimensions.meshCount = meshCount;
      this.dimensions.triangleCount = triCount;

      // Index all joints from GLTF
      const newJointNodes: Map<string, JointNodeRef> = new Map();
      for (const [jName, jDef] of Object.entries(ASIMOV_JOINTS)) {
        const node = scene.getObjectByName(jDef.nodeName);
        if (node) {
          const ref: JointNodeRef = {
            def: jDef,
            node,
            basePosition: node.position.clone(),
            baseQuaternion: node.quaternion.clone(),
            axisVector: new THREE.Vector3(jDef.axis[0], jDef.axis[1], jDef.axis[2]).normalize(),
            scratchQuat: new THREE.Quaternion(),
            currentAngle: 0.0,
          };
          newJointNodes.set(jName, ref);
        }
      }

      // If GLTF hierarchy is complete, safely replace procedural model
      if (newJointNodes.size >= 20) {
        while (this.modelContainer.children.length > 0) {
          this.modelContainer.remove(this.modelContainer.children[0]);
        }
        this.jointNodes = newJointNodes;
        for (let i = 0; i < CANONICAL_SIM_JOINTS.length; i++) {
          this.canonicalJointNodes[i] = this.jointNodes.get(CANONICAL_SIM_JOINTS[i]) || null;
        }
        this.pelvisNode = scene.getObjectByName('pelvis_link') || null;
        if (this.pelvisNode) {
          // Reset local translation on pelvis_link so rootGroup alone dictates world base position.
          // This eliminates the 0.63m double-offset and places the foot soles directly on the floor (Y = 0.000m).
          this.pelvisNode.position.set(0, 0, 0);
        }
        this.headNode = scene.getObjectByName(ASIMOV_HEAD_BODY) || null;
        this.modelContainer.add(scene);
      }

      this.isLoaded = true;
      this.measurePhysicalDimensions();
    } catch (err) {
      // Graceful fallback: procedural model is already constructed, fully textured and articulated
      console.log('[AsimovRobotModel] Using high-fidelity procedural robot model:', (err as any)?.message || err);
      this.isLoaded = true;
    }
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    if (typeof Buffer !== 'undefined') {
      const buf = Buffer.from(base64, 'base64');
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Set single joint angle in radians around its physical axis (zero allocation)
   */
  public setJointAngle(jointName: string, radians: number): boolean {
    const jRef = this.jointNodes.get(jointName);
    if (!jRef) return false;

    // Clamp angle to physical hardware limit
    const [minLim, maxLim] = jRef.def.range;
    const clamped = Math.max(minLim, Math.min(maxLim, radians));
    jRef.currentAngle = clamped;

    // Zero-allocation rotation update: axis * angle
    jRef.scratchQuat.setFromAxisAngle(jRef.axisVector, clamped);
    jRef.node.quaternion.copy(jRef.baseQuaternion).multiply(jRef.scratchQuat);
    return true;
  }

  /**
   * Fast batch update for all 25 joints from canonical SIM_JOINTS (0..24) array.
   * Completely zero heap allocations in the 60 FPS render loop.
   */
  public applySimJointState(jointPositions: Float32Array | number[]): void {
    const len = Math.min(25, jointPositions.length);
    for (let i = 0; i < len; i++) {
      const jRef = this.canonicalJointNodes[i];
      if (!jRef) continue;

      const [minLim, maxLim] = jRef.def.range;
      const val = jointPositions[i];
      const clamped = Math.max(minLim, Math.min(maxLim, val));
      jRef.currentAngle = clamped;

      jRef.scratchQuat.setFromAxisAngle(jRef.axisVector, clamped);
      jRef.node.quaternion.copy(jRef.baseQuaternion).multiply(jRef.scratchQuat);
    }
  }

  /**
   * Apply authoritative 6-DoF base pose from MuJoCo simulation.
   */
  public applyBasePose(
    positionMeters: [number, number, number],
    orientationQuat?: [number, number, number, number]
  ): void {
    // Coordinate transform scaled to authoritative visual environment:
    // MuJoCo X (Forward) -> Three.js -Z
    // MuJoCo Y (Left)    -> Three.js -X
    // MuJoCo Z (Up)      -> Three.js +Y
    const s = this.environmentScale;
    this.rootGroup.position.set(-positionMeters[1] * s, positionMeters[2] * s, -positionMeters[0] * s);

    if (orientationQuat) {
      this.scratchBaseQuat.set(
        orientationQuat[0],
        orientationQuat[1],
        orientationQuat[2],
        orientationQuat[3]
      );
      // Three.js quaternion: q_three = q_coord * q_mujoco * q_coord_inv
      this.rootGroup.quaternion.copy(this.coordQuat).multiply(this.scratchBaseQuat).multiply(this.coordQuatInv);
    }
  }

  /**
   * Apply authoritative robot state snapshot from StateBuffer
   */
  public applyAuthoritativeState(pose: InterpolatedRobotPose): void {
    this.applyBasePose(pose.basePosition, pose.baseOrientation);
    this.applySimJointState(pose.jointPositions);
  }

  /**
   * Batch update multiple joint angles
   */
  public setJointAngles(angles: Record<string, number>): void {
    for (const [name, val] of Object.entries(angles)) {
      this.setJointAngle(name, val);
    }
  }

  public getJointAngle(jointName: string): number {
    return this.jointNodes.get(jointName)?.currentAngle ?? 0.0;
  }

  public getAllJointAngles(): Record<string, number> {
    const result: Record<string, number> = {};
    this.jointNodes.forEach((ref, name) => {
      result[name] = ref.currentAngle;
    });
    return result;
  }

  public resetToNeutralPose(): void {
    this.jointNodes.forEach((ref) => {
      ref.currentAngle = 0.0;
      ref.node.position.copy(ref.basePosition);
      ref.node.quaternion.copy(ref.baseQuaternion);
    });
  }

  /**
   * Apply predefined validation poses (Section 6)
   */
  public applyValidationPose(pose: ValidationPoseName): void {
    this.resetToNeutralPose();

    switch (pose) {
      case 'left_knee':
        this.setJointAngle('left_knee_joint', 0.6);
        break;

      case 'right_knee':
        // Right knee axis in MuJoCo is [0, -1, 0] -> negative angle flexes backward
        this.setJointAngle('right_knee_joint', -0.6);
        break;

      case 'both_knees':
        this.setJointAngle('left_knee_joint', 0.6);
        this.setJointAngle('right_knee_joint', -0.6);
        break;

      case 'crouch':
        // Coordinated crouching posture
        this.setJointAngle('left_hip_pitch_joint', -0.45);
        this.setJointAngle('right_hip_pitch_joint', 0.45);
        this.setJointAngle('left_knee_joint', 0.9);
        this.setJointAngle('right_knee_joint', -0.9);
        this.setJointAngle('left_ankle_pitch_joint', -0.32);
        this.setJointAngle('right_ankle_pitch_joint', 0.32);
        break;

      case 'hip_pitch':
        this.setJointAngle('left_hip_pitch_joint', -0.35);
        this.setJointAngle('right_hip_pitch_joint', 0.35);
        break;

      case 'hip_roll':
        this.setJointAngle('left_hip_roll_joint', 0.25);
        this.setJointAngle('right_hip_roll_joint', -0.25);
        break;

      case 'ankle_pitch':
        this.setJointAngle('left_ankle_pitch_joint', 0.2);
        this.setJointAngle('right_ankle_pitch_joint', -0.2);
        break;

      case 'ankle_roll':
        this.setJointAngle('left_ankle_roll_joint', 0.08);
        this.setJointAngle('right_ankle_roll_joint', -0.08);
        break;

      case 'shoulder':
        this.setJointAngle('left_shoulder_pitch_joint', 0.8);
        this.setJointAngle('right_shoulder_pitch_joint', -0.8);
        this.setJointAngle('left_shoulder_roll_joint', -0.4);
        this.setJointAngle('right_shoulder_roll_joint', 0.4);
        break;

      case 'elbow':
        this.setJointAngle('left_elbow_joint', 1.0);
        this.setJointAngle('right_elbow_joint', -1.0);
        break;

      case 'neutral':
      default:
        this.resetToNeutralPose();
        break;
    }
  }

  /**
   * Deterministic local articulation test loop (Section 19)
   * Cycles: neutral -> crouch -> neutral -> arms -> legs -> full-body gait -> neutral
   */
  public updateContinuousArticulation(timeSeconds: number): void {
    const cycleTime = 16.0; // 16 second recurring test loop
    const t = timeSeconds % cycleTime;

    if (t < 2.0) {
      // 0-2s: Neutral Hold
      this.resetToNeutralPose();
    } else if (t < 5.0) {
      // 2-5s: Smooth Crouch and Return
      const progress = (t - 2.0) / 3.0;
      const s = Math.sin(progress * Math.PI);
      this.setJointAngle('left_hip_pitch_joint', -0.4 * s);
      this.setJointAngle('right_hip_pitch_joint', 0.4 * s);
      this.setJointAngle('left_knee_joint', 0.8 * s);
      this.setJointAngle('right_knee_joint', -0.8 * s);
      this.setJointAngle('left_ankle_pitch_joint', -0.3 * s);
      this.setJointAngle('right_ankle_pitch_joint', 0.3 * s);
    } else if (t < 8.0) {
      // 5-8s: Upper Body Articulation (Waist, Shoulders, Elbows, Head)
      const u = (t - 5.0) * 2.0;
      this.setJointAngle('waist_yaw_joint', Math.sin(u) * 0.4);
      this.setJointAngle('neck_yaw_joint', Math.sin(u) * 0.3);
      this.setJointAngle('neck_pitch_joint', Math.cos(u * 1.5) * 0.2);
      this.setJointAngle('left_shoulder_pitch_joint', Math.sin(u) * 0.6);
      this.setJointAngle('right_shoulder_pitch_joint', -Math.sin(u) * 0.6);
      this.setJointAngle('left_elbow_joint', 0.5 + Math.sin(u) * 0.4);
      this.setJointAngle('right_elbow_joint', -0.5 - Math.sin(u) * 0.4);
    } else if (t < 11.0) {
      // 8-11s: Lower Body Articulation (Hips, Knees, Ankles)
      const l = (t - 8.0) * 2.5;
      this.setJointAngle('left_hip_pitch_joint', Math.sin(l) * 0.3);
      this.setJointAngle('right_hip_pitch_joint', -Math.sin(l) * 0.3);
      this.setJointAngle('left_knee_joint', Math.max(0, Math.sin(l) * 0.6));
      this.setJointAngle('right_knee_joint', -Math.max(0, -Math.sin(l) * 0.6));
      this.setJointAngle('left_hip_roll_joint', Math.sin(l * 0.5) * 0.15);
      this.setJointAngle('right_hip_roll_joint', -Math.sin(l * 0.5) * 0.15);
    } else if (t < 14.5) {
      // 11-14.5s: Coordinated 25-Joint Walking Kinematics
      const w = (t - 11.0) * 3.0;
      const legPhase = w;
      const armPhase = w + Math.PI;

      // Legs
      this.setJointAngle('left_hip_pitch_joint', Math.sin(legPhase) * 0.35);
      this.setJointAngle('right_hip_pitch_joint', -Math.sin(legPhase) * 0.35);
      this.setJointAngle('left_knee_joint', Math.max(0, Math.sin(legPhase) * 0.55));
      this.setJointAngle('right_knee_joint', -Math.max(0, -Math.sin(legPhase) * 0.55));
      this.setJointAngle('left_ankle_pitch_joint', -Math.sin(legPhase) * 0.2);
      this.setJointAngle('right_ankle_pitch_joint', Math.sin(legPhase) * 0.2);

      // Arms swing opposite legs
      this.setJointAngle('left_shoulder_pitch_joint', Math.sin(armPhase) * 0.4);
      this.setJointAngle('right_shoulder_pitch_joint', -Math.sin(armPhase) * 0.4);
      this.setJointAngle('left_elbow_joint', 0.4 + Math.sin(armPhase) * 0.3);
      this.setJointAngle('right_elbow_joint', -0.4 - Math.sin(armPhase) * 0.3);

      // Torso & head stabilization
      this.setJointAngle('waist_yaw_joint', Math.sin(legPhase) * 0.12);
      this.setJointAngle('neck_yaw_joint', -Math.sin(legPhase) * 0.1);
    } else {
      // 14.5-16s: Ramp back to neutral
      this.resetToNeutralPose();
    }
  }

  /**
   * Get world position of Head for First-Person Camera (Section 17)
   */
  public getHeadWorldPosition(target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    if (this.headNode) {
      this.headNode.getWorldPosition(target);
    } else {
      target.copy(this.rootGroup.position);
      target.y += 1.15;
    }
    return target;
  }

  /**
   * Get world position of Pelvis for Chase Camera (Section 17)
   */
  public getPelvisWorldPosition(target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    if (this.pelvisNode) {
      this.pelvisNode.getWorldPosition(target);
    } else {
      target.copy(this.rootGroup.position);
    }
    return target;
  }

  private measurePhysicalDimensions(): void {
    const bbox = new THREE.Box3().setFromObject(this.rootGroup);
    const size = new THREE.Vector3();
    bbox.getSize(size);

    this.dimensions.totalHeightMeters = Math.round(size.y * 1000) / 1000;
    this.dimensions.shoulderWidthMeters = Math.round(size.x * 1000) / 1000;

    if (this.pelvisNode) {
      const pPos = new THREE.Vector3();
      this.pelvisNode.getWorldPosition(pPos);
      this.dimensions.pelvisHeightMeters = Math.round(pPos.y * 1000) / 1000;
    }
  }

  public measureCurrentBoundingBox(): THREE.Vector3 {
    this.rootGroup.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(this.rootGroup);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    return size;
  }

  public getDimensions(): RobotDimensions {
    return this.dimensions;
  }

  public isReady(): boolean {
    return this.isLoaded;
  }

  public dispose(): void {
    this.jointNodes.clear();
    while (this.modelContainer.children.length > 0) {
      const child = this.modelContainer.children[0];
      this.modelContainer.remove(child);
    }
  }
}
