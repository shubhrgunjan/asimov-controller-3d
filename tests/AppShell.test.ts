/**
 * AppShell.test.ts
 * 
 * Unit & Integration Tests for Phase 4 Application Shell:
 * - AppStateMachine deterministic transitions
 * - GlobalConnectionState transitions (DISCONNECTED, CONNECTING, CONNECTED, DEGRADED, RECONNECTING, FAILED)
 * - AppSettingsManager persistence and change subscriptions
 * - Boundary condition and navigation history checks
 */

import { AppStateMachine, AppScreen, GlobalConnectionState } from '../src/app/navigation/AppStateMachine';
import { AppSettingsManager, DEFAULT_APP_CONFIG } from '../src/settings/AppSettings';

describe('AppStateMachine', () => {
  let sm: AppStateMachine;

  beforeEach(() => {
    sm = new AppStateMachine('HOME');
  });

  test('initializes with specified starting screen and DISCONNECTED state', () => {
    expect(sm.getScreen()).toBe('HOME');
    expect(sm.getConnectionState()).toBe('DISCONNECTED');
    expect(sm.getErrorMessage()).toBeNull();
  });

  test('navigates cleanly between allowed screens', () => {
    expect(sm.navigate('TELEOPERATION')).toBe(true);
    expect(sm.getScreen()).toBe('TELEOPERATION');
    expect(sm.getPreviousScreen()).toBe('HOME');

    expect(sm.navigate('SETTINGS')).toBe(true);
    expect(sm.getScreen()).toBe('SETTINGS');
    expect(sm.getPreviousScreen()).toBe('TELEOPERATION');
  });

  test('goBack returns to previous screen from SETTINGS', () => {
    sm.navigate('TELEOPERATION');
    sm.navigate('SETTINGS');
    expect(sm.getScreen()).toBe('SETTINGS');

    const result = sm.goBack();
    expect(result).toBe(true);
    expect(sm.getScreen()).toBe('TELEOPERATION');
  });

  test('goBack returns to HOME from BENCHMARK', () => {
    sm.navigate('BENCHMARK');
    expect(sm.getScreen()).toBe('BENCHMARK');

    const result = sm.goBack();
    expect(result).toBe(true);
    expect(sm.getScreen()).toBe('HOME');
  });

  test('automatically navigates to CONNECTING when connection state changes to CONNECTING from HOME', () => {
    expect(sm.getScreen()).toBe('HOME');
    sm.setConnectionState('CONNECTING');
    expect(sm.getScreen()).toBe('CONNECTING');
    expect(sm.getConnectionState()).toBe('CONNECTING');
  });

  test('automatically navigates to TELEOPERATION when connection handshakes successfully', () => {
    sm.setConnectionState('CONNECTING');
    expect(sm.getScreen()).toBe('CONNECTING');

    sm.setConnectionState('CONNECTED');
    expect(sm.getScreen()).toBe('TELEOPERATION');
    expect(sm.getConnectionState()).toBe('CONNECTED');
  });

  test('transitions to DEGRADED and maintains TELEOPERATION screen', () => {
    sm.setConnectionState('CONNECTING');
    sm.setConnectionState('CONNECTED');
    expect(sm.getScreen()).toBe('TELEOPERATION');

    sm.setConnectionState('DEGRADED', 'Packet rate below 20 Hz');
    expect(sm.getScreen()).toBe('TELEOPERATION');
    expect(sm.getConnectionState()).toBe('DEGRADED');
    expect(sm.getErrorMessage()).toBe('Packet rate below 20 Hz');

    // Recovers back to CONNECTED
    sm.setConnectionState('CONNECTED');
    expect(sm.getConnectionState()).toBe('CONNECTED');
    expect(sm.getErrorMessage()).toBeNull();
  });

  test('returns to HOME when handshake FAILS from CONNECTING', () => {
    sm.setConnectionState('CONNECTING');
    expect(sm.getScreen()).toBe('CONNECTING');

    sm.setConnectionState('FAILED', 'ECONNREFUSED 10.222.5.132:8854');
    expect(sm.getScreen()).toBe('HOME');
    expect(sm.getConnectionState()).toBe('FAILED');
    expect(sm.getErrorMessage()).toBe('ECONNREFUSED 10.222.5.132:8854');
  });

  test('notifies subscribers upon state and screen changes', () => {
    const events: Array<{ screen: AppScreen; conn: GlobalConnectionState }> = [];
    const unsubscribe = sm.subscribe((snapshot) => {
      events.push({ screen: snapshot.screen, conn: snapshot.connectionState });
    });

    sm.navigate('HOME');
    sm.setConnectionState('CONNECTING');
    sm.setConnectionState('CONNECTED');

    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events[events.length - 1].screen).toBe('TELEOPERATION');
    unsubscribe();

    // After unsubscribe, no further events are received
    sm.navigate('HOME');
    expect(events[events.length - 1].screen).toBe('TELEOPERATION');
  });

  test('records bounded snapshot history', () => {
    for (let i = 0; i < 30; i++) {
      sm.navigate(i % 2 === 0 ? 'HOME' : 'SETTINGS');
    }
    const history = sm.getHistory();
    expect(history.length).toBeLessThanOrEqual(20);
  });
});

