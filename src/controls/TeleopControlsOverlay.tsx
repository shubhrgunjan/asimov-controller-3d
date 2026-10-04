/**
 * TeleopControlsOverlay.tsx
 * 
 * Production Game-Like Teleoperation Control Surface for Asimov 1.
 * Features:
 * - OperatorStatusBar across top (Robot mode, policy, safety, velocity, cameras)
 * - Dual ergonomic virtual joysticks (Left: Vx/Vy translation, Right: Wz yaw rotation)
 * - Tactile action buttons (STAND, WALK, CROUCH, RECOVERY, DAMP, RESET)
 * - Prominent high-contrast safety E-STOP button
 * - Unobstructed central 3D viewport
 * - Safety interlock banner during network degradation or connection drop
 */

import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { VirtualJoystick } from './VirtualJoystick';
import { TeleopController } from './TeleopController';
import { CommandType, RobotMode, PolicyId, RecoveryState } from '../protocol/AsimovStateProtocol';
import { CameraMode } from '../renderer/SceneManager';
import { OperatorStatusBar } from './OperatorStatusBar';
import { GlobalConnectionState } from '../app/navigation/AppStateMachine';
import { InterpolatedRobotPose } from '../synchronization/StateBuffer';

export interface TeleopControlsOverlayProps {
  controller: TeleopController;
  currentCamera: CameraMode;
  onSelectCamera: (mode: CameraMode) => void;
  connectionState: GlobalConnectionState;
  host: string;
  port: number;
  latestPose?: InterpolatedRobotPose | null;
  rttMs?: number;
  packetRateHz?: number;
  onUpdateConnection?: (host: string, port: number) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onOpenSettings?: () => void;
  onExitToHome?: () => void;
}

