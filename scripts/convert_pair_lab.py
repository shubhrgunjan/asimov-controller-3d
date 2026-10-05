#!/usr/bin/env python3
"""
scripts/convert_pair_lab.py

Converts the canonical PAIR Lab environment from MuJoCo (environments/pair_lab.xml)
into high-fidelity Three.js assets and offline definitions at true 1:1 metric scale.

Generates:
- assets/pair_lab.glb (High-performance glTF 2.0 binary asset)
- src/model/pair_lab_model_data.ts (Zero-latency base64 geometry fallback definitions)
"""

import os
import sys
import json
import struct
import base64
import numpy as np

def parse_obj(file_path):
    verts = []
    uvs = []
    normals = []
    
    unique_map = {}
    out_verts = []
    out_uvs = []
    out_normals = []
    out_indices = []

    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            if line.startswith("v "):
                verts.append([float(x) for x in line[2:].strip().split()[:3]])
            elif line.startswith("vt "):
                uvs.append([float(x) for x in line[3:].strip().split()[:2]])
            elif line.startswith("vn "):
                normals.append([float(x) for x in line[3:].strip().split()[:3]])
            elif line.startswith("f "):
                tokens = line[2:].strip().split()
                poly_indices = []
                for tok in tokens:
                    parts = tok.split("/")
                    v_idx = int(parts[0]) - 1
                    vt_idx = int(parts[1]) - 1 if len(parts) > 1 and parts[1] else -1
                    vn_idx = int(parts[2]) - 1 if len(parts) > 2 and parts[2] else -1
                    
                    key = (v_idx, vt_idx, vn_idx)
                    if key in unique_map:
                        poly_indices.append(unique_map[key])
                    else:
                        new_idx = len(out_verts)
                        unique_map[key] = new_idx
                        poly_indices.append(new_idx)
                        
                        v = verts[v_idx]
                        out_verts.append(v)
                        
                        if vt_idx >= 0 and vt_idx < len(uvs):
                            u, val = uvs[vt_idx]
                            out_uvs.append([u, 1.0 - val])
                        else:
                            out_uvs.append([0.0, 0.0])
                            
                        if vn_idx >= 0 and vn_idx < len(normals):
                            out_normals.append(normals[vn_idx])
                        else:
                            out_normals.append([0.0, 1.0, 0.0])

                for i in range(1, len(poly_indices) - 1):
                    out_indices.extend([poly_indices[0], poly_indices[i], poly_indices[i + 1]])

    return (
        np.array(out_verts, dtype=np.float32),
        np.array(out_normals, dtype=np.float32),
        np.array(out_uvs, dtype=np.float32),
        np.array(out_indices, dtype=np.uint32 if len(out_verts) > 65535 else np.uint16)
    )

