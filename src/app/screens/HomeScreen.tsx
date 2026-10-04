/**
 * HomeScreen.tsx
 * 
 * Clean, operator-first landing screen for Asimov Controller 3D.
 * Provides clear target selection, connection lifecycle control,
 * robot telemetry status, and quick access to live teleoperation.
 */

import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
} from 'react-native';
import { GlobalConnectionState } from '../navigation/AppStateMachine';

export interface HomeScreenProps {
  connectionState: GlobalConnectionState;
  host: string;
  port: number;
  errorMessage: string | null;
  onConnect: (host: string, port: number) => void;
  onDisconnect: () => void;
  onEnterTeleop: () => void;
  onOpenSettings: () => void;
  onOpenBenchmark: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  connectionState,
  host: initialHost,
  port: initialPort,
  errorMessage,
  onConnect,
  onDisconnect,
  onEnterTeleop,
  onOpenSettings,
  onOpenBenchmark,
}) => {
  const [host, setHost] = useState(initialHost);
  const [port, setPort] = useState(String(initialPort));
  const [isEditingCustom, setIsEditingCustom] = useState(false);

  const isConnected = connectionState === 'CONNECTED';
  const isConnecting = connectionState === 'CONNECTING' || connectionState === 'RECONNECTING';

  const handleSelectPreset = (presetHost: string, presetPort: number) => {
    setHost(presetHost);
    setPort(String(presetPort));
    setIsEditingCustom(false);
  };

  const handleConnectPress = () => {
    if (isConnected) {
      onEnterTeleop();
      return;
    }
    const parsedPort = parseInt(port, 10) || 8854;
    onConnect(host.trim(), parsedPort);
  };

  const getStatusBadge = () => {
    switch (connectionState) {
      case 'CONNECTED':
        return { color: '#10b981', label: 'CONNECTED' };
      case 'CONNECTING':
        return { color: '#06b6d4', label: 'CONNECTING...' };
      case 'RECONNECTING':
        return { color: '#a855f7', label: 'RECONNECTING...' };
      case 'DEGRADED':
        return { color: '#f59e0b', label: 'DEGRADED' };
      case 'FAILED':
        return { color: '#ef4444', label: 'FAILED' };
      case 'DISCONNECTED':
      default:
        return { color: '#64748b', label: 'DISCONNECTED' };
    }
  };

  const badge = getStatusBadge();

  return (
    <View style={styles.container} pointerEvents="box-none">
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Brand Header */}
        <View style={styles.header}>
          <Text style={styles.brandTitle}>ASIMOV CONTROLLER</Text>
          <Text style={styles.brandSubtitle}>ASIMOV 1 · VIRTUAL TELEOPERATION</Text>
          <View style={styles.titleDivider} />
        </View>

        {/* Central Operator Card */}
        <View style={styles.card}>
          {/* Status Indicator Pill */}
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: badge.color }]} />
            <Text style={[styles.statusText, { color: badge.color }]}>{badge.label}</Text>
          </View>

          {/* Connection Target Information */}
          <View style={styles.endpointSection}>
            <Text style={styles.fieldLabel}>BACKEND ENDPOINT</Text>
            <Text style={styles.endpointDisplay}>{`ws://${host}:${port}`}</Text>

            {/* Target Presets */}
            <View style={styles.presetRow}>
              <TouchableOpacity
                style={[
                  styles.presetPill,
                  host === '10.222.5.132' && !isEditingCustom && styles.presetPillActive,
                ]}
                onPress={() => handleSelectPreset('10.222.5.132', 8854)}
                disabled={isConnecting}
              >
                <Text style={styles.presetText}>LAN (10.222.5.132)</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.presetPill,
                  host === '127.0.0.1' && !isEditingCustom && styles.presetPillActive,
                ]}
                onPress={() => handleSelectPreset('127.0.0.1', 8854)}
                disabled={isConnecting}
              >
                <Text style={styles.presetText}>Localhost</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.presetPill, isEditingCustom && styles.presetPillActive]}
                onPress={() => setIsEditingCustom(!isEditingCustom)}
                disabled={isConnecting}
              >
                <Text style={styles.presetText}>Custom</Text>
              </TouchableOpacity>
            </View>

            {/* Custom Host/Port Input Form */}
            {isEditingCustom && (
              <View style={styles.customInputContainer}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputSublabel}>Host IP:</Text>
                  <TextInput
                    style={styles.textInput}
                    value={host}
                    onChangeText={setHost}
                    placeholder="192.168.x.x"
                    placeholderTextColor="#475569"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
                <View style={[styles.inputGroup, { width: 90 }]}>
                  <Text style={styles.inputSublabel}>Port:</Text>
                  <TextInput
                    style={styles.textInput}
                    value={port}
                    onChangeText={setPort}
                    placeholder="8854"
                    placeholderTextColor="#475569"
                    keyboardType="numeric"
                  />
                </View>
              </View>
            )}
          </View>

          {/* Error Message if present */}
          {errorMessage && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

          {/* Primary Action Button */}
          <TouchableOpacity
            style={[
              styles.primaryButton,
              isConnected ? styles.primaryButtonConnected : null,
              isConnecting ? styles.primaryButtonConnecting : null,
            ]}
            onPress={handleConnectPress}
            disabled={isConnecting}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>
              {isConnected
                ? 'ENTER 3D TELEOP →'
                : isConnecting
                ? 'ESTABLISHING HANDSHAKE...'
                : 'CONNECT TO ROBOT'}
            </Text>
          </TouchableOpacity>

          {/* Disconnect button if connected */}
          {isConnected && (
            <TouchableOpacity
              style={styles.secondaryDisconnectButton}
              onPress={onDisconnect}
              activeOpacity={0.7}
            >
              <Text style={styles.secondaryDisconnectText}>DISCONNECT</Text>
            </TouchableOpacity>
          )}

          {/* Settings Button */}
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={onOpenSettings}
            activeOpacity={0.7}
          >
            <Text style={styles.settingsButtonText}>⚙ SETTINGS & CONFIGURATION</Text>
          </TouchableOpacity>
        </View>

        {/* Discrete Engineering Suite Access */}
        <View style={styles.footerSection}>
          <TouchableOpacity
            style={styles.benchmarkLink}
            onPress={onOpenBenchmark}
            activeOpacity={0.6}
          >
            <Text style={styles.benchmarkLinkText}>
              [ Phase 1 & 2 Benchmark & Diagnostics Suite ]
            </Text>
          </TouchableOpacity>
          <Text style={styles.systemMetadata}>
            VAS1 50 Hz State · VAC1 32B Control · MuJoCo 200 Hz Authoritative
          </Text>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(7, 10, 16, 0.90)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 20,
    width: '100%',
    maxWidth: 520,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  brandTitle: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 2.2,
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  brandSubtitle: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginTop: 6,
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  titleDivider: {
    width: 60,
    height: 2,
    backgroundColor: '#0284c7',
    marginTop: 14,
    borderRadius: 1,
  },
  card: {
    width: '100%',
    backgroundColor: 'rgba(15, 23, 42, 0.94)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 8,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 20,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.0,
    fontFamily: 'monospace',
  },
  endpointSection: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
  },
  fieldLabel: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 4,
    fontFamily: 'monospace',
  },
  endpointDisplay: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'monospace',
    marginBottom: 12,
  },
  presetRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  presetPill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  presetPillActive: {
    backgroundColor: '#0284c7',
    borderColor: '#38bdf8',
  },
  presetText: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: '600',
  },
  customInputContainer: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    width: '100%',
  },
  inputGroup: {
    flex: 1,
  },
  inputSublabel: {
    color: '#94a3b8',
    fontSize: 10,
    marginBottom: 2,
    fontFamily: 'monospace',
  },
  textInput: {
    backgroundColor: '#0b1120',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    color: '#f8fafc',
    fontSize: 13,
    fontFamily: 'monospace',
  },
  errorBanner: {
    width: '100%',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 11,
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  primaryButton: {
    width: '100%',
    backgroundColor: '#0284c7',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#38bdf8',
  },
  primaryButtonConnected: {
    backgroundColor: '#059669',
    borderColor: '#34d399',
  },
  primaryButtonConnecting: {
    backgroundColor: '#0369a1',
    opacity: 0.8,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.2,
    fontFamily: 'monospace',
  },
  secondaryDisconnectButton: {
    width: '100%',
    backgroundColor: 'transparent',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
  },
  secondaryDisconnectText: {
    color: '#ef4444',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 0.8,
  },
  settingsButton: {
    width: '100%',
    backgroundColor: 'rgba(30, 41, 59, 0.6)',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  settingsButtonText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    fontFamily: 'monospace',
  },
  footerSection: {
    marginTop: 24,
    alignItems: 'center',
  },
  benchmarkLink: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  benchmarkLinkText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  systemMetadata: {
    color: '#475569',
    fontSize: 9,
    fontFamily: 'monospace',
    marginTop: 8,
    textAlign: 'center',
  },
});