describe('AppSettingsManager', () => {
  let settings: AppSettingsManager;

  beforeEach(() => {
    settings = new AppSettingsManager();
  });

  test('initializes with default operational parameters', () => {
    const config = settings.getConfig();
    expect(config.connection.port).toBe(8854);
    expect(config.connection.autoReconnect).toBe(true);
    expect(config.rendering.resolution).toBe('720p');
    expect(config.synchronization.interpolationDelayMs).toBe(40);
    expect(config.diagnostics.showDevHud).toBe(false);
  });

  test('updates connection configuration correctly', () => {
    settings.updateConnection({ host: '192.168.1.100', port: 9000 });
    const config = settings.getConfig();
    expect(config.connection.host).toBe('192.168.1.100');
    expect(config.connection.port).toBe(9000);
    expect(config.connection.autoReconnect).toBe(true); // Preserves other fields
  });

  test('updates rendering configuration correctly', () => {
    settings.updateRendering({ resolution: '1080p' });
    expect(settings.getConfig().rendering.resolution).toBe('1080p');
  });

  test('updates synchronization parameters correctly', () => {
    settings.updateSynchronization({ interpolationDelayMs: 20, adaptiveBuffer: true });
    const config = settings.getConfig();
    expect(config.synchronization.interpolationDelayMs).toBe(20);
    expect(config.synchronization.adaptiveBuffer).toBe(true);
  });

  test('updates diagnostics configuration correctly', () => {
    settings.updateDiagnostics({ showDevHud: true, logLevel: 'DEBUG' });
    const config = settings.getConfig();
    expect(config.diagnostics.showDevHud).toBe(true);
    expect(config.diagnostics.logLevel).toBe('DEBUG');
  });

  test('resets cleanly back to defaults', () => {
    settings.updateConnection({ host: 'custom-host', port: 9999 });
    settings.updateRendering({ resolution: '1080p' });
    settings.resetToDefaults();

    const config = settings.getConfig();
    expect(config.connection.host).toBe(DEFAULT_APP_CONFIG.connection.host);
    expect(config.connection.port).toBe(DEFAULT_APP_CONFIG.connection.port);
    expect(config.rendering.resolution).toBe(DEFAULT_APP_CONFIG.rendering.resolution);
  });

  test('notifies subscribers upon configuration changes', () => {
    let callCount = 0;
    const unsubscribe = settings.subscribe(() => {
      callCount++;
    });

    settings.updateConnection({ host: 'new-host' });
    settings.updateRendering({ resolution: '1080p' });
    expect(callCount).toBe(2);

    unsubscribe();
    settings.updateDiagnostics({ showDevHud: true });
    expect(callCount).toBe(2);
  });
});
