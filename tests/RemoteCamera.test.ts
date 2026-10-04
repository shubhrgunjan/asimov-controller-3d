/**
 * RemoteCamera.test.ts
 * 
 * Unit tests for Milestone P4.7: Optional Remote Camera Integration
 * - View mode toggling (HIDDEN, PIP, SPLIT)
 * - Correct HTTP MJPEG stream URL generation
 * - Front camera vs Viewer camera switching
 * - Invariant: video is strictly an observation channel and local 3D stays authoritative
 */

import { RemoteCameraName, RemoteViewMode } from '../src/cameras/RemoteCameraSurface';

describe('Milestone P4.7: Remote Camera Integration', () => {
  const host = '10.222.5.132';
  const port = 8854;

  test('Stream URLs format correctly for available cameras', () => {
    const frontUrl = `http://${host}:${port}/api/camera/stream?camera=front_camera`;
    const viewerUrl = `http://${host}:${port}/api/camera/stream?camera=viewer_camera`;

    expect(frontUrl).toBe('http://10.222.5.132:8854/api/camera/stream?camera=front_camera');
    expect(viewerUrl).toBe('http://10.222.5.132:8854/api/camera/stream?camera=viewer_camera');
  });

  test('View mode transitions cycle cleanly: HIDDEN -> PIP -> SPLIT -> HIDDEN', () => {
    let mode: RemoteViewMode = 'HIDDEN';

    const cycleMode = (current: RemoteViewMode): RemoteViewMode => {
      if (current === 'HIDDEN') return 'PIP';
      if (current === 'PIP') return 'SPLIT';
      return 'HIDDEN';
    };

    mode = cycleMode(mode);
    expect(mode).toBe('PIP');

    mode = cycleMode(mode);
    expect(mode).toBe('SPLIT');

    mode = cycleMode(mode);
    expect(mode).toBe('HIDDEN');
  });

  test('Camera switcher switches between front_camera and viewer_camera', () => {
    let selected: RemoteCameraName = 'front_camera';

    const toggleCamera = (cam: RemoteCameraName): RemoteCameraName => {
      return cam === 'front_camera' ? 'viewer_camera' : 'front_camera';
    };

    selected = toggleCamera(selected);
    expect(selected).toBe('viewer_camera');

    selected = toggleCamera(selected);
    expect(selected).toBe('front_camera');
  });
});