export const TeleopControlsOverlay: React.FC<TeleopControlsOverlayProps> = ({
  controller,
  currentCamera,
  onSelectCamera,
  connectionState,
  latestPose,
  rttMs = 0,
  packetRateHz = 0,
  onConnect,
  onDisconnect,
  onOpenSettings = () => {},
  onExitToHome = () => {},
}) => {
  const [activeMode, setActiveMode] = useState<CommandType>(CommandType.STAND);
  const [cmdVelocities, setCmdVelocities] = useState({ vx: 0, vy: 0, wz: 0 });

  // Poll commanded velocities at ~10 Hz for smooth operator feedback
  useEffect(() => {
    const timer = setInterval(() => {
      setCmdVelocities(controller.getTargetVelocities());
    }, 100);
    return () => clearInterval(timer);
  }, [controller]);

  const handleCommand = (cmd: CommandType) => {
    setActiveMode(cmd);
    controller.triggerAction(cmd);
  };

  const isConnected = connectionState === 'CONNECTED';
  const isInterrupted =
    connectionState === 'DISCONNECTED' ||
    connectionState === 'RECONNECTING' ||
    connectionState === 'FAILED';

  const robotMode = latestPose ? latestPose.robotMode : RobotMode.STAND;
  const policyId = latestPose ? (latestPose as any).policyId ?? PolicyId.OFFICIAL_LOCOMOTION : PolicyId.OFFICIAL_LOCOMOTION;
  const recoveryState = latestPose ? latestPose.recoveryState : RecoveryState.NORMAL;
  const safetyFault = latestPose ? (latestPose.flags & 0x01) !== 0 : false;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      {/* 1. TOP OPERATOR STATUS TELEMETRY BAR */}
      <OperatorStatusBar
        connectionState={connectionState}
        robotMode={robotMode}
        policyId={policyId}
        recoveryState={recoveryState}
        safetyFault={safetyFault}
        commandVelocities={cmdVelocities}
        packetRateHz={packetRateHz}
        rttMs={rttMs}
        currentCamera={currentCamera}
        onSelectCamera={onSelectCamera}
        onOpenSettings={onOpenSettings}
        onExitToHome={onExitToHome}
      />

      {/* 2. CONNECTION INTERRUPTED SAFETY BANNER */}
      {isInterrupted && (
        <View style={styles.warningBannerContainer} pointerEvents="box-none">
          <View style={styles.warningBanner}>
            <View style={styles.warningDot} />
            <Text style={styles.warningText}>
              {connectionState === 'RECONNECTING'
                ? 'CONNECTION LOST — RESTORING VAS1 STREAM...'
                : 'ROBOT DISCONNECTED — COMMAND DISPATCH INHIBITED'}
            </Text>
            {connectionState === 'DISCONNECTED' && (
              <TouchableOpacity style={styles.reconnectBtn} onPress={onConnect} activeOpacity={0.7}>
                <Text style={styles.reconnectBtnText}>RECONNECT</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* 3. BOTTOM TELEOPERATION CONTROL DECK */}
      <View style={styles.bottomDeck} pointerEvents="box-none">
        {/* Left Joystick: Translation (Vx forward/reverse, Vy lateral) */}
        <View style={styles.joystickSlot}>
          <Text style={styles.joystickLabel}>TRANSLATION (Vx / Vy)</Text>
          <VirtualJoystick
            size={136}
            knobSize={52}
            accentColor="#38bdf8"
            onMove={(normX, normY) => controller.updateLeftJoystick(normX, normY)}
            onRelease={() => controller.releaseLeftJoystick()}
          />
        </View>

        {/* Center Control Cluster: Mode Selectors + E-STOP */}
        <View style={styles.centerCluster} pointerEvents="box-none">
          {/* Primary Action Buttons Row */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.modeBtn, activeMode === CommandType.STAND && styles.modeBtnActive]}
              onPress={() => handleCommand(CommandType.STAND)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.modeBtnText,
                  activeMode === CommandType.STAND && styles.modeBtnTextActive,
                ]}
              >
                STAND
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modeBtn, activeMode === CommandType.WALK && styles.modeBtnActive]}
              onPress={() => handleCommand(CommandType.WALK)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.modeBtnText,
                  activeMode === CommandType.WALK && styles.modeBtnTextActive,
                ]}
              >
                WALK
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modeBtn, activeMode === CommandType.CROUCH && styles.modeBtnActive]}
              onPress={() => handleCommand(CommandType.CROUCH)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.modeBtnText,
                  activeMode === CommandType.CROUCH && styles.modeBtnTextActive,
                ]}
              >
                CROUCH
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modeBtn, styles.modeBtnRecovery]}
              onPress={() => handleCommand(CommandType.RECOVERY)}
              activeOpacity={0.7}
            >
              <Text style={[styles.modeBtnText, styles.modeBtnTextRecovery]}>RECOVER</Text>
            </TouchableOpacity>
          </View>

          {/* Auxiliary Row: Damp & Reset */}
          <View style={styles.auxRow}>
            <TouchableOpacity
              style={styles.auxBtn}
              onPress={() => handleCommand(CommandType.DAMP)}
              activeOpacity={0.7}
            >
              <Text style={styles.auxBtnText}>DAMP</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.auxBtn}
              onPress={() => handleCommand(CommandType.RESET)}
              activeOpacity={0.7}
            >
              <Text style={styles.auxBtnText}>RESET</Text>
            </TouchableOpacity>
          </View>

          {/* Prominent Safety E-STOP Button */}
          <TouchableOpacity
            style={styles.estopButton}
            onPress={() => handleCommand(CommandType.ESTOP)}
            activeOpacity={0.8}
          >
            <View style={styles.estopInnerRing}>
              <Text style={styles.estopText}>E - S T O P</Text>
              <Text style={styles.estopSubtext}>EMERGENCY HALT</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Right Joystick: Rotation (Wz yaw rate) */}
        <View style={styles.joystickSlot}>
          <Text style={styles.joystickLabel}>ROTATION (Yaw Wz)</Text>
          <VirtualJoystick
            size={136}
            knobSize={52}
            accentColor="#818cf8"
            onMove={(normX) => controller.updateRightJoystick(normX)}
            onRelease={() => controller.releaseRightJoystick()}
          />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'space-between',
  },
  warningBannerContainer: {
    position: 'absolute',
    top: 110,
    left: 20,
    right: 20,
    alignItems: 'center',
    zIndex: 25,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ef4444',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 6,
  },
  warningDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
    marginRight: 10,
  },
  warningText: {
    color: '#f8fafc',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  reconnectBtn: {
    backgroundColor: '#0284c7',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    marginLeft: 12,
  },
  reconnectBtnText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  bottomDeck: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 24,
    zIndex: 10,
  },
  joystickSlot: {
    alignItems: 'center',
  },
  joystickLabel: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.0,
    fontFamily: 'monospace',
    marginBottom: 8,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  centerCluster: {
    alignItems: 'center',
    paddingBottom: 4,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  modeBtn: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeBtnActive: {
    backgroundColor: '#0284c7',
    borderColor: '#38bdf8',
  },
  modeBtnRecovery: {
    backgroundColor: 'rgba(217, 119, 6, 0.25)',
    borderColor: 'rgba(245, 158, 11, 0.5)',
  },
  modeBtnText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.8,
  },
  modeBtnTextActive: {
    color: '#ffffff',
  },
  modeBtnTextRecovery: {
    color: '#fbbf24',
  },
  auxRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  auxBtn: {
    backgroundColor: 'rgba(30, 41, 59, 0.7)',
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  auxBtnText: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  estopButton: {
    width: 220,
    backgroundColor: '#dc2626',
    borderRadius: 12,
    padding: 3,
    borderWidth: 2,
    borderColor: '#fca5a5',
    shadowColor: '#dc2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
    elevation: 8,
  },
  estopInnerRing: {
    backgroundColor: '#b91c1c',
    borderRadius: 9,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  estopText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 2.5,
    fontFamily: 'monospace',
  },
  estopSubtext: {
    color: '#fecaca',
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 1.2,
    fontFamily: 'monospace',
    marginTop: 2,
  },
});
