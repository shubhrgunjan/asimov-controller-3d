import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { BenchmarkController, BottleneckDiagnosis } from '../benchmark/BenchmarkController';
import { FrameMetrics, SteadyStateSummary } from '../benchmark/PerformanceMonitor';
import { RenderStats } from '../renderer/ThreeRenderer';

interface BenchmarkHUDProps {
  controller: BenchmarkController;
}

export const BenchmarkHUD: React.FC<BenchmarkHUDProps> = ({ controller }) => {
  const monitor = controller.monitor;
  const metrics: FrameMetrics = monitor.getLatestMetrics();
  const renderStats: RenderStats = monitor.getLatestRenderStats();
  const phase = monitor.getPhase();
  const progress = monitor.getPhaseProgress();
  const summary: SteadyStateSummary = monitor.getSummary();
  const level = controller.getLevel();
  const resMode = controller.getResolution();
  const recentHistory = monitor.getRecentHistory();
  const isMatrix = controller.isMatrixActive();
  const matrixProg = controller.getMatrixProgress();

  // Format triangles to K
  const formatTris = (tris: number) => {
    if (tris >= 1000) return `${(tris / 1000).toFixed(1)}K`;
    return tris.toString();
  };

  const getBottleneckLabel = (b: BottleneckDiagnosis) => {
    switch (b) {
      case 'BALANCED_60FPS':
        return '60 FPS OPTIMAL';
      case 'GPU_FRAGMENT_BOUND':
        return 'GPU FRAGMENT / FILL';
      case 'GPU_SHADOW_BOUND':
        return 'GPU SHADOW PASS';
      case 'CPU_DISPATCH_BOUND':
        return 'CPU DRAW DISPATCH';
      case 'CPU_TRANSFORM_BOUND':
        return 'CPU KINEMATICS';
      default:
        return 'MEASURING...';
    }
  };

  const fpsColor =
    metrics.instantaneousFps >= 58
      ? '#10b981'
      : metrics.instantaneousFps >= 45
      ? '#f59e0b'
      : '#f43f5e';

  return (
    <View style={styles.hudOverlay} pointerEvents="box-none">
      {/* Primary Technical Metrics Card */}
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>PHASE 2 ASIMOV BENCHMARK</Text>
          <View style={[styles.badge, phase === 'RECORDING' ? styles.badgeRecording : styles.badgeDefault]}>
            <Text style={styles.badgeText}>
              {phase === 'RECORDING'
                ? `REC ${(progress * 100).toFixed(0)}%`
                : phase === 'WARMUP'
                ? `WARM ${(progress * 100).toFixed(0)}%`
                : phase}
            </Text>
          </View>
        </View>

        {isMatrix && (
          <View style={styles.matrixBanner}>
            <Text style={styles.matrixBannerText}>
              AUTORUN: {matrixProg.label} [{matrixProg.current + 1}/{matrixProg.total}]
            </Text>
          </View>
        )}

        {/* Display Presentation Performance */}
        <Text style={styles.sectionHeader}>PRESENTATION (VSYNC)</Text>
        <View style={styles.metricRow}>
          <Text style={styles.label}>DISPLAY FPS</Text>
          <Text style={[styles.value, { color: fpsColor }]}>
            {metrics.instantaneousFps.toFixed(1)}
            <Text style={styles.unit}> (AVG {summary.averageFps > 0 ? summary.averageFps.toFixed(1) : '--'})</Text>
          </Text>
        </View>

        <View style={styles.metricRow}>
          <Text style={styles.label}>FRAME INTERVAL</Text>
          <Text style={styles.value}>
            {metrics.frameDeltaMs.toFixed(2)} <Text style={styles.unit}>ms</Text>
          </Text>
        </View>

        <View style={styles.metricRow}>
          <Text style={styles.label}>P95 / P99</Text>
          <Text style={styles.value}>
            {summary.p95FrameTimeMs > 0 ? summary.p95FrameTimeMs.toFixed(2) : '--'} / {summary.p99FrameTimeMs > 0 ? summary.p99FrameTimeMs.toFixed(2) : '--'}{' '}
            <Text style={styles.unit}>ms</Text>
          </Text>
        </View>

        <View style={styles.metricRow}>
          <Text style={styles.label}>MISSED VSYNC</Text>
          <Text style={[styles.value, { color: summary.missedVsyncs === 0 ? '#10b981' : '#f59e0b' }]}>
            {summary.missedVsyncs}
            <Text style={styles.unit}> ({summary.jankPercentage.toFixed(1)}% JANK)</Text>
          </Text>
        </View>

        <View style={styles.divider} />

        {/* CPU / Render Preparation */}
        <Text style={styles.sectionHeader}>CPU / RENDER PREP</Text>
        <View style={styles.metricRow}>
          <Text style={styles.label}>JS CPU PREP</Text>
          <Text style={styles.value}>
            {summary.averageCpuTimeMs > 0 ? summary.averageCpuTimeMs.toFixed(2) : '--'}
            <Text style={styles.unit}> ms (P95 {summary.p95CpuTimeMs > 0 ? summary.p95CpuTimeMs.toFixed(2) : '--'})</Text>
          </Text>
        </View>

        <View style={styles.metricRow}>
          <Text style={styles.label}>CPU HEADROOM</Text>
          <Text style={[styles.value, { color: '#10b981' }]}>
            {summary.cpuHeadroomMs > 0 ? summary.cpuHeadroomMs.toFixed(2) : '--'} <Text style={styles.unit}>ms</Text>
          </Text>
        </View>

        <View style={styles.divider} />

        {/* Rendering Workload Stats */}
        <View style={styles.metricRow}>
          <Text style={styles.label}>DRAW CALLS</Text>
          <Text style={styles.value}>{renderStats.calls}</Text>
        </View>

        <View style={styles.metricRow}>
          <Text style={styles.label}>TRIANGLES</Text>
          <Text style={styles.value}>{formatTris(renderStats.triangles)}</Text>
        </View>

        <View style={styles.metricRow}>
          <Text style={styles.label}>OBJECTS</Text>
          <Text style={styles.value}>{controller.scene.getWorkloadSpec().objectCount}</Text>
        </View>

        <View style={styles.divider} />

        {/* Configuration */}
        <View style={styles.metricRow}>
          <Text style={styles.label}>RESOLUTION</Text>
          <Text style={styles.value}>
            {renderStats.resolution.width} × {renderStats.resolution.height}
            <Text style={styles.unit}> ({resMode.toUpperCase()})</Text>
          </Text>
        </View>

        <View style={styles.metricRow}>
          <Text style={styles.label}>TEST LEVEL</Text>
          <Text style={[styles.value, { color: '#38bdf8' }]}>{level}</Text>
        </View>

        <View style={styles.metricRow}>
          <Text style={styles.label}>SHADOWS</Text>
          <Text style={styles.value}>{controller.isShadowsEnabled() ? 'ENABLED' : 'DISABLED'}</Text>
        </View>

        <View style={styles.divider} />

        {/* Stutter Catalog */}
        <View style={styles.stutterContainer}>
          <Text style={styles.subHeader}>STUTTER EVENTS</Text>
          <View style={styles.stutterGrid}>
            <Text style={styles.stutterItem}>
              {'>'}20ms: <Text style={styles.stutterVal}>{summary.stutters.countGt20ms}</Text>
            </Text>
            <Text style={styles.stutterItem}>
              {'>'}25ms: <Text style={styles.stutterVal}>{summary.stutters.countGt25ms}</Text>
            </Text>
            <Text style={styles.stutterItem}>
              {'>'}33ms: <Text style={styles.stutterVal}>{summary.stutters.countGt33ms}</Text>
            </Text>
            <Text style={styles.stutterItem}>
              {'>'}50ms: <Text style={styles.stutterVal}>{summary.stutters.countGt50ms}</Text>
            </Text>
          </View>
        </View>

        {/* Bottleneck Analysis */}
        <View style={styles.bottleneckRow}>
          <Text style={styles.label}>BOTTLENECK</Text>
          <Text style={styles.bottleneckValue}>
            {getBottleneckLabel(controller.diagnoseBottleneck(summary))}
          </Text>
        </View>

        {/* Mini Frame-Time Sparkline */}
        <View style={styles.sparklineContainer}>
          <View style={styles.sparklineBudgetLine} />
          <View style={styles.sparklineBars}>
            {recentHistory.slice(-40).map((time, idx) => {
              const h = Math.min(28, (time / 40) * 28);
              const isOver = time > 16.7;
              return (
                <View
                  key={idx}
                  style={[
                    styles.sparkBar,
                    {
                      height: h,
                      backgroundColor: isOver ? '#f43f5e' : '#38bdf8',
                    },
                  ]}
                />
              );
            })}
          </View>
          <Text style={styles.sparklineLegend}>16.7ms (60FPS budget)</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  hudOverlay: {
    position: 'absolute',
    top: 12,
    left: 12,
    zIndex: 100,
  },
  card: {
    backgroundColor: 'rgba(10, 14, 20, 0.88)',
    borderColor: 'rgba(56, 189, 248, 0.25)',
    borderWidth: 1,
    borderRadius: 6,
    padding: 10,
    width: 250,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  title: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 1.1,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  badgeDefault: {
    backgroundColor: '#334155',
  },
  badgeRecording: {
    backgroundColor: '#dc2626',
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  matrixBanner: {
    backgroundColor: 'rgba(2, 132, 199, 0.3)',
    borderColor: '#0284c7',
    borderWidth: 1,
    borderRadius: 4,
    padding: 4,
    marginBottom: 6,
  },
  matrixBannerText: {
    color: '#38bdf8',
    fontSize: 9,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 1.5,
  },
  label: {
    color: '#94a3b8',
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  value: {
    color: '#f8fafc',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  unit: {
    color: '#64748b',
    fontSize: 9,
    fontWeight: '400',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginVertical: 4,
  },
  subHeader: {
    color: '#64748b',
    fontSize: 9,
    fontFamily: 'monospace',
    fontWeight: '700',
    marginBottom: 2,
  },
  sectionHeader: {
    color: '#38bdf8',
    fontSize: 9,
    fontFamily: 'monospace',
    fontWeight: '700',
    letterSpacing: 0.8,
    marginVertical: 2,
  },
  stutterContainer: {
    marginVertical: 2,
  },
  stutterGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  stutterItem: {
    color: '#94a3b8',
    fontSize: 9,
    fontFamily: 'monospace',
    width: '48%',
  },
  stutterVal: {
    color: '#f8fafc',
    fontWeight: '700',
  },
  bottleneckRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  bottleneckValue: {
    color: '#fbbf24',
    fontSize: 9.5,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  sparklineContainer: {
    marginTop: 6,
    height: 34,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    borderTopWidth: 1,
    paddingTop: 4,
  },
  sparklineBudgetLine: {
    position: 'absolute',
    top: 16,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(244, 63, 94, 0.4)',
  },
  sparklineBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 28,
  },
  sparkBar: {
    width: 4,
    borderRadius: 1,
  },
  sparklineLegend: {
    color: '#64748b',
    fontSize: 8,
    fontFamily: 'monospace',
    marginTop: 2,
  },
});
