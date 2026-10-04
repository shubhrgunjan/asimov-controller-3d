import * as THREE from 'three';
import * as fs from 'fs';
import * as path from 'path';
import { AsimovRobotModel } from '../src/model/AsimovRobotModel';
import { ASIMOV_JOINTS, ASIMOV_BODIES, ASIMOV_TOTAL_JOINTS, ASIMOV_TOTAL_TRIANGLES } from '../src/model/AsimovJointHierarchy';
import { ASIMOV_1_MOBILE_GLB_BASE64, ASIMOV_1_BYTE_SIZE } from '../src/model/asimov_1_model_data';

describe('Phase 2 — Asimov 1 Visual Model & Hierarchy Validation', () => {
  const glbPath = path.resolve(__dirname, '../assets/asimov_1.glb');

  test('GLB asset exists on disk with valid glTF 2.0 binary header and mobile size limit', () => {
    expect(fs.existsSync(glbPath)).toBe(true);
    const stats = fs.statSync(glbPath);
    // Must be <= 5 MB (actual ~1.65 MB)
    expect(stats.size).toBeLessThan(5 * 1024 * 1024);
    expect(stats.size).toBeGreaterThan(100 * 1024);

    const fd = fs.openSync(glbPath, 'r');
    const header = Buffer.alloc(12);
    fs.readSync(fd, header, 0, 12, 0);
    fs.closeSync(fd);

    expect(header.toString('utf8', 0, 4)).toBe('glTF');
    expect(header.readUInt32LE(4)).toBe(2); // glTF version 2
  });

  test('Embedded offline Base64 buffer decodes to valid binary GLB buffer', () => {
    expect(ASIMOV_1_MOBILE_GLB_BASE64.length).toBeGreaterThan(1000);
    const decoded = Buffer.from(ASIMOV_1_MOBILE_GLB_BASE64, 'base64');
    expect(decoded.length).toBe(ASIMOV_1_BYTE_SIZE);
    expect(decoded.toString('utf8', 0, 4)).toBe('glTF');
  });

  test('Loads canonical visual model into Three.js without errors', async () => {
    const robot = new AsimovRobotModel();
    await robot.load();
    expect(robot.isReady()).toBe(true);

    const dims = robot.getDimensions();
    expect(dims.meshCount).toBe(26);
    expect(dims.jointCount).toBe(25);
    // Triangle count must be within mobile rendering budget (<= 120,000)
    expect(dims.triangleCount).toBe(113436);
    expect(dims.triangleCount).toBeLessThanOrEqual(120000);
  });

  test('Verifies completeness of all 25 canonical robotic joints without duplicates', () => {
    const jointNames = Object.keys(ASIMOV_JOINTS);
    expect(jointNames.length).toBe(25);
    expect(ASIMOV_TOTAL_JOINTS).toBe(25);

    const uniqueNames = new Set(jointNames);
    expect(uniqueNames.size).toBe(25);

    // Verify critical joints are all present
    const expectedCrucialJoints = [
      'left_hip_pitch_joint',
      'left_hip_roll_joint',
      'left_hip_yaw_joint',
      'left_knee_joint',
      'left_ankle_pitch_joint',
      'left_ankle_roll_joint',
      'right_hip_pitch_joint',
      'right_hip_roll_joint',
      'right_hip_yaw_joint',
      'right_knee_joint',
      'right_ankle_pitch_joint',
      'right_ankle_roll_joint',
      'waist_yaw_joint',
      'neck_yaw_joint',
      'neck_pitch_joint',
      'left_shoulder_pitch_joint',
      'left_shoulder_roll_joint',
      'left_shoulder_yaw_joint',
      'left_elbow_joint',
      'left_wrist_yaw_joint',
      'right_shoulder_pitch_joint',
      'right_shoulder_roll_joint',
      'right_shoulder_yaw_joint',
      'right_elbow_joint',
      'right_wrist_yaw_joint',
    ];

    for (const jName of expectedCrucialJoints) {
      expect(ASIMOV_JOINTS[jName]).toBeDefined();
      const jDef = ASIMOV_JOINTS[jName];
      expect(jDef.axis.length).toBe(3);
      expect(jDef.range[0]).toBeLessThan(jDef.range[1]);
      // Verify axis is non-zero
      const len = Math.hypot(jDef.axis[0], jDef.axis[1], jDef.axis[2]);
      expect(len).toBeCloseTo(1.0, 3);
    }
  });

  test('Validates model physical scale matches canonical MuJoCo dimensions', async () => {
    const robot = new AsimovRobotModel();
    await robot.load();

    const dims = robot.getDimensions();
    // MuJoCo head top is ~1.22 m
    expect(dims.totalHeightMeters).toBeGreaterThan(1.15);
    expect(dims.totalHeightMeters).toBeLessThan(1.30);

    // Pelvis is at Z=0.630 m in MuJoCo
    expect(dims.pelvisHeightMeters).toBeCloseTo(0.63, 1);

    // Neutral width across shoulders/arms at sides is ~0.424 m
    expect(dims.shoulderWidthMeters).toBeGreaterThan(0.35);
    expect(dims.shoulderWidthMeters).toBeLessThan(0.48);

    // Outstretched arm span in T-pose is ~0.80 - 0.95 m
    robot.setJointAngle('left_shoulder_roll_joint', -1.4);
    robot.setJointAngle('right_shoulder_roll_joint', 1.4);
    const outstretchedBox = robot.measureCurrentBoundingBox();
    expect(outstretchedBox.x).toBeGreaterThan(0.70);
    expect(outstretchedBox.x).toBeLessThan(1.00);
    robot.resetToNeutralPose();
  });

  test('Executes programmatic joint validation poses and verifies physical pivots', async () => {
    const robot = new AsimovRobotModel();
    await robot.load();

    // Neutral
    robot.applyValidationPose('neutral');
    expect(robot.getJointAngle('left_knee_joint')).toBe(0.0);
    expect(robot.getJointAngle('right_knee_joint')).toBe(0.0);

    // Left knee flex
    robot.applyValidationPose('left_knee');
    expect(robot.getJointAngle('left_knee_joint')).toBe(0.6);
    expect(robot.getJointAngle('right_knee_joint')).toBe(0.0);

    // Right knee flex (negative around right axis [0, -1, 0])
    robot.applyValidationPose('right_knee');
    expect(robot.getJointAngle('right_knee_joint')).toBe(-0.6);
    expect(robot.getJointAngle('left_knee_joint')).toBe(0.0);

    // Crouch posture
    robot.applyValidationPose('crouch');
    expect(robot.getJointAngle('left_knee_joint')).toBe(0.9);
    expect(robot.getJointAngle('right_knee_joint')).toBe(-0.9);
    expect(robot.getJointAngle('left_hip_pitch_joint')).toBe(-0.45);
    expect(robot.getJointAngle('right_hip_pitch_joint')).toBe(0.45);
    expect(robot.getJointAngle('left_ankle_pitch_joint')).toBe(-0.32);
    expect(robot.getJointAngle('right_ankle_pitch_joint')).toBe(0.32);

    // Ankle test (coupled 2-DOF serial chain)
    robot.applyValidationPose('ankle_roll');
    expect(robot.getJointAngle('left_ankle_roll_joint')).toBe(0.08);
    expect(robot.getJointAngle('right_ankle_roll_joint')).toBe(-0.08);

    // Reset to neutral
    robot.resetToNeutralPose();
    expect(robot.getJointAngle('left_knee_joint')).toBe(0.0);
  });

  test('Runs continuous articulation test loop without NaN or matrix divergence', async () => {
    const robot = new AsimovRobotModel();
    await robot.load();

    for (let t = 0; t <= 16.0; t += 0.5) {
      robot.updateContinuousArticulation(t);
      const angles = robot.getAllJointAngles();
      for (const [jName, angle] of Object.entries(angles)) {
        expect(Number.isFinite(angle)).toBe(true);
        const [minLim, maxLim] = ASIMOV_JOINTS[jName].range;
        expect(angle).toBeGreaterThanOrEqual(minLim - 0.001);
        expect(angle).toBeLessThanOrEqual(maxLim + 0.001);
      }
    }
  });

  test('Verifies camera attachment positions for Head (FPV) and Pelvis (Chase)', async () => {
    const robot = new AsimovRobotModel();
    await robot.load();

    const headPos = new THREE.Vector3();
    const pelvisPos = new THREE.Vector3();

    robot.getHeadWorldPosition(headPos);
    robot.getPelvisWorldPosition(pelvisPos);

    expect(headPos.y).toBeGreaterThan(1.0); // Head above 1.0 m
    expect(pelvisPos.y).toBeCloseTo(0.63, 1); // Pelvis at ~0.63 m
  });
});
