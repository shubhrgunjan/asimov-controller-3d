#!/usr/bin/env python3
"""
Convert Asimov 1 canonical MuJoCo model to mobile-optimized GLB asset.
Preserves exact joint hierarchy, joint pivots, axes, and local transforms.
Generates:
  - assets/asimov_1.glb (default mobile-optimized asset <= 120k triangles)
  - assets/asimov_1_mobile.glb
  - assets/asimov_1_hd.glb (high-fidelity profile)
  - src/model/asimov_1_model_data.ts (instant offline Base64 loading)
  - src/model/AsimovJointHierarchy.ts (machine-readable TypeScript mappings)
"""

import os
import sys
import json
import base64
import struct
import xml.etree.ElementTree as ET
import numpy as np

VASIMOV_ROOT = "/home/shubhr/Shubhr/Projects/vasimov"
XML_PATH = os.path.join(VASIMOV_ROOT, "model/asimov_1_vasimov.xml")
MESH_DIR = os.path.join(VASIMOV_ROOT, "upstream/asimov-1/sim-model/assets/meshes")
OUTPUT_DIR = "/home/shubhr/Shubhr/Projects/asimov-controller-3d/assets"
SRC_MODEL_DIR = "/home/shubhr/Shubhr/Projects/asimov-controller-3d/src/model"

GRID_MOBILE = {
    'WAIST_YAW.STL': 34,
    'ANKLE_B_NEW.STL': 42,
    'LEFT_KNEE.STL': 38,
    'RIGHT_KNEE.STL': 38,
    'IMU_ORIGIN.STL': 38,
    'LEFT_SHOULDER_ROLL.STL': 34,
    'RIGHT_SHOULDER_ROLL.STL': 34,
    'LEFT_SHOULDER_YAW.STL': 34,
    'RIGHT_SHOULDER_YAW.STL': 34,
    'LEFT_HIP_YAW.STL': 34,
    'RIGHT_HIP_YAW.STL': 34,
    'LEFT_HIP_PITCH.STL': 32,
    'RIGHT_HIP_PITCH.STL': 32,
    'NECK_PITCH.STL': 36,
    'LEFT_SHOULDER_PITCH.STL': 30,
    'RIGHT_SHOULDER_PITCH.STL': 30,
    'LEFT_ELBOW.STL': 30,
    'RIGHT_ELBOW.STL': 30,
    'NECK_YAW.STL': 30,
    'LEFT_HIP_ROLL.STL': 30,
    'RIGHT_HIP_ROLL.STL': 30,
    'LEFT_ANKLE_A.STL': 28,
    'RIGHT_ANKLE_A.STL': 28,
    'LEFT_WRIST_YAW.STL': 26,
    'RIGHT_WRIST_YAW.STL': 26,
}

GRID_HD = {
    'WAIST_YAW.STL': 85,
    'ANKLE_B_NEW.STL': 110,
    'LEFT_KNEE.STL': 95,
    'RIGHT_KNEE.STL': 95,
    'IMU_ORIGIN.STL': 90,
    'LEFT_SHOULDER_ROLL.STL': 85,
    'RIGHT_SHOULDER_ROLL.STL': 85,
    'LEFT_SHOULDER_YAW.STL': 85,
    'RIGHT_SHOULDER_YAW.STL': 85,
    'LEFT_HIP_YAW.STL': 85,
    'RIGHT_HIP_YAW.STL': 85,
}

def read_stl(file_path):
    with open(file_path, "rb") as fp:
        fp.read(80)
        num_tri = struct.unpack("<I", fp.read(4))[0]
        raw = fp.read(num_tri * 50)
        data = np.frombuffer(raw, dtype=np.dtype([
            ("normal", np.float32, 3),
            ("v1", np.float32, 3),
            ("v2", np.float32, 3),
            ("v3", np.float32, 3),
            ("attr", np.uint16)
        ]))
        v1 = data["v1"]
        v2 = data["v2"]
        v3 = data["v3"]
        flat_v = np.empty((num_tri * 3, 3), dtype=np.float32)
        flat_v[0::3] = v1
        flat_v[1::3] = v2
        flat_v[2::3] = v3
        return flat_v, num_tri

