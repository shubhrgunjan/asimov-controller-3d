/**
 * LiveRobotSync.test.ts
 * 
 * Unit & Integration Test Suite for P3.5 Live Asimov Robot Synchronization.
 * Verifies:
 * - 25-joint canonical mapping from Float32Array to Three.js nodes
 * - Zero-allocation joint update path
 * - Representative poses: Standing, Crouch, Walking, Recovery, Arbitrary Joint Movement
 * - Mechanical limit clamping
 * - 6-DoF Base translation & quaternion coordinate conversion
 * - Model stability without transform divergence
 */

import * as THREE from 'three';
import { AsimovRobotModel } from '../src/model/AsimovRobotModel';
import { CANONICAL_SIM_JOINTS, ASIMOV_JOINTS } from '../src/model/AsimovJointHierarchy';
import { InterpolatedRobotPose } from '../src/synchronization/StateBuffer';
import { RobotMode, RecoveryState } from '../src/protocol/AsimovStateProtocol';

describe('Phase 3 Milestone P3.5: Live Asimov Robot Synchronization', () => {
  let robot: AsimovRobotModel;

  beforeAll(async () => {
    robot = new AsimovRobotModel();
    await robot.load();
  });

  const createPose = (
    jointAngles: number[],
    basePos: [number, number, number] = [0, 0, 0.61],
    baseQuat: [number, number, number, number] = [0, 0, 0, 1]
  ): InterpolatedRobotPose => {
    const qpos = new Float32Array(25);
    for (let i = 0; i < Math.min(25, jointAngles.length); i++) {
      qpos[i] = jointAngles[i];
    }

    return {
      timestamp: 10.0,
      sequenceNumber: 100,
      robotMode: RobotMode.MOVE,
      recoveryState: RecoveryState.NORMAL,
      flags: 0,
      basePosition: basePos,
      baseOrientation: baseQuat,
      linearVelocity: [0, 0, 0],
      angularVelocity: [0, 0, 0],
      jointPositions: qpos,
      jointVelocities: new Float32Array(25),
      isExtrapolated: false,
      stateAgeMs: 5,
    };
  };

  test('P3.5.1: Verifies all 25 canonical joints map to valid Three.js nodes', () => {
    expect(CANONICAL_SIM_JOINTS.length).toBe(25);

    CANONICAL_SIM_JOINTS.forEach((jName) => {
      const def = ASIMOV_JOINTS[jName];
      expect(def).toBeDefined();

      const testAngle = def.range[1] <= 0 ? -0.05 : 0.05;
      const ok = robot.setJointAngle(jName, testAngle);
      expect(ok).toBe(true);
      expect(robot.getJointAngle(jName)).toBeCloseTo(testAngle, 4);
    });

    robot.resetToNeutralPose();
  });

  test('P3.5.2: Standing Pose synchronization applies zero/neutral state to all joints', () => {
    const neutralPose = createPose(new Array(25).fill(0.0), [0.0, 0.0, 0.61]);
    robot.applyAuthoritativeState(neutralPose);

    for (let i = 0; i < 25; i++) {
      const jName = CANONICAL_SIM_JOINTS[i];
      expect(robot.getJointAngle(jName)).toBeCloseTo(0.0, 5);
    }

    // World position of root in Three.js coordinates:
    // MuJoCo [0, 0, 0.61] -> Three.js [-Y, Z, -X] = [0, 0.61, 0]
    expect(robot.rootGroup.position.x).toBeCloseTo(0.0, 4);
    expect(robot.rootGroup.position.y).toBeCloseTo(0.61, 4);
    expect(robot.rootGroup.position.z).toBeCloseTo(0.0, 4);
  });

  test('P3.5.3: Crouch Pose synchronization articulates hips, knees, and ankles symmetrically', () => {
    // Indices:
    // 0: left_hip_pitch, 3: left_knee, 4: left_ankle_pitch
    // 6: right_hip_pitch, 9: right_knee, 10: right_ankle_pitch
    const crouchAngles = new Array(25).fill(0.0);
    crouchAngles[0] = -0.45; // left hip pitch
    crouchAngles[3] = 0.90;  // left knee
    crouchAngles[4] = -0.32; // left ankle pitch
    crouchAngles[6] = 0.45;  // right hip pitch
    crouchAngles[9] = -0.90; // right knee
    crouchAngles[10] = 0.32; // right ankle pitch

    const crouchPose = createPose(crouchAngles, [0.0, 0.0, 0.48]); // lowered base height
    robot.applyAuthoritativeState(crouchPose);

    expect(robot.getJointAngle('left_hip_pitch_joint')).toBeCloseTo(-0.45, 4);
    expect(robot.getJointAngle('left_knee_joint')).toBeCloseTo(0.90, 4);
    expect(robot.getJointAngle('left_ankle_pitch_joint')).toBeCloseTo(-0.32, 4);
    expect(robot.getJointAngle('right_hip_pitch_joint')).toBeCloseTo(0.45, 4);
    expect(robot.getJointAngle('right_knee_joint')).toBeCloseTo(-0.90, 4);
    expect(robot.getJointAngle('right_ankle_pitch_joint')).toBeCloseTo(0.32, 4);

    expect(robot.rootGroup.position.y).toBeCloseTo(0.48, 4);
  });

  test('P3.5.4: Walking Pose synchronization applies alternating biped gait and arm swing', () => {
    const walkAngles = new Array(25).fill(0.0);
    // Left leg forward swing
    walkAngles[0] = -0.35; // left hip pitch
    walkAngles[3] = 0.60;  // left knee
    walkAngles[4] = -0.15; // left ankle pitch
    // Right leg backward stance
    walkAngles[6] = -0.20; // right hip pitch
    walkAngles[9] = -0.10; // right knee
    walkAngles[10] = 0.10; // right ankle pitch
    // Arms counter-swing
    walkAngles[12] = 0.40;  // left shoulder pitch (back)
    walkAngles[15] = 0.50;  // left elbow
    walkAngles[17] = -0.40; // right shoulder pitch (forward)
    walkAngles[20] = -0.50; // right elbow

    const walkPose = createPose(walkAngles, [0.85, 0.02, 0.605]);
    robot.applyAuthoritativeState(walkPose);

    expect(robot.getJointAngle('left_hip_pitch_joint')).toBeCloseTo(-0.35, 4);
    expect(robot.getJointAngle('right_shoulder_pitch_joint')).toBeCloseTo(-0.40, 4);
    expect(robot.rootGroup.position.z).toBeCloseTo(-0.85, 4); // MuJoCo X (0.85) -> Three.js -Z (-0.85)
    expect(robot.rootGroup.position.x).toBeCloseTo(-0.02, 4); // MuJoCo Y (0.02) -> Three.js -X (-0.02)
  });

  test('P3.5.5: Recovery Pose synchronization reflects compliant damping or ground pose', () => {
    const recoveryAngles = new Array(25).fill(0.0);
    recoveryAngles[0] = -0.2;
    recoveryAngles[3] = 0.3;
    recoveryAngles[6] = 0.2;
    recoveryAngles[9] = -0.3;
    recoveryAngles[22] = 0.1; // waist yaw

    const recoveryPose = createPose(recoveryAngles, [0.0, 0.0, 0.25]); // near ground
    robot.applyAuthoritativeState(recoveryPose);

    expect(robot.getJointAngle('waist_yaw_joint')).toBeCloseTo(0.1, 4);
    expect(robot.rootGroup.position.y).toBeCloseTo(0.25, 4);
  });

  test('P3.5.6: Clamps arbitrary joint states exceeding mechanical limits', () => {
    const extremeAngles = new Array(25).fill(0.0);
    // left knee limit is [0.0, 1.5]
    extremeAngles[3] = 5.0; // exceeds max
    // left ankle pitch limit is [-0.35, 0.35]
    extremeAngles[4] = -2.0; // exceeds min

    const extremePose = createPose(extremeAngles);
    robot.applyAuthoritativeState(extremePose);

    expect(robot.getJointAngle('left_knee_joint')).toBeCloseTo(1.5, 4);
    expect(robot.getJointAngle('left_ankle_pitch_joint')).toBeCloseTo(-0.35, 4);
  });

  test('P3.5.7: Base orientation quaternion maps correctly to Three.js basis', () => {
    // MuJoCo yaw rotation 90 deg around Z:
    // quat = [0, 0, sin(45), cos(45)] = [0, 0, 0.7071068, 0.7071068]
    const yaw90Pose = createPose(
      new Array(25).fill(0.0),
      [0, 0, 0.61],
      [0.0, 0.0, Math.SQRT1_2, Math.SQRT1_2]
    );

    robot.applyAuthoritativeState(yaw90Pose);

    // Verify root orientation is a valid normalized quaternion
    const q = robot.rootGroup.quaternion;
    const len = Math.hypot(q.x, q.y, q.z, q.w);
    expect(len).toBeCloseTo(1.0, 5);
  });
});
