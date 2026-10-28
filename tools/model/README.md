# 3D guitar model

`web/models/guitar.glb` is based on **"Guitar Hero Controller"** by **CamSear16**
(https://sketchfab.com/3d-models/guitar-hero-controller-bcac8f9f95a44008ad90f470326e5fca),
licensed under **CC-BY-4.0** (http://creativecommons.org/licenses/by/4.0/).

Changes made for YAGCC (shape untouched):

* the frets, strum bar, Start / Back buttons and whammy bar are separate nodes with their own pivots so the configurator can animate them;
* the static parts are merged into two meshes (plastic and chrome);
* the front plate is recoloured blue-purple (#5B4EE8) with a black trim (set `YAGCC_FACE=rrggbb` when building for another colour);
* brand marks were removed from the textures (headstock wordmark, embossed logo, console guide-button logo, rear label);
* textures were downsized to 2048 px JPEG and the glossiness map was converted to a roughness map.

`build_glb.py` reproduces the file from the two Sketchfab downloads (instructions at the top of the script).
The 3D view uses three.js (MIT), bundled as `web/vendor/three-yagcc.js`.


# 3D controllers (Test page)

`web/js/gamepad3d.js` shows one real pad model per USB mode in the "Controller Visualizer" card (the 2D drawing in `gamepad.js` stays as the
fallback for software WebGL / `?2d`, and as the hidden keyboard layer). The models are loaded lazily, one per selected mode:

| file (`web/models/`) | modes | based on (author, source) | size |
| --- | --- | --- | --- |
| `pad_xbox360.glb` | XInput | Xbox 360 pad by [matok39x](https://www.cgtrader.com/designers/matok39x) (CGTrader), `xbox360.blend` converted with Blender's glTF exporter | 1.1 MB |
| `pad_xboxone.glb` | Xbox One, OG Xbox, HID | "White XBOX Controller" by [CREATRBOI](https://sketchfab.com/CREATRBOI) (Sketchfab) | 0.8 MB |
| `pad_ds4.glb` | PS3 GH, PS3 RB, PS4 | "DualShock 4 PlayStation Controller" by [shaielwolf](https://sketchfab.com/shaielwolf) (Sketchfab) | 1.1 MB |
| `pad_ds5.glb` | PS5 | "Playstation 5 Dualsense" by [AHarmlessPotato](https://sketchfab.com/AHarmlessPotato) (Sketchfab) | 1.2 MB |
| `pad_joycon.glb` | Switch, Wii RB | "Nintendo Switch Joycon" by [Hayley Jacka](https://sketchfab.com/HayleyJacka) (Sketchfab) | 0.7 MB |

No DualShock 3 model was provided, so the PS3 modes show the DualShock 4. An earlier `dualshock4.glb` (12 MB, 400k triangles, flat colours, blank caps) was
evaluated and not used: the 1k-texture DualShock 4 above is lighter, already carries the symbols, SHARE / OPTIONS and PS marks in its textures and splits into
the same parts.
`PS2.c4d` (Cinema 4D) was not converted: assimp has no Cinema 4D reader and no open-source C4D importer was available.

Changes made for YAGCC: every pad is split into named, pivoted nodes; static parts are merged per material and the meshes simplified
(meshoptimizer, borders locked, ~15-25k triangles each); textures are resized (<= 1024 px base colour, 512 px others) and re-encoded as JPEG; materials
of the Xbox 360 / Xbox One pads were reset to plain white plastic; the Xbox 360 glass lenses over the face buttons were dropped; the Xbox One pad (one single
shell) had its triggers and bumpers cut out with exact plane cuts and was levelled (it sits tilted in the source); the Joy-Con pair is the right Joy-Con plus a copy
turned 180 degrees with a blue body (hue-shifted texture), a minus bar instead of the plus, its capture button moved to the bottom and the shoulder
buttons at the top. Button labels the source lacks are drawn at run time as flat decals (letters on the Xbox pads, PlayStation symbols on the DualSense,
arrows and capture on the left Joy-Con, view / menu icons) from simple geometric shapes and a plain font; the existing marks in the models were kept.

## Node names (identical in every file)

`btn_a btn_b btn_x btn_y` (outputs 1-4 by position: bottom, right, left, top), `lb rb` (5, 6), `lt rt` (7, 8, analog 22 / 23), `back start guide` (9, 10, 11),
`ls rs` (stick cap; tilts with X / Y and presses for the click, outputs 12 / 13), `dpad` (one piece that tilts; Xbox pads) or `dpad_up dpad_down dpad_left dpad_right`
(four keys; PlayStation pads and the left Joy-Con). The Joy-Con file has both pads: right = `btn_*`, `rs rb rt start guide`; left = `dpad_*`, `ls lb lt back`, `capture`.
Every part node has glTF `extras`: `role` (`btn`, `bump`, `trig`, `stick`, `dpad`, `dpad4`, `static`), `size` (cap width / depth), `top` (cap top centre, pivot-relative) and `hgt`.
Node origins are the pivots (stick base, trigger hinge, cap centre), so the page only sets rotations / offsets. `gamepad3d.js` holds the per-model table (motion angles, decals).

## Rebuilding

`tools/model/pads/` (Node 20+, `npm install` once; Python with `pip install bpy` only for the .blend):

```
tools/model/pads/build_all.sh <dir with the source files> [out dir]
```

* `convert_blend.py` - `xbox360.blend` -> `x360_raw.glb` (Blender glTF exporter, run through the `bpy` module).
* `build_pads.mjs` - the per-model recipe: orientation, which connected pieces / triangles belong to which named part, pivots, materials, simplification budgets. Pieces are
  picked by their index in the connected-component listing of `comps.mjs` (so it only matches the exact source files named above); `hl.mjs` renders chosen pieces in red to check a pick.
* `optimize_pads.mjs` - texture resize / re-encode, dedup, prune.
* `lib.mjs`, `engine.mjs` - helpers (bake to world space, components, exact plane splitting, mesh reduction, GLB writer).

`web/vendor/three-yagcc.js` was rebuilt from three.js r169 with a few more exports (Raycaster, Vector2, PlaneGeometry, Quaternion, Euler, Matrix4, DoubleSide); the guitar is unaffected.
