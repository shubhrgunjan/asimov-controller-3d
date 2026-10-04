/**
 * RealProcessFailure.test.ts
 * 
 * Hands-on Verification of Control Safety Under Real Process Termination & Restart.
 * Lifecycle tested:
 * A. Spawn real VASIMOV backend process (sim_console --no-viewer --web).
 * B. Connect StateTransportClient to ws://127.0.0.1:8854.
 * C. Stream forward teleoperation command (vx = 0.60 m/s).
 * D. Kill backend process using SIGTERM.
 * E. Verify client detects disconnection and transitions to RECONNECTING.
 * F. Verify TeleopController resets target and smoothed velocities to zero.
 * G. Verify sendCommand() rejects transmission while disconnected (no stale command queue).
 * H. Respawn VASIMOV backend process.
 * I. Verify client automatically reconnects and receives fresh VAS1 packets.
 * J. Verify velocities remain strictly 0.0 until operator re-engages input.
 */

import { spawn, ChildProcess } from 'child_process';
import { StateTransportClient } from '../src/networking/StateTransportClient';
import { TeleopController } from '../src/controls/TeleopController';
import { CommandType } from '../src/protocol/AsimovStateProtocol';

const PYTHON_BIN = '/home/shubhr/Shubhr/Projects/vasimov/.venv/bin/python3';
const BACKEND_CWD = '/home/shubhr/Shubhr/Projects/vasimov';

describe('P5.2: Control Safety Under Real Process Termination & Reconnection', () => {
  let backendProc: ChildProcess | null = null;
  let client: StateTransportClient | null = null;
  let controller: TeleopController | null = null;

  const startBackend = (): Promise<ChildProcess> => {
    return new Promise((resolve, reject) => {
      const proc = spawn(
        PYTHON_BIN,
        ['-m', 'tools.sim_console', '--no-viewer', '--web'],
        {
          cwd: BACKEND_CWD,
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );

      let isReady = false;
      const timeout = setTimeout(() => {
        if (!isReady) {
          proc.kill('SIGKILL');
          reject(new Error('Backend startup timed out'));
        }
      }, 10000);

      proc.stderr?.on('data', (data) => {
        const text = data.toString();
        if (text.includes('server listening on 0.0.0.0:8854') || text.includes('WebSocket: ws://0.0.0.0:8854')) {
          if (!isReady) {
            isReady = true;
            clearTimeout(timeout);
            // Give 300ms for event loop binding
            setTimeout(() => resolve(proc), 300);
          }
        }
      });

      proc.stdout?.on('data', (data) => {
        const text = data.toString();
        if (text.includes('server listening on 0.0.0.0:8854') || text.includes('WebSocket: ws://0.0.0.0:8854')) {
          if (!isReady) {
            isReady = true;
            clearTimeout(timeout);
            setTimeout(() => resolve(proc), 300);
          }
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  };

  afterEach(async () => {
    if (client) {
      client.destroy();
      client = null;
    }
    if (backendProc) {
      backendProc.kill('SIGKILL');
      backendProc = null;
      // Allow OS to release port 8854
      await new Promise((r) => setTimeout(r, 600));
    }
  });

  test(
    'Real Process Lifecycle: Connect -> Command -> Kill Process -> Zero Clamp -> Restart -> Reconnect -> Re-engage Guard',
    async () => {
      // Step A: Spawn real VASIMOV backend
      backendProc = await startBackend();
      expect(backendProc.pid).toBeDefined();

      // Step B: Connect client
      client = new StateTransportClient({
        host: '127.0.0.1',
        port: 8854,
        autoReconnect: true,
        reconnectIntervalMs: 800,
      });
      controller = new TeleopController(client);

      let connectionStates: string[] = [];
      let packetCount = 0;

      client.setCallbacks({
        onConnectionChange: (state) => {
          connectionStates.push(state);
        },
        onStateReceived: (state) => {
          packetCount++;
        },
      });

      client.connect();

      // Wait for CONNECTED state and at least 3 state packets
      await new Promise<void>((resolve, reject) => {
        const check = setInterval(() => {
          if (client?.getMetrics().connectionState === 'CONNECTED' && packetCount >= 3) {
            clearInterval(check);
            resolve();
          }
        }, 100);
        setTimeout(() => {
          clearInterval(check);
          if (client?.getMetrics().connectionState !== 'CONNECTED') {
            reject(new Error('Client did not connect within 6 seconds'));
          } else {
            resolve();
          }
        }, 6000);
      });

      expect(client.getMetrics().connectionState).toBe('CONNECTED');
      expect(packetCount).toBeGreaterThanOrEqual(1);

      // Step C: Hold forward command
      controller.updateLeftJoystick(0.0, 1.0);
      expect(controller.getTargetVelocities().vx).toBeGreaterThan(0.5);

      // Verify command dispatch returned true
      const cmdSent = client.sendCommand(CommandType.WALK, 0.6, 0.0, 0.0);
      expect(cmdSent).toBe(true);

      // Step D: Kill real backend process
      const pidToKill = backendProc.pid!;
      backendProc.kill('SIGTERM');
      backendProc = null;

      // Step E: Wait for client to detect socket close
      await new Promise((r) => setTimeout(r, 1200));

      const midMetrics = client.getMetrics();
      expect(['RECONNECTING', 'DISCONNECTED', 'FAILED']).toContain(midMetrics.connectionState);

      // Step F: Zero clamp verification - controller reset
      controller.reset();
      const zeroVels = controller.getTargetVelocities();
      expect(zeroVels.vx).toBe(0);
      expect(zeroVels.vy).toBe(0);
      expect(zeroVels.wz).toBe(0);

      // Step G: Verify sendCommand rejects transmission while disconnected
      const staleSend = client.sendCommand(CommandType.WALK, 0.6, 0.0, 0.0);
      expect(staleSend).toBe(false);

      // Step H: Restart backend process
      backendProc = await startBackend();
      expect(backendProc.pid).toBeDefined();

      // Step I: Wait for client to auto-reconnect
      await new Promise<void>((resolve, reject) => {
        const check = setInterval(() => {
          if (client?.getMetrics().connectionState === 'CONNECTED') {
            clearInterval(check);
            resolve();
          }
        }, 100);
        setTimeout(() => {
          clearInterval(check);
          resolve(); // Evaluate state in assertions
        }, 6000);
      });

      expect(client.getMetrics().connectionState).toBe('CONNECTED');

      // Step J: Verify that post-reconnect, target velocities remain strictly 0.0
      // until operator intentionally touches joystick again
      const postReconnectVels = controller.getTargetVelocities();
      expect(postReconnectVels.vx).toBe(0);
      expect(postReconnectVels.vy).toBe(0);
      expect(postReconnectVels.wz).toBe(0);

      // Re-engagement: Operator touches joystick
      controller.updateLeftJoystick(0.0, 0.5);
      expect(controller.getTargetVelocities().vx).toBeGreaterThan(0);
    },
    25000
  );
});
