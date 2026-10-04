/**
 * DiagnosticsHUD.tsx
 * 
 * Developer Diagnostics Panel displaying empirical real-time metrics across:
 * 1. CONNECTION (state, RTT, packet rate, packet loss, sequence gaps)
 * 2. SIMULATION (sim Hz, policy Hz, current policy, robot mode, recovery state)
 * 3. RENDER (display FPS, presentation interval, jank %, missed VSync, render prep time)
 * 4. SYNCHRONIZATION (buffer depth, state age, newest sequence, stale-state count)
 * 
 * Non-Negotiable:
 * - Zero fake telemetry: every displayed value is directly measured.
 * - Render cadence decoupled: polls DiagnosticsCollector at 3 Hz (333 ms) to ensure
 *   React UI updates do not affect the 60 FPS Three.js rendering loop.
 */

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { DiagnosticsCollector, FullSystemDiagnostics } from './DiagnosticsCollector';
import { InterpolatedRobotPose } from '../synchronization/StateBuffer';

interface DiagnosticsHUDProps {
  collector: DiagnosticsCollector;
  getLatestPose?: () => InterpolatedRobotPose | null;
  initialExpanded?: boolean;
}

export const DiagnosticsHUD: React.FC<DiagnosticsHUDProps> = ({
  collector,
  getLatestPose,
  initialExpanded = true,
}) => {
  const [diag, setDiag] = useState<FullSystemDiagnostics>(() =>
    collector.collect(getLatestPose ? getLatestPose() : null)
  );
  const [expanded, setExpanded] = useState<boolean>(initialExpanded);

  // Poll at 3 Hz (333ms) - decoupled from 60 FPS render loop
  useEffect(() => {
    const interval = setInterval(() => {
      const pose = getLatestPose ? getLatestPose() : null;
      setDiag(collector.collect(pose));
    }, 333);

    return () => clearInterval(interval);
  }, [collector, getLatestPose]);

  const connState = diag.connection.state;
  const isConn = connState === 'CONNECTED';
  const connColor = isConn ? '#10b981' : connState === 'CONNECTING' ? '#f59e0b' : '#ef4444';

  const fpsColor =
    diag.render.displayFps >= 58
      ? '#10b981'
      : diag.render.displayFps >= 45
      ? '#f59e0b'
      : '#ef4444';

  const lossColor =
    diag.connection.packetLossPercent === 0
      ? '#10b981'
      : diag.connection.packetLossPercent < 2.0
      ? '#f59e0b'
      : '#ef4444';

  return (
    <View style={styles.container} pointerEvents="box-none">
      {/* Header bar / Toggle */}
      <TouchableOpacity
        style={styles.toggleBar}
        activeOpacity={0.8}
        onPress={() => setExpanded(!expanded)}
      >
        <View style={styles.toggleRow}>
          <View style={[styles.statusDot, { backgroundColor: connColor }]} />
          <Text style={styles.toggleTitle}>DIAGNOSTICS HUD</Text>
          <Text style={[styles.quickFps, { color: fpsColor }]}>
            {diag.render.displayFps.toFixed(1)} FPS
          </Text>
          <Text style={styles.toggleIndicator}>{expanded ? '▲' : '▼'}</Text>
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.panel}>
          {/* Domain 1: CONNECTION */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>1. CONNECTION</Text>
            <View style={styles.grid}>
              <View style={styles.item}>
                <Text style={styles.label}>STATE</Text>
                <Text style={[styles.val, { color: connColor }]}>{connState}</Text>
              </View>
              <View style={styles.item}>
                <Text style={styles.label}>RTT</Text>
                <Text style={styles.val}>{diag.connection.rttMs.toFixed(1)} ms</Text>
              </View>
              <View style={styles.item}>
                <Text style={styles.label}>PACKET RATE</Text>
                <Text style={styles.val}>{diag.connection.packetRateHz.toFixed(1)} Hz</Text>
              </View>
              <View style={styles.item}>
                <Text style={styles.label}>PACKET LOSS</Text>
                <Text style={[styles.val, { color: lossColor }]}>
                  {diag.connection.packetLossPercent.toFixed(1)}% ({diag.connection.sequenceGaps} gaps)
                </Text>
              </View>
            </View>
          </View>

          {/* Domain 2: SIMULATION */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>2. SIMULATION (AUTHORITATIVE)</Text>
            <View style={styles.grid}>
              <View style={styles.item}>
                <Text style={styles.label}>SIM HZ</Text>
                <Text style={styles.val}>{diag.simulation.simHz.toFixed(1)} Hz</Text>
              </View>
              <View style={styles.item}>
                <Text style={styles.label}>POLICY HZ</Text>
                <Text style={styles.val}>{diag.simulation.policyHz.toFixed(1)} Hz</Text>
              </View>
              <View style={styles.item}>
                <Text style={styles.label}>POLICY</Text>
                <Text style={styles.val}>{diag.simulation.activePolicy}</Text>
              </View>
              <View style={styles.item}>
                <Text style={styles.label}>ROBOT MODE</Text>
                <Text style={styles.val}>{diag.simulation.robotMode}</Text>
              </View>
              <View style={styles.item}>
                <Text style={styles.label}>RECOVERY</Text>
                <Text style={styles.val}>{diag.simulation.recoveryState}</Text>
              </View>
            </View>
          </View>

          {/* Domain 3: RENDER */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>3. RENDER (PRESENTATION)</Text>
            <View style={styles.grid}>
              <View style={styles.item}>
                <Text style={styles.label}>DISPLAY FPS</Text>
                <Text style={[styles.val, { color: fpsColor }]}>
                  {diag.render.displayFps.toFixed(1)} FPS
                </Text>
              </View>
              <View style={styles.item}>
                <Text style={styles.label}>INTERVAL</Text>
                <Text style={styles.val}>
                  {diag.render.presentationIntervalMs.toFixed(2)} ms (p95: {diag.render.p95PresentationMs.toFixed(1)})
                </Text>
              </View>
              <View style={styles.item}>
                <Text style={styles.label}>JANK / MISSED</Text>
                <Text style={styles.val}>
                  {diag.render.jankPercent.toFixed(1)}% / {diag.render.missedVsyncs}
                </Text>
              </View>
              <View style={styles.item}>
                <Text style={styles.label}>CPU PREP</Text>
                <Text style={styles.val}>
                  {diag.render.cpuPrepMs.toFixed(2)} ms (hdrm: {diag.render.cpuHeadroomMs.toFixed(1)}ms)
                </Text>
              </View>
            </View>
          </View>

          {/* Domain 4: SYNCHRONIZATION */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>4. SYNCHRONIZATION (BUFFER)</Text>
            <View style={styles.grid}>
              <View style={styles.item}>
                <Text style={styles.label}>BUFFER DEPTH</Text>
                <Text style={styles.val}>{diag.synchronization.bufferDepth} snapshots</Text>
              </View>
              <View style={styles.item}>
                <Text style={styles.label}>STATE AGE</Text>
                <Text style={styles.val}>{diag.synchronization.stateAgeMs.toFixed(1)} ms</Text>
              </View>
              <View style={styles.item}>
                <Text style={styles.label}>NEWEST SEQ</Text>
                <Text style={styles.val}>#{diag.synchronization.newestSequence}</Text>
              </View>
              <View style={styles.item}>
                <Text style={styles.label}>STALE COUNT</Text>
                <Text style={styles.val}>
                  {diag.synchronization.staleStateCount} {diag.synchronization.isExtrapolated ? '[EXTRAP]' : ''}
                </Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 40,
    left: 12,
    zIndex: 999,
    width: 290,
  },
  toggleBar: {
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  toggleTitle: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  quickFps: {
    fontSize: 12,
    fontWeight: '800',
    marginLeft: 'auto',
    marginRight: 8,
  },
  toggleIndicator: {
    color: '#94a3b8',
    fontSize: 10,
  },
  panel: {
    backgroundColor: 'rgba(10, 15, 30, 0.94)',
    borderRadius: 8,
    marginTop: 4,
    padding: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  section: {
    marginBottom: 6,
  },
  sectionTitle: {
    color: '#38bdf8',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: 2,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(56, 189, 248, 0.2)',
    paddingBottom: 2,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  item: {
    width: '48%',
    marginVertical: 2,
  },
  label: {
    color: '#94a3b8',
    fontSize: 8,
    fontWeight: '600',
  },
  val: {
    color: '#f8fafc',
    fontSize: 10,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