def optimize_mesh(flat_v, num_tri, mesh_name, profile="mobile"):
    grid_res = GRID_MOBILE.get(mesh_name, 35) if profile == "mobile" else GRID_HD.get(mesh_name, None)

    if grid_res is not None:
        vmin = flat_v.min(axis=0)
        vmax = flat_v.max(axis=0)
        span = vmax - vmin
        cell_size = span.max() / grid_res
        grid_coords = np.floor((flat_v - vmin) / cell_size).astype(np.int32)
        
        cell_keys = grid_coords[:, 0].astype(np.int64) * 1000000000 + \
                    grid_coords[:, 1].astype(np.int64) * 100000 + \
                    grid_coords[:, 2].astype(np.int64)
                    
        unique_keys, idx, inv = np.unique(cell_keys, return_index=True, return_inverse=True)
        
        verts = np.zeros((len(unique_keys), 3), dtype=np.float32)
        counts = np.zeros((len(unique_keys), 1), dtype=np.float32)
        np.add.at(verts, inv, flat_v)
        np.add.at(counts, inv, 1.0)
        verts = verts / np.maximum(counts, 1.0)
        
        new_tri_indices = inv.reshape((num_tri, 3))
        valid_mask = (new_tri_indices[:, 0] != new_tri_indices[:, 1]) & \
                     (new_tri_indices[:, 1] != new_tri_indices[:, 2]) & \
                     (new_tri_indices[:, 2] != new_tri_indices[:, 0])
        indices = new_tri_indices[valid_mask].astype(np.uint32)
    else:
        quant = np.round(flat_v, 5)
        _, idx, inv = np.unique(quant, axis=0, return_index=True, return_inverse=True)
        verts = flat_v[idx]
        indices = inv.reshape((num_tri, 3)).astype(np.uint32)

    v0 = verts[indices[:, 0]]
    v1 = verts[indices[:, 1]]
    v2 = verts[indices[:, 2]]
    face_normals = np.cross(v1 - v0, v2 - v0)
    vertex_normals = np.zeros_like(verts)
    np.add.at(vertex_normals, indices[:, 0], face_normals)
    np.add.at(vertex_normals, indices[:, 1], face_normals)
    np.add.at(vertex_normals, indices[:, 2], face_normals)
    
    norm_lens = np.linalg.norm(vertex_normals, axis=1, keepdims=True)
    vertex_normals = np.where(norm_lens > 1e-8, vertex_normals / norm_lens, np.array([0.0, 1.0, 0.0], dtype=np.float32))

    return verts, vertex_normals, indices.flatten()