def build_glb(compiled_meshes, bodies):
    bin_chunks = []
    buffer_views = []
    accessors = []
    meshes_gltf = []
    nodes_gltf = []
    
    current_byte_offset = 0

    def append_chunk(data_bytes, target_buffer):
        nonlocal current_byte_offset
        length = len(data_bytes)
        pad_len = (4 - (length % 4)) % 4
        padded = data_bytes + b"\x00" * pad_len
        view = {
            "buffer": 0,
            "byteOffset": current_byte_offset,
            "byteLength": length,
        }
        if target_buffer:
            view["target"] = target_buffer
        buffer_views.append(view)
        bin_chunks.append(padded)
        current_byte_offset += len(padded)
        return len(buffer_views) - 1

    material_map = {
        "chair_mat": 0,
        "table_wood_mat": 1,
        "table_adj_mat": 2,
        "gaming_chair_mat": 3,
        "almirah_mat": 4,
        "screen_mat": 5,
        "beanbag_mat": 6,
        "whiteboard_mat": 7,
    }

    materials_gltf = [
        {"name": "chair_mat", "pbrMetallicRoughness": {"baseColorFactor": [0.4, 0.45, 0.5, 1.0], "metallicFactor": 0.1, "roughnessFactor": 0.85}},
        {"name": "table_wood_mat", "pbrMetallicRoughness": {"baseColorFactor": [0.65, 0.45, 0.25, 1.0], "metallicFactor": 0.1, "roughnessFactor": 0.55}},
        {"name": "table_adj_mat", "pbrMetallicRoughness": {"baseColorFactor": [0.8, 0.8, 0.82, 1.0], "metallicFactor": 0.3, "roughnessFactor": 0.6}},
        {"name": "gaming_chair_mat", "pbrMetallicRoughness": {"baseColorFactor": [0.85, 0.45, 0.1, 1.0], "metallicFactor": 0.25, "roughnessFactor": 0.65}},
        {"name": "almirah_mat", "pbrMetallicRoughness": {"baseColorFactor": [0.75, 0.78, 0.8, 1.0], "metallicFactor": 0.2, "roughnessFactor": 0.7}},
        {"name": "screen_mat", "pbrMetallicRoughness": {"baseColorFactor": [0.2, 0.22, 0.25, 1.0], "metallicFactor": 0.4, "roughnessFactor": 0.3}},
        {"name": "beanbag_mat", "pbrMetallicRoughness": {"baseColorFactor": [0.35, 0.4, 0.45, 1.0], "metallicFactor": 0.1, "roughnessFactor": 0.9}},
        {"name": "whiteboard_mat", "pbrMetallicRoughness": {"baseColorFactor": [0.95, 0.95, 0.95, 1.0], "metallicFactor": 0.5, "roughnessFactor": 0.4}},
    ]

    mesh_idx_map = {}
    for mesh_name, mdata in compiled_meshes.items():
        v = mdata["verts"]
        n = mdata["norms"]
        uv = mdata["uvs"]
        idx = mdata["indices"]

        v_bytes = v.tobytes()
        n_bytes = n.tobytes()
        uv_bytes = uv.tobytes()

        if len(v) < 65535:
            idx_bytes = idx.astype(np.uint16).tobytes()
            idx_comp = 5123
        else:
            idx_bytes = idx.astype(np.uint32).tobytes()
            idx_comp = 5125

        bv_pos = append_chunk(v_bytes, 34962)
        bv_norm = append_chunk(n_bytes, 34962)
        bv_uv = append_chunk(uv_bytes, 34962)
        bv_idx = append_chunk(idx_bytes, 34963)

        acc_pos = len(accessors)
        accessors.append({
            "bufferView": bv_pos,
            "byteOffset": 0,
            "componentType": 5126,
            "count": len(v),
            "type": "VEC3",
            "max": [float(x) for x in v.max(axis=0)],
            "min": [float(x) for x in v.min(axis=0)],
        })

        acc_norm = len(accessors)
        accessors.append({
            "bufferView": bv_norm,
            "byteOffset": 0,
            "componentType": 5126,
            "count": len(n),
            "type": "VEC3",
        })

        acc_uv = len(accessors)
        accessors.append({
            "bufferView": bv_uv,
            "byteOffset": 0,
            "componentType": 5126,
            "count": len(uv),
            "type": "VEC2",
        })

        acc_idx = len(accessors)
        accessors.append({
            "bufferView": bv_idx,
            "byteOffset": 0,
            "componentType": idx_comp,
            "count": len(idx),
            "type": "SCALAR",
            "max": [int(idx.max())],
            "min": [int(idx.min())],
        })

        mesh_idx = len(meshes_gltf)
        meshes_gltf.append({
            "name": mesh_name,
            "primitives": [{
                "attributes": {
                    "POSITION": acc_pos,
                    "NORMAL": acc_norm,
                    "TEXCOORD_0": acc_uv,
                },
                "indices": acc_idx,
                "material": material_map.get(mdata["default_mat"], 0)
            }]
        })
        mesh_idx_map[mesh_name] = mesh_idx

    # Create scene nodes for each body
    scene_node_indices = []
    for b in bodies:
        node_idx = len(nodes_gltf)
        yaw = b["rotY"]
        half_yaw = yaw * 0.5
        quat = [0.0, float(np.sin(half_yaw)), 0.0, float(np.cos(half_yaw))]

        node = {
            "name": b["name"],
            "mesh": mesh_idx_map[b["mesh"]],
            "translation": b["pos"],
            "rotation": quat,
        }
        nodes_gltf.append(node)
        scene_node_indices.append(node_idx)

    bin_data = b"".join(bin_chunks)

    gltf_json = {
        "asset": {
            "version": "2.0",
            "generator": "Asimov_PAIR_Lab_Exporter_1to1",
            "copyright": "MuJoCo PAIR Lab Canonical Environment"
        },
        "scenes": [{
            "name": "PAIR_Lab_Scene",
            "nodes": scene_node_indices,
        }],
        "scene": 0,
        "nodes": nodes_gltf,
        "meshes": meshes_gltf,
        "materials": materials_gltf,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{
            "byteLength": len(bin_data)
        }]
    }

    json_bytes = json.dumps(gltf_json, separators=(",", ":")).encode("utf-8")
    json_pad_len = (4 - (len(json_bytes) % 4)) % 4
    json_bytes_padded = json_bytes + b" " * json_pad_len

    bin_pad_len = (4 - (len(bin_data) % 4)) % 4
    bin_data_padded = bin_data + b"\x00" * bin_pad_len

    total_length = 12 + 8 + len(json_bytes_padded) + 8 + len(bin_data_padded)
    glb_header = struct.pack("<4sII", b"glTF", 2, total_length)
    chunk0_header = struct.pack("<I4s", len(json_bytes_padded), b"JSON")
    chunk1_header = struct.pack("<I4s", len(bin_data_padded), b"BIN\x00")

    return glb_header + chunk0_header + json_bytes_padded + chunk1_header + bin_data_padded

