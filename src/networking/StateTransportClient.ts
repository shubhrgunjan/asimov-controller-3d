/**
 * StateTransportClient.ts
 * 
 * High-Performance Android Binary Network Client for VASIMOV.
 * Connects to ws://<host>:8854, receives 50 Hz VAS1 binary state packets,
 * transmits 32-byte VAC1 command packets, tracks empirical network telemetry,
 * and maintains clean reconnect lifecycles without React re-render overhead.
 */

import {
  parseStatePacket,
  serializeCommandPacket,
  AsimovRobotState,
  AsimovControlCommand,
  CommandType,
  STATE_PACKET_SIZE,
  COMMAND_PACKET_SIZE,
  PROTOCOL_VERSION,
} from '../protocol/AsimovStateProtocol';

export type ConnectionState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'DEGRADED'
  | 'RECONNECTING'
  | 'FAILED';

export interface NetworkMetrics {
  connectionState: ConnectionState;
  host: string;
  port: number;
  packetsReceived: number;
  packetsDropped: number;
  sequenceGaps: number;
  packetRateHz: number;
  packetLossPercent: number;
  lastSequenceNumber: number;
  lastPacketTimestamp: number;
  lastPacketArrivalWallTime: number;
  lastPacketAgeMs: number;
  rttMs: number;
  stalePacketsRejected: number;
  malformedPacketsRejected: number;
  reconnectCount: number;
}

export interface StateTransportClientOptions {
  host?: string;
  port?: number;
  autoReconnect?: boolean;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
  onStateReceived?: (state: AsimovRobotState) => void;
  onConnectionChange?: (state: ConnectionState) => void;
  onEnvironmentReceived?: (envData: any) => void;
}

export class StateTransportClient {
  private host: string;
  private port: number;
  private autoReconnect: boolean;
  private reconnectIntervalMs: number;
  private maxReconnectAttempts: number;
  private consecutiveFailures: number = 0;

  private ws: WebSocket | null = null;
  private connectionState: ConnectionState = 'DISCONNECTED';
  private reconnectTimer: any = null;
  private isDestroyed: boolean = false;

  // Listeners & Buffers
  private onStateReceived: ((state: AsimovRobotState) => void) | null = null;
  private onConnectionChange: ((state: ConnectionState) => void) | null = null;
  private onEnvironmentReceived: ((envData: any) => void) | null = null;

  // Real Empirical Metrics (No fake values)
  private metrics: NetworkMetrics = {
    connectionState: 'DISCONNECTED',
    host: '127.0.0.1',
    port: 8854,
    packetsReceived: 0,
    packetsDropped: 0,
    sequenceGaps: 0,
    packetRateHz: 0,
    packetLossPercent: 0,
    lastSequenceNumber: 0,
    lastPacketTimestamp: 0,
    lastPacketArrivalWallTime: 0,
    lastPacketAgeMs: 0,
    rttMs: 0,
    stalePacketsRejected: 0,
    malformedPacketsRejected: 0,
    reconnectCount: 0,
  };

  // Sliding window for rate calculation
  private packetTimestamps: number[] = [];
  private lastRateCheckTime: number = 0;
  private expectedSequence: number = 0;

  // Command sequence counter
  private commandSequence: number = 0;

  constructor(options: StateTransportClientOptions = {}) {
    this.host = options.host || '127.0.0.1';
    this.port = options.port || 8854;
    this.autoReconnect = options.autoReconnect ?? true;
    this.reconnectIntervalMs = options.reconnectIntervalMs || 1000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 500;
    this.onStateReceived = options.onStateReceived || null;
    this.onConnectionChange = options.onConnectionChange || null;
    this.onEnvironmentReceived = options.onEnvironmentReceived || null;

    this.metrics.host = this.host;
    this.metrics.port = this.port;
  }

  public setHost(host: string, port?: number): void {
    const changed = this.host !== host || (port !== undefined && this.port !== port);
    this.host = host;
    if (port !== undefined) this.port = port;
    this.metrics.host = this.host;
    this.metrics.port = this.port;

    if (changed && this.connectionState === 'CONNECTED') {
      this.disconnect();
      this.connect();
    }
  }

