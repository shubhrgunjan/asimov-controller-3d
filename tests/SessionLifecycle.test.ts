/**
 * SessionLifecycle.test.ts
 * 
 * Formal Integration Tests for Milestone P4.2 — Connection & Session Management:
 * - Deterministic transitions: DISCONNECTED -> CONNECTING -> CONNECTED -> DEGRADED -> RECONNECTING -> FAILED
 * - Stale packet age and rate degradation tracking
 * - Automatic velocity neutralization upon connection loss (no stale command transmission)
 * - StateBuffer flush on fresh reconnect handshake
 * - Duplicate socket/timer prevention
 */

import { StateTransportClient, ConnectionState } from '../src/networking/StateTransportClient';
import { TeleopSessionManager } from '../src/app/TeleopSessionManager';
import {
  serializeStatePacket,
  AsimovRobotState,
  RobotMode,
  PolicyId,
  RecoveryState,
  CommandType,
  PROTOCOL_VERSION,
} from '../src/protocol/AsimovStateProtocol';

// Deterministic Mock WebSocket for session lifecycle testing
class SessionMockWebSocket {
  public static instances: SessionMockWebSocket[] = [];
  public static autoOpen: boolean = true;
  public static openDelayMs: number = 5;

  public readyState: number = 0; // 0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED
  public binaryType: string = 'blob';
  public url: string;
  public sentData: any[] = [];

  public onopen: (() => void) | null = null;
  public onmessage: ((event: any) => void) | null = null;
  public onerror: ((event: any) => void) | null = null;
  public onclose: ((event: any) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    SessionMockWebSocket.instances.push(this);

    if (SessionMockWebSocket.autoOpen) {
      setTimeout(() => {
        if (this.readyState === 0) {
          this.readyState = 1;
          if (this.onopen) this.onopen();
        }
      }, SessionMockWebSocket.openDelayMs);
    }
  }

  public send(data: any): void {
    this.sentData.push(data);
  }

  public close(): void {
    this.readyState = 3;
    if (this.onclose) this.onclose({} as any);
  }

  public simulateMessage(data: any): void {
    if (this.onmessage) {
      this.onmessage({ data });
    }
  }
}

// Helper to construct a mock VAS1 state packet
function createMockStatePacket(seq: number, timestamp: number): ArrayBuffer {
  const state: AsimovRobotState = {
    protocolVersion: PROTOCOL_VERSION,
    flags: 0,
    robotMode: RobotMode.STAND,
    policyId: PolicyId.OFFICIAL_LOCOMOTION,
    recoveryState: RecoveryState.NORMAL,
    safetyState: 0,
    sequenceNumber: seq,
    timestamp,
    basePosition: [0, 0, 0.72],
    baseOrientation: [0, 0, 0, 1],
    linearVelocity: [0, 0, 0],
    angularVelocity: [0, 0, 0],
    jointPositions: new Float32Array(25),
    jointVelocities: new Float32Array(25),
    commandEcho: {
      linearX: 0,
      linearY: 0,
      yaw: 0,
    },
  };
  return serializeStatePacket(state);
}

