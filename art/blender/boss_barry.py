# boss_barry: Big Barry, first boss. Huge, round, cheerful, bright red shirt, tiny cap.
# (concept: art/concepts/boss_barry.png)
import sys
sys.path.insert(0, REPO + "/tools/blender")
import importlib, kit, chibi
importlib.reload(kit); importlib.reload(chibi)
from kit import box, cyl, sphere, reset, finish

SKIN, RED, JEANS, HAIR = "#f2b48c", "#e34a3c", "#3f5f9e", "#6b4428"
reset()
# Shoes and stubby legs
for sx in (-1, 1):
    box((0.17, 0.26, 0.07), "#3a2a22", (sx * 0.13, -0.03, 0.035))
    cyl(0.095, 0.14, JEANS, (sx * 0.13, 0, 0.13), seg=8)
# Jeans seat and the big round belly in a red shirt
sphere(0.3, JEANS, (0, 0, 0.3), scale=(1.12, 0.98, 0.5), seg=12, rings=6)
sphere(0.32, RED, (0, -0.01, 0.46), scale=(1.1, 1.0, 0.92), seg=14, rings=8)
# Arms: sleeves and mitten hands on the belly sides
for sx in (-1, 1):
    sphere(0.1, RED, (sx * 0.34, -0.02, 0.58), seg=8, rings=6)
    sphere(0.08, SKIN, (sx * 0.39, -0.05, 0.44), scale=(1, 1, 1.25), seg=8, rings=5)
# Head, hair, ears
sphere(0.19, SKIN, (0, -0.02, 0.84), scale=(1.12, 1.0, 0.95), seg=12, rings=7)
sphere(0.19, HAIR, (0, 0.06, 0.85), scale=(1.18, 0.85, 0.85), seg=8, rings=5)
for sx in (-1, 1):
    sphere(0.045, SKIN, (sx * 0.21, -0.01, 0.83), scale=(0.6, 1, 1.1), seg=6, rings=4)
# Face: squinty happy eyes, big grin with teeth, blush, bushy moustache
for sx in (-1, 1):
    sphere(0.03, chibi.EYE, (sx * 0.075, -0.19, 0.87), scale=(1.1, 0.4, 0.55), seg=6, rings=4)
    sphere(0.04, chibi.BLUSH, (sx * 0.14, -0.165, 0.8), scale=(1, 0.3, 0.6), seg=6, rings=3)
sphere(0.075, "#7a2a22", (0, -0.17, 0.765), scale=(1.3, 0.45, 0.55), seg=10, rings=5)
box((0.1, 0.02, 0.022), "#ffffff", (0, -0.197, 0.785))
sphere(0.06, HAIR, (0, -0.2, 0.815), scale=(1.8, 0.5, 0.45), seg=8, rings=4)
sphere(0.03, SKIN, (0, -0.215, 0.835), seg=6, rings=4)
# The tiny cap perched on top, brim forward
cyl(0.085, 0.07, RED, (0, -0.01, 1.045), seg=10, r2=0.07)
sphere(0.075, RED, (0, -0.01, 1.075), scale=(1, 1, 0.5), seg=10, rings=4)
box((0.12, 0.09, 0.016), RED, (0, -0.1, 1.018), rot=(-0.15, 0, 0), bevel=0.02)
sphere(0.015, "#ffd23f", (0, -0.01, 1.115), seg=6, rings=3)
finish("boss_barry", 1500, height=0.9)
