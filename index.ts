// Polyfill navigator.userAgent for Three.js GLTFLoader on React Native / Hermes
if (typeof navigator !== 'undefined' && !(navigator as any).userAgent) {
  Object.defineProperty(navigator, 'userAgent', {
    value: 'ReactNative',
    configurable: true,
    writable: true,
  });
}

// Polyfill Blob & URL.createObjectURL across all scopes for Three.js GLTFLoader embedded textures
const g: any = typeof globalThis !== 'undefined' ? globalThis : typeof global !== 'undefined' ? global : {};

class SafeBlob {
  parts: any[];
  type: string;
  size: number;
  constructor(parts: any[] = [], options: any = {}) {
    this.parts = parts;
    this.type = options.type || '';
    let sz = 0;
    for (const p of parts) {
      if (p && typeof p.byteLength === 'number') sz += p.byteLength;
      else if (p && typeof p.size === 'number') sz += p.size;
      else if (typeof p === 'string') sz += p.length;
    }
    this.size = sz;
  }
}

g.Blob = SafeBlob;
if (typeof global !== 'undefined') (global as any).Blob = SafeBlob;
if (typeof self !== 'undefined') (self as any).Blob = SafeBlob;
if (typeof window !== 'undefined') (window as any).Blob = SafeBlob;

const URLObj = g.URL || (typeof global !== 'undefined' ? (global as any).URL : null) || (typeof window !== 'undefined' ? (window as any).URL : null) || {};
URLObj.createObjectURL = (_blobOrObj: any) => {
  // Safe 1x1 transparent PNG data URI so embedded image decoding never crashes
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
};
URLObj.revokeObjectURL = () => {};

g.URL = URLObj;
if (typeof global !== 'undefined') (global as any).URL = URLObj;
if (typeof self !== 'undefined') (self as any).URL = URLObj;
if (typeof window !== 'undefined') (window as any).URL = URLObj;

import { registerRootComponent } from 'expo';
import App from './src/app/App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately.
registerRootComponent(App);
