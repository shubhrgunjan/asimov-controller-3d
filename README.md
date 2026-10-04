# Asimov Controller 3D — Phase 1 Performance Benchmark

Standalone mobile 3D rendering benchmark establishing real-time performance, frame times, stutter statistics, and hardware limits for the **Virtual Asimov 1 (VASIMOV)** robot controller.

---

## 🏛️ Technology Stack

- **Framework:** React Native `0.86.3` / Expo SDK `57.0.26` (Hermes Engine)
- **3D Graphics Engine:** Three.js `^0.174.0`
- **Native GPU Surface:** `expo-gl` `57.0.2` (Direct native Android OpenGL ES 3.0 / `EGLSurface` / `Choreographer` vsync)
- **Architecture:** Direct Three.js ownership (`App -> Renderer -> Scene -> Camera / Lighting / Objects / World`), avoiding React reconciler overhead.

---

## 🚀 Quick Start Instructions

### 1. Prerequisites
- **Node.js** v18+ (Tested on Node v24)
- **npm** or yarn
- **Expo CLI** (`npx expo`)
- **Android Device or Emulator:**
  - Android device running **Expo Go**, OR
  - Android Studio Virtual Device (AVD) with hardware acceleration enabled.

### 2. Install Dependencies
```bash
cd /home/shubhr/.gemini/antigravity-ide/scratch/asimov-controller-3d

# Install exact dependencies
npm install
```

### 3. Run Build & Type Validation
```bash
# Type-check TypeScript codebase
npm run type-check

# Run automated benchmark unit tests & matrix suite
npm test
```

### 4. Run on Android
```bash
# Start Expo development server for Android
npm run android
```
- **Physical Device:** Run `npm start` and scan the QR code using the **Expo Go** application on your Android phone.
- **Android Emulator:** Press `a` in the Expo terminal to automatically launch on a connected Android Virtual Device.

---

## 🎮 Benchmark Controls & Diagnostics

The application boots directly into the 3D benchmark environment with an integrated developer-only technical HUD and controls toolbar:

### Benchmark Levels
| Button | Workload Level | Geometry | Draw Calls | Features | Target |
| :---: | :--- | :---: | :---: | :--- | :---: |
| **`[ L1 ]`** | **Minimal** | 1.45K tris | 6 | Simple Lambert lighting, static camera | 60 FPS |
| **`[ L2 ]`** | **Moderate** | 32.4K tris | 46 | Concentric rings, PBR materials, 1024×1024 shadow map | 60 FPS |
| **`[ L3 ]`** | **Heavy** | 96.8K tris | 162 | 160 objects, procedural GPU textures, 16MB VRAM, shadows | 60 FPS |
| **`[ L4 ]`** | **Target Stress** | 182.4K tris | 218 | Articulated 28-link humanoid robot, walking gait, arena walls, 60 obstacles | Stress |

### Diagnostic Actions
- **`[ 720p / 1080p / NATIVE ]`**: Switch rendering resolution on the fly to measure GPU fill-rate sensitivity.
- **`[ SHADOWS: ON/OFF ]`**: Instantly toggle shadow map depth passes to isolate shadow GPU costs.
- **`[ TEXTURES: ON/OFF ]`**: Toggle procedural VRAM textures to isolate texture sampling bottlenecks.
- **`[ ANIM: ON/OFF ]`**: Toggle kinematics and rotation loops to isolate CPU transform overhead.
- **`[ RECORD (8s) ]`**: Executes a standard measurement window (2s warmup -> 6s steady-state recording) and calculates median, p95, p99, and stutter counts.
- **`[ AUTO MATRIX (3×) ]`**: Automatically executes the full 6-configuration matrix (L1 720p, L2 720p, L3 720p, L4 720p, L3 1080p, L4 1080p) across 3 runs each.
- **`[ 10M ENDURANCE ]`**: Initiates a 10-minute continuous run with periodic 5-second sampling to detect thermal throttling and memory growth.
- **`[ ASSET TEST ]`**: Parses and instantiates a standalone binary GLTF 2.0 (GLB) humanoid joint asset directly into the scene to verify asset loading without network dependencies.

---

## 📊 Reading the Developer HUD

The developer HUD provides live engineering metrics:
```text
PHASE 1 BENCHMARK               [ REC 85% ]

FPS             59.8 (AVG 59.7)
FRAME           16.7 ms
P95             17.8 ms
P99             21.2 ms
───────────────────────────────────────────
DRAW CALLS      162
TRIANGLES       96.8K
OBJECTS         162
───────────────────────────────────────────
RESOLUTION      1280 × 720 (720P)
TEST LEVEL      L3
SHADOWS         ENABLED
───────────────────────────────────────────
STUTTER EVENTS
>20ms: 6        >25ms: 0
>33ms: 0        >50ms: 0
BOTTLENECK      60 FPS OPTIMAL
```