def build_glb(bodies_list, profile="mobile"):
    bin_chunks = []
    buffer_views = []
    accessors = []
    meshes_gltf = []
    nodes_gltf = []
    
    total_triangles = 0
    total_vertices = 0
    body_mesh_idx_map = {}
    current_byte_offset = 0

    for idx, b in enumerate(bodies_list):
        stl_name = b["stl_file"]
        if not stl_name:
            continue
        stl_path = os.path.join(MESH_DIR, stl_name)
        if not os.path.exists(stl_path):
            continue

        raw_verts, raw_tri = read_stl(stl_path)
        verts, normals, indices = optimize_mesh(raw_verts, raw_tri, stl_name, profile)
        
        total_triangles += len(indices) // 3
        total_vertices += len(verts)

        v_bytes = verts.astype(np.float32).tobytes()
        n_bytes = normals.astype(np.float32).tobytes()
        
        if len(verts) < 65535:
            idx_data = indices.astype(np.uint16)
            idx_bytes = idx_data.tobytes()
            idx_comp_type = 5123
        else:
            idx_data = indices.astype(np.uint32)
            idx_bytes = idx_data.tobytes()
            idx_comp_type = 5125

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

        bv_pos = append_chunk(v_bytes, 34962)
        bv_norm = append_chunk(n_bytes, 34962)
        bv_idx = append_chunk(idx_bytes, 34963)

        acc_pos_idx = len(accessors)
        accessors.append({
            "bufferView": bv_pos,
            "byteOffset": 0,
            "componentType": 5126,
            "count": len(verts),
            "type": "VEC3",
            "max": [float(x) for x in verts.max(axis=0)],
            "min": [float(x) for x in verts.min(axis=0)],
        })

        acc_norm_idx = len(accessors)
        accessors.append({
            "bufferView": bv_norm,
            "byteOffset": 0,
            "componentType": 5126,
            "count": len(normals),
            "type": "VEC3",
        })

        acc_idx_idx = len(accessors)
        accessors.append({
            "bufferView": bv_idx,
            "byteOffset": 0,
            "componentType": idx_comp_type,
            "count": len(indices),
            "type": "SCALAR",
            "max": [int(indices.max())],
            "min": [int(indices.min())],
        })

        mat_id = 1 if ("ROLL" in b["name"] or "YAW" in b["name"] or "pitch" in b["name"]) else 0

        mesh_idx = len(meshes_gltf)
        meshes_gltf.append({
            "name": f"{b['name']}_mesh",
            "primitives": [{
                "attributes": {
                    "POSITION": acc_pos_idx,
                    "NORMAL": acc_norm_idx
                },
                "indices": acc_idx_idx,
                "material": mat_id
            }]
        })
        body_mesh_idx_map[b["name"]] = mesh_idx

    name_to_node_idx = {b["name"]: idx for idx, b in enumerate(bodies_list)}

    for idx, b in enumerate(bodies_list):
        node = {
            "name": b["name"],
            "translation": b["pos"],
            "rotation": [b["quat"][1], b["quat"][2], b["quat"][3], b["quat"][0]],
            "children": [name_to_node_idx[c] for c in b["children"] if c in name_to_node_idx],
            "extras": {
                "mujoco_body": b["name"],
                "joint_name": b["joint"]["name"] if b["joint"] else None,
                "joint_axis": b["joint"]["axis"] if b["joint"] else None,
                "joint_range": b["joint"]["range"] if b["joint"] else None,
            }
        }
        if b["name"] in body_mesh_idx_map:
            node["mesh"] = body_mesh_idx_map[b["name"]]
        nodes_gltf.append(node)

    materials_gltf = [
        {
            "name": "Asimov_Chassis_Alloy",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.72, 0.76, 0.82, 1.0],
                "metallicFactor": 0.85,
                "roughnessFactor": 0.35,
            },
            "doubleSided": False,
        },
        {
            "name": "Asimov_Structural_DarkAlloy",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.18, 0.22, 0.28, 1.0],
                "metallicFactor": 0.70,
                "roughnessFactor": 0.45,
            },
            "doubleSided": False,
        }
    ]

    bin_data = b"".join(bin_chunks)
    
    gltf_json = {
        "asset": {
            "version": "2.0",
            "generator": f"AsimovController3D_Pipeline_{profile}",
            "copyright": "VASIMOV Canonical Model Ingestion"
        },
        "scenes": [{
            "name": "Asimov1_Canonical_Scene",
            "nodes": [0]
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

    glb_bytes = glb_header + chunk0_header + json_bytes_padded + chunk1_header + bin_data_padded
    return glb_bytes, total_triangles, total_vertices

def main():
    print("=== Asimov 1 Model Conversion Pipeline ===")
    tree = ET.parse(XML_PATH)
    root = tree.getroot()

    mesh_file_map = {m.attrib["name"]: m.attrib["file"] for m in root.findall(".//mesh")}

    joints_dict = {}
    for j in root.findall(".//joint"):
        j_name = j.attrib.get("name")
        if j_name and j_name != "floating_base":
            joints_dict[j_name] = {
                "name": j_name,
                "axis": [float(x) for x in j.attrib.get("axis", "0 0 1").split()],
                "range": [float(x) for x in j.attrib.get("range", "-3.14 3.14").split()],
            }

    worldbody = root.find("worldbody")
    root_body = worldbody.find("body")

    bodies_list = []
    def parse_body(body_elem, parent_name=None):
        name = body_elem.attrib.get("name")
        pos = [float(x) for x in body_elem.attrib.get("pos", "0 0 0").split()]
        quat = [float(x) for x in body_elem.attrib.get("quat", "1 0 0 0").split()]
        
        vis_mesh_name = None
        stl_file = None
        for g in body_elem.findall("geom"):
            if g.attrib.get("class") == "visual" or g.attrib.get("type") == "mesh":
                m_ref = g.attrib.get("mesh")
                if m_ref:
                    vis_mesh_name = m_ref
                    stl_file = mesh_file_map.get(m_ref, m_ref)
                    break
        
        body_joint = None
        for j in body_elem.findall("joint"):
            j_name = j.attrib.get("name")
            if j_name and j_name in joints_dict:
                body_joint = joints_dict[j_name]
                break

        body_info = {
            "name": name,
            "parent": parent_name,
            "pos": pos,
            "quat": quat,
            "stl_file": stl_file,
            "joint": body_joint,
            "children": []
        }
        bodies_list.append(body_info)
        for child_body in body_elem.findall("body"):
            child_info = parse_body(child_body, name)
            body_info["children"].append(child_info["name"])
        return body_info

    parse_body(root_body)

    # 1. Build Mobile Asset (<= 120k triangles target budget)
    print("\n[1/3] Generating Mobile-Optimized Asset (asimov_1_mobile.glb)...")
    mobile_bytes, mobile_tris, mobile_verts = build_glb(bodies_list, "mobile")
    
    mobile_path = os.path.join(OUTPUT_DIR, "asimov_1_mobile.glb")
    default_path = os.path.join(OUTPUT_DIR, "asimov_1.glb")
    with open(mobile_path, "wb") as fp:
        fp.write(mobile_bytes)
    with open(default_path, "wb") as fp:
        fp.write(mobile_bytes)
    print(f"  -> Mobile Asset: {len(mobile_bytes) / (1024*1024):.2f} MB | {mobile_tris:,} triangles | {mobile_verts:,} vertices")

    # 2. Build HD Asset (High-Fidelity)
    print("\n[2/3] Generating High-Fidelity Asset (asimov_1_hd.glb)...")
    hd_bytes, hd_tris, hd_verts = build_glb(bodies_list, "hd")
    hd_path = os.path.join(OUTPUT_DIR, "asimov_1_hd.glb")
    with open(hd_path, "wb") as fp:
        fp.write(hd_bytes)
    print(f"  -> HD Asset: {len(hd_bytes) / (1024*1024):.2f} MB | {hd_tris:,} triangles | {hd_verts:,} vertices")

    # 3. Generate TypeScript Specifications & Base64 Module
    print("\n[3/3] Generating TypeScript specifications & offline base64 module...")
    b64_str = base64.b64encode(mobile_bytes).decode("ascii")
    
    data_ts_path = os.path.join(SRC_MODEL_DIR, "asimov_1_model_data.ts")
    with open(data_ts_path, "w") as fp:
        fp.write(f"""// AUTO-GENERATED from canonical MuJoCo model: asimov_1_vasimov.xml
// DO NOT EDIT MANUALLY. Generated by scripts/convert_asimov_model.py
// Base64-encoded optimized binary GLB for instant offline zero-network loading.

export const ASIMOV_1_MOBILE_GLB_BASE64 = "{b64_str}";
export const ASIMOV_1_TRIANGLES = {mobile_tris};
export const ASIMOV_1_VERTICES = {mobile_verts};
export const ASIMOV_1_BYTE_SIZE = {len(mobile_bytes)};
""")

    hierarchy_ts_path = os.path.join(SRC_MODEL_DIR, "AsimovJointHierarchy.ts")
    ts_content = f"""// AUTO-GENERATED from canonical MuJoCo model: asimov_1_vasimov.xml
// DO NOT EDIT MANUALLY. Generated by scripts/convert_asimov_model.py

export interface JointDefinition {{
  jointName: string;
  nodeName: string;
  parentBody: string;
  axis: [number, number, number];
  range: [number, number]; // [min, max] in radians
  defaultPos: [number, number, number];
  defaultQuat: [number, number, number, number]; // [x, y, z, w]
  neutralAngle: number;
}}

export const ASIMOV_JOINTS: Record<string, JointDefinition> = {{
"""
    for b in bodies_list:
        if b["joint"]:
            j = b["joint"]
            q = b["quat"]
            q_three = [q[1], q[2], q[3], q[0]]
            ts_content += f"""  '{j["name"]}': {{
    jointName: '{j["name"]}',
    nodeName: '{b["name"]}',
    parentBody: '{b["parent"]}',
    axis: [{j["axis"][0]}, {j["axis"][1]}, {j["axis"][2]}],
    range: [{j["range"][0]}, {j["range"][1]}],
    defaultPos: [{b["pos"][0]}, {b["pos"][1]}, {b["pos"][2]}],
    defaultQuat: [{q_three[0]}, {q_three[1]}, {q_three[2]}, {q_three[3]}],
    neutralAngle: 0.0,
  }},
"""
    ts_content += f"""}};

export const ASIMOV_BODIES = [
"""
    for b in bodies_list:
        ts_content += f"""  {{ name: '{b["name"]}', parent: '{b["parent"]}', mesh: '{b["stl_file"]}' }},\n"""
    ts_content += f"""];

export const ASIMOV_TOTAL_TRIANGLES = {mobile_tris};
export const ASIMOV_TOTAL_JOINTS = {len([b for b in bodies_list if b["joint"]])};
export const ASIMOV_ROOT_BODY = 'pelvis_link';
export const ASIMOV_HEAD_BODY = 'neck_pitch_link';
export const ASIMOV_LEFT_FOOT_BODY = 'left_ankle_roll_link';
export const ASIMOV_RIGHT_FOOT_BODY = 'right_ankle_roll_link';
"""
    with open(hierarchy_ts_path, "w") as fp:
        fp.write(ts_content)

    print("Pipeline Complete! Output assets and mappings successfully created.")

if __name__ == "__main__":
    main()
