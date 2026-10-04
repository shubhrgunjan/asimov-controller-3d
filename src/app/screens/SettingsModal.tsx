/**
 * SettingsModal.tsx
 * 
 * Production Operator Settings Screen for Asimov Controller 3D.
 * Allows configuration of connection parameters, rendering resolution,
 * interpolation delay window (20ms/30ms/40ms), and developer diagnostics.
 */

import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Switch,
} from 'react-native';
import { AppConfig, AppSettingsManager } from '../../settings/AppSettings';
import { ResolutionMode } from '../../renderer/ThreeRenderer';

export interface SettingsModalProps {
  settings: AppSettingsManager;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ settings, onClose }) => {
  const currentConfig = settings.getConfig();

  const [host, setHost] = useState(currentConfig.connection.host);
  const [port, setPort] = useState(String(currentConfig.connection.port));
  const [autoReconnect, setAutoReconnect] = useState(currentConfig.connection.autoReconnect);
  const [reconnectIntervalMs, setReconnectIntervalMs] = useState(
    String(currentConfig.connection.reconnectIntervalMs)
  );

  const [resolution, setResolution] = useState<ResolutionMode>(currentConfig.rendering.resolution);
  const [interpolationDelayMs, setInterpolationDelayMs] = useState(
    currentConfig.synchronization.interpolationDelayMs
  );
  const [adaptiveBuffer, setAdaptiveBuffer] = useState(
    currentConfig.synchronization.adaptiveBuffer
  );
  const [showDevHud, setShowDevHud] = useState(currentConfig.diagnostics.showDevHud);

  const handleSave = () => {
    const parsedPort = parseInt(port, 10) || 8854;
    const parsedInterval = parseInt(reconnectIntervalMs, 10) || 1500;

    settings.updateConnection({
      host: host.trim(),
      port: parsedPort,
      autoReconnect,
      reconnectIntervalMs: parsedInterval,
    });

    settings.updateRendering({
      resolution,
    });

    settings.updateSynchronization({
      interpolationDelayMs,
      adaptiveBuffer,
    });

    settings.updateDiagnostics({
      showDevHud,
    });

    onClose();
  };

  const handleReset = () => {
    settings.resetToDefaults();
    const def = settings.getConfig();
    setHost(def.connection.host);
    setPort(String(def.connection.port));
    setAutoReconnect(def.connection.autoReconnect);
    setReconnectIntervalMs(String(def.connection.reconnectIntervalMs));
    setResolution(def.rendering.resolution);
    setInterpolationDelayMs(def.synchronization.interpolationDelayMs);
    setAdaptiveBuffer(def.synchronization.adaptiveBuffer);
    setShowDevHud(def.diagnostics.showDevHud);
  };

  return (
    <View style={styles.container}>
      <View style={styles.modal}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>OPERATOR SETTINGS</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeIcon}>
            <Text style={styles.closeIconText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {/* Section: Connection */}
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>CONNECTION TARGET</Text>

            <View style={styles.fieldRow}>
              <Text style={styles.label}>Backend Host IP</Text>
              <TextInput
                style={styles.input}
                value={host}
                onChangeText={setHost}
                placeholder="10.222.5.132"
                placeholderTextColor="#475569"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.fieldRow}>
              <Text style={styles.label}>WebSocket Port</Text>
              <TextInput
                style={[styles.input, { width: 90 }]}
                value={port}
                onChangeText={setPort}
                keyboardType="numeric"
              />
            </View>

            <View style={styles.toggleRow}>
              <View>
                <Text style={styles.label}>Auto Reconnect</Text>
                <Text style={styles.sublabel}>Automatically recover lost stream</Text>
              </View>
              <Switch
                value={autoReconnect}
                onValueChange={setAutoReconnect}
                thumbColor={autoReconnect ? '#38bdf8' : '#64748b'}
                trackColor={{ false: '#1e293b', true: '#0284c7' }}
              />
            </View>

            <View style={styles.fieldRow}>
              <Text style={styles.label}>Retry Interval (ms)</Text>
              <TextInput
                style={[styles.input, { width: 90 }]}
                value={reconnectIntervalMs}
                onChangeText={setReconnectIntervalMs}
                keyboardType="numeric"
              />
            </View>
          </View>

          {/* Section: Rendering */}
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>3D RENDERING QUALITY</Text>
            <View style={styles.presetRow}>
              <TouchableOpacity
                style={[styles.pill, resolution === '720p' && styles.pillActive]}
                onPress={() => setResolution('720p')}
              >
                <Text style={[styles.pillText, resolution === '720p' && styles.pillTextActive]}>
                  720p (High Performance)
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pill, resolution === '1080p' && styles.pillActive]}
                onPress={() => setResolution('1080p')}
              >
                <Text style={[styles.pillText, resolution === '1080p' && styles.pillTextActive]}>
                  1080p (Native Crisp)
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Section: Temporal Synchronization */}
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>TEMPORAL SYNCHRONIZATION</Text>
            <Text style={styles.sublabel}>
              Interpolation delay absorbs network packet jitter before rendering transforms.
            </Text>
            <View style={styles.presetRow}>
              {[20, 30, 40].map((delay) => (
                <TouchableOpacity
                  key={delay}
                  style={[
                    styles.pill,
                    interpolationDelayMs === delay && !adaptiveBuffer && styles.pillActive,
                  ]}
                  onPress={() => {
                    setInterpolationDelayMs(delay);
                    setAdaptiveBuffer(false);
                  }}
                >
                  <Text
                    style={[
                      styles.pillText,
                      interpolationDelayMs === delay && !adaptiveBuffer && styles.pillTextActive,
                    ]}
                  >
                    {delay} ms
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={[styles.pill, adaptiveBuffer && styles.pillActive]}
                onPress={() => setAdaptiveBuffer(true)}
              >
                <Text style={[styles.pillText, adaptiveBuffer && styles.pillTextActive]}>
                  Adaptive
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Section: Diagnostics & Engineering */}
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>DEVELOPER DIAGNOSTICS</Text>
            <View style={styles.toggleRow}>
              <View>
                <Text style={styles.label}>Developer HUD Overlay</Text>
                <Text style={styles.sublabel}>Display VSync timing, RTT & Buffer Depth</Text>
              </View>
              <Switch
                value={showDevHud}
                onValueChange={setShowDevHud}
                thumbColor={showDevHud ? '#38bdf8' : '#64748b'}
                trackColor={{ false: '#1e293b', true: '#0284c7' }}
              />
            </View>
          </View>
        </ScrollView>

        {/* Footer Actions */}
        <View style={styles.footer}>
          <TouchableOpacity style={styles.resetButton} onPress={handleReset} activeOpacity={0.7}>
            <Text style={styles.resetText}>RESET DEFAULTS</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.saveButton} onPress={handleSave} activeOpacity={0.8}>
            <Text style={styles.saveText}>APPLY & CLOSE</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(7, 10, 16, 0.90)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 60,
  },
  modal: {
    width: '90%',
    maxWidth: 520,
    maxHeight: '85%',
    backgroundColor: 'rgba(15, 23, 42, 0.98)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  title: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1.2,
  },
  closeIcon: {
    padding: 6,
  },
  closeIconText: {
    color: '#94a3b8',
    fontSize: 16,
    fontWeight: '700',
  },
  content: {
    padding: 20,
  },
  section: {
    marginBottom: 22,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    paddingBottom: 16,
  },
  sectionHeader: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1.0,
    marginBottom: 12,
  },
  fieldRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  label: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '600',
  },
  sublabel: {
    color: '#64748b',
    fontSize: 10,
    marginTop: 2,
    maxWidth: 260,
  },
  input: {
    backgroundColor: '#0b1120',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    color: '#f8fafc',
    fontSize: 12,
    fontFamily: 'monospace',
    minWidth: 140,
    textAlign: 'right',
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  pill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  pillActive: {
    backgroundColor: '#0284c7',
    borderColor: '#38bdf8',
  },
  pillText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  pillTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: 'rgba(11, 17, 32, 0.6)',
  },
  resetButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  resetText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  saveButton: {
    backgroundColor: '#0284c7',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#38bdf8',
  },
  saveText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.8,
  },
});
