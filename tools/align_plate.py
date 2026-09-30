# /// script
# requires-python = ">=3.10"
# dependencies = ["opencv-python-headless", "numpy", "pillow"]
# ///
"""Warp a painted plate onto the render it was painted from, using the plot's lawn.

    uv run tools/align_plate.py <render.png> <painting.png> --out <plate.png> [--scale 2]

Finds the four corners of the biggest lawn-green quad (the puzzle plot) in both
images and maps the painting's corners onto the render's with a homography, so
the plot cells land exactly where the 3D tiles are. Writes the plate at the
render's size times --scale, plus <out>_check.png (render edges over the plate).
"""
import argparse

import cv2
import numpy as np


def plot_corners(img_bgr, debug=None):
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)
    mask = ((h > 28) & (h < 75) & (s > 70) & (v > 90)).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((15, 15), np.uint8))
    n, labels, stats, cent = cv2.connectedComponentsWithStats(mask)
    H, W = mask.shape
    # The plot: the biggest green blob whose center is in the middle of the frame.
    best, best_area = None, 0
    for i in range(1, n):
        cx, cy = cent[i]
        if abs(cx - W / 2) < W * 0.3 and abs(cy - H / 2) < H * 0.25 and stats[i, cv2.CC_STAT_AREA] > best_area:
            best, best_area = i, stats[i, cv2.CC_STAT_AREA]
    blob = (labels == best).astype(np.uint8) * 255
    cnts, _ = cv2.findContours(blob, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    hull = cv2.convexHull(max(cnts, key=cv2.contourArea))
    for eps in np.linspace(0.01, 0.1, 40):
        quad = cv2.approxPolyDP(hull, eps * cv2.arcLength(hull, True), True)
        if len(quad) == 4:
            break
    pts = quad.reshape(4, 2).astype(np.float32)
    # Order: top, right, bottom, left by angle around the center.
    c = pts.mean(0)
    pts = pts[np.argsort(np.arctan2(pts[:, 1] - c[1], pts[:, 0] - c[0]))]
    if debug is not None:
        cv2.imwrite(debug, blob)
    return pts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("render")
    ap.add_argument("painting")
    ap.add_argument("--out", required=True)
    ap.add_argument("--scale", type=float, default=2.0)
    a = ap.parse_args()
    r = cv2.imread(a.render)
    p = cv2.imread(a.painting)
    rc, pc = plot_corners(r), plot_corners(p)
    print("render plot corners  ", rc.round(1).tolist())
    print("painting plot corners", pc.round(1).tolist())
    Hm = cv2.getPerspectiveTransform(pc, rc * a.scale)
    size = (int(r.shape[1] * a.scale), int(r.shape[0] * a.scale))
    out = cv2.warpPerspective(p, Hm, size, flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT_101)
    cv2.imwrite(a.out, out)
    # Check image: the render's edges in magenta over the plate.
    edges = cv2.Canny(cv2.resize(r, size), 60, 140)
    chk = out.copy()
    chk[edges > 0] = (255, 0, 255)
    cv2.imwrite(a.out.replace(".png", "_check.png"), chk)
    # How much of the frame the warped painting leaves uncovered (filled by edge pixels).
    corners = cv2.perspectiveTransform(np.float32([[[0, 0], [p.shape[1], 0], [p.shape[1], p.shape[0]], [0, p.shape[0]]]]), Hm)
    print("painting frame in plate:", corners.reshape(4, 2).round(0).tolist(), "plate size", size)


if __name__ == "__main__":
    main()
