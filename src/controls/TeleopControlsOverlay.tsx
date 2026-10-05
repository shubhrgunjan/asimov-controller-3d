/**
 * TeleopControlsOverlay.tsx
 * 
 * Clean, Minimalist, Game-Grade Teleoperation Control Deck for Asimov 1.
 * 
 * Design Architecture:
 * 1. Pristine Main HUD:
 *    - 100% Unobstructed central 3D viewport — zero button crowding in center!
 *    - Top-Left: Sleek telemetry pill (Robot identity, connection dot, active mode, RTT latency, packet rate).
 *    - Top-Center: GTA Free-Look / Dual Joystick mode toggle badge.
 *    - Top-Right: Compact [ 🛑 STOP ] emergency halt pill + [ ☰ CONTROLS ] Deck launcher.
 *    - Bottom-Left: Ergonomic virtual joystick for Translation (Vx forward/reverse, Vy lateral).
 *    - Bottom-Right: 
 *      * In GTA Mode: Clean touch pan surface (drag anywhere on right screen to rotate camera 360° around robot).
 *      * In Dual Stick Mode: Ergonomic virtual joystick for Yaw Rotation.
 * 
 * 2. Translucent Minimalist Control Deck (Opened via Corner Button):
 *    - Full-height frosted glassmorphic modal sheet (never collapsed or cut off).
 *    - 5 Organized functional tabs:
 *      * 🤖 MODES & SPEED (Stand, Walk, Crouch, Recovery, Damp, Reset, E-Stop, Speed profiles, Lock)
 *      * 🎭 EMOTES & GESTURES (Wave/Hello, Bow, Squat, Cheer, Dance, Nod, Shake, Neutral)
 *      * 🎥 CAMERAS & VIDEO (Chase, FPV, Front, Orbit, Remote Video PIP/Split)
 *      * 🌐 ARENA (Flat, Obstacles, Low Friction Ice, Playground + Instant WebSocket Sync)
 *      * ⚙️ SYSTEM (Developer Diagnostics HUD toggle, Return to Home, Connection reset)
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Dimensions,
} from 'react-native';
import { VirtualJoystick } from './VirtualJoystick';
import { TeleopController, SpeedProfile } from './TeleopController';
import { CommandType, RobotMode } from '../protocol/AsimovStateProtocol';
import { CameraMode } from '../renderer/SceneManager';
import { GlobalConnectionState } from '../app/navigation/AppStateMachine';
import { InterpolatedRobotPose } from '../synchronization/StateBuffer';
import { RemoteCameraSurface } from '../cameras/RemoteCameraSurface';
import { TeleopSessionManager } from '../app/TeleopSessionManager';

export interface TeleopControlsOverlayProps {
  controller: TeleopController;
  teleopSession?: TeleopSessionManager;
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
  showDevHud?: boolean;
  onToggleDevHud?: () => void;
  onOrbitCamera?: (deltaAz: number, deltaEl: number) => void;
}

type DeckTab = 'modes' | 'emotes' | 'cameras' | 'environment' | 'system';

export const TeleopControlsOverlay: React.FC<TeleopControlsOverlayProps> = ({
  controller,
  teleopSession,
  currentCamera,
  onSelectCamera,
  connectionState,
  host,
  port,
  latestPose,
  rttMs = 0,
  packetRateHz = 0,
  onConnect,
  onDisconnect,
  onOpenSettings = () => {},
  onExitToHome = () => {},
  showDevHud = false,
  onToggleDevHud = () => {},
  onOrbitCamera,
}) => {
  // Main HUD & Deck Visibility
  const [isDeckOpen, setIsDeckOpen] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<DeckTab>('modes');

  // Robot Command & Motion State
  const [activeMode, setActiveMode] = useState<CommandType>(CommandType.STAND);
  const [, setCmdVelocities] = useState({ vx: 0, vy: 0, wz: 0 });
  const [speedProfile, setSpeedProfileState] = useState<SpeedProfile>('SPORT');
  const [isLocked, setIsLockedState] = useState<boolean>(false);
  const [lastEmoteStatus, setLastEmoteStatus] = useState<string | null>(null);

  // Sprint Mode & Speed Multiplier
  const [isSprint, setIsSprint] = useState<boolean>(controller.isSprint());

  // Right-screen control mode: Game D-Pad Arrows vs Yaw Joystick
  const [rightControlMode, setRightControlMode] = useState<'DPAD' | 'STICK'>('DPAD');

  // Secondary Remote Video Mode
  const [remoteViewMode, setRemoteViewMode] = useState<'PIP' | 'SPLIT' | 'HIDDEN'>('HIDDEN');

  // Environment State (Defaults to pair_lab)
  const [currentEnvData, setCurrentEnvData] = useState<any>(
    teleopSession?.getCurrentEnvironment() || { preset: 'pair_lab', name: 'pair_lab' }
  );

  // Full-screen camera touch & drag orbit tracking (multi-touch safe)
  const cameraTouchIdRef = useRef<string | number | null>(null);
  const cameraLastPosRef = useRef<{ x: number; y: number } | null>(null);

  const handleCameraTouchStart = (evt: any) => {
    if (evt.nativeEvent.changedTouches.length === 0) return;
    const touch = evt.nativeEvent.changedTouches[0];
    const { width, height } = Dimensions.get('window');
    const realW = Math.max(width, height);
    const realH = Math.min(width, height);

    // Safe zone: Ignore camera touches that land inside either bottom joystick area (left or right)
    const isLeftStickArea = touch.pageX < 240 && (touch.pageY > realH - 220 || touch.pageY > height - 220);
    const isRightStickArea = (touch.pageX > width - 240 || touch.pageX > realW - 240) && (touch.pageY > realH - 220 || touch.pageY > height - 220);
    if (isLeftStickArea || isRightStickArea) {
      return;
    }

    if (cameraTouchIdRef.current === null) {
      cameraTouchIdRef.current = touch.identifier;
      cameraLastPosRef.current = { x: touch.pageX, y: touch.pageY };
    }
  };

  const handleCameraTouchMove = (evt: any) => {
    if (cameraTouchIdRef.current === null || !cameraLastPosRef.current) return;
    const touches = evt.nativeEvent.touches;
    let touch = null;
    for (let i = 0; i < touches.length; i++) {
      if (touches[i].identifier === cameraTouchIdRef.current) {
        touch = touches[i];
        break;
      }
    }
    if (!touch) return;

    const dx = touch.pageX - cameraLastPosRef.current.x;
    const dy = touch.pageY - cameraLastPosRef.current.y;
    cameraLastPosRef.current = { x: touch.pageX, y: touch.pageY };

    if (onOrbitCamera && (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05)) {
      onOrbitCamera(dx * 0.0055, -dy * 0.0055);
    }
  };

  const handleCameraTouchEnd = (evt: any) => {
    if (cameraTouchIdRef.current === null) return;
    const changed = evt.nativeEvent.changedTouches;
    let ended = false;
    for (let i = 0; i < changed.length; i++) {
      if (changed[i].identifier === cameraTouchIdRef.current) {
        ended = true;
        break;
      }
    }
    if (ended || evt.nativeEvent.touches.length === 0) {
      cameraTouchIdRef.current = null;
      cameraLastPosRef.current = null;
    }
  };

  // Poll commanded velocities at ~10 Hz
  useEffect(() => {
    const timer = setInterval(() => {
      setCmdVelocities(controller.getTargetVelocities());
    }, 100);
    return () => clearInterval(timer);
  }, [controller]);

  // Subscribe to real-time environment changes from TeleopSessionManager
  useEffect(() => {
    if (teleopSession) {
      const unsub = teleopSession.addEnvironmentListener((env) => {
        setCurrentEnvData(env);
      });
      return unsub;
    }
  }, [teleopSession]);

  const handleSelectSpeedProfile = (profile: SpeedProfile) => {
    controller.setSpeedProfile(profile);
    setSpeedProfileState(profile);
  };

  const handleToggleLock = () => {
    const next = !isLocked;
    controller.setControlLock(next);
    setIsLockedState(next);
  };

  const handleCommand = (cmd: CommandType) => {
    setActiveMode(cmd);
    controller.triggerAction(cmd);
  };

  const handleTriggerEmote = async (emoteName: string) => {
    setLastEmoteStatus(`Sending: ${emoteName}...`);
    if (teleopSession) {
      const ok = await teleopSession.triggerEmote(emoteName);
      setLastEmoteStatus(ok ? `Playing: ${emoteName.toUpperCase()}` : `Failed: ${emoteName}`);
    } else {
      setLastEmoteStatus(`Dispatched: ${emoteName}`);
    }
    setTimeout(() => setLastEmoteStatus(null), 3000);
  };

  const handleLoadEnvironment = async (preset: string) => {
    if (teleopSession) {
      await teleopSession.setEnvironmentPreset(preset);
    }
  };

  const cycleCamera = () => {
    const cycle: CameraMode[] = ['third_person', 'orbit', 'first_person', 'front_inspection'];
    const idx = cycle.indexOf(currentCamera);
    const next = cycle[(idx + 1) % cycle.length];
    onSelectCamera(next);
  };

  const isConnected = connectionState === 'CONNECTED';
  const isInterrupted =
    connectionState === 'DISCONNECTED' ||
    connectionState === 'RECONNECTING' ||
    connectionState === 'FAILED';

  const robotMode = latestPose ? latestPose.robotMode : RobotMode.STAND;
  const robotModeLabel =
    robotMode === RobotMode.MOVE
      ? 'WALK'
      : robotMode === RobotMode.DAMP
      ? 'DAMP'
      : robotMode === RobotMode.FAULT_DAMP
      ? 'FAULT'
      : 'STAND';

  const currentEnvName = currentEnvData?.preset || currentEnvData?.name || 'pair_lab';

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      {/* Invisible Full-Screen Camera 360° Orbit Layer */}
      <View
        style={StyleSheet.absoluteFill}
        onTouchStart={handleCameraTouchStart}
        onTouchMove={handleCameraTouchMove}
        onTouchEnd={handleCameraTouchEnd}
        onTouchCancel={handleCameraTouchEnd}
      />

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* 1. TOP MINIMALIST STATUS BAR (Left Telemetry, Center Mode, Right Actions) */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <View style={styles.topBarContainer} pointerEvents="box-none">
        {/* Left: Telemetry Pill */}
        <View style={styles.telemetryPill}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: isConnected ? '#10b981' : isInterrupted ? '#ef4444' : '#f59e0b' },
            ]}
          />
          <Text style={styles.robotIdText}>ASIMOV 1</Text>
          <View style={styles.pillDivider} />
          <Text style={styles.modeBadgeText}>{robotModeLabel}</Text>
          <View style={styles.pillDivider} />
          <Text style={styles.metricText}>{Math.round(rttMs)}ms</Text>
          {packetRateHz > 0 && (
            <>
              <View style={styles.pillDivider} />
              <Text style={styles.metricText}>{Math.round(packetRateHz)}Hz</Text>
            </>
          )}
        </View>

        {/* Center: Camera Mode Quick Switcher */}
        <View style={styles.topCenterCluster}>
          <TouchableOpacity style={styles.cameraPill} onPress={cycleCamera} activeOpacity={0.75}>
            <Text style={styles.cameraPillIcon}>🎥</Text>
            <Text style={styles.cameraPillText}>{currentCamera.toUpperCase()}</Text>
          </TouchableOpacity>
        </View>

        {/* Right: Low-profile E-STOP pill + CONTROLS deck button */}
        <View style={styles.topRightCluster}>
          <TouchableOpacity
            style={styles.topEstopButton}
            onPress={() => handleCommand(CommandType.ESTOP)}
            activeOpacity={0.75}
          >
            <Text style={styles.topEstopText}>🛑 STOP</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cornerMenuButton}
            onPress={() => setIsDeckOpen(true)}
            activeOpacity={0.8}
          >
            <Text style={styles.cornerMenuIcon}>☰</Text>
            <Text style={styles.cornerMenuText}>CONTROLS</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* 2. OPTIONAL PIP SECONDARY VIDEO SURFACE */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <RemoteCameraSurface
        host={host}
        port={port}
        viewMode={remoteViewMode}
        onClose={() => setRemoteViewMode('HIDDEN')}
        onToggleViewMode={() => setRemoteViewMode((m) => (m === 'PIP' ? 'SPLIT' : 'PIP'))}
      />

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* 3. CONNECTION INTERRUPTED WARNING BANNER */}
      {/* ────────────────────────────────────────────────────────────────────── */}
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

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* 4. CLEAN VIEWPORT (ZERO BUTTONS IN CENTER!) */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      {lastEmoteStatus && (
        <View style={styles.emoteStatusFloatingBadge} pointerEvents="none">
          <Text style={styles.emoteStatusText}>{lastEmoteStatus}</Text>
        </View>
      )}

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* 5. BOTTOM TELEOPERATION SURFACE (Left Stick + GTA Pan or Right Stick) */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <View style={styles.bottomSurface} pointerEvents="box-none">
        {/* Left Control: Game Arcade Joystick + Sprint / Turbo Toggle */}
        <View style={styles.joystickSlot}>
          <TouchableOpacity
            style={[styles.sprintButton, isSprint && styles.sprintButtonActive]}
            onPress={() => {
              const next = controller.toggleSprint();
              setIsSprint(next);
            }}
            activeOpacity={0.75}
          >
            <Text style={[styles.sprintButtonText, isSprint && styles.sprintButtonTextActive]}>
              {isSprint ? '⚡ SPRINT: ACTIVE' : '⚡ SPRINT: OFF'}
            </Text>
          </TouchableOpacity>

          <Text style={styles.joystickSubtext}>MOVEMENT & STEERING</Text>
          <VirtualJoystick
            size={136}
            knobSize={52}
            accentColor="#38bdf8"
            onMove={(normX, normY) => controller.updateLeftJoystick(normX, normY)}
            onRelease={() => controller.releaseLeftJoystick()}
          />
        </View>

        {/* Right Control: Directional Arrows (D-Pad) for standard movement + Joystick toggle */}
        <View style={styles.rightControlSlot}>
          <View style={styles.rightControlHeader}>
            <Text style={styles.joystickSubtext}>
              {rightControlMode === 'DPAD' ? 'ARROW CONTROLS' : 'YAW ROTATION'}
            </Text>
            <TouchableOpacity
              style={styles.switchModePill}
              onPress={() => setRightControlMode((m) => (m === 'DPAD' ? 'STICK' : 'DPAD'))}
              activeOpacity={0.7}
            >
              <Text style={styles.switchModeText}>
                {rightControlMode === 'DPAD' ? '🕹️ STICK' : '🎮 D-PAD'}
              </Text>
            </TouchableOpacity>
          </View>

          {rightControlMode === 'DPAD' ? (
            <View style={styles.dpadContainer}>
              {/* Up Button */}
              <View style={styles.dpadRow}>
                <TouchableOpacity
                  style={styles.dpadButton}
                  onPressIn={() => controller.updateDpad('up', true)}
                  onPressOut={() => controller.updateDpad('up', false)}
                  activeOpacity={0.6}
                >
                  <Text style={styles.dpadArrow}>▲</Text>
                  <Text style={styles.dpadLabel}>FWD</Text>
                </TouchableOpacity>
              </View>

              {/* Middle Row: Left, Stop/Stand, Right */}
              <View style={styles.dpadRow}>
                <TouchableOpacity
                  style={styles.dpadButton}
                  onPressIn={() => controller.updateDpad('left', true)}
                  onPressOut={() => controller.updateDpad('left', false)}
                  activeOpacity={0.6}
                >
                  <Text style={styles.dpadArrow}>◀</Text>
                  <Text style={styles.dpadLabel}>LEFT</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.dpadButton, styles.dpadCenterButton]}
                  onPress={() => {
                    controller.releaseDpad();
                    controller.forceZeroVelocity();
                  }}
                  activeOpacity={0.6}
                >
                  <Text style={styles.dpadCenterDot}>●</Text>
                  <Text style={styles.dpadLabel}>STOP</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.dpadButton}
                  onPressIn={() => controller.updateDpad('right', true)}
                  onPressOut={() => controller.updateDpad('right', false)}
                  activeOpacity={0.6}
                >
                  <Text style={styles.dpadArrow}>▶</Text>
                  <Text style={styles.dpadLabel}>RIGHT</Text>
                </TouchableOpacity>
              </View>

              {/* Bottom Row: Down */}
              <View style={styles.dpadRow}>
                <TouchableOpacity
                  style={styles.dpadButton}
                  onPressIn={() => controller.updateDpad('down', true)}
                  onPressOut={() => controller.updateDpad('down', false)}
                  activeOpacity={0.6}
                >
                  <Text style={styles.dpadArrow}>▼</Text>
                  <Text style={styles.dpadLabel}>REV</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <VirtualJoystick
              size={136}
              knobSize={52}
              accentColor="#818cf8"
              onMove={(normX, normY) => controller.updateRightJoystick(normX, normY)}
              onRelease={() => controller.releaseRightJoystick()}
            />
          )}
        </View>
      </View>

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* 6. TRANSPARENT MINIMALIST CONTROL DECK (Modal Sheet) */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <Modal
        visible={isDeckOpen}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsDeckOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.deckContainer}>
            {/* Deck Header */}
            <View style={styles.deckHeader}>
              <View>
                <Text style={styles.deckTitle}>OPERATOR CONTROL DECK</Text>
                <Text style={styles.deckSubtitle}>
                  VASIMOV @ {host}:{port} • Arena: {currentEnvName.toUpperCase()}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.closeDeckButton}
                onPress={() => setIsDeckOpen(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.closeDeckText}>✕ CLOSE</Text>
              </TouchableOpacity>
            </View>

            {/* Tab Bar */}
            <View style={styles.deckTabBar}>
              {[
                { id: 'modes', label: '🤖 MODES' },
                { id: 'emotes', label: '🎭 EMOTES' },
                { id: 'cameras', label: '🎥 CAMERAS' },
                { id: 'environment', label: '🌐 ARENA' },
                { id: 'system', label: '⚙️ SYSTEM' },
              ].map((tab) => (
                <TouchableOpacity
                  key={tab.id}
                  style={[styles.deckTabItem, activeTab === tab.id && styles.deckTabItemActive]}
                  onPress={() => setActiveTab(tab.id as DeckTab)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.deckTabText,
                      activeTab === tab.id && styles.deckTabTextActive,
                    ]}
                  >
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Tab Content (Scrollable & Never Cut Off) */}
            <ScrollView style={styles.deckBody} contentContainerStyle={styles.deckBodyContent}>
              {/* TAB 1: MODES & SPEED */}
              {activeTab === 'modes' && (
                <View style={styles.tabSection}>
                  <Text style={styles.sectionHeading}>PRIMARY ROBOT ACTIONS</Text>
                  <View style={styles.gridRow}>
                    <TouchableOpacity
                      style={[styles.actionCard, activeMode === CommandType.STAND && styles.actionCardActive]}
                      onPress={() => handleCommand(CommandType.STAND)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.actionCardIcon}>🧍</Text>
                      <Text style={styles.actionCardTitle}>STAND</Text>
                      <Text style={styles.actionCardDesc}>Nominal stance</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.actionCard, activeMode === CommandType.WALK && styles.actionCardActive]}
                      onPress={() => handleCommand(CommandType.WALK)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.actionCardIcon}>🚶</Text>
                      <Text style={styles.actionCardTitle}>WALK</Text>
                      <Text style={styles.actionCardDesc}>Locomotion ready</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.actionCard, activeMode === CommandType.CROUCH && styles.actionCardActive]}
                      onPress={() => handleCommand(CommandType.CROUCH)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.actionCardIcon}>🧘</Text>
                      <Text style={styles.actionCardTitle}>CROUCH</Text>
                      <Text style={styles.actionCardDesc}>Low-profile stance</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.actionCard, styles.actionCardRecovery]}
                      onPress={() => handleCommand(CommandType.RECOVERY)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.actionCardIcon}>⚡</Text>
                      <Text style={[styles.actionCardTitle, { color: '#f59e0b' }]}>GET-UP</Text>
                      <Text style={styles.actionCardDesc}>Recovery kinematic</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.actionCard}
                      onPress={() => handleCommand(CommandType.DAMP)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.actionCardIcon}>🛡️</Text>
                      <Text style={styles.actionCardTitle}>DAMP</Text>
                      <Text style={styles.actionCardDesc}>Passive damping</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.actionCard}
                      onPress={() => handleCommand(CommandType.RESET)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.actionCardIcon}>🔄</Text>
                      <Text style={styles.actionCardTitle}>RESET</Text>
                      <Text style={styles.actionCardDesc}>Restart simulation</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.actionCard, styles.actionCardEstop]}
                      onPress={() => handleCommand(CommandType.ESTOP)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.actionCardIcon}>🛑</Text>
                      <Text style={[styles.actionCardTitle, { color: '#ef4444' }]}>E - STOP</Text>
                      <Text style={styles.actionCardDesc}>Emergency shutdown</Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={[styles.sectionHeading, { marginTop: 18 }]}>VELOCITY SCALING & SAFETY</Text>
                  <View style={styles.optionRow}>
                    {(['PRECISION', 'NORMAL', 'SPORT'] as SpeedProfile[]).map((prof) => (
                      <TouchableOpacity
                        key={prof}
                        style={[styles.pillOption, speedProfile === prof && styles.pillOptionActive]}
                        onPress={() => handleSelectSpeedProfile(prof)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.pillOptionText, speedProfile === prof && styles.pillOptionTextActive]}>
                          {prof}
                        </Text>
                      </TouchableOpacity>
                    ))}

                    <TouchableOpacity
                      style={[styles.pillOption, isLocked && styles.pillOptionLocked]}
                      onPress={handleToggleLock}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.pillOptionText, isLocked && { color: '#ef4444' }]}>
                        {isLocked ? '🔒 LOCKED' : '🔓 UNLOCKED'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* TAB 2: EMOTES & GESTURES */}
              {activeTab === 'emotes' && (
                <View style={styles.tabSection}>
                  <Text style={styles.sectionHeading}>EXPRESSIVE ROBOT GESTURES & EMOTES</Text>
                  <View style={styles.gridRow}>
                    {[
                      { id: 'hello', name: 'WAVE / HELLO', icon: '👋', desc: 'Raise right hand and wave' },
                      { id: 'bow', name: 'BOW', icon: '🙇', desc: 'Respectful formal bow' },
                      { id: 'squat', name: 'DEEP SQUAT', icon: '🏋️', desc: 'Leg articulation crouch' },
                      { id: 'cheer', name: 'CHEER', icon: '🙌', desc: 'Dual-arm celebratory cheer' },
                      { id: 'dance', name: 'DANCE', icon: '🕺', desc: 'Rhythmic torso and arm sway' },
                      { id: 'nod', name: 'NOD YES', icon: '🤖', desc: 'Affirmative head nod' },
                      { id: 'shake', name: 'SHAKE NO', icon: '🙅', desc: 'Negative head shake' },
                      { id: 'stop', name: 'NEUTRAL POSE', icon: '🛑', desc: 'Return arms to neutral' },
                    ].map((emote) => (
                      <TouchableOpacity
                        key={emote.id}
                        style={styles.actionCard}
                        onPress={() => handleTriggerEmote(emote.id)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.actionCardIcon}>{emote.icon}</Text>
                        <Text style={styles.actionCardTitle}>{emote.name}</Text>
                        <Text style={styles.actionCardDesc}>{emote.desc}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {/* TAB 3: CAMERAS & VIDEO */}
              {activeTab === 'cameras' && (
                <View style={styles.tabSection}>
                  <Text style={styles.sectionHeading}>3D PERSPECTIVES</Text>
                  <View style={styles.gridRow}>
                    {[
                      { id: 'third_person', name: 'ORBIT / FREE LOOK', icon: '🌐', desc: '360° touch free look' },
                      { id: 'orbit', name: 'CINEMATIC ORBIT', icon: '🔄', desc: 'Continuous smooth orbit' },
                      { id: 'first_person', name: 'FPV EYE-LEVEL', icon: '👁️', desc: 'Mounted to robot head' },
                      { id: 'front_inspection', name: 'FRONTAL', icon: '🧍', desc: 'Inspects robot face and torso' },
                    ].map((cam) => (
                      <TouchableOpacity
                        key={cam.id}
                        style={[styles.actionCard, currentCamera === cam.id && styles.actionCardActive]}
                        onPress={() => onSelectCamera(cam.id as CameraMode)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.actionCardIcon}>{cam.icon}</Text>
                        <Text style={styles.actionCardTitle}>{cam.name}</Text>
                        <Text style={styles.actionCardDesc}>{cam.desc}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={[styles.sectionHeading, { marginTop: 18 }]}>REMOTE VIDEO STREAM</Text>
                  <View style={styles.optionRow}>
                    {[
                      { mode: 'HIDDEN', label: 'OFF' },
                      { mode: 'PIP', label: 'PICTURE-IN-PICTURE' },
                      { mode: 'SPLIT', label: 'SPLIT SCREEN' },
                    ].map((opt) => (
                      <TouchableOpacity
                        key={opt.mode}
                        style={[styles.pillOption, remoteViewMode === opt.mode && styles.pillOptionActive]}
                        onPress={() => setRemoteViewMode(opt.mode as any)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.pillOptionText, remoteViewMode === opt.mode && styles.pillOptionTextActive]}>
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {/* TAB 4: ENVIRONMENT & ARENA (LIVE SYNC WITH PC) */}
              {activeTab === 'environment' && (
                <View style={styles.tabSection}>
                  <Text style={styles.sectionHeading}>
                    ARENA PRESET (REAL-TIME SYNC WITH VASIMOV PC)
                  </Text>
                  <View style={styles.activeEnvBanner}>
                    <Text style={styles.activeEnvBannerLabel}>ACTIVE ON SIMULATION:</Text>
                    <Text style={styles.activeEnvBannerValue}>{currentEnvName.toUpperCase()}</Text>
                    {currentEnvData?.ground_friction !== undefined && (
                      <Text style={styles.activeEnvBannerDetails}>
                        Friction μ={currentEnvData.ground_friction} • Obstacles: {currentEnvData?.obstacle_count ?? 0}
                      </Text>
                    )}
                  </View>

                  <View style={styles.gridRow}>
                    {[
                      { id: 'pair_lab', name: 'PAIR LAB (DEFAULT)', icon: '🏛️', desc: 'Real MuJoCo lab with desks, chairs & cubes' },
                      { id: 'flat', name: 'FLAT GROUND', icon: '🟦', desc: 'Standard plane (friction μ=1.0)' },
                      { id: 'obstacles', name: 'DYNAMIC OBSTACLES', icon: '🟧', desc: 'Movable boxes, rolling ball, trip bar' },
                      { id: 'playground', name: 'PLAYGROUND ARENA', icon: '🟪', desc: 'Multi-shape interactive arena' },
                      { id: 'friction_low', name: 'LOW FRICTION ICE', icon: '🧊', desc: 'Slippery ice surface (μ=0.1)' },
                    ].map((preset) => (
                      <TouchableOpacity
                        key={preset.id}
                        style={[styles.actionCard, currentEnvName === preset.id && styles.actionCardActive]}
                        onPress={() => handleLoadEnvironment(preset.id)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.actionCardIcon}>{preset.icon}</Text>
                        <Text style={styles.actionCardTitle}>{preset.name}</Text>
                        <Text style={styles.actionCardDesc}>{preset.desc}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <TouchableOpacity
                    style={styles.syncButton}
                    onPress={() => teleopSession?.startEnvironmentSync()}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.syncButtonText}>🔄 RE-POLL ENVIRONMENT FROM PC</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* TAB 5: SYSTEM & SETTINGS */}
              {activeTab === 'system' && (
                <View style={styles.tabSection}>
                  <Text style={styles.sectionHeading}>OPERATOR SYSTEM & DIAGNOSTICS</Text>

                  <View style={styles.systemRow}>
                    <TouchableOpacity
                      style={[styles.systemButton, showDevHud && styles.systemButtonActive]}
                      onPress={onToggleDevHud}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.systemButtonText}>
                        {showDevHud ? '🟢 DEV HUD: VISIBLE' : '⚪ DEV HUD: HIDDEN'}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.systemButton}
                      onPress={onOpenSettings}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.systemButtonText}>⚙️ SETTINGS MODAL</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={[styles.systemRow, { marginTop: 12 }]}>
                    <TouchableOpacity
                      style={[styles.systemButton, { borderColor: '#ef4444' }]}
                      onPress={onDisconnect}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.systemButtonText, { color: '#ef4444' }]}>
                        🔌 DISCONNECT
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.systemButton, { borderColor: '#38bdf8' }]}
                      onPress={onExitToHome}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.systemButtonText, { color: '#38bdf8' }]}>
                        🏠 RETURN TO HOME
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </ScrollView>
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

  // 1. TOP STATUS BAR
  topBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    zIndex: 20,
  },
  telemetryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(8, 14, 26, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  robotIdText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    fontFamily: 'monospace',
  },
  pillDivider: {
    width: 1,
    height: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    marginHorizontal: 8,
  },
  modeBadgeText: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    fontFamily: 'monospace',
  },
  metricText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'monospace',
  },

  topCenterCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  gtaTogglePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderWidth: 1,
    borderColor: '#38bdf8',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  gtaToggleIcon: {
    fontSize: 12,
    marginRight: 5,
  },
  gtaToggleText: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.6,
  },

  cameraPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(8, 14, 26, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  cameraPillIcon: {
    fontSize: 12,
    marginRight: 6,
  },
  cameraPillText: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 0.6,
  },

  topRightCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  topEstopButton: {
    backgroundColor: '#dc2626',
    borderWidth: 1.5,
    borderColor: '#ef4444',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  topEstopText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 0.8,
  },

  cornerMenuButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(2, 132, 199, 0.90)',
    borderWidth: 1,
    borderColor: '#38bdf8',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  cornerMenuIcon: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
    marginRight: 6,
  },
  cornerMenuText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.8,
  },

  // 2. WARNING BANNER
  warningBannerContainer: {
    alignItems: 'center',
    marginHorizontal: 20,
    zIndex: 10,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.90)',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  warningDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ffffff',
    marginRight: 8,
  },
  warningText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  reconnectBtn: {
    backgroundColor: '#ffffff',
    borderRadius: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
    marginLeft: 8,
  },
  reconnectBtnText: {
    color: '#ef4444',
    fontSize: 9,
    fontWeight: '800',
    fontFamily: 'monospace',
  },

  emoteStatusFloatingBadge: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    backgroundColor: 'rgba(14, 165, 233, 0.3)',
    borderColor: '#38bdf8',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 4,
    paddingHorizontal: 14,
    zIndex: 15,
  },
  emoteStatusText: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
  },

  // 3. BOTTOM TELEOPERATION SURFACE
  bottomSurface: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingBottom: 20,
    zIndex: 50,
  },
  joystickSlot: {
    alignItems: 'center',
    zIndex: 60,
  },
  joystickSubtext: {
    color: '#94a3b8',
    fontSize: 9,
    fontFamily: 'monospace',
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 6,
  },

  // Sprint / Turbo Button Style
  sprintButton: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 14,
    paddingVertical: 5,
    paddingHorizontal: 12,
    marginBottom: 6,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
  },
  sprintButtonActive: {
    backgroundColor: 'rgba(245, 158, 11, 0.35)',
    borderColor: '#f59e0b',
    shadowColor: '#f59e0b',
    shadowOpacity: 0.8,
    shadowRadius: 6,
  },
  sprintButtonText: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  sprintButtonTextActive: {
    color: '#fbbf24',
    textShadowColor: 'rgba(245, 158, 11, 0.6)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },

  // Right Control Slot & D-Pad Styles
  rightControlSlot: {
    alignItems: 'center',
    zIndex: 60,
  },
  rightControlHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 6,
  },
  switchModePill: {
    backgroundColor: 'rgba(30, 41, 59, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    borderRadius: 10,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  switchModeText: {
    color: '#38bdf8',
    fontSize: 8,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  dpadContainer: {
    width: 140,
    height: 140,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dpadRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dpadButton: {
    width: 44,
    height: 44,
    backgroundColor: 'rgba(15, 23, 42, 0.90)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.35)',
    borderRadius: 10,
    margin: 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
  },
  dpadCenterButton: {
    backgroundColor: 'rgba(30, 41, 59, 0.85)',
    borderColor: 'rgba(239, 68, 68, 0.4)',
  },
  dpadArrow: {
    color: '#38bdf8',
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 18,
  },
  dpadLabel: {
    color: '#94a3b8',
    fontSize: 8,
    fontWeight: '700',
    fontFamily: 'monospace',
    marginTop: -1,
  },
  dpadCenterDot: {
    color: '#ef4444',
    fontSize: 14,
    lineHeight: 16,
  },

  // GTA Free-look Touch Surface (Right side of screen)
  gtaTouchSurface: {
    width: '45%',
    height: 140,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(56, 189, 248, 0.25)',
    borderRadius: 16,
    backgroundColor: 'rgba(8, 14, 26, 0.30)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  gtaHintBadge: {
    backgroundColor: 'rgba(15, 23, 42, 0.70)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  gtaHintText: {
    color: '#94a3b8',
    fontSize: 9,
    fontFamily: 'monospace',
    fontWeight: '700',
    letterSpacing: 0.8,
  },

  // 4. MODAL CONTROL DECK (FULL SCREEN & EXPANDED)
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(3, 7, 18, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  deckContainer: {
    width: '95%',
    maxWidth: 720,
    height: '92%',
    maxHeight: '94%',
    backgroundColor: 'rgba(9, 14, 26, 0.96)',
    borderWidth: 1.5,
    borderColor: 'rgba(56, 189, 248, 0.35)',
    borderRadius: 16,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  deckHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  deckTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.8,
  },
  deckSubtitle: {
    color: '#94a3b8',
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  closeDeckButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  closeDeckText: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
  },

  deckTabBar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  deckTabItem: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  deckTabItemActive: {
    borderBottomColor: '#38bdf8',
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
  },
  deckTabText: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  deckTabTextActive: {
    color: '#ffffff',
  },

  deckBody: {
    flex: 1,
    width: '100%',
  },
  deckBodyContent: {
    padding: 16,
    paddingBottom: 36,
  },
  tabSection: {
    width: '100%',
  },
  sectionHeading: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    fontFamily: 'monospace',
    marginBottom: 10,
  },
  gridRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  actionCard: {
    width: '31%',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  actionCardActive: {
    borderColor: '#38bdf8',
    backgroundColor: 'rgba(2, 132, 199, 0.3)',
  },
  actionCardRecovery: {
    borderColor: 'rgba(245, 158, 11, 0.4)',
  },
  actionCardEstop: {
    borderColor: 'rgba(239, 68, 68, 0.5)',
    backgroundColor: 'rgba(220, 38, 38, 0.15)',
  },
  actionCardIcon: {
    fontSize: 18,
    marginBottom: 4,
  },
  actionCardTitle: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  actionCardDesc: {
    color: '#94a3b8',
    fontSize: 9,
    fontFamily: 'monospace',
    textAlign: 'center',
    marginTop: 2,
  },

  optionRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  pillOption: {
    flex: 1,
    minWidth: 90,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  pillOptionActive: {
    borderColor: '#38bdf8',
    backgroundColor: 'rgba(2, 132, 199, 0.35)',
  },
  pillOptionLocked: {
    borderColor: '#ef4444',
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  pillOptionText: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  pillOptionTextActive: {
    color: '#ffffff',
  },

  activeEnvBanner: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderColor: 'rgba(56, 189, 248, 0.3)',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  activeEnvBannerLabel: {
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  activeEnvBannerValue: {
    color: '#38bdf8',
    fontSize: 14,
    fontWeight: '900',
    fontFamily: 'monospace',
    marginTop: 2,
  },
  activeEnvBannerDetails: {
    color: '#cbd5e1',
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 4,
  },

  syncButton: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderWidth: 1,
    borderColor: '#38bdf8',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 6,
  },
  syncButtonText: {
    color: '#38bdf8',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.6,
  },

  systemRow: {
    flexDirection: 'row',
    gap: 10,
  },
  systemButton: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  systemButtonActive: {
    borderColor: '#10b981',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  systemButtonText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
});