describe('P4.2: Connection & Session Lifecycle Management', () => {
  const originalWebSocket = (global as any).WebSocket;

  beforeEach(() => {
    SessionMockWebSocket.instances = [];
    SessionMockWebSocket.autoOpen = true;
    SessionMockWebSocket.openDelayMs = 5;
    (global as any).WebSocket = SessionMockWebSocket;
  });

  afterEach(() => {
    (global as any).WebSocket = originalWebSocket;
  });

  test('Session transitions cleanly: DISCONNECTED -> CONNECTING -> CONNECTED', async () => {
    const states: ConnectionState[] = [];
    const client = new StateTransportClient({
      host: '10.222.5.132',
      port: 8854,
      onConnectionChange: (s) => states.push(s),
    });

    expect(client.getMetrics().connectionState).toBe('DISCONNECTED');
    client.connect();
    expect(client.getMetrics().connectionState).toBe('CONNECTING');

    await new Promise((r) => setTimeout(r, 15));
    expect(client.getMetrics().connectionState).toBe('CONNECTED');
    expect(client.isConnected()).toBe(true);

    client.destroy();
  });

  test('Stops sending commands and neutralizes velocities upon server disconnect', async () => {
    const session = new TeleopSessionManager(undefined, undefined, {
      host: '10.222.5.132',
      port: 8854,
      autoConnect: false,
    });

    session.connect();
    await new Promise((r) => setTimeout(r, 15));
    expect(session.getConnectionState()).toBe('CONNECTED');

    // Operator applies forward joystick motion
    session.teleop.updateLeftJoystick(0.0, 1.0);
    const vBefore = session.teleop.getTargetVelocities();
    expect(vBefore.vx).toBeGreaterThan(0.5);

    // Simulate unexpected server crash/disconnect
    SessionMockWebSocket.instances[0].close();
    expect(session.getConnectionState()).toBe('RECONNECTING');

    // Teleop velocities must be immediately neutralized
    const vAfter = session.teleop.getTargetVelocities();
    expect(vAfter.vx).toBe(0);
    expect(vAfter.vy).toBe(0);
    expect(vAfter.wz).toBe(0);

    // Sending commands while disconnected must fail gracefully
    const sent = session.teleop.triggerAction(CommandType.STAND);
    expect(sent).toBe(false);

    session.dispose();
  });

  test('Flushes stale buffer snapshots upon reconnect handshake', async () => {
    const session = new TeleopSessionManager(undefined, undefined, {
      autoConnect: false,
      interpolationDelayMs: 40,
      reconnectIntervalMs: 10,
    });

    session.connect();
    await new Promise((r) => setTimeout(r, 15));
    const ws1 = SessionMockWebSocket.instances[0];

    // Push 5 state packets
    for (let i = 1; i <= 5; i++) {
      ws1.simulateMessage(createMockStatePacket(i, 100.0 + i * 0.02));
    }
    expect(session.buffer.getDepth()).toBe(5);

    // Disconnect
    ws1.close();
    expect(session.getConnectionState()).toBe('RECONNECTING');

    // Reconnect fires
    await new Promise((r) => setTimeout(r, 20));
    // Upon fresh connection, buffer must be reset to 0 to prevent temporal warping
    expect(session.buffer.getDepth()).toBe(0);

    session.dispose();
  });

  test('Transitions to FAILED when maxReconnectAttempts is exhausted', async () => {
    SessionMockWebSocket.autoOpen = false; // Never open

    const states: ConnectionState[] = [];
    const client = new StateTransportClient({
      reconnectIntervalMs: 10,
      maxReconnectAttempts: 2,
      onConnectionChange: (s) => states.push(s),
    });

    client.connect(); // Attempt 0 -> CONNECTING
    expect(client.getMetrics().connectionState).toBe('CONNECTING');

    // Simulate immediate failure to trigger reconnect
    SessionMockWebSocket.instances[0].close();
    expect(client.getMetrics().connectionState).toBe('RECONNECTING');

    // Wait for retry 1
    await new Promise((r) => setTimeout(r, 15));
    if (SessionMockWebSocket.instances[1]) SessionMockWebSocket.instances[1].close();

    // Wait for retry 2 (limit reached)
    await new Promise((r) => setTimeout(r, 25));
    if (SessionMockWebSocket.instances[2]) SessionMockWebSocket.instances[2].close();

    // Must transition to FAILED
    expect(client.getMetrics().connectionState).toBe('FAILED');
    expect(client.isConnected()).toBe(false);

    client.destroy();
  });

  test('Tracks lastPacketArrivalWallTime and computes lastPacketAgeMs', async () => {
    const client = new StateTransportClient({
      host: '10.222.5.132',
      port: 8854,
    });

    client.connect();
    await new Promise((r) => setTimeout(r, 15));
    const ws = SessionMockWebSocket.instances[0];

    ws.simulateMessage(createMockStatePacket(1, 100.0));
    const metrics1 = client.getMetrics();
    expect(metrics1.lastPacketArrivalWallTime).toBeGreaterThan(0);
    expect(metrics1.lastPacketAgeMs).toBeLessThan(50);

    // Wait 40ms and query metrics again
    await new Promise((r) => setTimeout(r, 40));
    const metrics2 = client.getMetrics();
    expect(metrics2.lastPacketAgeMs).toBeGreaterThanOrEqual(30);

    client.destroy();
  });

  test('Does not accumulate duplicate sockets or listeners on multiple connect/disconnect cycles', async () => {
    const client = new StateTransportClient({
      host: '10.222.5.132',
      port: 8854,
      autoReconnect: false,
    });

    for (let i = 0; i < 5; i++) {
      client.connect();
      await new Promise((r) => setTimeout(r, 10));
      client.disconnect();
    }

    // Only 5 instances created sequentially, each closed properly
    expect(SessionMockWebSocket.instances.length).toBe(5);
    for (const ws of SessionMockWebSocket.instances) {
      expect(ws.readyState).toBe(3); // CLOSED
    }

    client.destroy();
  });
});
