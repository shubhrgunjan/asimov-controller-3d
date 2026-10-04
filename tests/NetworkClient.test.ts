/**
 * NetworkClient.test.ts
 * 
 * Unit tests for StateTransportClient:
 * - Connection lifecycle (CONNECTING, CONNECTED, DISCONNECTED, RECONNECTING)
 * - Binary state reception & deserialization
 * - Sequence validation, loss tracking & stale packet rejection
 * - Malformed packet rejection
 * - Command serialization and sending
 * - Reconnect scheduling
 */

import { StateTransportClient } from '../src/networking/StateTransportClient';
import {
  serializeStatePacket,
  parseCommandPacket,
  AsimovRobotState,
  RobotMode,
  PolicyId,
  RecoveryState,
  CommandType,
  PROTOCOL_VERSION,
  STATE_PACKET_SIZE,
} from '../src/protocol/AsimovStateProtocol';

// Mock WebSocket
class MockWebSocket {
  public static instances: MockWebSocket[] = [];
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSING = 2;
  public static readonly CLOSED = 3;

  public binaryType: string = 'blob';
  public readyState: number = 0; // 0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED
  public url: string;
  public sentData: any[] = [];

  public onopen: (() => void) | null = null;
  public onmessage: ((event: any) => void) | null = null;
  public onerror: ((event: any) => void) | null = null;
  public onclose: ((event: any) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = 1;
      if (this.onopen) this.onopen();
    }, 10);
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

(global as any).WebSocket = MockWebSocket;

