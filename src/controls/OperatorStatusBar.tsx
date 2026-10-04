/**
 * OperatorStatusBar.tsx
 * 
 * Compact, high-contrast, operator-facing robot status telemetry bar for Asimov Controller 3D.
 * Displays authoritative robot mode, policy execution, recovery state,
 * commanded velocities, connection health, and camera view controls
 * without cluttering the screen with raw developer metrics.
 */

import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { CameraMode } from '../renderer/SceneManager';
import { RobotMode, PolicyId, RecoveryState } from '../protocol/AsimovStateProtocol';
import { GlobalConnectionState } from '../app/navigation/AppStateMachine';
import { RemoteViewMode } from '../cameras/RemoteCameraSurface';

export interface OperatorStatusBarProps {
  connectionState: GlobalConnectionState;
  robotMode: RobotMode;
  policyId: PolicyId;
  recoveryState: RecoveryState;
  safetyFault: boolean;
  commandVelocities: { vx: number; vy: number; wz: number };
  packetRateHz: number;
  rttMs: number;
  currentCamera: CameraMode;
  remoteViewMode?: RemoteViewMode;
  onSelectCamera: (mode: CameraMode) => void;
  onToggleRemoteView?: () => void;
  onOpenSettings: () => void;
  onExitToHome: () => void;
}

