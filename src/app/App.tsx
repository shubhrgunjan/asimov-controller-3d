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

export default function App() {
  const [controller, setController] = useState<BenchmarkController | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const controllerRef = useRef<BenchmarkController | null>(null);

  const handleContextCreate = useCallback((gl: ExpoWebGLRenderingContext) => {
    try {
      const renderer = new ThreeRenderer(gl);
      const bController = new BenchmarkController(renderer);

      // Default to live teleoperation mode for Phase 3
      bController.setAppMode('TELEOP');
      bController.scene.loadLevel('ASIMOV_ARTICULATED');
      bController.sceneManager.setCameraMode('third_person');

      controllerRef.current = bController;
      setController(bController);

      // Force UI updates when controller notifies (throttled at 10Hz inside controller)
      const unsubscribe = bController.subscribe(() => {
        setTick((t) => (t + 1) % 10000);
      });

      // Start the Three.js 60 FPS render loop
      bController.start();

      // Initiate connection to authoritative VASIMOV backend
      bController.teleopSession.connect();

      return () => {
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

  const appMode = controller ? controller.getAppMode() : 'TELEOP';
  const currentCamera = (controller ? controller.sceneManager.getCurrentCameraMode() : 'third_person') as CameraMode;

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      {/* Hardware Accelerated Native OpenGL ES Surface */}
      <GLView style={StyleSheet.absoluteFill} onContextCreate={handleContextCreate} />

      {/* Global Mode Switcher Pill (Top Center) */}
      {controller && (
        <View style={styles.modeSwitcherContainer} pointerEvents="box-none">
          <View style={styles.modeSwitcherPill}>
            <TouchableOpacity
              style={[styles.modeTab, appMode === 'TELEOP' && styles.modeTabActive]}
              onPress={() => controller.setAppMode('TELEOP')}
              activeOpacity={0.7}
            >
              <Text style={[styles.modeTabText, appMode === 'TELEOP' && styles.modeTabTextActive]}>
                LIVE TELEOP
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeTab, appMode === 'BENCHMARK' && styles.modeTabActive]}
              onPress={() => controller.setAppMode('BENCHMARK')}
              activeOpacity={0.7}
            >
              <Text style={[styles.modeTabText, appMode === 'BENCHMARK' && styles.modeTabTextActive]}>
                BENCHMARK
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Mode A: LIVE TELEOPERATION (Phase 3) */}
      {controller && appMode === 'TELEOP' && (
        <>
          {/* Phase 3 Empirical Diagnostics HUD (Collapsible) */}
          <DiagnosticsHUD
            collector={controller.teleopSession.diagnostics}
            getLatestPose={() => controller.teleopSession.getLatestPose()}
            initialExpanded={false}
          />

          {/* Interactive Game-Like Teleoperation HUD Overlay */}
          <TeleopControlsOverlay
            controller={controller.teleopSession.teleop}
            currentCamera={currentCamera}
            onSelectCamera={(mode) => controller.sceneManager.setCameraMode(mode)}
            connectionState={controller.teleopSession.client.getMetrics().connectionState}
            host={controller.teleopSession.client.getMetrics().host}
            port={controller.teleopSession.client.getMetrics().port}
            onUpdateConnection={(host, port) => controller.teleopSession.updateServerAddress(host, port)}
            onConnect={() => controller.teleopSession.connect()}
            onDisconnect={() => controller.teleopSession.disconnect()}
          />
        </>
      )}

      {/* Mode B: BENCHMARK SUITE (Phases 1 & 2) */}
      {controller && appMode === 'BENCHMARK' && (
        <>
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
    backgroundColor: '#0a0e14',
  },
  modeSwitcherContainer: {
    position: 'absolute',
    top: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100,
  },
  modeSwitcherPill: {
    flexDirection: 'row',
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderRadius: 20,
    padding: 3,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  modeTab: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  modeTabActive: {
    backgroundColor: '#0284c7',
  },
  modeTabText: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  modeTabTextActive: {
    color: '#ffffff',
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
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