describe('Phase 3 Networking Client: StateTransportClient', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    jest.clearAllMocks();
  });

  const createDummyState = (seq: number, time: number): AsimovRobotState => ({
    protocolVersion: PROTOCOL_VERSION,
    flags: 0,
    robotMode: RobotMode.STAND,
    policyId: PolicyId.OFFICIAL_LOCOMOTION,
    recoveryState: RecoveryState.NORMAL,
    safetyState: 0,
    sequenceNumber: seq,
    timestamp: time,
    basePosition: [0, 0, 0.61],
    baseOrientation: [0, 0, 0, 1],
    linearVelocity: [0, 0, 0],
    angularVelocity: [0, 0, 0],
    jointPositions: new Float32Array(25),
    jointVelocities: new Float32Array(25),
    commandEcho: { linearX: 0, linearY: 0, yaw: 0 },
  });

  test('P3.3.1: Connects and transitions connectionState to CONNECTED', async () => {
    const states: string[] = [];
    const client = new StateTransportClient({
      host: '192.168.1.100',
      port: 8854,
      onConnectionChange: (s) => states.push(s),
    });

    client.connect();
    expect(client.getMetrics().connectionState).toBe('CONNECTING');

    await new Promise((r) => setTimeout(r, 20));
    expect(client.getMetrics().connectionState).toBe('CONNECTED');
    expect(client.isConnected()).toBe(true);

    const mockWs = MockWebSocket.instances[0];
    expect(mockWs.sentData.length).toBe(1);
    expect(mockWs.sentData[0]).toContain('subscribe');

    client.destroy();
  });

  test('P3.3.2: Receives binary state packets and notifies onStateReceived', async () => {
    let receivedState: any = null;
    const client = new StateTransportClient({
      onStateReceived: (st) => {
        receivedState = st;
      },
    });

    client.connect();
    await new Promise((r) => setTimeout(r, 20));

    const mockWs = MockWebSocket.instances[0];
    const dummy = createDummyState(1, 10.0);
    const packet = serializeStatePacket(dummy);

    mockWs.simulateMessage(packet);

    expect(receivedState).not.toBeNull();
    expect(receivedState?.sequenceNumber).toBe(1);
    expect(receivedState?.timestamp).toBeCloseTo(10.0, 3);
    expect(client.getMetrics().packetsReceived).toBe(1);

    client.destroy();
  });

  test('P3.3.3: Detects sequence gaps and computes packet loss percentage', async () => {
    const client = new StateTransportClient();
    client.connect();
    await new Promise((r) => setTimeout(r, 20));
    const mockWs = MockWebSocket.instances[0];

    // Packet 1
    mockWs.simulateMessage(serializeStatePacket(createDummyState(1, 10.0)));
    // Packet 5 (missed 2, 3, 4 -> 3 dropped)
    mockWs.simulateMessage(serializeStatePacket(createDummyState(5, 10.08)));

    const m = client.getMetrics();
    expect(m.packetsReceived).toBe(2);
    expect(m.packetsDropped).toBe(3);
    expect(m.sequenceGaps).toBe(3);
    expect(m.packetLossPercent).toBeCloseTo(60.0, 1); // 3 / 5 = 60%

    client.destroy();
  });

  test('P3.3.4: Rejects stale or duplicate packets without affecting state', async () => {
    let stateUpdates = 0;
    const client = new StateTransportClient({
      onStateReceived: () => stateUpdates++,
    });
    client.connect();
    await new Promise((r) => setTimeout(r, 20));
    const mockWs = MockWebSocket.instances[0];

    // Packet 10
    mockWs.simulateMessage(serializeStatePacket(createDummyState(10, 1.0)));
    expect(stateUpdates).toBe(1);

    // Duplicate packet 10
    mockWs.simulateMessage(serializeStatePacket(createDummyState(10, 1.0)));
    expect(stateUpdates).toBe(1); // not updated!

    // Stale packet 8 (out-of-order)
    mockWs.simulateMessage(serializeStatePacket(createDummyState(8, 0.8)));
    expect(stateUpdates).toBe(1); // not updated!

    expect(client.getMetrics().stalePacketsRejected).toBe(2);
    client.destroy();
  });

  test('P3.3.5: Rejects malformed and truncated binary packets', async () => {
    const client = new StateTransportClient();
    client.connect();
    await new Promise((r) => setTimeout(r, 20));
    const mockWs = MockWebSocket.instances[0];

    // Truncated (100 bytes)
    mockWs.simulateMessage(new ArrayBuffer(100));
    // Corrupted magic
    const valid = serializeStatePacket(createDummyState(1, 0.0));
    new Uint8Array(valid)[0] = 0x00; // corrupt magic
    mockWs.simulateMessage(valid);

    const m = client.getMetrics();
    expect(m.malformedPacketsRejected).toBe(2);
    expect(m.packetsReceived).toBe(0);

    client.destroy();
  });

  test('P3.3.6: Serializes and transmits VAC1 commands', async () => {
    const client = new StateTransportClient();
    client.connect();
    await new Promise((r) => setTimeout(r, 20));
    const mockWs = MockWebSocket.instances[0];

    const ok = client.sendCommand(CommandType.WALK, 0.45, -0.1, 0.2);
    expect(ok).toBe(true);

    expect(mockWs.sentData.length).toBe(2); // subscription + binary cmd
    const cmdBuffer = mockWs.sentData[1];
    expect(cmdBuffer instanceof ArrayBuffer).toBe(true);
    expect(cmdBuffer.byteLength).toBe(32);

    const parsedCmd = parseCommandPacket(cmdBuffer);
    expect(parsedCmd.commandType).toBe(CommandType.WALK);
    expect(parsedCmd.linearX).toBeCloseTo(0.45, 3);
    expect(parsedCmd.linearY).toBeCloseTo(-0.1, 3);
    expect(parsedCmd.yawRate).toBeCloseTo(0.2, 3);

    client.destroy();
  });

  test('P3.3.7: Handles server disconnect and schedules clean reconnect', async () => {
    const states: string[] = [];
    const client = new StateTransportClient({
      reconnectIntervalMs: 50,
      onConnectionChange: (s) => states.push(s),
    });

    client.connect();
    await new Promise((r) => setTimeout(r, 20));
    expect(client.isConnected()).toBe(true);

    // Simulate unexpected server close
    MockWebSocket.instances[0].close();
    expect(client.isConnected()).toBe(false);
    expect(client.getMetrics().connectionState).toBe('RECONNECTING');

    // Wait for reconnect timer to fire
    await new Promise((r) => setTimeout(r, 80));
    expect(MockWebSocket.instances.length).toBe(2);
    expect(client.getMetrics().reconnectCount).toBe(1);

    client.destroy();
  });
});