export const OperatorStatusBar: React.FC<OperatorStatusBarProps> = ({
  connectionState,
  robotMode,
  policyId,
  recoveryState,
  safetyFault,
  commandVelocities,
  packetRateHz,
  rttMs,
  currentCamera,
  remoteViewMode = 'HIDDEN',
  onSelectCamera,
  onToggleRemoteView,
  onOpenSettings,
  onExitToHome,
}) => {
  const getModeLabel = (mode: RobotMode): string => {
    switch (mode) {
      case RobotMode.STAND:
        return 'STAND';
      case RobotMode.MOVE:
        return 'MOVE';
      case RobotMode.DAMP:
        return 'DAMP';
      case RobotMode.FAULT_DAMP:
        return 'FAULT DAMP';
      default:
        return 'INIT';
    }
  };

  const getPolicyLabel = (policy: PolicyId): string => {
    switch (policy) {
      case PolicyId.OFFICIAL_LOCOMOTION:
        return 'MENLO LOCOMOTION';
      case PolicyId.SAFEFALL:
        return 'SAFE-FALL';
      case PolicyId.GETUP:
        return 'GET-UP';
      case PolicyId.MANUAL_OVERRIDE:
        return 'MANUAL OVERRIDE';
      case PolicyId.NONE:
      default:
        return 'STANDBY';
    }
  };

  const getRecoveryLabel = (recovery: RecoveryState): string => {
    switch (recovery) {
      case RecoveryState.NORMAL:
        return 'NORMAL';
      case RecoveryState.FALL_DETECTED:
        return 'FALL DETECTED';
      case RecoveryState.DAMPING_ACTIVE:
        return 'DAMPING ACTIVE';
      case RecoveryState.GETUP_IN_PROGRESS:
        return 'GET-UP RUNNING';
      case RecoveryState.STAND_ARMED:
        return 'STAND ARMED';
      default:
        return 'UNKNOWN';
    }
  };

  const isConnected = connectionState === 'CONNECTED';
  const isDegraded = connectionState === 'DEGRADED';
  const connColor = isConnected ? '#10b981' : isDegraded ? '#f59e0b' : '#ef4444';

  return (
    <View style={styles.topContainer} pointerEvents="box-none">
      {/* Upper Bar: Navigation & Connection & Camera */}
      <View style={styles.primaryBar}>
        {/* Navigation & Robot ID */}
        <View style={styles.leftSection}>
          <TouchableOpacity style={styles.homeBtn} onPress={onExitToHome} activeOpacity={0.7}>
            <Text style={styles.homeBtnText}>⌂ HOME</Text>
          </TouchableOpacity>
          <View style={styles.robotBadge}>
            <Text style={styles.robotName}>ASIMOV 1</Text>
            <View style={[styles.statusDot, { backgroundColor: connColor }]} />
          </View>
        </View>

        {/* Camera Selector Pills */}
        <View style={styles.cameraPills}>
          {(['third_person', 'first_person', 'front_inspection', 'orbit'] as CameraMode[]).map(
            (mode) => {
              const active = currentCamera === mode;
              const label =
                mode === 'third_person'
                  ? 'CHASE'
                  : mode === 'first_person'
                  ? 'FPV'
                  : mode === 'front_inspection'
                  ? 'FRONT'
                  : 'ORBIT';

              return (
                <TouchableOpacity
                  key={mode}
                  style={[styles.camPill, active && styles.camPillActive]}
                  onPress={() => onSelectCamera(mode)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.camPillText, active && styles.camPillTextActive]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            }
          )}
        </View>

        {/* Remote Camera Toggle */}
        {onToggleRemoteView && (
          <TouchableOpacity
            style={[styles.remoteCamBtn, remoteViewMode !== 'HIDDEN' && styles.remoteCamBtnActive]}
            onPress={onToggleRemoteView}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.remoteCamText,
                remoteViewMode !== 'HIDDEN' && styles.remoteCamTextActive,
              ]}
            >
              {remoteViewMode === 'HIDDEN' ? '📷 VIDEO' : `📷 ${remoteViewMode}`}
            </Text>
          </TouchableOpacity>
        )}

        {/* Settings & Connection Pill */}
        <View style={styles.rightSection}>
          <View style={styles.connMetricsPill}>
            <Text style={[styles.connStateText, { color: connColor }]}>
              {isConnected ? `${packetRateHz}Hz · ${rttMs}ms` : connectionState}
            </Text>
          </View>
          <TouchableOpacity style={styles.settingsBtn} onPress={onOpenSettings} activeOpacity={0.7}>
            <Text style={styles.settingsIcon}>⚙</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Sub Bar: Authoritative Robot & Policy Status Strip */}
      <View style={styles.statusStrip}>
        <View style={styles.statusItem}>
          <Text style={styles.statusLabel}>MODE</Text>
          <Text style={styles.statusValue}>{getModeLabel(robotMode)}</Text>
        </View>

        <View style={styles.statusItem}>
          <Text style={styles.statusLabel}>POLICY</Text>
          <Text style={[styles.statusValue, { color: '#38bdf8' }]}>
            {getPolicyLabel(policyId)}
          </Text>
        </View>

        <View style={styles.statusItem}>
          <Text style={styles.statusLabel}>RECOVERY</Text>
          <Text
            style={[
              styles.statusValue,
              { color: recoveryState === RecoveryState.NORMAL ? '#e2e8f0' : '#f59e0b' },
            ]}
          >
            {getRecoveryLabel(recoveryState)}
          </Text>
        </View>

        <View style={styles.statusItem}>
          <Text style={styles.statusLabel}>SAFETY</Text>
          <Text style={[styles.statusValue, { color: safetyFault ? '#ef4444' : '#10b981' }]}>
            {safetyFault ? 'FAULT' : 'NORMAL'}
          </Text>
        </View>

        <View style={styles.statusItemRight}>
          <Text style={styles.statusLabel}>CMD (Vx · Vy · Wz)</Text>
          <Text style={styles.statusCommandValue}>
            {`${commandVelocities.vx.toFixed(2)}  ${commandVelocities.vy.toFixed(2)}  ${commandVelocities.wz.toFixed(2)}`}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  topContainer: {
    position: 'absolute',
    top: 32,
    left: 12,
    right: 12,
    zIndex: 20,
  },
  primaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  homeBtn: {
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  homeBtnText: {
    color: '#cbd5e1',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.6,
  },
  robotBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  robotName: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 1.0,
    marginRight: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  cameraPills: {
    flexDirection: 'row',
    backgroundColor: 'rgba(11, 17, 32, 0.7)',
    borderRadius: 8,
    padding: 2,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  camPill: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  camPillActive: {
    backgroundColor: '#0284c7',
  },
  camPillText: {
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.6,
  },
  camPillTextActive: {
    color: '#ffffff',
  },
  rightSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  connMetricsPill: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(11, 17, 32, 0.6)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  connStateText: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  settingsBtn: {
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  settingsIcon: {
    color: '#cbd5e1',
    fontSize: 12,
  },
  remoteCamBtn: {
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  remoteCamBtnActive: {
    backgroundColor: '#0284c7',
    borderColor: '#38bdf8',
  },
  remoteCamText: {
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  remoteCamTextActive: {
    color: '#ffffff',
  },
  statusStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(11, 17, 32, 0.85)',
    borderRadius: 8,
    marginTop: 6,
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.18)',
    gap: 16,
  },
  statusItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 'auto',
  },
  statusLabel: {
    color: '#64748b',
    fontSize: 9,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  statusValue: {
    color: '#f8fafc',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  statusCommandValue: {
    color: '#38bdf8',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
});
