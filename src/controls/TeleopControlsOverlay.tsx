/**
 * TeleopControlsOverlay.tsx
 * 
 * Game-Like Teleoperation HUD Overlay for Asimov 1.
 * Features:
 * - Dual virtual touch joysticks (Left: forward/lateral, Right: yaw)
 * - Action buttons: STAND, WALK, CROUCH, RECOVERY, RESET, E-STOP
 * - Camera mode selector: 3RD, 1ST, FRONT, ORBIT
 * - Backend connection status & manual connect toggle
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, TextInput } from 'react-native';
import { VirtualJoystick } from './VirtualJoystick';
import { TeleopController } from './TeleopController';
import { CommandType } from '../protocol/AsimovStateProtocol';
import { CameraMode } from '../renderer/SceneManager';

interface TeleopControlsOverlayProps {
  controller: TeleopController;
  currentCamera: CameraMode;
  onSelectCamera: (mode: CameraMode) => void;
  connectionState: string;
  host: string;
  port: number;
  onUpdateConnection: (host: string, port: number) => void;
  onConnect: () => void;
  onDisconnect: () => void;
}

export const TeleopControlsOverlay: React.FC<TeleopControlsOverlayProps> = ({
  controller,
  currentCamera,
  onSelectCamera,
  connectionState,
  host,
  port,
  onUpdateConnection,
  onConnect,
  onDisconnect,
}) => {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inputHost, setInputHost] = useState(host);
  const [inputPort, setInputPort] = useState(port.toString());

  const isConnected = connectionState === 'CONNECTED';
  const connColor = isConnected ? '#10b981' : connectionState === 'CONNECTING' ? '#f59e0b' : '#ef4444';

  const handleSaveSettings = () => {
    const parsedPort = parseInt(inputPort, 10) || 8854;
    onUpdateConnection(inputHost.trim(), parsedPort);
    setSettingsOpen(false);
  };

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      {/* Top Bar: Connection & Camera Selectors */}
      <View style={styles.topBar} pointerEvents="box-none">
        {/* Connection status pill */}
        <TouchableOpacity
          style={styles.connPill}
          activeOpacity={0.7}
          onPress={() => setSettingsOpen(true)}
        >
          <View style={[styles.statusDot, { backgroundColor: connColor }]} />
          <Text style={styles.connText}>
            {isConnected ? `${host}:${port}` : `${connectionState}`}
          </Text>
          <Text style={styles.settingsIcon}>⚙</Text>
        </TouchableOpacity>

        {/* Camera Selector Pills */}
        <View style={styles.cameraRow}>
          {(['third_person', 'first_person', 'front_inspection', 'orbit'] as CameraMode[]).map(
            (mode) => {
              const active = currentCamera === mode;
              const label =
                mode === 'third_person'
                  ? '3RD'
                  : mode === 'first_person'
                  ? 'FPV'
                  : mode === 'front_inspection'
                  ? 'FRONT'
                  : 'ORBIT';

              return (
                <TouchableOpacity
                  key={mode}
                  style={[styles.camButton, active && styles.camButtonActive]}
                  onPress={() => onSelectCamera(mode)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.camText, active && styles.camTextActive]}>{label}</Text>
                </TouchableOpacity>
              );
            }
          )}
        </View>
      </View>

      {/* Action Buttons Toolbar (Right Center) */}
      <View style={styles.actionBar}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.btnStand]}
          onPress={() => controller.triggerAction(CommandType.STAND)}
          activeOpacity={0.7}
        >
          <Text style={styles.actionBtnText}>STAND</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionBtn, styles.btnWalk]}
          onPress={() => controller.triggerAction(CommandType.WALK)}
          activeOpacity={0.7}
        >
          <Text style={styles.actionBtnText}>WALK</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionBtn, styles.btnCrouch]}
          onPress={() => controller.triggerAction(CommandType.CROUCH)}
          activeOpacity={0.7}
        >
          <Text style={styles.actionBtnText}>CROUCH</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionBtn, styles.btnRecovery]}
          onPress={() => controller.triggerAction(CommandType.RECOVERY)}
          activeOpacity={0.7}
        >
          <Text style={styles.actionBtnText}>GET UP</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionBtn, styles.btnReset]}
          onPress={() => controller.triggerAction(CommandType.RESET)}
          activeOpacity={0.7}
        >
          <Text style={styles.actionBtnText}>RESET</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionBtn, styles.btnEstop]}
          onPress={() => controller.triggerAction(CommandType.ESTOP)}
          activeOpacity={0.7}
        >
          <Text style={styles.actionBtnTextEstop}>E-STOP</Text>
        </TouchableOpacity>
      </View>

      {/* Bottom Joystick Layer */}
      <View style={styles.joystickRow} pointerEvents="box-none">
        {/* Left Joystick: Motion (vx, vy) */}
        <View style={styles.joystickWrapper}>
          <Text style={styles.joystickLabel}>TRANSLATION</Text>
          <VirtualJoystick
            size={130}
            knobSize={50}
            accentColor="#38bdf8"
            onMove={(normX, normY) => controller.updateLeftJoystick(normX, normY)}
            onRelease={() => controller.releaseLeftJoystick()}
          />
        </View>

        {/* Right Joystick: Yaw (wz) */}
        <View style={styles.joystickWrapper}>
          <Text style={styles.joystickLabel}>ROTATION</Text>
          <VirtualJoystick
            size={130}
            knobSize={50}
            accentColor="#818cf8"
            onMove={(normX) => controller.updateRightJoystick(normX)}
            onRelease={() => controller.releaseRightJoystick()}
          />
        </View>
      </View>

      {/* Connection Settings Modal */}
      <Modal visible={settingsOpen} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>VASIMOV BACKEND CONNECTION</Text>

            <Text style={styles.inputLabel}>SERVER HOST / IP</Text>
            <TextInput
              style={styles.input}
              value={inputHost}
              onChangeText={setInputHost}
              placeholder="10.222.5.132 or 127.0.0.1"
              placeholderTextColor="#64748b"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.inputLabel}>WEBSOCKET PORT</Text>
            <TextInput
              style={styles.input}
              value={inputPort}
              onChangeText={setInputPort}
              placeholder="8854"
              placeholderTextColor="#64748b"
              keyboardType="numeric"
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.btnCancel]}
                onPress={() => setSettingsOpen(false)}
              >
                <Text style={styles.modalBtnText}>CANCEL</Text>
              </TouchableOpacity>

              {isConnected ? (
                <TouchableOpacity
                  style={[styles.modalBtn, styles.btnDisconnect]}
                  onPress={() => {
                    onDisconnect();
                    setSettingsOpen(false);
                  }}
                >
                  <Text style={styles.modalBtnText}>DISCONNECT</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.modalBtn, styles.btnConnect]}
                  onPress={() => {
                    handleSaveSettings();
                    onConnect();
                  }}
                >
                  <Text style={styles.modalBtnText}>CONNECT</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 42,
    paddingHorizontal: 16,
    zIndex: 10,
  },
  connPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  connText: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  settingsIcon: {
    color: '#94a3b8',
    fontSize: 12,
    marginLeft: 6,
  },
  cameraRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 16,
    padding: 3,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  camButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  camButtonActive: {
    backgroundColor: '#0284c7',
  },
  camText: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '700',
  },
  camTextActive: {
    color: '#ffffff',
  },
  actionBar: {
    position: 'absolute',
    right: 16,
    top: 96,
    zIndex: 20,
    alignItems: 'flex-end',
  },
  actionBtn: {
    width: 72,
    paddingVertical: 7,
    borderRadius: 8,
    marginVertical: 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  btnStand: {
    backgroundColor: 'rgba(30, 41, 59, 0.88)',
  },
  btnWalk: {
    backgroundColor: 'rgba(16, 185, 129, 0.85)',
  },
  btnCrouch: {
    backgroundColor: 'rgba(30, 41, 59, 0.88)',
  },
  btnRecovery: {
    backgroundColor: 'rgba(245, 158, 11, 0.85)',
  },
  btnReset: {
    backgroundColor: 'rgba(71, 85, 105, 0.88)',
  },
  btnEstop: {
    backgroundColor: 'rgba(220, 38, 38, 0.95)',
    borderColor: '#f87171',
    marginTop: 6,
  },
  actionBtnText: {
    color: '#f8fafc',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  actionBtnTextEstop: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  joystickRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingBottom: 28,
  },
  joystickWrapper: {
    alignItems: 'center',
  },
  joystickLabel: {
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  modalTitle: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: 14,
    textAlign: 'center',
  },
  inputLabel: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 4,
    marginTop: 8,
  },
  input: {
    backgroundColor: '#1e293b',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    color: '#f8fafc',
    fontSize: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 18,
  },
  modalBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
    marginLeft: 8,
  },
  btnCancel: {
    backgroundColor: '#334155',
  },
  btnConnect: {
    backgroundColor: '#0284c7',
  },
  btnDisconnect: {
    backgroundColor: '#dc2626',
  },
  modalBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
});