  public setCallbacks(callbacks: {
    onStateReceived?: (state: AsimovRobotState) => void;
    onConnectionChange?: (state: ConnectionState) => void;
    onEnvironmentReceived?: (envData: any) => void;
  }): void {
    if (callbacks.onStateReceived !== undefined) {
      this.onStateReceived = callbacks.onStateReceived;
    }
    if (callbacks.onConnectionChange !== undefined) {
      this.onConnectionChange = callbacks.onConnectionChange;
    }
    if (callbacks.onEnvironmentReceived !== undefined) {
      this.onEnvironmentReceived = callbacks.onEnvironmentReceived;
    }
  }

  /**
   * Connect to VASIMOV WebSocket server
   */
  public connect(): void {
    if (this.isDestroyed) return;

    // Clean up any stale or half-open socket before opening a fresh one
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }

    this.setConnectionState(this.metrics.reconnectCount > 0 ? 'RECONNECTING' : 'CONNECTING');

    const url = `ws://${this.host}:${this.port}`;
    try {
      this.ws = new WebSocket(url);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = this.handleOpen.bind(this);
      this.ws.onmessage = this.handleMessage.bind(this);
      this.ws.onerror = this.handleError.bind(this);
      this.ws.onclose = this.handleClose.bind(this);
    } catch (err) {
      this.scheduleReconnect();
    }
  }

  public disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.consecutiveFailures = 0;

    if (this.ws) {
      // Remove handlers before closing
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }

    this.setConnectionState('DISCONNECTED');
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.disconnect();
    this.onStateReceived = null;
    this.onConnectionChange = null;
  }

  private handleOpen(): void {
    this.consecutiveFailures = 0;
    this.setConnectionState('CONNECTED');
    this.expectedSequence = 0;
    this.metrics.lastSequenceNumber = 0;

    // Send binary stream subscription request
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ action: 'subscribe', params: { format: 'binary' } }));
      }
    } catch (_) {}
  }

  private processBinaryPacket(buffer: ArrayBuffer, now: number): void {
    if (buffer.byteLength !== STATE_PACKET_SIZE) {
      this.metrics.malformedPacketsRejected++;
      return;
    }

    let state: AsimovRobotState;
    try {
      state = parseStatePacket(buffer);
    } catch (_) {
      this.metrics.malformedPacketsRejected++;
      return;
    }

    // Sequence validation & stale packet rejection
    const seq = state.sequenceNumber;
    if (this.expectedSequence > 0) {
      // Detect stale / out-of-order packets
      if (seq <= this.metrics.lastSequenceNumber && Math.abs(seq - this.metrics.lastSequenceNumber) < 100000) {
        this.metrics.stalePacketsRejected++;
        return;
      }

      // Detect sequence gaps (dropped packets)
      const gap = seq - this.expectedSequence;
      if (gap > 0) {
        this.metrics.sequenceGaps += gap;
        this.metrics.packetsDropped += gap;
      }
    }

    this.metrics.lastSequenceNumber = seq;
    this.expectedSequence = seq + 1;
    this.metrics.lastPacketTimestamp = state.timestamp;
    this.metrics.lastPacketArrivalWallTime = now;
    this.metrics.lastPacketAgeMs = 0;
    this.metrics.packetsReceived++;

    // Track packet arrival for real packet rate calculation
    this.packetTimestamps.push(now);
    this.updatePacketRate(now);

    // Notify consumer (e.g. StateBuffer) outside render loop
    if (this.onStateReceived) {
      this.onStateReceived(state);
    }
  }

  private handleMessage(event: WebSocketMessageEvent): void {
    const now = Date.now();

    // 1. Process Binary Packet (VAS1 State)
    if (event.data instanceof ArrayBuffer) {
      this.processBinaryPacket(event.data, now);
      return;
    }

    if (typeof Blob !== 'undefined' && event.data instanceof Blob) {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          this.processBinaryPacket(reader.result, now);
        }
      };
      reader.readAsArrayBuffer(event.data);
      return;
    }

    // 2. Process JSON Control Acknowledgements, Environment Sync, or Text Messages
    if (typeof event.data === 'string') {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'environment' || msg.action === 'environment') {
          const envData = msg.data || msg.params || msg;
          if (this.onEnvironmentReceived) {
            this.onEnvironmentReceived(envData);
          }
        } else if (msg.type === 'ack' && msg.ack && msg.ack.timestamp) {
          // Empirical RTT calculation
          const echoTime = msg.ack.timestamp * 1000;
          const rtt = now - echoTime;
          if (rtt >= 0 && rtt < 5000) {
            this.metrics.rttMs = Math.round(rtt * 10) / 10;
          }
        }
      } catch (_) {}
    }
  }

  private handleError(_event: any): void {
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
    if (this.autoReconnect && !this.isDestroyed) {
      this.setConnectionState('RECONNECTING');
      this.scheduleReconnect();
    }
  }

  private handleClose(): void {
    this.ws = null;
    if (this.autoReconnect && !this.isDestroyed) {
      this.setConnectionState('RECONNECTING');
      this.scheduleReconnect();
    } else {
      this.setConnectionState('DISCONNECTED');
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.isDestroyed) return;

    if (this.consecutiveFailures >= this.maxReconnectAttempts) {
      this.setConnectionState('FAILED');
      // Rather than staying dead indefinitely, back off to 5s periodic check
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (this.autoReconnect && !this.isDestroyed) {
          this.connect();
        }
      }, 5000);
      return;
    }

    this.consecutiveFailures++;
    this.metrics.reconnectCount++;
    this.setConnectionState('RECONNECTING');

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectIntervalMs);
  }

  private setConnectionState(state: ConnectionState): void {
    this.connectionState = state;
    this.metrics.connectionState = state;
    if (this.onConnectionChange) {
      this.onConnectionChange(state);
    }
  }

  private updatePacketRate(now: number): void {
    // Maintain 1.0 second sliding window
    const windowStart = now - 1000;
    while (this.packetTimestamps.length > 0 && this.packetTimestamps[0] < windowStart) {
      this.packetTimestamps.shift();
    }

    this.metrics.packetRateHz = this.packetTimestamps.length;

    // Real packet loss percentage
    const totalExpected = this.metrics.packetsReceived + this.metrics.packetsDropped;
    if (totalExpected > 0) {
      this.metrics.packetLossPercent =
        Math.round((this.metrics.packetsDropped / totalExpected) * 1000) / 10;
    }

    // Packet rate degradation detection
    if (this.connectionState === 'CONNECTED' && this.metrics.packetRateHz < 20 && this.metrics.packetsReceived > 20) {
      this.setConnectionState('DEGRADED');
    } else if (this.connectionState === 'DEGRADED' && this.metrics.packetRateHz >= 40) {
      this.setConnectionState('CONNECTED');
    }
  }

  public resetReconnectCount(): void {
    this.metrics.reconnectCount = 0;
  }

  /**
   * Send binary teleoperation command (VAC1) to VASIMOV backend
   */
  public sendCommand(
    commandType: number,
    linearX: number = 0.0,
    linearY: number = 0.0,
    yawRate: number = 0.0,
    flags: number = 0
  ): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    this.commandSequence++;
    const cmd: AsimovControlCommand = {
      protocolVersion: PROTOCOL_VERSION,
      commandType,
      flags,
      sequenceNumber: this.commandSequence,
      timestamp: Date.now() / 1000.0,
      linearX,
      linearY,
      yawRate,
    };

    try {
      const buffer = serializeCommandPacket(cmd);
      this.ws.send(buffer);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Request authoritative environment configuration from VASIMOV over WebSocket
   */
  public queryEnvironment(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ action: 'get_environment' }));
      } catch (_) {}
    }
  }

  /**
   * Request environment preset change on VASIMOV simulation over WebSocket
   */
  public setEnvironmentPreset(preset: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ action: 'environment', params: { preset } }));
      } catch (_) {}
    }
  }

  /**
   * Get low-frequency empirical diagnostics snapshot (for UI HUD @ 2-4 Hz)
   */
  public getMetrics(): NetworkMetrics {
    const now = Date.now();
    const lastArrival = this.metrics.lastPacketArrivalWallTime;
    this.metrics.lastPacketAgeMs = lastArrival > 0 ? Math.max(0, now - lastArrival) : 0;
    return { ...this.metrics };
  }

  public isConnected(): boolean {
    return this.connectionState === 'CONNECTED';
  }
}
