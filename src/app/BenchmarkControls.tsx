import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { BenchmarkController } from '../benchmark/BenchmarkController';
import { BenchmarkLevel } from '../benchmark/BenchmarkScene';
import { ResolutionMode } from '../renderer/ThreeRenderer';
import { AssetTestResult } from '../renderer/AssetLoader';
import { CameraMode } from '../renderer/SceneManager';
import { ValidationPoseName } from '../model/AsimovRobotModel';

interface BenchmarkControlsProps {
  controller: BenchmarkController;
}

export const BenchmarkControls: React.FC<BenchmarkControlsProps> = ({ controller }) => {
  const [assetStatus, setAssetStatus] = useState<string | null>(null);

  const currentLevel = controller.getLevel();
  const currentRes = controller.getResolution();
  const currentCamera = controller.getCameraMode();
  const shadows = controller.isShadowsEnabled();
  const textures = controller.isTexturesEnabled();
  const anim = controller.isAnimationEnabled();
  const isMatrixRunning = controller.isMatrixActive();

  const handleLevelSelect = (lvl: BenchmarkLevel) => {
    controller.setLevel(lvl);
  };

  const handleResolutionSelect = (res: ResolutionMode) => {
    controller.setResolution(res);
  };

  const handleCameraSelect = (cam: CameraMode) => {
    controller.setCameraMode(cam);
  };

  const handlePoseSelect = (pose: ValidationPoseName) => {
    controller.applyValidationPose(pose);
  };

  const handleRunAssetTest = async () => {
    setAssetStatus('PARSING GLB...');
    const res: AssetTestResult = await controller.runAssetTest();
    if (res.success) {
      setAssetStatus(`GLB OK: ${res.meshCount} meshes, ${res.triangleCount} tris, ${res.loadTimeMs.toFixed(1)}ms`);
    } else {
      setAssetStatus(`GLB ERR: ${res.error}`);
    }
  };

  const levelLabels: { key: BenchmarkLevel; label: string }[] = [
    { key: 'L1', label: 'L1' },
    { key: 'L2', label: 'L2' },
    { key: 'L3', label: 'L3' },
    { key: 'L4', label: 'L4' },
    { key: 'ASIMOV_STATIC', label: 'ASIMOV' },
    { key: 'ASIMOV_ARTICULATED', label: 'ARTICULATE' },
    { key: 'ASIMOV_ENVIRONMENT', label: 'ARENA' },
  ];

  const cameraModes: { key: CameraMode; label: string }[] = [
    { key: 'orbit', label: 'ORBIT' },
    { key: 'third_person', label: 'CHASE' },
    { key: 'front_inspection', label: 'FRONT' },
    { key: 'first_person', label: 'FPV' },
    { key: 'rapid_sweep', label: 'SWEEP' },
  ];

  const validationPoses: { key: ValidationPoseName; label: string }[] = [
    { key: 'neutral', label: 'NEUTRAL' },
    { key: 'crouch', label: 'CROUCH' },
    { key: 'both_knees', label: 'KNEES' },
    { key: 'hip_pitch', label: 'HIPS' },
    { key: 'ankle_pitch', label: 'ANKLES' },
    { key: 'shoulder', label: 'ARMS' },
  ];

  return (
    <View style={styles.controlsOverlay} pointerEvents="box-none">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Level Selectors */}
        <View style={styles.buttonGroup}>
          <Text style={styles.groupLabel}>MODEL & LEVEL</Text>
          <View style={styles.row}>
            {levelLabels.map(({ key, label }) => (
              <TouchableOpacity
                key={key}
                style={[
                  styles.btn,
                  currentLevel === key && styles.btnActive,
                  key.startsWith('ASIMOV') && styles.btnAsimov,
                  currentLevel === key && key.startsWith('ASIMOV') && styles.btnAsimovActive,
                ]}
                onPress={() => handleLevelSelect(key)}
              >
                <Text
                  style={[
                    styles.btnText,
                    currentLevel === key && styles.btnTextActive,
                    key.startsWith('ASIMOV') && styles.btnAsimovText,
                  ]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Camera Selectors */}
        <View style={styles.buttonGroup}>
          <Text style={styles.groupLabel}>CAMERA (SEC. 17)</Text>
          <View style={styles.row}>
            {cameraModes.map(({ key, label }) => (
              <TouchableOpacity
                key={key}
                style={[styles.btn, currentCamera === key && styles.btnActive]}
                onPress={() => handleCameraSelect(key)}
              >
                <Text style={[styles.btnText, currentCamera === key && styles.btnTextActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Validation Poses */}
        <View style={styles.buttonGroup}>
          <Text style={styles.groupLabel}>JOINT VALIDATION (SEC. 6)</Text>
          <View style={styles.row}>
            {validationPoses.map(({ key, label }) => (
              <TouchableOpacity
                key={key}
                style={styles.btnPose}
                onPress={() => handlePoseSelect(key)}
              >
                <Text style={styles.btnPoseText}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Resolution Selectors */}
        <View style={styles.buttonGroup}>
          <Text style={styles.groupLabel}>RESOLUTION</Text>
          <View style={styles.row}>
            {(['720p', '1080p', 'native'] as ResolutionMode[]).map((res) => (
              <TouchableOpacity
                key={res}
                style={[styles.btn, currentRes === res && styles.btnActive]}
                onPress={() => handleResolutionSelect(res)}
              >
                <Text style={[styles.btnText, currentRes === res && styles.btnTextActive]}>
                  {res.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Feature Toggles */}
        <View style={styles.buttonGroup}>
          <Text style={styles.groupLabel}>FEATURES</Text>
          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.btn, shadows && styles.btnActive]}
              onPress={() => controller.toggleShadows()}
            >
              <Text style={[styles.btnText, shadows && styles.btnTextActive]}>
                SHADOWS: {shadows ? 'ON' : 'OFF'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, textures && styles.btnActive]}
              onPress={() => controller.toggleTextures()}
            >
              <Text style={[styles.btnText, textures && styles.btnTextActive]}>
                TEXTURES: {textures ? 'ON' : 'OFF'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, anim && styles.btnActive]}
              onPress={() => controller.toggleAnimation()}
            >
              <Text style={[styles.btnText, anim && styles.btnTextActive]}>
                ANIM: {anim ? 'ON' : 'OFF'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Action Controls */}
        <View style={styles.buttonGroup}>
          <Text style={styles.groupLabel}>BENCHMARK ACTIONS</Text>
          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.btnAction, isMatrixRunning && styles.btnDisabled]}
              disabled={isMatrixRunning}
              onPress={() => controller.triggerBenchmarkRun(2000, 8000)}
            >
              <Text style={styles.btnActionText}>RECORD (8s)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btnActionPrimary, isMatrixRunning && styles.btnActiveAlert]}
              onPress={() => controller.startMatrixExecution()}
            >
              <Text style={styles.btnActionPrimaryText}>
                {isMatrixRunning ? 'MATRIX RUNNING...' : 'AUTO MATRIX (3×)'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.btnAction}
              onPress={() => controller.triggerSustainedRun(600000)}
            >
              <Text style={styles.btnActionText}>10M ENDURANCE</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.btnAsset}
              onPress={handleRunAssetTest}
            >
              <Text style={styles.btnAssetText}>ASSET TEST</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Asset Test Output Toast */}
      {assetStatus && (
        <View style={styles.toastContainer}>
          <Text style={styles.toastText}>{assetStatus}</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  controlsOverlay: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 12,
    zIndex: 100,
  },
  scrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(10, 14, 20, 0.92)',
    borderColor: 'rgba(56, 189, 248, 0.25)',
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
  },
  buttonGroup: {
    marginRight: 12,
  },
  groupLabel: {
    color: '#64748b',
    fontSize: 8.5,
    fontFamily: 'monospace',
    fontWeight: '700',
    marginBottom: 4,
    letterSpacing: 0.8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  btn: {
    backgroundColor: '#1e293b',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginRight: 4,
  },
  btnActive: {
    backgroundColor: '#0284c7',
    borderColor: '#38bdf8',
  },
  btnAsimov: {
    borderColor: '#06b6d4',
  },
  btnAsimovActive: {
    backgroundColor: '#0891b2',
    borderColor: '#22d3ee',
  },
  btnText: {
    color: '#94a3b8',
    fontSize: 9.5,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  btnTextActive: {
    color: '#ffffff',
  },
  btnAsimovText: {
    color: '#67e8f9',
  },
  btnPose: {
    backgroundColor: '#1e1b4b',
    borderColor: '#6366f1',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginRight: 4,
  },
  btnPoseText: {
    color: '#a5b4fc',
    fontSize: 9.5,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  btnAction: {
    backgroundColor: '#0f172a',
    borderColor: '#38bdf8',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginRight: 4,
  },
  btnActionText: {
    color: '#38bdf8',
    fontSize: 9.5,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  btnActionPrimary: {
    backgroundColor: '#0284c7',
    borderColor: '#38bdf8',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginRight: 4,
  },
  btnActionPrimaryText: {
    color: '#ffffff',
    fontSize: 9.5,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  btnActiveAlert: {
    backgroundColor: '#b91c1c',
    borderColor: '#ef4444',
  },
  btnAsset: {
    backgroundColor: '#7c3aed',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginRight: 4,
  },
  btnAssetText: {
    color: '#ffffff',
    fontSize: 9.5,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  toastContainer: {
    marginTop: 6,
    backgroundColor: 'rgba(30, 41, 59, 0.95)',
    borderColor: '#38bdf8',
    borderWidth: 1,
    borderRadius: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    alignSelf: 'flex-start',
  },
  toastText: {
    color: '#38bdf8',
    fontSize: 9,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
});