- **FRAME**: Instantaneous presentation frame time (target: `16.67 ms`).
- **P95 / P99**: 95th and 99th percentile frame times to expose micro-stutters and frame spikes.
- **STUTTER EVENTS**: Counts of frames exceeding 20ms, 25ms, 33ms (dropped frame), and 50ms (severe hitch).
- **BOTTLENECK**: Real-time diagnosis based on JS CPU time vs GPU wait time (`BALANCED_60FPS`, `GPU_FRAGMENT_BOUND`, `GPU_SHADOW_BOUND`, `CPU_DISPATCH_BOUND`).

---

## 🤖 Phase 2 Asimov 1 Visual Model & Articulation

Phase 2 replaces synthetic models with the **actual Asimov 1 visual and mechanical hierarchy** ingested directly from the canonical MuJoCo model (`asimov_1_vasimov.xml`).

### Workload Modes
- **`[ ASIMOV (STATIC) ]`**: Canonical Asimov 1 visual model (113.4k triangles, 26 links, 25 joints) in neutral standing pose.
- **`[ ASIMOV (ARTIC) ]`**: Continuous 25-joint motion sequence (crouch, waist yaw, arm swing, leg articulation, coordinated walking gait).
- **`[ ASIMOV (ENV) ]`**: Articulated robot inside the representative target arena (boundary walls, perimeter columns, obstacle blocks).

### Camera Modes
- **`[ ORBIT ]`**: Automated smooth radial inspection orbit.
- **`[ CHASE (3RD) ]`**: Dynamic chase camera tracking behind the pelvis.
- **`[ FRONT (INSP) ]`**: Eye-level front inspection camera.
- **`[ HEAD (FPV) ]`**: First-person camera rigidly mounted to the robot's head (`neck_pitch_link`).
- **`[ RAPID SWEEP ]`**: High-frequency viewpoint sweeping to test frustum culling and matrix updates.

### Programmatic Validation Poses
- **`[ NEUTRAL ]`**: Restores all 25 joints to $0.0\text{ rad}$.
- **`[ CROUCH ]`**: Coordinated crouching posture (knees, hips, ankles).
- **`[ L-KNEE / R-KNEE ]`**: Individual leg flexion around physical pivots.
- **`[ ANKLE / HIP / ARMS ]`**: Targeted joint articulation validation.

---

## 📑 Formal Engineering Reports

- **Phase 1 Benchmark Report:** [docs/phase-1-performance-report.md](file:///home/shubhr/Shubhr/Projects/asimov-controller-3d/docs/phase-1-performance-report.md)
- **Phase 2 Visual Model Report:** [docs/phase-2-visual-model-report.md](file:///home/shubhr/Shubhr/Projects/asimov-controller-3d/docs/phase-2-visual-model-report.md)

---

## 📁 Project Structure

```text
asimov-controller-3d/
├── assets/
│   ├── asimov_1.glb                   # Optimized binary GLB asset (113.4k tris, 1.65 MB)
│   ├── asimov_1_mobile.glb            # Mobile target GLB asset
│   └── asimov_1_hd.glb                # High-density reference GLB (311.7k tris, 5.05 MB)
├── scripts/
│   └── convert_asimov_model.py        # Reproducible offline MuJoCo XML & STL to GLB converter
├── src/
│   ├── model/
│   │   ├── AsimovJointHierarchy.ts    # Auto-generated 25-joint definitions, axes, limits, bodies
│   │   ├── AsimovRobotModel.ts        # Three.js driver with quaternion kinematics & validation poses
│   │   └── asimov_1_model_data.ts     # Offline Base64 embedded GLB buffer
│   ├── benchmark/
│   │   ├── BenchmarkScene.ts          # Workload manager (L1-L4, ASIMOV_STATIC, ARTICULATED, ENV)
│   │   ├── BenchmarkController.ts     # Render loop, matrix runner, state & bottleneck engine
│   │   └── PerformanceMonitor.ts      # Microsecond timing, percentiles, stutters & endurance
│   ├── renderer/
│   │   ├── ThreeRenderer.ts           # OpenGL ES / expo-gl Three.js WebGLRenderer wrapper
│   │   ├── SceneManager.ts            # Ownership hierarchy & 5 zero-allocation camera presets
│   │   └── AssetLoader.ts             # Offline binary GLB asset parsing and validation
│   └── app/
│       ├── App.tsx                    # Main React Native component hosting GLView
│       ├── BenchmarkHUD.tsx           # Technical developer monospace HUD
│       └── BenchmarkControls.tsx      # Level switching, cameras, and joint validation toolbar
├── docs/
│   ├── phase-1-performance-report.md  # Phase 1 synthetic performance report
│   └── phase-2-visual-model-report.md  # Phase 2 visual model & real-device validation report
├── tests/
│   ├── AsimovModelValidation.test.ts  # Scale, joint hierarchy, and kinematics unit tests
│   ├── BenchmarkSuite.test.ts         # Performance monitor and scene architecture tests
│   ├── MatrixRunner.test.ts           # Phase 1 benchmark matrix runner
│   └── Phase2MatrixRunner.test.ts     # Phase 2 Asimov benchmark matrix & endurance runner
├── package.json
├── tsconfig.json
├── app.json
└── README.md
```
