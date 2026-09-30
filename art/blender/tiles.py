# tile_1 .. tile_7: painted crates in the tier colors, each with a sculpted cream icon
# of its coaster piece on the lid (Mega Loop: a big ring with a star; cream, since
# the tier-7 crate itself is gold).
import sys
sys.path.insert(0, REPO + "/tools/blender")
import importlib, math, kit
importlib.reload(kit)
from kit import box, cyl, sphere, reset, finish, mat_tex, textured, tube, star

ICON, GOLD = "#fff3dc", "#ffd23f"
TOP = 0.2           # crate height; icons sit on the lid
results = []


def rails(path, color=ICON, r=0.022):
    """Two parallel rails along a path in the XZ plane, plus a few ties."""
    for y in (-0.07, 0.07):
        tube([(x, y, z) for x, z in path], r, color, sides=6)
    for x, z in path[1:-1:2]:
        box((0.03, 0.2, 0.018), "#8a6446", (x, 0, z - 0.02))


def arc(height, n=9, span=0.3):
    return [(-span + 2 * span * i / (n - 1), TOP + 0.03 + height * math.sin(math.pi * i / (n - 1))) for i in range(n)]


for tier in range(1, 8):
    reset()
    textured(box((0.84, 0.84, TOP), "#ffffff", (0, 0, TOP / 2), bevel=0.03), mat_tex("crate_%d" % tier, "art/textures/crate_tier_%d.png" % tier), 0.84)
    if tier == 1:      # Bump: a low hump of track
        rails(arc(0.07))
    elif tier == 2:    # Hill: a tall hump
        rails(arc(0.2))
    elif tier == 3:    # Drop: a steep plunge
        rails([(-0.3, TOP + 0.24), (-0.18, TOP + 0.23), (-0.08, TOP + 0.17), (0.02, TOP + 0.08), (0.14, TOP + 0.035), (0.3, TOP + 0.03)])
    elif tier == 4:    # Helix: a coil spring
        tube([(0.14 * math.cos(2 * math.pi * i / 10), 0.14 * math.sin(2 * math.pi * i / 10), TOP + 0.04 + 0.18 * i / 20) for i in range(21)], 0.028, ICON)
    elif tier == 5:    # Loop: an upright ring on a short base
        tube([(0.1 * math.sin(2 * math.pi * i / 14), 0, TOP + 0.13 - 0.1 * math.cos(2 * math.pi * i / 14)) for i in range(14)], 0.032, ICON, closed=True)
        box((0.36, 0.1, 0.03), ICON, (0, 0, TOP + 0.02))
    elif tier == 6:    # Corkscrew: a twist along the crate
        tube([(-0.32 + 0.64 * i / 16, 0.1 * math.cos(2 * math.pi * i / 16), TOP + 0.13 + 0.1 * math.sin(2 * math.pi * i / 16)) for i in range(17)], 0.03, ICON)
        for x in (-0.32, 0.32):
            cyl(0.02, 0.13, "#8a6446", (x, 0.1, TOP + 0.065), seg=5)
    elif tier == 7:    # Mega Loop: a big gold ring crowned with a star
        tube([(0.12 * math.sin(2 * math.pi * i / 16), 0, TOP + 0.14 - 0.12 * math.cos(2 * math.pi * i / 16)) for i in range(16)], 0.042, ICON, closed=True)
        star(0.07, 0.032, 0.05, "#ff9b45", (0, 0, TOP + 0.14))
        box((0.42, 0.12, 0.03), ICON, (0, 0, TOP + 0.02))
    results.append(finish("tile_%d" % tier, 800))
print(results)
