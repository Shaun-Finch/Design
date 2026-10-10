"""Blender (headless) script: Rocketbox FBX -> GLB, plus a JSON summary of bones, meshes and shape keys.
Usage: blender -b -P convert.py -- IN.fbx OUT.glb"""
import json
import os
import sys

import bpy

src, dst = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src, automatic_bone_orientation=True)
# relink textures that sit next to the FBX or in a Textures folder
here = os.path.dirname(src)
for img in bpy.data.images:
    name = os.path.basename(img.filepath.replace("\\", "/"))
    for cand in (os.path.join(here, name), os.path.join(here, "Textures", name), os.path.join(here, "..", "Textures", name)):
        if os.path.exists(cand):
            img.filepath = cand
            img.reload()
            break
info = {"bones": [], "meshes": [], "shapeKeys": {}, "images": [i.filepath for i in bpy.data.images]}
for ob in bpy.data.objects:
    if ob.type == "ARMATURE":
        info["bones"] = [b.name for b in ob.data.bones]
    if ob.type == "MESH":
        info["meshes"].append({"name": ob.name, "verts": len(ob.data.vertices)})
        if ob.data.shape_keys:
            info["shapeKeys"][ob.name] = [k.name for k in ob.data.shape_keys.key_blocks]
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_image_format="JPEG", export_animations=False)
json.dump(info, open(dst + ".json", "w"), indent=1)
print("converted", src, "->", dst, os.path.getsize(dst) // 1024, "KB;", len(info["bones"]), "bones")
