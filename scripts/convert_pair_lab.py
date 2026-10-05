#!/usr/bin/env python3
"""
scripts/convert_pair_lab.py

Converts the canonical PAIR Lab environment from MuJoCo (environments/pair_lab.xml)
into an optimized, high-fidelity Three.js scene with all authentic 3D OBJ assets,
materials, and coordinates.

Generates:
- assets/pair_lab.glb (High-performance glTF 2.0 binary asset)
- src/model/pair_lab_model_data.ts (Offline TypeScript fallback definitions)
"""

import os
import sys
import json
import struct
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
        np.array(out_indices, dtype=np.uint32)
    )

def optimize_mesh(verts, norms, uvs, indices, res=70):
    vmin = verts.min(axis=0)
    vmax = verts.max(axis=0)
    span = vmax - vmin
    cell_size = span.max() / res
    if cell_size <= 0:
        return verts, norms, uvs, indices

    grid_coords = np.floor((verts - vmin) / cell_size).astype(np.int32)
    keys = (
        grid_coords[:, 0].astype(np.int64) * 1000000000 +
        grid_coords[:, 1].astype(np.int64) * 100000 +
        grid_coords[:, 2].astype(np.int64)
    )
    _, idx, inv = np.unique(keys, return_index=True, return_inverse=True)

    new_indices = inv[indices].reshape(-1, 3)
    valid = (
        (new_indices[:, 0] != new_indices[:, 1]) &
        (new_indices[:, 1] != new_indices[:, 2]) &
        (new_indices[:, 2] != new_indices[:, 0])
    )
    valid_indices = new_indices[valid].flatten().astype(np.uint32)

    new_verts = np.zeros((len(idx), 3), dtype=np.float32)
    new_norms = np.zeros((len(idx), 3), dtype=np.float32)
    new_uvs = np.zeros((len(idx), 2), dtype=np.float32)
    counts = np.zeros((len(idx), 1), dtype=np.float32)

    np.add.at(new_verts, inv, verts)
    np.add.at(new_norms, inv, norms)
    np.add.at(new_uvs, inv, uvs)
    np.add.at(counts, inv, 1.0)

    new_verts /= np.maximum(counts, 1.0)
    new_uvs /= np.maximum(counts, 1.0)

    norm_lens = np.linalg.norm(new_norms, axis=1, keepdims=True)
    new_norms = np.where(norm_lens > 1e-6, new_norms / norm_lens, np.array([0, 1, 0], dtype=np.float32))

    return new_verts, new_norms, new_uvs, valid_indices

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
        # Yaw rotation around Y axis in Three.js
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
            "generator": "Asimov_PAIR_Lab_Exporter",
            "copyright": "MuJoCo PAIR Lab Environment"
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
    print("=== Converting PAIR Lab Canonical MuJoCo Environment ===")
    src_assets_dir = "/home/shubhr/Shubhr/Projects/vasimov/environments/assets"
    dst_assets_dir = "/home/shubhr/Shubhr/Projects/asimov-controller-3d/assets"
    os.makedirs(dst_assets_dir, exist_ok=True)

    mesh_specs = {
        "chair_mesh": ("chair.obj", [2.0, 2.0, 2.0], "chair_mat", 65),
        "gaming_chair_mesh": ("gaming_chair.obj", [2.75, 2.75, 2.75], "gaming_chair_mat", 65),
        "table_big_mesh": ("table_big.obj", [0.95, 1.025, 1.0], "table_wood_mat", None),
        "table_small_mesh": ("table_small.obj", [2.18, 0.90, 0.85], "table_wood_mat", None),
        "table_adjustable_mesh": ("table_adjustable.obj", [3.05, 3.05, 3.05], "table_adj_mat", 65),
        "almirah_mesh": ("almirah.obj", [4.4, 4.4, 4.4], "almirah_mat", 65),
        "beanbag_mesh": ("beanbag.obj", [1.75, 1.75, 1.75], "beanbag_mat", 60),
        "screen_mesh": ("screen.obj", [4.5, 4.5, 4.5], "screen_mat", 65),
        "whiteboard_mesh": ("whiteboard.obj", [3.0, 3.0, 3.0], "whiteboard_mat", 65),
    }

    compiled_meshes = {}
    total_triangles = 0
    total_vertices = 0

    for mesh_name, (obj_filename, scale_vec, mat_name, decimate_res) in mesh_specs.items():
        obj_path = os.path.join(src_assets_dir, obj_filename)
        verts, norms, uvs, indices = parse_obj(obj_path)

        if decimate_res is not None:
            verts, norms, uvs, indices = optimize_mesh(verts, norms, uvs, indices, res=decimate_res)

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

        # Parity flip compensation
        fixed_indices = indices.copy().reshape(-1, 3)
        fixed_indices[:, [1, 2]] = fixed_indices[:, [2, 1]]
        fixed_indices = fixed_indices.flatten()

        tri_count = len(fixed_indices) // 3
        total_triangles += tri_count
        total_vertices += len(three_verts)
        print(f"  ✓ {mesh_name}: {len(three_verts):,} vertices, {tri_count:,} triangles")

        compiled_meshes[mesh_name] = {
            "verts": three_verts,
            "norms": three_norms,
            "uvs": uvs,
            "indices": fixed_indices,
            "default_mat": mat_name,
        }

    bodies = [
        {"name": "table_big", "mesh": "table_big_mesh", "pos": [-4.0, 0.0, -5.75], "rotY": 0.0},
        {"name": "table_small_1", "mesh": "table_small_mesh", "pos": [-3.4952, 0.0, 5.3558], "rotY": 0.0},
        {"name": "table_small_2", "mesh": "table_small_mesh", "pos": [4.4328, 0.0, 5.3558], "rotY": 0.0},
        {"name": "table_adjustable", "mesh": "table_adjustable_mesh", "pos": [0.4960, 0.0, 8.1079], "rotY": 1.570796},
        {"name": "gaming_chair", "mesh": "gaming_chair_mesh", "pos": [0.5000, 0.0, 6.9262], "rotY": -1.570796},
        {"name": "almirah", "mesh": "almirah_mesh", "pos": [-6.9778, 0.0, 7.7865], "rotY": 0.0},
        {"name": "screen", "mesh": "screen_mesh", "pos": [-6.7674, 0.0, 0.7744], "rotY": 0.0},
        {"name": "beanbag_1", "mesh": "beanbag_mesh", "pos": [-4.5765, 0.0, 1.4294], "rotY": -1.9419},
        {"name": "beanbag_2", "mesh": "beanbag_mesh", "pos": [-4.5765, 0.0, -0.9270], "rotY": 0.0},
        {"name": "whiteboard_1", "mesh": "whiteboard_mesh", "pos": [1.4121, 0.0, -7.7812], "rotY": -1.570796},

        {"name": "chair_1", "mesh": "chair_mesh", "pos": [-2.1743, 0.0, 4.2506], "rotY": 3.141593},
        {"name": "chair_2", "mesh": "chair_mesh", "pos": [-2.1743, 0.0, 6.0637], "rotY": 3.141593},
        {"name": "chair_3", "mesh": "chair_mesh", "pos": [-4.8661, 0.0, 4.2506], "rotY": 0.0},
        {"name": "chair_4", "mesh": "chair_mesh", "pos": [-4.8661, 0.0, 6.0637], "rotY": 0.0},
        {"name": "chair_5", "mesh": "chair_mesh", "pos": [3.0396, 0.0, 4.2506], "rotY": 0.0},
        {"name": "chair_6", "mesh": "chair_mesh", "pos": [3.0396, 0.0, 6.0637], "rotY": 0.0},
        {"name": "chair_7", "mesh": "chair_mesh", "pos": [5.7314, 0.0, 4.2506], "rotY": 3.141593},
        {"name": "chair_8", "mesh": "chair_mesh", "pos": [5.7314, 0.0, 6.0637], "rotY": 3.141593},
        {"name": "chair_9", "mesh": "chair_mesh", "pos": [-2.6836, 0.0, -4.0697], "rotY": 3.141593},
        {"name": "chair_10", "mesh": "chair_mesh", "pos": [-2.6836, 0.0, -5.6508], "rotY": 3.141593},
        {"name": "chair_11", "mesh": "chair_mesh", "pos": [-2.6836, 0.0, -7.4640], "rotY": 3.141593},
    ]

    glb_bytes = build_glb(compiled_meshes, bodies)
    out_glb_path = os.path.join(dst_assets_dir, "pair_lab.glb")
    with open(out_glb_path, "wb") as f:
        f.write(glb_bytes)

    size_mb = len(glb_bytes) / (1024 * 1024)
    print(f"\n✅ Successfully generated PAIR Lab Binary GLB: {out_glb_path}")
    print(f"   Size: {size_mb:.2f} MB | {total_triangles:,} triangles | {total_vertices:,} vertices")

    # Also generate a TypeScript definitions file with pre-compiled geometry data
    # so the app can mount the exact geometries with zero file loading issues
    ts_data = {}
    for mname, mdata in compiled_meshes.items():
        ts_data[mname] = {
            "verts": np.round(mdata["verts"], 4).flatten().tolist(),
            "norms": np.round(mdata["norms"], 3).flatten().tolist(),
            "uvs": np.round(mdata["uvs"], 4).flatten().tolist(),
            "indices": mdata["indices"].tolist(),
            "mat": mdata["default_mat"],
        }

    ts_path = "/home/shubhr/Shubhr/Projects/asimov-controller-3d/src/model/pair_lab_model_data.ts"
    with open(ts_path, "w") as f:
        f.write(f"""// AUTO-GENERATED by scripts/convert_pair_lab.py
// Exact MuJoCo PAIR Lab 3D assets & bodies compiled for Three.js.
// DO NOT EDIT MANUALLY.

export interface CompiledMeshSpec {{
  verts: number[];
  norms: number[];
  uvs: number[];
  indices: number[];
  mat: string;
}}

export interface BodySpec {{
  name: string;
  mesh: string;
  pos: [number, number, number];
  rotY: number;
}}

export const PAIR_LAB_BODIES: BodySpec[] = {json.dumps(bodies, indent=2)};

export const PAIR_LAB_CUBES: Array<{{ name: string; pos: [number, number, number]; size: [number, number, number] }}> = [
  {{ name: 'cube_1', pos: [1.4435, 0.25, 2.3613], size: [0.5, 0.5, 0.5] }},
  {{ name: 'cube_2', pos: [-1.4483, 0.175, -0.5355], size: [0.5, 0.35, 0.5] }},
  {{ name: 'cube_3', pos: [1.0639, 0.150, -3.2359], size: [0.5, 0.30, 0.5] }},
  {{ name: 'cube_4', pos: [5.2472, 0.200, -1.2309], size: [0.5, 0.40, 0.5] }},
  {{ name: 'cube_5', pos: [3.7199, 0.250, -4.9063], size: [0.5, 0.50, 0.5] }},
];

export const PAIR_LAB_MESHES: Record<string, CompiledMeshSpec> = {json.dumps(ts_data, separators=(',', ':'))};
""")
    ts_size_mb = os.path.getsize(ts_path) / (1024 * 1024)
    print(f"✅ Generated TypeScript module: {ts_path} ({ts_size_mb:.2f} MB)")

if __name__ == "__main__":
    main()
