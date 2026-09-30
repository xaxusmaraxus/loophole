# Loophole: Godot style test ("inked toy diorama")

A fully procedural 3D diorama for the art direction. There are no asset files: everything is built in code from vertex-colored, flat-shaded geometry and finished by three shaders.

| File | What it does |
| --- | --- |
| `main.gd` | Builds the scene: a terraced island with an overhanging grass lip and rock strata, the toon sea, a waterfall, the paved plaza, the puzzle plot and tiles, the coaster, the train, the station, trees, the Ferris wheel, drop tower, carousel, food stand, lamps, bunting and about 100 chibi guests (some of them puking). |
| `geo.gd` | Geometry batcher: boxes (optionally chamfered), cylinders, cones, spheres, jittered icosahedron blobs, tubes and beams, all merged into one mesh per material. |
| `shaders/toon.gdshader` | Cel light: two hard bands, a cool ambient shade, a crisp spec blob on glossy paint, a thin rim, and wind sway for foliage (vertex alpha below 1). |
| `shaders/ink_post.gdshader` | Full-screen pass on a quad parented to the camera: ink lines from depth creases and sharp normal changes, plus warm/cool grading, a vignette and grain. The camera's near/far and projection type are passed in as uniforms. |
| `shaders/water.gdshader` | Toon sea: color bands by distance to the coast, drifting foam rings, a hard foam line at the cliffs, glints and shadows. |

## The coaster
The ride is built from plot cells (`TRACK` in `main.gd`) with the same piece ladder as the web prototype:
- **Bump** and **Hill**: crests at different deck heights.
- **Drop**: a tall crest with a lift chain on the climb.
- **Loop** and **Mega Loop**: teardrop loops that drift sideways, so the exit clears the entry.
- **Helix**: a banked 450° climbing turn.
- **Corkscrew**: a heartline roll, where the track twists a full turn in place.

Corners are banked. The train's five cars take their orientation from the same frames as the rails, so they roll and invert correctly. The riders scream with their arms up, and some are green.

## Run
Open this folder in **Godot 4.3+** and press Play (Forward+).

| Key | Does |
| --- | --- |
| Arrows | Swipe the tiles (plain 2048; track cells are walls) |
| C | Cycle cameras: overview, gameplay iso, mega loop, loop, postcard, ride |
| T | Toggle day / sunset |

## Render the shots
```
godot --path . -- --shots              # all shots to shots/
godot --path . -- --shots --only=05    # just the ones whose name contains "05"
```
Headless on Linux without a GPU:
```
VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json xvfb-run -a -s "-screen 0 1600x1000x24" \
  godot --rendering-driver vulkan --path . --resolution 1600x1000 -- --shots
```
Add `--noink` to turn the line pass off, or `--inkdebug` to see its depth edges (red) and normal edges (green).
The latest set is in `docs/style-test/overhaul/`.
