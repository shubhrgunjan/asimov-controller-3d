import React, { useRef, useState, useEffect, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GLView, ExpoWebGLRenderingContext } from 'expo-gl';
import { ThreeRenderer } from '../renderer/ThreeRenderer';
import { BenchmarkController } from '../benchmark/BenchmarkController';
import { BenchmarkHUD } from './BenchmarkHUD';
import { BenchmarkControls } from './BenchmarkControls';
import { DiagnosticsHUD } from '../diagnostics/DiagnosticsHUD';
import { TeleopControlsOverlay } from '../controls/TeleopControlsOverlay';
import { CameraMode } from '../renderer/SceneManager';
import { AppStateMachine, AppScreen, GlobalConnectionState } from './navigation/AppStateMachine';
import { HomeScreen } from './screens/HomeScreen';
import { ConnectingOverlay } from './screens/ConnectingOverlay';
import { SettingsModal } from './screens/SettingsModal';
import { appSettings, AppConfig } from '../settings/AppSettings';

export default function App() {
  const [controller, setController] = useState<BenchmarkController | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // Application State Machine & Settings
  const stateMachineRef = useRef<AppStateMachine>(new AppStateMachine('HOME'));
  const [currentScreen, setCurrentScreen] = useState<AppScreen>('HOME');
  const [connectionState, setConnectionState] = useState<GlobalConnectionState>('DISCONNECTED');
  const [appConfig, setAppConfig] = useState<AppConfig>(appSettings.getConfig());

  const controllerRef = useRef<BenchmarkController | null>(null);

  // Subscribe to State Machine & Settings Store
  useEffect(() => {
    const unsubSM = stateMachineRef.current.subscribe((snapshot) => {
      setCurrentScreen(snapshot.screen);
      setConnectionState(snapshot.connectionState);
    });

    const unsubSettings = appSettings.subscribe((config) => {
      setAppConfig(config);
      if (controllerRef.current) {
        // Sync resolution if changed
        if (controllerRef.current.renderer.getResolutionMode() !== config.rendering.resolution) {
          controllerRef.current.setResolution(config.rendering.resolution);
        }
        // Sync buffer delay
        controllerRef.current.teleopSession.setInterpolationDelay(
          config.synchronization.interpolationDelayMs
        );
      }
    });

    return () => {
      unsubSM();
      unsubSettings();
    };
  }, []);

  const handleContextCreate = useCallback((gl: ExpoWebGLRenderingContext) => {
    try {
      const config = appSettings.getConfig();
      const renderer = new ThreeRenderer(gl);
      renderer.setResolution(config.rendering.resolution);
      renderer.setShadows(config.rendering.shadowsEnabled);

      const bController = new BenchmarkController(renderer);

      // Default to live teleoperation mode for Phase 4
      bController.setAppMode('TELEOP');
      bController.scene.loadLevel('ASIMOV_ARTICULATED');
      bController.sceneManager.setCameraMode(config.rendering.defaultCameraMode);
      bController.teleopSession.setInterpolationDelay(config.synchronization.interpolationDelayMs);

      controllerRef.current = bController;
      setController(bController);

      // Wire StateTransportClient connection changes into the AppStateMachine
      const unsubConn = bController.teleopSession.addConnectionListener((state) => {
        stateMachineRef.current.setConnectionState(state);
      });

      // UI throttle trigger for telemetry changes
      const unsubscribe = bController.subscribe(() => {
        setTick((t) => (t + 1) % 10000);
      });

      // Start the Three.js 60 FPS render loop
      bController.start();

      return () => {
        unsubConn();
        unsubscribe();
        bController.dispose();
      };
    } catch (err) {
      console.error('Failed to initialize 3D teleop renderer:', err);
      setInitError((err as Error)?.message || 'Renderer initialization error');
    }
  }, []);

  useEffect(() => {
    return () => {
      if (controllerRef.current) {
        controllerRef.current.dispose();
      }
    };
  }, []);

  // Handlers for Operator Actions
  const handleConnect = (host: string, port: number) => {
    if (!controllerRef.current) return;
    appSettings.updateConnection({ host, port });
    controllerRef.current.teleopSession.updateServerAddress(host, port);
    stateMachineRef.current.setConnectionState('CONNECTING');
    controllerRef.current.teleopSession.connect();
  };

  const handleDisconnect = () => {
    if (!controllerRef.current) return;
    controllerRef.current.teleopSession.disconnect();
    stateMachineRef.current.setConnectionState('DISCONNECTED');
  };

  const handleCancelConnection = () => {
    handleDisconnect();
    stateMachineRef.current.navigate('HOME');
  };

  const currentCamera = (
    controller ? controller.sceneManager.getCameraMode() : 'third_person'
  ) as CameraMode;

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      {/* Hardware Accelerated Native OpenGL ES Surface */}
      <GLView style={StyleSheet.absoluteFill} onContextCreate={handleContextCreate} />

      {/* 1. SCREEN: HOME (Operator Landing Screen) */}
      {currentScreen === 'HOME' && (
        <HomeScreen
          connectionState={connectionState}
          host={appConfig.connection.host}
          port={appConfig.connection.port}
          errorMessage={stateMachineRef.current.getErrorMessage()}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          onEnterTeleop={() => stateMachineRef.current.navigate('TELEOPERATION')}
          onOpenSettings={() => stateMachineRef.current.navigate('SETTINGS')}
          onOpenBenchmark={() => {
            if (controller) controller.setAppMode('BENCHMARK');
            stateMachineRef.current.navigate('BENCHMARK');
          }}
        />
      )}

      {/* 2. OVERLAY: CONNECTING / RECONNECTING */}
      {currentScreen === 'CONNECTING' && (
        <ConnectingOverlay
          connectionState={connectionState}
          host={appConfig.connection.host}
          port={appConfig.connection.port}
          onCancel={handleCancelConnection}
        />
      )}

      {/* 3. SCREEN: LIVE TELEOPERATION */}
      {currentScreen === 'TELEOPERATION' && controller && (
        <>
          {/* Optional Developer Diagnostics HUD (toggled via settings) */}
          {appConfig.diagnostics.showDevHud && (
            <DiagnosticsHUD
              collector={controller.teleopSession.diagnostics}
              getLatestPose={() => controller.teleopSession.getLatestPose()}
              initialExpanded={false}
            />
          )}

          {/* Full Interactive Teleoperation Controls & Status Overlay */}
          <TeleopControlsOverlay
            controller={controller.teleopSession.teleop}
            currentCamera={currentCamera}
            onSelectCamera={(mode) => controller.sceneManager.setCameraMode(mode, undefined, undefined, true)}
            connectionState={connectionState}
            host={controller.teleopSession.client.getMetrics().host}
            port={controller.teleopSession.client.getMetrics().port}
            latestPose={controller.teleopSession.getLatestPose()}
            rttMs={controller.teleopSession.client.getMetrics().rttMs}
            packetRateHz={controller.teleopSession.client.getMetrics().packetRateHz}
            onConnect={() => controller.teleopSession.connect()}
            onDisconnect={handleDisconnect}
            onOpenSettings={() => stateMachineRef.current.navigate('SETTINGS')}
            onExitToHome={() => stateMachineRef.current.navigate('HOME')}
          />
        </>
      )}

      {/* 4. MODAL: SETTINGS */}
      {currentScreen === 'SETTINGS' && (
        <SettingsModal
          settings={appSettings}
          onClose={() => stateMachineRef.current.goBack()}
        />
      )}

      {/* 5. SCREEN: BENCHMARK SUITE (Phases 1 & 2 Legacy) */}
      {currentScreen === 'BENCHMARK' && controller && (
        <>
          <View style={styles.benchmarkExitContainer} pointerEvents="box-none">
            <TouchableOpacity
              style={styles.benchmarkExitButton}
              onPress={() => {
                controller.setAppMode('TELEOP');
                controller.scene.loadLevel('ASIMOV_ARTICULATED');
                stateMachineRef.current.navigate('HOME');
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.benchmarkExitText}>← EXIT BENCHMARK TO OPERATOR HOME</Text>
            </TouchableOpacity>
          </View>
          <BenchmarkHUD controller={controller} />
          <BenchmarkControls controller={controller} />
        </>
      )}

      {/* Initialization Fallback */}
      {initError && (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorTitle}>RENDERER INIT FAILED</Text>
          <Text style={styles.errorText}>{initError}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#070a10',
  },
  benchmarkExitContainer: {
    position: 'absolute',
    top: 36,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100,
  },
  benchmarkExitButton: {
    backgroundColor: '#0284c7',
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#38bdf8',
  },
  benchmarkExitText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.8,
  },
  errorOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorTitle: {
    color: '#ef4444',
    fontSize: 16,
    fontFamily: 'monospace',
    fontWeight: '700',
    marginBottom: 8,
  },
  errorText: {
    color: '#f8fafc',
    fontSize: 12,
    fontFamily: 'monospace',
    textAlign: 'center',
  },
});
