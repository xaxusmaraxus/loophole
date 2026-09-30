# guest_03: grandma with a bun, round glasses and a handbag (concept: art/concepts/guest_03.png)
import sys
sys.path.insert(0, REPO + "/tools/blender")
import importlib, kit, chibi
importlib.reload(kit); importlib.reload(chibi)
from kit import box, cyl, sphere, torus, reset, finish

reset()
b = chibi.body(shirt="#9d74e6", pants="#c9b3ee", shoes="#6b4a3a", hair="#e4e4ec", hat=False, hips=False)
# Dress: a skirt flaring out below the cardigan
cyl(0.24, 0.16, "#c9b3ee", (0, 0, 0.19), seg=8, r2=0.18)
# Bun on top
sphere(0.085, "#e4e4ec", (0, 0.05, 0.9), seg=7, rings=4)
# Round glasses
for sx in (-1, 1):
    torus(0.045, 0.008, "#8a5a34", (sx * 0.075, -0.195, 0.66), rot=(1.5708, 0, 0), seg=6, minor=3)
box((0.05, 0.01, 0.01), "#8a5a34", (0, -0.2, 0.67))
# Handbag in the left hand
box((0.1, 0.05, 0.08), "#b8472e", (-b["hand_x"] - 0.03, -0.02, 0.24))
box((0.06, 0.01, 0.05), "#8a3a26", (-b["hand_x"] - 0.03, -0.02, 0.3))
finish("guest_03", 800, scale=0.45 / 0.9 * 0.95, paint="art/textures/guest_03_front.png")
