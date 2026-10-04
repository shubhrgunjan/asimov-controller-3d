/**
 * NetworkDiscovery.ts
 * 
 * Zero-Configuration Network Discovery & Dynamic Host Resolution.
 * Automatically resolves the backend IP on any Wi-Fi network (home, college, hotspot),
 * detects USB reverse tethering (127.0.0.1 via ADB), and dynamically discovers
 * active Virtual Asimov 1 simulation instances.
 */

export interface DiscoveredTarget {
  host: string;
  port: number;
  label: string;
  isOnline: boolean;
  priority: number;
}

/**
 * Extracts the development host IP address from Expo bundler metadata.
 * In any Expo environment (Home Wi-Fi, College, Hotspot), the phone connects
 * to the computer via hostUri or scriptURL. This is guaranteed to match the
 * machine running the VASIMOV simulation backend.
 */
export function getExpoHostAddress(): string | null {
  // 1. Try Expo Constants metadata
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = require('expo-constants')?.default || require('expo-constants');
    const hostUri =
      Constants?.expoConfig?.hostUri ||
      Constants?.manifest?.debuggerHost ||
      Constants?.manifest2?.extra?.expoClient?.hostUri;

    if (typeof hostUri === 'string' && hostUri) {
      const host = hostUri.split(':')[0];
      if (host && host !== 'localhost' && host !== '127.0.0.1') {
        return host;
      }
    }
  } catch {
    // Fallback if expo-constants is unavailable
  }

  // 2. Try React Native SourceCode scriptURL
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const RN = require('react-native');
    const scriptURL = RN?.NativeModules?.SourceCode?.scriptURL;
    if (typeof scriptURL === 'string' && scriptURL) {
      const match = scriptURL.match(/^https?:\/\/([^:\/]+)/);
      if (match && match[1] && match[1] !== 'localhost' && match[1] !== '127.0.0.1') {
        return match[1];
      }
    }
  } catch {
    // Non-native / headless environment fallback
  }

  return null;
}

/**
 * Perform a lightweight HTTP probe to verify if a VASIMOV backend is reachable.
 */
export async function probeBackend(host: string, httpPort: number = 8852, timeoutMs: number = 800): Promise<boolean> {
  if (!host) return false;
  let timeoutId: any;
  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`http://${host}:${httpPort}/api/state`, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.status === 200;
  } catch {
    if (timeoutId) clearTimeout(timeoutId);
    return false;
  }
}

/**
 * Discover all potential connection candidates and identify the active VASIMOV server.
 */
export async function discoverBackendTargets(configuredHost?: string): Promise<{
  activeTarget: DiscoveredTarget | null;
  candidates: DiscoveredTarget[];
}> {
  const expoHost = getExpoHostAddress();
  const candidatesList: { host: string; label: string; priority: number }[] = [];

  // Priority 1: Dynamically detected Expo host (same computer serving Expo)
  if (expoHost) {
    candidatesList.push({
      host: expoHost,
      label: `Wi-Fi (${expoHost})`,
      priority: 1,
    });
  }

  // Priority 2: USB Cable via ADB Reverse (127.0.0.1)
  candidatesList.push({
    host: '127.0.0.1',
    label: 'USB / Localhost (127.0.0.1)',
    priority: 2,
  });

  // Priority 3: Android Emulator loopback
  let isAndroid = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const RN = require('react-native');
    isAndroid = RN?.Platform?.OS === 'android';
  } catch {
    // Ignore in non-RN environments
  }

  if (isAndroid) {
    candidatesList.push({
      host: '10.0.2.2',
      label: 'Android Emulator (10.0.2.2)',
      priority: 3,
    });
  }

  // Priority 4: Stored / configured host if distinct
  if (configuredHost && !candidatesList.some((c) => c.host === configuredHost)) {
    candidatesList.push({
      host: configuredHost,
      label: `Custom (${configuredHost})`,
      priority: 4,
    });
  }

  // Probe in parallel with bounded timeout
  const evaluated = await Promise.all(
    candidatesList.map(async (item) => {
      const isOnline = await probeBackend(item.host);
      return {
        host: item.host,
        port: 8854,
        label: item.label,
        isOnline,
        priority: item.priority,
      };
    })
  );

  const active = evaluated.find((e) => e.isOnline) || null;

  return {
    activeTarget: active,
    candidates: evaluated,
  };
}