def main():
    print("=== Converting PAIR Lab Canonical MuJoCo Environment at 1:1 Metric Scale ===")
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.abspath(os.path.join(script_dir, ".."))
    src_assets_dir = os.path.abspath(os.path.join(project_dir, "../vasimov/environments/assets"))
    dst_assets_dir = os.path.join(project_dir, "assets")
    os.makedirs(dst_assets_dir, exist_ok=True)

    # Authentic 1:1 metric scales directly from vasimov/environments/pair_lab.xml
    mesh_specs = {
        "chair_mesh": ("chair.obj", [0.9302, 0.9302, 0.9302], "chair_mat"),
        "gaming_chair_mesh": ("gaming_chair.obj", [1.2791, 1.2791, 1.2791], "gaming_chair_mat"),
        "table_big_mesh": ("table_big.obj", [0.4419, 0.4767, 0.4651], "table_wood_mat"),
        "table_small_mesh": ("table_small.obj", [1.0140, 0.4186, 0.3953], "table_wood_mat"),
        "table_adjustable_mesh": ("table_adjustable.obj", [1.4186, 1.4186, 1.4186], "table_adj_mat"),
        "almirah_mesh": ("almirah.obj", [2.0465, 2.0465, 2.0465], "almirah_mat"),
        "beanbag_mesh": ("beanbag.obj", [0.8140, 0.8140, 0.8140], "beanbag_mat"),
        "screen_mesh": ("screen.obj", [2.0930, 2.0930, 2.0930], "screen_mat"),
        "whiteboard_mesh": ("whiteboard.obj", [1.3953, 1.3953, 1.3953], "whiteboard_mat"),
    }

    compiled_meshes = {}
    ts_data = {}
    total_triangles = 0
    total_vertices = 0

    for mesh_name, (obj_filename, scale_vec, mat_name) in mesh_specs.items():
        obj_path = os.path.join(src_assets_dir, obj_filename)
        verts, norms, uvs, indices = parse_obj(obj_path)

        # Coordinate transformation: MuJoCo (Z-up) -> Three.js (Y-up)
        # MuJoCo X (forward) -> Three.js -Z
        # MuJoCo Y (left)    -> Three.js -X
        # MuJoCo Z (up)      -> Three.js +Y
        sx, sy, sz = scale_vec
        three_verts = np.empty_like(verts)
        three_verts[:, 0] = -verts[:, 1] * sy
        three_verts[:, 1] =  verts[:, 2] * sz
        three_verts[:, 2] = -verts[:, 0] * sx

        three_norms = np.empty_like(norms)
        three_norms[:, 0] = -norms[:, 1]
        three_norms[:, 1] =  norms[:, 2]
        three_norms[:, 2] = -norms[:, 0]
        # Safe normalization to prevent any division by zero
        nl = np.linalg.norm(three_norms, axis=1, keepdims=True)
        nl_safe = np.maximum(nl, 1e-6)
        three_norms = np.where(nl > 1e-6, three_norms / nl_safe, np.array([0, 1, 0], dtype=np.float32))

        tri_count = len(indices) // 3
        total_triangles += tri_count
        total_vertices += len(three_verts)
        print(f"  ✓ {mesh_name}: {len(three_verts):,} vertices, {tri_count:,} triangles")

        compiled_meshes[mesh_name] = {
            "verts": three_verts,
            "norms": three_norms,
            "uvs": uvs,
            "indices": indices,
            "default_mat": mat_name,
        }

        # Encode arrays as high-performance base64 binary strings for zero-overhead deserialization
        b_v = base64.b64encode(three_verts.tobytes()).decode("ascii")
        b_n = base64.b64encode(three_norms.tobytes()).decode("ascii")
        b_uv = base64.b64encode(uvs.tobytes()).decode("ascii")
        b_idx = base64.b64encode(indices.tobytes()).decode("ascii")

        ts_data[mesh_name] = {
            "verts": b_v,
            "norms": b_n,
            "uvs": b_uv,
            "indices": b_idx,
            "isUint32": bool(len(three_verts) > 65535),
            "mat": mat_name,
        }

    # Canonical 1:1 metric bodies directly matching vasimov/environments/pair_lab.xml
    bodies = [
        {"name": "table_big", "mesh": "table_big_mesh", "pos": [-1.8605, 0.0, -2.6744], "rotY": 0.0},
        {"name": "table_small_1", "mesh": "table_small_mesh", "pos": [-1.6257, 0.0, 2.4911], "rotY": 0.0},
        {"name": "table_small_2", "mesh": "table_small_mesh", "pos": [2.0618, 0.0, 2.4911], "rotY": 0.0},
        {"name": "table_adjustable", "mesh": "table_adjustable_mesh", "pos": [0.2307, 0.0, 3.7711], "rotY": 1.570796},
        {"name": "gaming_chair", "mesh": "gaming_chair_mesh", "pos": [0.2326, 0.0, 3.2215], "rotY": -1.570796},
        {"name": "almirah", "mesh": "almirah_mesh", "pos": [-3.2455, 0.0, 3.6216], "rotY": 0.0},
        {"name": "screen", "mesh": "screen_mesh", "pos": [-3.1476, 0.0, 0.3602], "rotY": 0.0},
        {"name": "beanbag_1", "mesh": "beanbag_mesh", "pos": [-2.1286, 0.0, 0.6648], "rotY": -1.941900},
        {"name": "beanbag_2", "mesh": "beanbag_mesh", "pos": [-2.1286, 0.0, -0.4312], "rotY": 0.0},
        {"name": "whiteboard_1", "mesh": "whiteboard_mesh", "pos": [0.6568, 0.0, -3.6192], "rotY": -1.570796},

        {"name": "chair_1", "mesh": "chair_mesh", "pos": [-1.0113, 0.0, 1.9770], "rotY": 3.141593},
        {"name": "chair_2", "mesh": "chair_mesh", "pos": [-1.0113, 0.0, 2.8203], "rotY": 3.141593},
        {"name": "chair_3", "mesh": "chair_mesh", "pos": [-2.2633, 0.0, 1.9770], "rotY": 0.0},
        {"name": "chair_4", "mesh": "chair_mesh", "pos": [-2.2633, 0.0, 2.8203], "rotY": 0.0},
        {"name": "chair_5", "mesh": "chair_mesh", "pos": [1.4138, 0.0, 1.9770], "rotY": 0.0},
        {"name": "chair_6", "mesh": "chair_mesh", "pos": [1.4138, 0.0, 2.8203], "rotY": 0.0},
        {"name": "chair_7", "mesh": "chair_mesh", "pos": [2.6658, 0.0, 1.9770], "rotY": 3.141593},
        {"name": "chair_8", "mesh": "chair_mesh", "pos": [2.6658, 0.0, 2.8203], "rotY": 3.141593},
        {"name": "chair_9", "mesh": "chair_mesh", "pos": [-1.2482, 0.0, -1.8929], "rotY": 3.141593},
        {"name": "chair_10", "mesh": "chair_mesh", "pos": [-1.2482, 0.0, -2.6283], "rotY": 3.141593},
        {"name": "chair_11", "mesh": "chair_mesh", "pos": [-1.2482, 0.0, -3.4716], "rotY": 3.141593},
    ]

    # Canonical 1:1 metric obstacle cubes directly matching vasimov/environments/pair_lab.xml
    cubes = [
        {"name": "cube_1", "pos": [0.6714, 0.1163, 1.0983], "size": [0.2326, 0.2326, 0.2326]},
        {"name": "cube_2", "pos": [-0.6736, 0.0814, -0.2491], "size": [0.2326, 0.1628, 0.2326]},
        {"name": "cube_3", "pos": [0.4948, 0.0698, -1.5051], "size": [0.2326, 0.1396, 0.2326]},
        {"name": "cube_4", "pos": [2.4406, 0.0930, -0.5725], "size": [0.2326, 0.1860, 0.2326]},
        {"name": "cube_5", "pos": [1.7302, 0.1163, -2.2820], "size": [0.2326, 0.2326, 0.2326]},
    ]

    glb_bytes = build_glb(compiled_meshes, bodies)
    out_glb_path = os.path.join(dst_assets_dir, "pair_lab.glb")
    with open(out_glb_path, "wb") as f:
        f.write(glb_bytes)

    size_mb = len(glb_bytes) / (1024 * 1024)
    print(f"\n✅ Successfully generated PAIR Lab Binary GLB: {out_glb_path}")
    print(f"   Size: {size_mb:.2f} MB | {total_triangles:,} triangles | {total_vertices:,} vertices")

    # Generate authoritative TypeScript module with zero-overhead base64 buffer deserialization
    ts_path = os.path.join(project_dir, "src/model/pair_lab_model_data.ts")
    ts_content = f"""// AUTO-GENERATED by scripts/convert_pair_lab.py
// Exact MuJoCo PAIR Lab 3D assets & bodies compiled for Three.js at true 1:1 metric scale.
// Zero-decimation, authentic vertex normals and UVs for photo-accurate rendering.
// DO NOT EDIT MANUALLY.

import * as THREE from 'three';

export interface CompiledMeshSpec {{
  verts: string;
  norms: string;
  uvs: string;
  indices: string;
  isUint32?: boolean;
  mat: string;
}}

export interface BodySpec {{
  name: string;
  mesh: string;
  pos: [number, number, number];
  rotY: number;
}}

export const PAIR_LAB_BODIES: BodySpec[] = {json.dumps(bodies, indent=2)};

export const PAIR_LAB_CUBES: Array<{{ name: string; pos: [number, number, number]; size: [number, number, number] }}> = {json.dumps(cubes, indent=2)};

function base64ToUint8Array(b64: string): Uint8Array {{
  if (typeof Buffer !== 'undefined') {{
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }}
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {{
    bytes[i] = binary.charCodeAt(i);
  }}
  return bytes;
}}

export function decodeMeshSpec(spec: CompiledMeshSpec): THREE.BufferGeometry {{
  const geom = new THREE.BufferGeometry();
  const vU8 = base64ToUint8Array(spec.verts);
  const nU8 = base64ToUint8Array(spec.norms);
  const uvU8 = base64ToUint8Array(spec.uvs);
  const idxU8 = base64ToUint8Array(spec.indices);

  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vU8.buffer, vU8.byteOffset, vU8.byteLength / 4), 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nU8.buffer, nU8.byteOffset, nU8.byteLength / 4), 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvU8.buffer, uvU8.byteOffset, uvU8.byteLength / 4), 2));

  if (spec.isUint32) {{
    geom.setIndex(new THREE.BufferAttribute(new Uint32Array(idxU8.buffer, idxU8.byteOffset, idxU8.byteLength / 4), 1));
  }} else {{
    geom.setIndex(new THREE.BufferAttribute(new Uint16Array(idxU8.buffer, idxU8.byteOffset, idxU8.byteLength / 2), 1));
  }}
  return geom;
}}

export const PAIR_LAB_MESHES: Record<string, CompiledMeshSpec> = {json.dumps(ts_data, separators=(',', ':'))};
"""
    with open(ts_path, "w") as f:
        f.write(ts_content)

    ts_size_mb = os.path.getsize(ts_path) / (1024 * 1024)
    print(f"✅ Generated TypeScript module: {ts_path} ({ts_size_mb:.2f} MB)")

if __name__ == "__main__":
    main()
