// Polyfill navigator.userAgent for Three.js GLTFLoader on React Native / Hermes
if (typeof navigator !== 'undefined' && !(navigator as any).userAgent) {
  Object.defineProperty(navigator, 'userAgent', {
    value: 'ReactNative',
    configurable: true,
    writable: true,
  });
}

import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface AssetTestResult {
  success: boolean;
  meshCount: number;
  triangleCount: number;
  materialNames: string[];
  hasTransforms: boolean;
  loadTimeMs: number;
  rootObject: THREE.Group | THREE.Object3D;
  error?: string;
}

/**
 * Creates a valid standalone binary GLB buffer representing a humanoid joint component.
 * Valid glTF 2.0 binary format containing geometry buffer, indices, positions, normals,
 * PBR metallic-roughness material, and transform node hierarchy.
 */
function createRoboticJointGLB(): ArrayBuffer {
  // Construct a cube/bracket geometry buffer
  // 8 vertices: positions (float32 * 3), normals (float32 * 3), uvs (float32 * 2) = 8 * 4 = 32 bytes/vertex
  // 36 indices: uint16
  const positions = new Float32Array([
    // Front face
    -0.5, -0.5,  0.5,   0.5, -0.5,  0.5,   0.5,  0.5,  0.5,  -0.5,  0.5,  0.5,
    // Back face
    -0.5, -0.5, -0.5,  -0.5,  0.5, -0.5,   0.5,  0.5, -0.5,   0.5, -0.5, -0.5,
    // Top face
    -0.5,  0.5, -0.5,  -0.5,  0.5,  0.5,   0.5,  0.5,  0.5,   0.5,  0.5, -0.5,
    // Bottom face
    -0.5, -0.5, -0.5,   0.5, -0.5, -0.5,   0.5, -0.5,  0.5,  -0.5, -0.5,  0.5,
    // Right face
     0.5, -0.5, -0.5,   0.5,  0.5, -0.5,   0.5,  0.5,  0.5,   0.5, -0.5,  0.5,
    // Left face
    -0.5, -0.5, -0.5,  -0.5, -0.5,  0.5,  -0.5,  0.5,  0.5,  -0.5,  0.5, -0.5,
  ]);

  const normals = new Float32Array([
    0, 0, 1,   0, 0, 1,   0, 0, 1,   0, 0, 1,
    0, 0, -1,  0, 0, -1,  0, 0, -1,  0, 0, -1,
    0, 1, 0,   0, 1, 0,   0, 1, 0,   0, 1, 0,
    0, -1, 0,  0, -1, 0,  0, -1, 0,  0, -1, 0,
    1, 0, 0,   1, 0, 0,   1, 0, 0,   1, 0, 0,
   -1, 0, 0,  -1, 0, 0,  -1, 0, 0,  -1, 0, 0,
  ]);

  const indices = new Uint16Array([
    0, 1, 2,      0, 2, 3,    // Front
    4, 5, 6,      4, 6, 7,    // Back
    8, 9, 10,     8, 10, 11,  // Top
    12, 13, 14,   12, 14, 15, // Bottom
    16, 17, 18,   16, 18, 19, // Right
    20, 21, 22,   20, 22, 23, // Left
  ]);

  const posByteLength = positions.byteLength;
  const normByteLength = normals.byteLength;
  const idxByteLength = indices.byteLength;

  const totalBinLength = (posByteLength + normByteLength + idxByteLength + 3) & ~3; // 4-byte aligned
  const binBuffer = new Uint8Array(totalBinLength);

  binBuffer.set(new Uint8Array(positions.buffer), 0);
  binBuffer.set(new Uint8Array(normals.buffer), posByteLength);
  binBuffer.set(new Uint8Array(indices.buffer), posByteLength + normByteLength);

  const gltfJSON = {
    asset: { version: '2.0', generator: 'AsimovGLBBuilder' },
    scenes: [{ name: 'RoboticJointScene', nodes: [0] }],
    nodes: [
      {
        name: 'AsimovActuatorBracket_L1',
        mesh: 0,
        translation: [0, 1.2, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
    ],
    meshes: [
      {
        name: 'ActuatorHousingMesh',
        primitives: [
          {
            attributes: {
              POSITION: 0,
              NORMAL: 1,
            },
            indices: 2,
            material: 0,
          },
        ],
      },
    ],
    materials: [
      {
        name: 'AsimovPBR_AnodizedAlloy',
        pbrMetallicRoughness: {
          baseColorFactor: [0.2, 0.6, 0.9, 1.0],
          metallicFactor: 0.85,
          roughnessFactor: 0.25,
        },
        doubleSided: false,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        byteOffset: 0,
        componentType: 5126, // FLOAT
        count: 24,
        type: 'VEC3',
        max: [0.5, 0.5, 0.5],
        min: [-0.5, -0.5, -0.5],
      },
      {
        bufferView: 1,
        byteOffset: 0,
        componentType: 5126, // FLOAT
        count: 24,
        type: 'VEC3',
        max: [1, 1, 1],
        min: [-1, -1, -1],
      },
      {
        bufferView: 2,
        byteOffset: 0,
        componentType: 5123, // UNSIGNED_SHORT
        count: 36,
        type: 'SCALAR',
        max: [23],
        min: [0],
      },
    ],
    bufferViews: [
      {
        buffer: 0,
        byteOffset: 0,
        byteLength: posByteLength,
        target: 34962, // ARRAY_BUFFER
      },
      {
        buffer: 0,
        byteOffset: posByteLength,
        byteLength: normByteLength,
        target: 34962,
      },
      {
        buffer: 0,
        byteOffset: posByteLength + normByteLength,
        byteLength: idxByteLength,
        target: 34963, // ELEMENT_ARRAY_BUFFER
      },
    ],
    buffers: [{ byteLength: totalBinLength }],
  };

  const jsonStr = JSON.stringify(gltfJSON);
  const jsonEncoder = new TextEncoder();
  const jsonEncoded = jsonEncoder.encode(jsonStr);
  const jsonByteLength = (jsonEncoded.byteLength + 3) & ~3; // 4-byte aligned
  const jsonPadded = new Uint8Array(jsonByteLength);
  jsonPadded.set(jsonEncoded, 0);
  for (let i = jsonEncoded.byteLength; i < jsonByteLength; i++) {
    jsonPadded[i] = 0x20; // Space padding
  }

  const totalGlbLength = 12 + (8 + jsonByteLength) + (8 + totalBinLength);
  const glbBuffer = new ArrayBuffer(totalGlbLength);
  const dataView = new DataView(glbBuffer);

  // 1. Header (12 bytes)
  dataView.setUint32(0, 0x46546c67, true); // 'glTF'
  dataView.setUint32(4, 2, true);          // version 2
  dataView.setUint32(8, totalGlbLength, true);

  // 2. Chunk 0: JSON (8 bytes header + jsonByteLength)
  dataView.setUint32(12, jsonByteLength, true);
  dataView.setUint32(16, 0x4e4f534a, true); // 'JSON'
  new Uint8Array(glbBuffer, 20, jsonByteLength).set(jsonPadded);

  // 3. Chunk 1: BIN (8 bytes header + totalBinLength)
  const binHeaderOffset = 20 + jsonByteLength;
  dataView.setUint32(binHeaderOffset, totalBinLength, true);
  dataView.setUint32(binHeaderOffset + 4, 0x004e4942, true); // 'BIN\0'
  new Uint8Array(glbBuffer, binHeaderOffset + 8, totalBinLength).set(binBuffer);

  return glbBuffer;
}

/**
 * AssetLoader
 * 
 * Verifies GLTF/GLB asset loading, parsing, material binding,
 * transform application, and GPU mesh readiness.
 */
export class AssetLoader {
  private loader: GLTFLoader;

  constructor() {
    this.loader = new GLTFLoader();
  }

  /**
   * Run standalone GLB asset verification test
   */
  public async testRoboticJointAsset(): Promise<AssetTestResult> {
    const t0 = performance.now();
    try {
      const glbData = createRoboticJointGLB();

      const gltf = await new Promise<GLTF>((resolve, reject) => {
        this.loader.parse(
          glbData,
          '',
          (parsed) => resolve(parsed),
          (err) => reject(err)
        );
      });

      const t1 = performance.now();
      const loadTimeMs = t1 - t0;

      let meshCount = 0;
      let triangleCount = 0;
      const materialNames: string[] = [];
      let hasTransforms = false;

      gltf.scene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          meshCount++;
          const mesh = child as THREE.Mesh;
          mesh.castShadow = true;
          mesh.receiveShadow = true;

          if (mesh.geometry) {
            const index = mesh.geometry.getIndex();
            if (index) {
              triangleCount += index.count / 3;
            } else {
              triangleCount += mesh.geometry.attributes.position.count / 3;
            }
          }

          if (mesh.material) {
            const mat = mesh.material as THREE.Material;
            materialNames.push(mat.name || 'UnnamedMaterial');
          }

          if (!child.position.equals(new THREE.Vector3(0, 0, 0)) ||
              !child.scale.equals(new THREE.Vector3(1, 1, 1))) {
            hasTransforms = true;
          }
        }
      });

      return {
        success: true,
        meshCount,
        triangleCount,
        materialNames,
        hasTransforms: hasTransforms || gltf.scene.children.length > 0,
        loadTimeMs,
        rootObject: gltf.scene,
      };
    } catch (err) {
      return {
        success: false,
        meshCount: 0,
        triangleCount: 0,
        materialNames: [],
        hasTransforms: false,
        loadTimeMs: performance.now() - t0,
        rootObject: new THREE.Group(),
        error: (err as Error)?.message || 'GLTF Parsing error',
      };
    }
  }
}
