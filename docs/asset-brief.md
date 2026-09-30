# Asset brief: round 1

**Goal:** move the Godot style test (`docs/style-test/`) toward the mockup: a cozy, hand-painted-looking theme park diorama. Keep the low-poly readability of the current test. Add warmth, detail and character.

**Mood:** a warm autumn afternoon on a small island park. Chunky, friendly shapes, soft light, saturated but not neon. Think of a painted board game rather than a realistic render. No text on models (UI text stays in the UI).

## Pipeline
1. **Concept sheet per asset** (image model or ComfyUI/Krea): front, side and 3/4 views on a plain background, using the style prompt below. These are references for modeling, not in-game art.
2. **Model in Blender (Blender MCP):** low-poly, flat or softly painted. Keep the poly budgets below.
3. **Export glTF binary** to `godot/assets/models/<name>.glb`:
   - +Z up in Blender (glTF export converts to Godot's Y-up); apply scale and rotation before export.
   - Origin at the **bottom center** of the object, resting on the ground.
   - Units in meters; 1 grid cell = 1 m.
   - Front faces Blender **−Y**, which becomes the camera-facing side in Godot. Exception: the coaster car's front faces Blender **+Y** (its direction of travel).
4. **Textures** (optional in round 1): one 512–1024 px painted atlas per asset, or plain vertex or material colors. No normal or roughness maps needed. Roughness around 0.8.
5. **Check in Godot:** `godot --path godot -- --shots`, then compare with the previous round.

**Style prompt** (prefix for every concept or texture prompt):
> cozy hand-painted stylized theme park asset, chunky low-poly shapes, soft warm autumn light, saturated friendly palette, clean silhouette, board-game miniature look, plain light background, no text, no logos

## Palette
| Use | Hex |
| --- | --- |
| Grass | `#6fb84a` `#63a944` `#7cc453` |
| Paving | `#e3cfa6` `#d6bf94` |
| Cliffs | `#a47a55` `#8b6a4f` `#b58a5e` |
| Water | `#1a5c9e` → `#4dbdd1` |
| Autumn leaves | `#e8883a` `#d9542f` `#f2b33d` `#b8472e` |
| Evergreen | `#3f8a4a` `#4f9e4f` `#2f6f45` |
| Track rails / canopy red | `#e34a3c` / `#e8484f` |
| Accent gold | `#ffd23f` |
| Piece tiers 1–7 | `#e0b06a` `#7cc45f` `#4fa7dc` `#9d74e6` `#ee5d50` `#ff9b45` `#ffd447` |

## Models (in priority order)
Names must match exactly; `main.gd` loads them automatically.

| # | File name | What | Size (m) | Tris |
| --- | --- | --- | --- | --- |
| 1 | `guest_01` … `guest_06` | Guests: a stubby, big-headed body (head about ⅓ of height). Vary the outfits: tourist with a camera, kid with a balloon, grandma with a bun and glasses, a teen with spiky hair and shades, a guy holding a corn dog, an influencer with a phone. | 0.45 tall | ≤ 800 |
| 2 | `boss_barry` | **Big Barry**, the first boss: huge, round, cheerful, bright red shirt, tiny cap. | 0.9 tall | ≤ 1500 |
| 3 | `tree_round_01` … `_04` | Round deciduous trees: 2 autumn (orange, red), 1 yellow, 1 green. Chunky clustered canopies. | 1.2–1.6 tall | ≤ 400 |
| 4 | `tree_pine_01` … `_03` | Stylized pines, stacked tiers. | 1.3–1.8 tall | ≤ 300 |
| 5 | `station` | The coaster station: a two-cell platform with a striped red and white canopy over the **front half only** (the board behind must stay visible), plus a gold sign. | 2.2 × 0.9 | ≤ 3000 |
| 6 | `coaster_car` | A two-seat coaster car, red with a gold stripe, and a lap bar. Seats open at the top so guest heads show. | 0.27 × 0.31 | ≤ 600 |
| 7 | `tile_1` … `tile_7` | Piece tiles: beveled crates in the tier colors, each with a small sculpted icon on top. 1 Bump (low hump), 2 Hill (tall hump), 3 Drop (steep ramp), 4 Helix (coil spring), 5 Loop (upright ring), 6 Corkscrew (twisted double ring), 7 Mega Loop (big gold ring with a star). | 0.84 × 0.84, ≤ 0.5 tall | ≤ 800 |
| 8 | `carousel` | Carousel: striped cone roof, gold pole, 8 horses. | ⌀ 2.5, 1.9 tall | ≤ 3000 |
| 9 | `food_stand` | Snack stand: striped awning, counter facing front, a giant corn dog on the roof. | 1.1 × 0.8 | ≤ 1500 |

**Later (round 2), no hook yet:** lamp post, bench, fence segment, flower bed, bunting string, rocks, pond, the other bosses (Iron-Gut Ivy, an old sailor; Dr. Vertigo, a coaster scientist in a lab coat; The Mayor), and guest animations (idle, walk, sit, cheer, puke).

## Textures (round 2)
Tileable, 1024 px, same style prompt plus `seamless tileable top-down texture`:
- `grass_painted`: painterly grass with tiny flowers
- `paving`: warm sandstone pavers
- `cliff_strata`: layered orange and brown rock bands (side view)
- `sand`: soft beach sand; `mud`: dark wet mud with puddles

Save to `godot/assets/textures/`. Wiring them into `main.gd` is a round 2 task.

## Status
_Update after each batch: what's done, what's blocked, open questions. Save renders to `docs/style-test/round-<n>/`._

- **Round 1, batch 1 (2026-09-30): guests 1–3 and Big Barry are in.** Waiting on review before the rest of the list.
  - `guest_01` tourist (bucket hat, camera): 796 tris, 0.45 m. `guest_02` kid with a red balloon: 792 tris, 0.52 m with the balloon (body about 0.4 m). `guest_03` grandma (bun, glasses, handbag): 798 tris, 0.47 m with the bun. `boss_barry`: 1,424 tris, 0.9 m. All flat material colors from the palette, roughness 0.8, origin bottom center, front −Y.
  - Pipeline: `tools/krea_bg.py` + `art/comfy/<name>.json` for concept sheets (Krea 2 Turbo in a local ComfyUI; the jobs start with the brief's style prompt). Models are Python scripts, `art/blender/<name>.py`, built on `tools/blender/kit.py` (primitives, budget check, bottom-center origin, GLB export) and `tools/blender/chibi.py` (the shared guest body). `python3 tools/blender/send.py art/blender/<name>.py` runs one in the open Blender through the BlenderMCP addon socket, so each model can be rebuilt from its script. `.blend` files and turnaround previews are saved next to them (`art/blender/`, `art/previews/`).
  - Renders: `docs/style-test/round-1/`, plus `compare_round0_vs_round1.png` (left: round 0, right: round 1).
  - New mood reference from the user: `docs/mood/coaster_town_mood.png` (painted isometric island park; a denser, more detailed direction than the style test so far).
  - Observations: the guests read as characters at gameplay zoom now, and Barry stands out at the front of the queue. With only 3 variants the crowd repeats. `main.gd` gives each guest a random yaw, so about half face away from the camera; facing the queue forward is a scene change, left for the user to decide. The biggest remaining gap to the mood image is the environment (cliffs, water, paving, dressing), not the characters.
  - **Paint-over test (matching the mood image):** a new camera (mode 5, `07_mood_square_day`: orthographic, square-on, 50° pitch, framed like the mood) rendered the diorama, then Krea repainted it (`art/comfy/paint_*.json`, results in `docs/style-test/round-1/paintover/`, overview `paintover_test.png`). Image-to-image at denoise **0.45** with a detailed style prompt keeps the layout (board, station, carousel, stand in place) and gets very close to the mood's painted look. At 0.6 the layout drifts; the depth-control and style-reference variants lost the layout entirely. Candidate direction: paint the static park as a background plate for the fixed camera, keep only the moving parts (tiles, track, train, guests) in 3D. Open questions: how well 3D pieces blend over the painting, and repainting when the park changes.
  - **Phone portrait (the target platform):** camera mode 6 (`08_phone_day`, `09_phone_sunset`, 720×1280) puts the plot at nearly full width with the park above and the station and queue below. The coaster was scaled up (`ELEMENT_SCALE` 1.5, higher decks, wider and thicker track). Finding: with a square-on camera, loops that run up or down a column are seen edge-on, as a line. Turning the camera 20° (`PHONE_YAW`, now the default) makes every element read in 3D, at the cost of a slightly diamond-shaped board and swipes that no longer match the screen axes exactly. Needs a decision.
  - **Phone paint-over:** `docs/style-test/round-1/phone_paintover.png` (render, Krea img2img 0.45, GPT image `gpt-6-astra` via ima2 with the mood image as reference). The GPT image kept the layout (tiles, icons, track, station, queue, Barry) and is closest to the mood so far; Krea kept the layout but came out softer. Not checked yet: pixel alignment with the 3D render (the GPT output is 2:3, the render 9:16). ima2's CLI timed out at about 180 s although the server finished; the image was recovered from `~/.ima2/generated/`.
  - **Compositing test, painted plate + live 3D (`10_phone_plate_day.png`, `phone_plate_motion.gif`):**
    - Pipeline: `godot --path godot -- --plate-source` renders the phone view without the moving parts (tiles, coaster, station, guests); GPT image (`art/gen/plate_phone_day.json`) paints it; `uv run tools/align_plate.py` warps the painting onto the render by the four corners of the plot's lawn (the cells then match to the pixel, see `paintover/phone_plate_alignment_check.png`); `uv run tools/sway_mask.py` makes a wind mask of the painted canopies. `godot --path godot -- --shots --plate res://assets/plates/phone_day.png [--frames N]` renders the composite.
    - In the game, the low-poly park stays as an invisible stand-in: `plate.gdshader` shows the painting in its place (sampled in screen space), keeps its depth (3D pieces go behind it correctly) and darkens it where 3D pieces cast shadows. The canopies sway in the shader; nothing else in the painting moves.
    - Works: the 3D tiles sit exactly on the painted cells, the coaster and guests stand on the painted park, and the trees move without tearing the painting.
    - Problems: (1) The 3D pieces look pale and flat next to the painting, because color grading is off so the painting shows unchanged. They need their own painted treatment (saturated colors, outlines, painted textures). (2) GPT painted its own trees and props, so they don't match the 3D stand-ins: occlusion is only right where they overlap, and guests can stand in painted flower beds. Guest paths need a walkable-area mask. (3) The painting didn't reach the bottom 4% of the frame (mirrored for now); paint slightly larger than the frame next time. (4) Only one plate: sunset, the other parks and any change to the park need their own plates.
  - **Painted look for the live pieces** (`painted_look_before_after.png`, `11_phone_plate_painted.png`): in plate mode every moving piece gets `painted.gdshader` (soft cel light with warm highlights and violet shadows, rim light, saturation ×1.35, a faint brush noise) plus an outline pass (`painted_outline.gdshader`, width per piece via an `outline_width` meta: 1.4 cm tiles and station, 0.6 cm guests). The track has too thin rails for an outline hull (and its winding pushes the hull inward), so it gets ink edges shaded into the surface instead (`ink` meta). Tiles created by swipes are painted as they appear (checked: `12_phone_plate_after_swipe.png`). Fixes problem (1) for the most part; the pieces now read as belonging to the painting. Still plain: the station (a placeholder box) and the tile crates (flat colors, no painted texture or sculpted icons yet). Those are the next asset tasks (`station`, `tile_1..7` in the model list), now with painted textures in mind.
  - **Closer to the painting, step 2** (`painted_look_steps.png`: plain → painted shader → textured): GPT painted a crate face (`godot/assets/textures/painted_crate.png`) and a brush-dab swatch (`painted_brush.png`) in the mood style (`art/gen/tex_*.json`). The tiles now use the crate as light/dark detail on their tier color (box-projected per face, `crate` meta), and every piece uses the brush swatch instead of noise. A Kuwahara filter (`painterly_post.gdshader`, radius 2) flattens shading into brush-like patches on the bigger pieces only: they mark themselves via the stencil buffer (Godot 4.5+), while the track and guests use `painted_crisp.gdshader`, which skips the filter because it smears thin shapes. Still plain: the station (placeholder).
  - **Round 1, batch 2 (`16_phone_plate_assets.png`):**
    - **Track, rebuilt toward a painted target** (`track_before_after_target.png`; the target is a GPT paint-over of our own coaster): chunky red rails with a baked highlight and dark underside, a thin outline, sparse wooden ties, and wooden trestles with cap beams and X-bracing instead of poles. Fixed the rail tubes' triangle winding (we were seeing the inside of the far wall).
    - **`station`** (644 tris): plank deck, red posts with gold caps, a striped canopy over the front half only, a scalloped edge, and a gold-framed sign without text. GPT-painted plank, canopy and gold textures in `art/textures/`.
    - **`tile_1`–`tile_7`** (204–300 tris, ≤ 0.5 m): painted crates in the tier colors (the crate texture tinted per tier) with sculpted cream icons: Bump and Hill as rails, Drop as a plunge, Helix as a coil, Loop as a ring, Corkscrew as a twist on posts, and Mega Loop as a big ring with an orange star. The star isn't gold because the tier-7 crate already is.
    - **Guests and Barry, painted from their concept sheets:** the front view is projected onto the faces that point forward (`kit.front_paint`), and the sides and back keep flat colors. Barry's modeled face was removed since the painting provides it. The kid's face comes out a bit squashed (the balloon overlaps the head in the concept), but it doesn't show at game size.
    - **Ride physics (`main.gd`, "Track frames and ride physics"; `ride_chase_lap.gif`):** the track and the cars now share one precomputed frame per 2 cm, so the cars always sit exactly on the rails. The car's up is the force the riders feel: centripetal acceleration plus gravity, low-passed along the track. Loops and the corkscrew (and only those) turn the car over; everywhere else it banks into turns (65° at most) and never flips over a crest. Speed comes from energy (slow over the tops, fast in the dips, easing out of and into the station), and the minimum speed is set so the widest loop still presses riders into their seats at the top. The curve handles no longer overshoot, the helix now exits toward the next cell, and the corkscrew is longer. `godot --headless --path godot -- --ride-check` prints the numbers: the largest up turn per 2 cm step is down from 138° to about 11°, only the two loops and the corkscrew are inverted, and a lap takes 12.7 s at 0.5–3.5 m/s.
    - **Track look, closer to the target** (`track_vs_target.png`): narrow bright highlight on the rails and brush-like patches along them, dense ties with a lit top plank, and trestles every ~0.9 m, none under inversions or through lower track.
    - Open: guests and Barry still get a random facing from `main.gd`, so about half show their unpainted backs. Facing the queue and the crowd toward the camera would show the painted faces; that needs a scene change. (the brief says 4.3+). The editor rewrote `godot/project.godot` for 4.7; that change isn't committed.
