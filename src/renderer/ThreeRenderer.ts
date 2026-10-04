import * as THREE from 'three';
import { ExpoWebGLRenderingContext } from 'expo-gl';

export type ResolutionMode = '720p' | '1080p' | 'native';

export interface RendererResolution {
  width: number;
  height: number;
  pixelRatio: number;
  label: string;
}

export interface RenderStats {
  calls: number;
  triangles: number;
  points: number;
  lines: number;
  geometries: number;
  textures: number;
  programs: number;
  renderCpuTimeMs: number;
  resolution: {
    width: number;
    height: number;
  };
}

/**
 * ThreeRenderer
 * 
 * Hardware-accelerated Three.js WebGL renderer integrated with Android's
 * native OpenGL ES surface via Expo GLView (EGLSurface / Choreographer).
 */
export class ThreeRenderer {
  private gl: ExpoWebGLRenderingContext;
  private renderer: THREE.WebGLRenderer;
  private currentResolutionMode: ResolutionMode = '720p';
  private nativeWidth: number;
  private nativeHeight: number;
  private activeWidth: number = 1280;
  private activeHeight: number = 720;
  private shadowsEnabled: boolean = true;

  constructor(gl: ExpoWebGLRenderingContext) {
    this.gl = gl;
    this.nativeWidth = gl.drawingBufferWidth || 1280;
    this.nativeHeight = gl.drawingBufferHeight || 720;

    // Create synthetic canvas descriptor for Three.js WebGLRenderer compatibility with React Native GLView
    const mockCanvas = {
      width: this.nativeWidth,
      height: this.nativeHeight,
      style: {},
      addEventListener: () => {},
      removeEventListener: () => {},
      clientWidth: this.nativeWidth,
      clientHeight: this.nativeHeight,
      getContext: () => gl,
    } as unknown as HTMLCanvasElement;

    // In Three.js r163+, THREE.WebGLRenderer checks:
    // `if (typeof WebGLRenderingContext !== 'undefined' && context instanceof WebGLRenderingContext)`
    // and throws "WebGL 1 is not supported since r163".
    // In expo-gl, WebGL2RenderingContext inherits from WebGLRenderingContext, which erroneously
    // triggers this WebGL 1 rejection. We override Symbol.hasInstance on WebGLRenderingContext
    // so Three.js properly treats Expo's OpenGL ES 3.0 / WebGL2 context as WebGL2.
    if (typeof WebGLRenderingContext !== 'undefined') {
      try {
        Object.defineProperty(WebGLRenderingContext, Symbol.hasInstance, {
          value: () => false,
          configurable: true,
        });
      } catch {
        // Fallback for environments with locked intrinsics
      }
    }

    this.renderer = new THREE.WebGLRenderer({
      canvas: mockCanvas,
      context: gl as unknown as WebGLRenderingContext,
      antialias: true,
      powerPreference: 'high-performance',
      precision: 'highp',
      stencil: false,
      depth: true,
    });

    // Configure high-efficiency shadow mapping
    this.renderer.shadowMap.enabled = this.shadowsEnabled;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Configure tone mapping for realistic physical materials
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    // Apply initial resolution
    this.setResolution(this.currentResolutionMode);
  }

  /**
   * Set target rendering resolution.
   * 720p: 1280x720 (landscape) or 720x1280 (portrait)
   * 1080p: 1920x1080 (landscape) or 1080x1920 (portrait)
   * native: device physical buffer
   */
  public setResolution(mode: ResolutionMode): RendererResolution {
    this.currentResolutionMode = mode;
    const isLandscape = this.nativeWidth >= this.nativeHeight;

    let targetWidth: number;
    let targetHeight: number;

    switch (mode) {
      case '720p':
        targetWidth = isLandscape ? 1280 : 720;
        targetHeight = isLandscape ? 720 : 1280;
        break;
      case '1080p':
        targetWidth = isLandscape ? 1920 : 1080;
        targetHeight = isLandscape ? 1080 : 1920;
        break;
      case 'native':
      default:
        targetWidth = this.nativeWidth;
        targetHeight = this.nativeHeight;
        break;
    }

    this.activeWidth = targetWidth;
    this.activeHeight = targetHeight;

    // Direct WebGL viewport and buffer sizing
    this.renderer.setSize(targetWidth, targetHeight, false);
    this.renderer.setPixelRatio(1.0);

    return {
      width: targetWidth,
      height: targetHeight,
      pixelRatio: 1.0,
      label: `${mode.toUpperCase()} (${targetWidth}×${targetHeight})`,
    };
  }

  public getResolutionMode(): ResolutionMode {
    return this.currentResolutionMode;
  }

  public getDimensions(): { width: number; height: number } {
    return { width: this.activeWidth, height: this.activeHeight };
  }

  public getAspect(): number {
    return this.activeWidth / this.activeHeight;
  }

  public setShadows(enabled: boolean, scene?: THREE.Scene): void {
    if (this.shadowsEnabled === enabled) return;
    this.shadowsEnabled = enabled;
    this.renderer.shadowMap.enabled = enabled;
    if (scene) {
      scene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => {
              m.needsUpdate = true;
            });
          } else if (mesh.material) {
            mesh.material.needsUpdate = true;
          }
        }
      });
    }
  }

  public isShadowsEnabled(): boolean {
    return this.shadowsEnabled;
  }

  /**
   * Render frame and swap native Android EGL frame buffer via gl.endFrameEXP()
   */
  public render(scene: THREE.Scene, camera: THREE.Camera): RenderStats {
    const t0 = performance.now();

    // Execute Three.js rendering pipeline
    this.renderer.render(scene, camera);

    // Swap native Android EGL frame buffer
    this.gl.endFrameEXP();

    const t1 = performance.now();
    const renderCpuTimeMs = t1 - t0;

    const info = this.renderer.info;
    return {
      calls: info.render.calls,
      triangles: info.render.triangles,
      points: info.render.points,
      lines: info.render.lines,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs ? info.programs.length : 0,
      renderCpuTimeMs,
      resolution: {
        width: this.activeWidth,
        height: this.activeHeight,
      },
    };
  }

  public getNativeContext(): ExpoWebGLRenderingContext {
    return this.gl;
  }

  public getThreeRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  public dispose(): void {
    this.renderer.dispose();
  }
}
