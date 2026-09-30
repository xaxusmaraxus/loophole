# /// script
# requires-python = ">=3.10"
# dependencies = ["opencv-python-headless", "numpy"]
# ///
"""Wind mask for a painted plate: tree canopies (autumn foliage and pines) by color.

    uv run tools/sway_mask.py godot/assets/plates/phone_day.png --out godot/assets/plates/phone_day_sway.png

White = sways fully, black = still. Small colorful bits (flowers) are removed, the
edges are feathered so the motion fades out instead of tearing the painting.
"""
import argparse

import cv2
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("plate")
ap.add_argument("--out", required=True)
a = ap.parse_args()
img = cv2.imread(a.plate)
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
h, s, v = [c.astype(int) for c in cv2.split(hsv)]
autumn = (h < 28) & (s > 150) & (v > 120)            # orange, red, yellow leaves
pine = (h > 45) & (h < 95) & (s > 90) & (v < 125)    # dark evergreen needles
m = ((autumn | pine) * 255).astype(np.uint8)
m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((21, 21), np.uint8))   # drop flowers and specks
n, labels, stats, _ = cv2.connectedComponentsWithStats(m)
keep = np.zeros_like(m)
for i in range(1, n):
    if stats[i, cv2.CC_STAT_AREA] > 2500:
        keep[labels == i] = 255
# Not foliage: the carousel roof (left edge, upper middle) reads as autumn red.
H, W = keep.shape
keep[int(H * 0.18):int(H * 0.5), :int(W * 0.2)] = 0
keep = cv2.erode(keep, np.ones((7, 7), np.uint8))
keep = cv2.GaussianBlur(keep, (0, 0), 9)
cv2.imwrite(a.out, keep)
print("sway coverage %.1f%%" % (100 * (keep > 128).mean()))
