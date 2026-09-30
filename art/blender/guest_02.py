# guest_02: kid with a red balloon (concept: art/concepts/guest_02.png)
import sys
sys.path.insert(0, REPO + "/tools/blender")
import importlib, kit, chibi
importlib.reload(kit); importlib.reload(chibi)
from kit import box, cyl, sphere, reset, finish

reset()
b = chibi.body(shirt="#ffd23f", pants="#e34a3c", shoes="#4fa7dc", hair="#6b4428", hat=False, width=0.95)
# Tuft on top
sphere(0.06, "#6b4428", (0.03, -0.02, 0.9), scale=(0.7, 0.7, 1.2), seg=6, rings=3)
# Balloon on a string from the right hand, floating up and a little back
hx = b["hand_x"]
cyl(0.006, 0.6, "#f3e6c4", (hx + 0.03, 0.02, 0.58), seg=3, rot=(0, 0.1, 0))
sphere(0.13, "#e8484f", (hx + 0.06, 0.03, 1.0), scale=(1, 1, 1.15), seg=8, rings=6)
cyl(0.025, 0.03, "#e8484f", (hx + 0.06, 0.03, 0.855), seg=5, r2=0.005)
finish("guest_02", 800, scale=0.45 / 0.9 * 0.9, paint="art/textures/guest_02_front.png", paint_zmax=0.8)
