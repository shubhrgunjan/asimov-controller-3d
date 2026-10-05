/**
 * VirtualJoystick.tsx
 * 
 * High-performance virtual touch joystick for mobile teleoperation.
 * Uses React Native PanResponder with capture priority and termination lock,
 * guaranteeing seamless simultaneous dual-joystick operation and concurrent camera panning.
 */

import React, { useRef, useState, useMemo } from 'react';
import { View, StyleSheet, PanResponder, GestureResponderEvent, PanResponderGestureState } from 'react-native';

interface VirtualJoystickProps {
  size?: number; // Outer diameter (default: 130)
  knobSize?: number; // Inner knob diameter (default: 50)
  onMove: (normX: number, normY: number) => void;
  onRelease: () => void;
  accentColor?: string;
}

export const VirtualJoystick: React.FC<VirtualJoystickProps> = ({
  size = 130,
  knobSize = 50,
  onMove,
  onRelease,
  accentColor = '#38bdf8',
}) => {
  const radius = size / 2;
  const maxDistance = radius - knobSize / 2;

  const [knobPos, setKnobPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const onReleaseRef = useRef(onRelease);
  onReleaseRef.current = onRelease;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,

        onPanResponderGrant: () => {
          // Touch begins inside joystick surface
        },

        onPanResponderMove: (_evt: GestureResponderEvent, gestureState: PanResponderGestureState) => {
          const dx = gestureState.dx;
          const dy = gestureState.dy;

          const dist = Math.sqrt(dx * dx + dy * dy);
          const clampedDist = Math.min(dist, maxDistance);
          const angle = Math.atan2(dy, dx);

          const clampedX = Math.cos(angle) * clampedDist;
          const clampedY = Math.sin(angle) * clampedDist;

          setKnobPos({ x: clampedX, y: clampedY });

          // Normalized outputs:
          // normX: [-1.0, 1.0] (right = +1, left = -1)
          // normY: [-1.0, 1.0] (up/forward = +1, down/backward = -1, inverted screen coords)
          const normX = clampedDist > 0 ? clampedX / maxDistance : 0;
          const normY = clampedDist > 0 ? -clampedY / maxDistance : 0;

          onMoveRef.current(normX, normY);
        },

        onPanResponderRelease: () => {
          setKnobPos({ x: 0, y: 0 });
          onReleaseRef.current();
        },

        onPanResponderTerminate: () => {
          setKnobPos({ x: 0, y: 0 });
          onReleaseRef.current();
        },
      }),
    [maxDistance]
  );

  return (
    <View
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: radius,
          borderColor: accentColor + '44',
        },
      ]}
      {...panResponder.panHandlers}
    >
      {/* Target Crosshair */}
      <View style={[styles.crosshairH, { width: size * 0.6 }]} pointerEvents="none" />
      <View style={[styles.crosshairV, { height: size * 0.6 }]} pointerEvents="none" />

      {/* Draggable Knob */}
      <View
        pointerEvents="none"
        style={[
          styles.knob,
          {
            width: knobSize,
            height: knobSize,
            borderRadius: knobSize / 2,
            backgroundColor: accentColor + 'cc',
            borderColor: '#ffffff88',
            transform: [{ translateX: knobPos.x }, { translateY: knobPos.y }],
          },
        ]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  base: {
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  crosshairH: {
    position: 'absolute',
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  crosshairV: {
    position: 'absolute',
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  knob: {
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
});
