# Xbox 360 pad: Blender file -> GLB (glTF export, JPEG textures, Y up).  usage: python3 convert_blend.py xbox360.blend x360_raw.glb
# Needs `pip install bpy` (the Blender-as-a-module wheel; Python 3.11-3.13 matching the wheel).
import bpy, sys
src, out = sys.argv[-2], sys.argv[-1]
bpy.ops.wm.open_mainfile(filepath=src)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_image_format='JPEG', export_yup=True)
