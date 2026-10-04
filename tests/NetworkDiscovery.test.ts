/**
 * NetworkDiscovery.test.ts
 * 
 * Verifies dynamic network host detection, probe mechanism,
 * and automated candidate ranking for LAN/Wi-Fi, USB, and emulators.
 */

import { getExpoHostAddress, probeBackend, discoverBackendTargets } from '../src/utils/NetworkDiscovery';

describe('NetworkDiscovery', () => {
  beforeEach(() => {
    jest.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      const url = input.toString();
      if (url.includes('127.0.0.1:8852')) {
        return { status: 200 } as any;
      }
      throw new Error('Connection refused');
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns null or detected IP safely in node test environment', () => {
    const host = getExpoHostAddress();
    expect(host === null || typeof host === 'string').toBe(true);
  });

  it('fails gracefully when probing unreachable host', async () => {
    const isOnline = await probeBackend('192.0.2.1', 8852, 100);
    expect(isOnline).toBe(false);
  });

  it('succeeds when probing reachable host', async () => {
    const isOnline = await probeBackend('127.0.0.1', 8852, 100);
    expect(isOnline).toBe(true);
  });

  it('discovers candidate list with USB localhost fallback and priority ranking', async () => {
    const { activeTarget, candidates } = await discoverBackendTargets('192.168.1.99');
    
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    
    // USB cable fallback must always be a candidate
    const usbCandidate = candidates.find(c => c.host === '127.0.0.1');
    expect(usbCandidate).toBeDefined();
    expect(usbCandidate?.priority).toBe(2);
    expect(usbCandidate?.isOnline).toBe(true);

    // Custom host candidate should be included
    const customCandidate = candidates.find(c => c.host === '192.168.1.99');
    expect(customCandidate).toBeDefined();
    expect(customCandidate?.priority).toBe(4);

    // Active target should be resolved to the online candidate
    expect(activeTarget?.host).toBe('127.0.0.1');
  });
});
