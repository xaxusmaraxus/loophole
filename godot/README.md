# Loophole: Godot style test

A procedural 3D diorama for trying out the art direction. It has no asset files yet: the island, sea, cliffs, waterfall, trees, puzzle plot, coaster (built from plot cells, with a loop, helix, corkscrew and Mega Loop), station, carousel and guests are all generated in `main.gd`.

## Run
Open this folder in **Godot 4.3+** and press Play (Forward+ renderer).

| Key | Does |
| --- | --- |
| Arrows | Swipe the tiles (plain 2048; track cells are walls) |
| C | Cycle cameras: overview iso, overview square, ride close-up, gameplay iso, gameplay square |
| T | Toggle day / sunset |

## Render the comparison shots
```
godot --path . -- --shots
```
This writes PNGs to `shots/` and quits. Headless on Linux without a GPU:
```
VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json xvfb-run -a -s "-screen 0 1600x1000x24" \
  godot --rendering-driver vulkan --path . --resolution 1600x1000 -- --shots
```
The latest set is copied to `docs/style-test/`.

## What's placeholder
Everything is primitive shapes with flat colors. To get closer to the painted mockup:
- hand-painted textures for grass, paving and cliffs
- modeled guests with walk/sit/puke animations, and signature buildings
- an outline or rim-light pass
- denser dressing: fences, flowers, signs, bunting
