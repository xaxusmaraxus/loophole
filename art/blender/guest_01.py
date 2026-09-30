# guest_01: tourist with a bucket hat and a camera (concept: art/concepts/guest_01.png)
import sys
sys.path.insert(0, REPO + "/tools/blender")
import importlib, kit, chibi
importlib.reload(kit); importlib.reload(chibi)
from kit import box, cyl, sphere, torus, reset, finish

reset()
b = chibi.body(shirt="#3aa0e0", pants="#b8a26a", shoes="#8a5a34", hair="#3a2718")
# Bucket hat: brim and crown
cyl(0.3, 0.04, "#e8b560", (0, 0.02, 0.8), seg=12, r2=0.22, rot=(0.12, 0, 0))
cyl(0.215, 0.14, "#e8b560", (0, 0.03, 0.88), seg=12, r2=0.18, rot=(0.12, 0, 0))
# Camera on a strap
box((0.15, 0.06, 0.09), "#dcdcdc", (0, -0.165, 0.4))
cyl(0.035, 0.04, "#2a2a33", (0, -0.2, 0.395), seg=8, rot=(1.5708, 0, 0))
box((0.03, 0.02, 0.02), "#e8733a", (-0.05, -0.19, 0.44))
for sx in (-1, 1):
    box((0.025, 0.012, 0.13), "#7a4a28", (sx * 0.07, -0.16, 0.47), rot=(0, sx * 0.45, 0))
finish("guest_01", 800, height=0.45, paint="art/textures/guest_01_front.png")
