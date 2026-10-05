/**
 * ConnectingOverlay.tsx
 * 
 * Overlay modal displayed while establishing WebSocket transport handshake
 * or performing automatic reconnection to the VASIMOV server.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { GlobalConnectionState } from '../navigation/AppStateMachine';

export interface ConnectingOverlayProps {
  connectionState: GlobalConnectionState;
  host: string;
  port: number;
  onCancel: () => void;
  onRetry?: () => void;
}

export const ConnectingOverlay: React.FC<ConnectingOverlayProps> = ({
  connectionState,
  host,
  port,
  onCancel,
  onRetry,
}) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const isReconnecting = connectionState === 'RECONNECTING';

  return (
    <View style={styles.overlay}>
      <View style={styles.modal}>
        {/* Pulsing indicator */}
        <View style={styles.pulseContainer}>
          <View style={[styles.pulseRing, isReconnecting && styles.pulseRingReconnecting]} />
          <View style={[styles.pulseCore, isReconnecting && styles.pulseCoreReconnecting]} />
        </View>

        <Text style={styles.title}>
          {isReconnecting ? 'RECONNECTING TO ROBOT' : 'CONNECTING TO ROBOT'}
        </Text>

        <Text style={styles.endpoint}>{`ws://${host}:${port}`}</Text>

        <Text style={styles.subtext}>
          {isReconnecting
            ? 'Connection lost. Restoring authoritative VAS1 stream...'
            : 'Initiating WebSocket handshake and subscribing to VAS1 stream...'}
        </Text>

        <Text style={styles.timer}>{`${elapsedSeconds}s elapsed`}</Text>

        <View style={styles.buttonRow}>
          {onRetry && (
            <TouchableOpacity style={styles.retryButton} onPress={onRetry} activeOpacity={0.7}>
              <Text style={styles.retryButtonText}>RETRY NOW</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.cancelButton, onRetry && styles.cancelButtonHalf]} onPress={onCancel} activeOpacity={0.7}>
            <Text style={styles.cancelButtonText}>CANCEL</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(7, 10, 16, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 50,
  },
  modal: {
    width: '85%',
    maxWidth: 380,
    backgroundColor: 'rgba(15, 23, 42, 0.96)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 10,
  },
  pulseContainer: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  pulseRing: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#38bdf8',
    opacity: 0.4,
  },
  pulseRingReconnecting: {
    borderColor: '#a855f7',
  },
  pulseCore: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#0284c7',
  },
  pulseCoreReconnecting: {
    backgroundColor: '#9333ea',
  },
  title: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1.0,
    marginBottom: 6,
    textAlign: 'center',
  },
  endpoint: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'monospace',
    marginBottom: 12,
  },
  subtext: {
    color: '#94a3b8',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
    marginBottom: 16,
  },
  timer: {
    color: '#64748b',
    fontSize: 10,
    fontFamily: 'monospace',
    marginBottom: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
  },
  retryButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#0284c7',
    borderWidth: 1,
    borderColor: '#38bdf8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.8,
  },
  cancelButton: {
    width: '100%',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    alignItems: 'center',
  },
  cancelButtonHalf: {
    flex: 1,
    width: undefined,
  },
  cancelButtonText: {
    color: '#ef4444',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 1.0,
  },
});
