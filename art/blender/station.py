# station: the two-cell coaster platform. Striped canopy over the FRONT half only, so
# the board behind stays visible; a gold-framed sign without text. Front is -Y.
import sys
sys.path.insert(0, REPO + "/tools/blender")
import importlib, math, kit
importlib.reload(kit)
from kit import box, cyl, sphere, reset, finish, mat_tex, textured

reset()
PLANKS = mat_tex("planks", "art/textures/painted_planks.png")
CANOPY = mat_tex("canopy", "art/textures/painted_canopy.png")
GOLD = mat_tex("gold", "art/textures/painted_gold.png", rough=0.5)
RED, CREAM, DARK = "#d23a2c", "#fbf1dc", "#5a3a26"

# Platform: plank deck on a darker skirt, gold edge along the front
box((2.24, 0.94, 0.06), DARK, (0, 0, 0.03))
textured(box((2.2, 0.9, 0.2), "#ffffff", (0, 0, 0.16), bevel=0.02), PLANKS, 0.45)
textured(box((2.2, 0.035, 0.03), "#ffffff", (0, -0.45, 0.255)), GOLD, 0.3)
# Posts: red with gold caps, front row and the canopy's back edge
for x in (-1.02, 0.0, 1.02):
    for y, h in ((-0.4, 0.66), (0.0, 0.78)):
        cyl(0.032, h, RED, (x, y, 0.26 + h / 2), seg=6)
        textured(sphere(0.045, "#ffffff", (x, y, 0.26 + h), seg=6, rings=4), GOLD, 0.3)
# Canopy: a sloped striped roof from the front (low) to the middle (high)
slope = math.atan2(0.12, 0.5)
textured(box((2.36, 0.56, 0.035), "#ffffff", (0, -0.22, 0.99), rot=(-slope, 0, 0)), CANOPY, 0.8, axis_v="y")
# Scalloped front edge in alternating red and cream
for k in range(12):
    x = -1.1 + k * 0.2
    cyl(0.1, 0.1, RED if k % 2 == 0 else CREAM, (x, -0.5, 0.88), seg=6, r2=0.0, rot=(math.pi, 0, 0), scale=(1, 0.35, 1))
# Sign on top of the canopy: gold frame, red panel, a gold star
textured(box((0.9, 0.05, 0.28), "#ffffff", (0, -0.3, 1.16), bevel=0.015), GOLD, 0.3)
box((0.78, 0.03, 0.18), RED, (0, -0.33, 1.16), bevel=0.01)
sphere(0.05, "#ffd23f", (0, -0.35, 1.16), scale=(1, 0.4, 1), seg=5, rings=3)
finish("station", 3000)
