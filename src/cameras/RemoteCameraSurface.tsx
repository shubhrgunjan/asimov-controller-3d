/**
 * RemoteCameraSurface.tsx
 * 
 * Secondary Observation Surface for Asimov 1 Remote Video Streaming.
 * Displays live MJPEG stream from VASIMOV HTTP API:
 *   http://<host>:<port>/api/camera/stream?camera=<front_camera|viewer_camera>
 * 
 * Important Invariants:
 * - Pure observation channel; does NOT replace authoritative local 3D kinematics.
 * - Does NOT block or interfere with the 60 FPS Three.js render loop.
 * - Supports Picture-in-Picture (PiP) and Side-by-Side Split View modes.
 */

import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Image } from 'react-native';

export type RemoteCameraName = 'front_camera' | 'viewer_camera';
export type RemoteViewMode = 'PIP' | 'SPLIT' | 'HIDDEN';

export interface RemoteCameraSurfaceProps {
  host: string;
  port: number;
  viewMode: RemoteViewMode;
  onClose: () => void;
  onToggleViewMode: () => void;
}

export const RemoteCameraSurface: React.FC<RemoteCameraSurfaceProps> = ({
  host,
  port,
  viewMode,
  onClose,
  onToggleViewMode,
}) => {
  const [selectedCamera, setSelectedCamera] = useState<RemoteCameraName>('front_camera');
  const [hasError, setHasError] = useState(false);

  if (viewMode === 'HIDDEN') return null;

  const streamUrl = `http://${host}:${port}/api/camera/stream?camera=${selectedCamera}`;

  const isPip = viewMode === 'PIP';

  return (
    <View style={isPip ? styles.pipContainer : styles.splitContainer} pointerEvents="box-none">
      <View style={isPip ? styles.pipCard : styles.splitCard}>
        {/* Header Bar */}
        <View style={styles.headerBar}>
          <View style={styles.titleGroup}>
            <View style={[styles.statusDot, { backgroundColor: hasError ? '#ef4444' : '#10b981' }]} />
            <Text style={styles.titleText}>
              {selectedCamera === 'front_camera' ? 'FPV ROBOT CAM' : 'VIEWER CAM'}
            </Text>
          </View>

          <View style={styles.actionGroup}>
            {/* Camera Switcher Toggle */}
            <TouchableOpacity
              style={styles.camSwitchBtn}
              onPress={() => {
                setHasError(false);
                setSelectedCamera((c) =>
                  c === 'front_camera' ? 'viewer_camera' : 'front_camera'
                );
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.camSwitchText}>
                {selectedCamera === 'front_camera' ? 'SWITCH TO VIEWER' : 'SWITCH TO FPV'}
              </Text>
            </TouchableOpacity>

            {/* Toggle PiP vs Split */}
            <TouchableOpacity
              style={styles.modeToggleBtn}
              onPress={onToggleViewMode}
              activeOpacity={0.7}
            >
              <Text style={styles.modeToggleText}>{isPip ? '⤢ SPLIT' : '⤡ PiP'}</Text>
            </TouchableOpacity>

            {/* Close */}
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Video Surface */}
        <View style={styles.videoSurface}>
          {!hasError ? (
            <Image
              source={{ uri: streamUrl }}
              style={styles.streamImage}
              resizeMode="cover"
              onError={() => setHasError(true)}
            />
          ) : (
            <View style={styles.errorContainer}>
              <Text style={styles.errorTitle}>CAMERA FEED OFFLINE</Text>
              <Text style={styles.errorSubtext}>{`Cannot reach ${streamUrl}`}</Text>
              <TouchableOpacity
                style={styles.retryBtn}
                onPress={() => setHasError(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.retryText}>RETRY FEED</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Footer info */}
        <View style={styles.footerBar}>
          <Text style={styles.footerInfo}>
            MJPEG Stream · Observation Only · Local 3D Stays Authoritative
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  pipContainer: {
    position: 'absolute',
    top: 110,
    right: 16,
    zIndex: 22,
  },
  pipCard: {
    width: 240,
    height: 165,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.4)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
    elevation: 8,
  },
  splitContainer: {
    position: 'absolute',
    top: 110,
    left: 16,
    right: 16,
    height: 220,
    zIndex: 22,
  },
  splitCard: {
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(15, 23, 42, 0.96)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.4)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
    elevation: 8,
  },
  headerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(11, 17, 32, 0.9)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  titleText: {
    color: '#f8fafc',
    fontSize: 9,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  actionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  camSwitchBtn: {
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  camSwitchText: {
    color: '#38bdf8',
    fontSize: 8,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  modeToggleBtn: {
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  modeToggleText: {
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  closeBtn: {
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  closeText: {
    color: '#ef4444',
    fontSize: 11,
    fontWeight: '800',
  },
  videoSurface: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  streamImage: {
    width: '100%',
    height: '100%',
  },
  errorContainer: {
    padding: 12,
    alignItems: 'center',
  },
  errorTitle: {
    color: '#ef4444',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  errorSubtext: {
    color: '#64748b',
    fontSize: 8,
    fontFamily: 'monospace',
    textAlign: 'center',
    marginBottom: 8,
  },
  retryBtn: {
    backgroundColor: '#0284c7',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  retryText: {
    color: '#ffffff',
    fontSize: 8,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  footerBar: {
    backgroundColor: 'rgba(11, 17, 32, 0.8)',
    paddingVertical: 3,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  footerInfo: {
    color: '#64748b',
    fontSize: 7,
    fontFamily: 'monospace',
  },
});
