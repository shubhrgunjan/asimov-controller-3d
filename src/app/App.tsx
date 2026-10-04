import React, { useRef, useState, useEffect, useCallback } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GLView, ExpoWebGLRenderingContext } from 'expo-gl';
import { ThreeRenderer } from '../renderer/ThreeRenderer';
import { BenchmarkController } from '../benchmark/BenchmarkController';
import { BenchmarkHUD } from './BenchmarkHUD';
import { BenchmarkControls } from './BenchmarkControls';

export default function App() {
  const [controller, setController] = useState<BenchmarkController | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const controllerRef = useRef<BenchmarkController | null>(null);

  const handleContextCreate = useCallback((gl: ExpoWebGLRenderingContext) => {
    try {
      const renderer = new ThreeRenderer(gl);
      const bController = new BenchmarkController(renderer);

      controllerRef.current = bController;
      setController(bController);

      // Force UI updates when controller notifies (throttled at 10Hz inside controller)
      const unsubscribe = bController.subscribe(() => {
        setTick((t) => (t + 1) % 10000);
      });

      // Start the Three.js 60 FPS render loop
      bController.start();

      return () => {
        unsubscribe();
        bController.dispose();
      };
    } catch (err) {
      console.error('Failed to initialize 3D benchmark renderer:', err);
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

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      {/* Hardware Accelerated Native OpenGL ES Surface */}
      <GLView style={StyleSheet.absoluteFill} onContextCreate={handleContextCreate} />

      {/* Developer HUD Overlay */}
      {controller && <BenchmarkHUD controller={controller} />}

      {/* Benchmark Controls Toolbar */}
      {controller && <BenchmarkControls controller={controller} />}

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
