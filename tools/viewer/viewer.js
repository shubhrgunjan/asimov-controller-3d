import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const container = document.getElementById('canvas-container');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingSub = document.getElementById('loading-sub');
const inspector = document.getElementById('inspector');

// 1. Scene, Camera, Renderer
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x090d16);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(12, 10, 12);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

// 2. Interactive Orbit Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2 + 0.05; // Don't go below floor
controls.target.set(0, 1.2, 0);

// 3. Environmental Fill Lighting matching Blender World
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x475569, 1.2);
hemiLight.position.set(0, 20, 0);
scene.add(hemiLight);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);

// Overhead directional sun for crisp shadows
const sunLight = new THREE.DirectionalLight(0xfff7ed, 1.5);
sunLight.position.set(5, 12, 5);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 40;
sunLight.shadow.camera.left = -12;
sunLight.shadow.camera.right = 12;
sunLight.shadow.camera.top = 12;
sunLight.shadow.camera.bottom = -12;
sunLight.shadow.bias = -0.0005;
scene.add(sunLight);

let labModel = null;
let isWireframe = false;
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();

// 4. Load PAIR_Lab.glb directly via GLTFLoader
const loader = new GLTFLoader();
const glbUrl = '../../assets/PAIR_Lab.glb';

loader.load(
  glbUrl,
  (gltf) => {
    labModel = gltf.scene;
    scene.add(labModel);

    let meshCount = 0;
    let triCount = 0;
    const materialSet = new Set();

    // 1. Remove floating black cube artifacts (e.g. Cube.001 in air)
    const toRemove = [];
    labModel.traverse((child) => {
      if (child.name === 'Cube.001' || (child.name.startsWith('Cube') && child.position.y > 1.5)) {
        toRemove.push(child);
      }
    });
    for (const obj of toRemove) {
      obj.visible = false;
      if (obj.parent) obj.parent.remove(obj);
    }

    labModel.traverse((child) => {
      if (child.isMesh) {
        meshCount++;
        child.castShadow = true;
        child.receiveShadow = true;

        if (child.geometry) {
          const idx = child.geometry.getIndex();
          triCount += idx ? idx.count / 3 : child.geometry.attributes.position.count / 3;
        }

        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((m) => {
            materialSet.add(m.name || 'unnamed');
            if (m.map) {
              m.map.colorSpace = THREE.SRGBColorSpace;
              m.map.needsUpdate = true;
            }
          });
        }
      }
    });

    document.getElementById('stat-objects').textContent = meshCount.toLocaleString();
    document.getElementById('stat-triangles').textContent = Math.round(triCount).toLocaleString();
    document.getElementById('stat-materials').textContent = materialSet.size.toString();

    // Fade out loading screen
    loadingOverlay.style.opacity = '0';
    setTimeout(() => {
      loadingOverlay.style.display = 'none';
    }, 500);

    setCameraPreset('overview');
  },
  (xhr) => {
    if (xhr.lengthComputable) {
      const pct = Math.round((xhr.loaded / xhr.total) * 100);
      loadingSub.textContent = `${pct}% (${(xhr.loaded / 1024 / 1024).toFixed(1)} MB)`;
    } else {
      loadingSub.textContent = `${(xhr.loaded / 1024 / 1024).toFixed(1)} MB`;
    }
  },
  (err) => {
    console.error('Failed to load PAIR_Lab.glb:', err);
    loadingSub.textContent = `Error: ${err.message || 'File not found. Please export PAIR_Lab.glb first.'}`;
    loadingSub.style.color = '#ef4444';
  }
);

// 5. Camera Presets matching Blender views
const cameraPresets = {
  overview: { pos: [-11, 8.5, 11], target: [0, 1.0, 0] },
  adjustable_desk: { pos: [-1.2, 2.2, 5.8], target: [0.5, 0.85, 8.1] },
  workspace_south: { pos: [2.5, 2.2, 2.8], target: [4.4, 0.85, 5.35] },
  presentation: { pos: [1.4, 2.2, -4.5], target: [1.4, 1.4, -7.8] },
  cubes: { pos: [3.5, 4.2, 4.8], target: [1.2, 0.3, 0.5] },
  topdown: { pos: [0, 20.0, 0.01], target: [0, 0, 0] },
};

function setCameraPreset(key) {
  const p = cameraPresets[key];
  if (!p) return;
  camera.position.set(p.pos[0], p.pos[1], p.pos[2]);
  controls.target.set(p.target[0], p.target[1], p.target[2]);
  controls.update();
}

// 6. UI Controls Hookup
document.getElementById('camera-select').addEventListener('change', (e) => {
  setCameraPreset(e.target.value);
});

document.getElementById('tonemap-select').addEventListener('change', (e) => {
  const map = {
    aces: THREE.ACESFilmicToneMapping,
    agx: THREE.AgXToneMapping || THREE.ACESFilmicToneMapping,
    linear: THREE.LinearToneMapping,
    reinhard: THREE.ReinhardToneMapping,
  };
  renderer.toneMapping = map[e.target.value] || THREE.ACESFilmicToneMapping;
});

const exposureSlider = document.getElementById('exposure-slider');
const exposureVal = document.getElementById('exposure-val');
exposureSlider.addEventListener('input', (e) => {
  const val = parseFloat(e.target.value);
  renderer.toneMappingExposure = val;
  exposureVal.textContent = val.toFixed(2);
});

document.getElementById('btn-wireframe').addEventListener('click', () => {
  if (!labModel) return;
  isWireframe = !isWireframe;
  labModel.traverse((child) => {
    if (child.isMesh && child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => (m.wireframe = isWireframe));
      } else {
        child.material.wireframe = isWireframe;
      }
    }
  });
});

document.getElementById('btn-reset-cam').addEventListener('click', () => {
  const sel = document.getElementById('camera-select');
  setCameraPreset(sel.value);
});

// 7. Click to Inspect 3D Asset
window.addEventListener('pointerdown', (e) => {
  if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  if (labModel) {
    const hits = raycaster.intersectObjects(labModel.children, true);
    if (hits.length > 0) {
      const hit = hits[0].object;
      const matName = hit.material ? (hit.material.name || 'unnamed') : 'none';
      const pos = hit.getWorldPosition(new THREE.Vector3());
      inspector.innerHTML = `
        <strong style="color:#38bdf8;">Selected:</strong> ${hit.name || hit.parent?.name || 'Unnamed Object'}<br>
        <span style="color:#94a3b8;">Material:</span> ${matName} | 
        <span style="color:#94a3b8;">World Pos:</span> (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})
      `;
    }
  }
});

// 8. Window Resize Handling
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// 9. Animation Loop
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
