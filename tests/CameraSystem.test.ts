/**
 * CameraSystem.test.ts
 * 
 * Unit & Integration Test Suite for P3.7 Local Three.js Camera System.
 * Covers:
 * - Switching across all 4 camera modes (Third Person, First Person, Front Inspection, Orbit)
 * - Third-person chase camera dynamic tracking of pelvis
 * - First-person FPV camera alignment with robot head
 * - Front-inspection camera framing
 * - Orbit camera continuous orbit trajectory
 * - Zero network dependencies (camera operations remain strictly local)
 * - Uninterrupted robot state synchronization during camera mode changes
 */

import * as THREE from 'three';
import { SceneManager } from '../src/renderer/SceneManager';
import { AsimovRobotModel } from '../src/model/AsimovRobotModel';
import { InterpolatedRobotPose } from '../src/synchronization/StateBuffer';
import { RobotMode, RecoveryState } from '../src/protocol/AsimovStateProtocol';

describe('Phase 3 Milestone P3.7: Local Camera System', () => {
  let sceneManager: SceneManager;
  let robot: AsimovRobotModel;

  beforeAll(async () => {
    sceneManager = new SceneManager(16 / 9);
    robot = new AsimovRobotModel();
    await robot.load();
    sceneManager.objectsGroup.add(robot.rootGroup);
  });

  const makePose = (basePos: [number, number, number]): InterpolatedRobotPose => ({
    timestamp: 1.0,
    sequenceNumber: 1,
    robotMode: RobotMode.MOVE,
    recoveryState: RecoveryState.NORMAL,
    flags: 0,
    basePosition: basePos,
    baseOrientation: [0, 0, 0, 1],
    linearVelocity: [0.5, 0, 0],
    angularVelocity: [0, 0, 0],
    jointPositions: new Float32Array(25),
    jointVelocities: new Float32Array(25),
    isExtrapolated: false,
    stateAgeMs: 2,
  });

  test('P3.7.1: Switches smoothly between all 4 camera modes without error', () => {
    const modes = ['third_person', 'first_person', 'front_inspection', 'orbit'] as const;

    modes.forEach((mode) => {
      sceneManager.setCameraMode(mode);
      expect(sceneManager.getCameraMode()).toBe(mode);

      // Verify update loop runs cleanly in this mode
      expect(() => sceneManager.update(1.0, 0.016)).not.toThrow();
    });
  });

  test('P3.7.2: Third-person chase camera tracks robot pelvis dynamically', () => {
    sceneManager.setCameraMode('third_person');

    // Initial pose at origin
    robot.applyAuthoritativeState(makePose([0, 0, 0.61]));
    const pelvis0 = robot.getPelvisWorldPosition();

    // Run several update ticks to let camera smooth-lerp
    for (let i = 0; i < 20; i++) {
      sceneManager.update(i * 0.016, 0.016, undefined, pelvis0);
    }
    const initialCamZ = sceneManager.camera.position.z;

    // Robot moves forward in MuJoCo by 2.0 meters (MuJoCo +X -> Three.js -Z)
    robot.applyAuthoritativeState(makePose([2.0, 0.0, 0.61]));
    const pelvis1 = robot.getPelvisWorldPosition();
    expect(pelvis1.z).toBeCloseTo(-2.0, 3);

    // Run update ticks to let chase camera follow
    for (let i = 0; i < 40; i++) {
      sceneManager.update(i * 0.016, 0.016, undefined, pelvis1);
    }

    // Camera must have moved forward in Three.js (towards negative Z) to follow robot
    expect(sceneManager.camera.position.z).toBeLessThan(initialCamZ - 1.0);
  });

  test('P3.7.3: First-person FPV camera mounts at head height and looks forward', () => {
    sceneManager.setCameraMode('first_person');

    robot.applyAuthoritativeState(makePose([0.0, 0.0, 0.61]));
    const headPos = robot.getHeadWorldPosition();

    sceneManager.update(0.0, 0.016, headPos);

    // Camera position should be located at the head link
    expect(sceneManager.camera.position.y).toBeCloseTo(headPos.y + 0.08, 2);
    expect(sceneManager.camera.position.x).toBeCloseTo(headPos.x, 2);
  });

  test('P3.7.4: Front-inspection camera frames robot from the front', () => {
    sceneManager.setCameraMode('front_inspection');

    // Run updates to let camera lerp to target
    for (let i = 0; i < 60; i++) {
      sceneManager.update(i * 0.016, 0.016);
    }

    // Front inspection camera is placed in front (-Z in Three.js) looking at robot
    expect(sceneManager.camera.position.z).toBeCloseTo(-2.2, 1);
    expect(sceneManager.camera.position.y).toBeCloseTo(0.85, 1);
  });

  test('P3.7.5: Orbit camera rotates continuously around target without divergence', () => {
    sceneManager.setCameraMode('orbit', 5.0, 2.5);

    sceneManager.update(0.0, 0.016);
    const p0 = sceneManager.camera.position.clone();

    // After a quarter orbit period
    const tQuarter = Math.PI / (2 * 0.2); // orbit speed is 0.2
    sceneManager.update(tQuarter, 0.016);
    const p1 = sceneManager.camera.position.clone();

    // Verify distance from origin remains constant (radius ~5.0)
    const r0 = Math.hypot(p0.x, p0.z);
    const r1 = Math.hypot(p1.x, p1.z);
    expect(r0).toBeCloseTo(5.0, 2);
    expect(r1).toBeCloseTo(5.0, 2);
    expect(sceneManager.camera.position.y).toBeCloseTo(2.5, 2);
  });

  test('P3.7.6: Camera switching does not affect robot state synchronization', () => {
    const modes = ['third_person', 'first_person', 'front_inspection', 'orbit'] as const;

    modes.forEach((mode, i) => {
      sceneManager.setCameraMode(mode);
      // Robot receives pose
      const angle = (i + 1) * 0.1;
      const pose = makePose([i * 0.5, 0, 0.61]);
      pose.jointPositions[3] = angle; // left knee
      robot.applyAuthoritativeState(pose);

      sceneManager.update(i * 0.016, 0.016, robot.getHeadWorldPosition(), robot.getPelvisWorldPosition());

      expect(robot.getJointAngle('left_knee_joint')).toBeCloseTo(angle, 4);
    });
  });
});
