#!/bin/sh
# Rebuilds web/models/pad_*.glb from the artists' source models.
#   usage: tools/model/pads/build_all.sh <dir with the source models> [out dir, default ./out]
# Needs: node 20+ (run `npm install` in this folder once), python3 with `pip install bpy` for the Xbox 360 .blend (skipped when
# x360_raw.glb already exists in the source dir). Source files expected in <dir>:
#   xbox360.blend  white_xbox_controller.glb  dualshock_4_playstation_controller_1k.glb  dualsense_model_updated.glb  nintendo_switch_joycon.glb
set -e
SRC=${1:?source dir}; OUT=${2:-out}; HERE=$(cd "$(dirname "$0")" && pwd); cd "$HERE"
[ -f "$SRC/x360_raw.glb" ] || python3 convert_blend.py "$SRC/xbox360.blend" "$SRC/x360_raw.glb"
node build_pads.mjs all "$SRC" "$OUT"
node optimize_pads.mjs "$OUT/pad_xbox360.raw.glb"  "$OUT/pad_xbox360.glb"  1024 512
node optimize_pads.mjs "$OUT/pad_xboxone.raw.glb"  "$OUT/pad_xboxone.glb"  1024 512
node optimize_pads.mjs "$OUT/pad_ds4.raw.glb"      "$OUT/pad_ds4.glb"      1024 512
node optimize_pads.mjs "$OUT/pad_ds5.raw.glb"      "$OUT/pad_ds5.glb"      1024 512
node optimize_pads.mjs "$OUT/pad_joycon.raw.glb"   "$OUT/pad_joycon.glb"   1024 512
ls -l "$OUT"/pad_*.glb | grep -v raw
