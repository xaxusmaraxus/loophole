"""The stubby big-headed guest body, authored 1 unit tall (finish() scales it).

Head about a third of the height, front facing -Y. Returns the key heights so
outfits can hang accessories on the right spots.
"""
from kit import box, cyl, sphere

SKIN = "#f2b48c"
EYE = "#2b1d14"
BLUSH = "#f08a7a"


def body(shirt, pants, shoes, hair, skin=SKIN, sleeves=True, width=1.0, hair_cap=True, hat=True, hips=True):
    """hat=True: only the hair that shows under a hat; False: a full cap of hair on top."""
    w = width
    # Feet and legs
    for sx in (-1, 1):
        box((0.13 * w, 0.2, 0.05), shoes, (sx * 0.09 * w, -0.02, 0.025))
        cyl(0.06, 0.12, skin, (sx * 0.09 * w, 0, 0.1), seg=6)
    # Hips and torso
    if hips:
        box((0.34 * w, 0.24, 0.13), pants, (0, 0, 0.2), bevel=0.04)
    box((0.38 * w, 0.27, 0.24), shirt, (0, 0, 0.36), bevel=0.07)
    # Arms: sleeve + stubby hand
    for sx in (-1, 1):
        if sleeves:
            sphere(0.08, shirt, (sx * 0.22 * w, 0, 0.43), seg=6, rings=4)
        sphere(0.06, skin, (sx * 0.25 * w, 0, 0.33), scale=(1, 1, 1.6), seg=6, rings=4)
    # Head
    sphere(0.2, skin, (0, 0, 0.66), scale=(1.06, 0.95, 0.95), seg=12, rings=7)
    if hair_cap:
        sphere(0.205, hair, (0, 0.05, 0.69), scale=(1.1, 0.9, 0.93), seg=8, rings=5)
        if hat:
            sphere(0.12, hair, (0, -0.1, 0.79), scale=(1.5, 0.8, 0.5), seg=8, rings=4)
        else:
            sphere(0.205, hair, (0, 0.0, 0.785), scale=(1.07, 0.98, 0.55), seg=10, rings=5)
    # Face: eyes and blush (front is -Y)
    for sx in (-1, 1):
        sphere(0.028, EYE, (sx * 0.075, -0.18, 0.66), scale=(0.8, 0.4, 1.25), seg=5, rings=3)
        sphere(0.03, BLUSH, (sx * 0.115, -0.175, 0.61), scale=(1, 0.3, 0.6), seg=5, rings=3)
    return {"chest": 0.4, "head": 0.66, "head_top": 0.85, "face_y": -0.19, "hand_z": 0.3, "hand_x": 0.25 * w}
