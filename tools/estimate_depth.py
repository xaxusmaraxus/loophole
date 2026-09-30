# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = ["torch", "transformers>=4.45", "pillow", "numpy"]
# ///
"""Estimate a depth map for a painted background with Depth Anything V2 (local, MPS/CPU).

    uv run tools/estimate_depth.py game/art/backgrounds/market_bg.png \
        --out game/art/backgrounds/market_depth.png

Writes a 16-bit greyscale PNG of relative "closeness" (0 = far, 65535 = near) at the
painting's size. The model downloads once (~1.3 GB) into the Hugging Face cache.
"""

import argparse

import numpy as np
import torch
from PIL import Image
from transformers import pipeline


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default="depth-anything/Depth-Anything-V2-Large-hf")
    args = ap.parse_args()
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    pipe = pipeline("depth-estimation", model=args.model, device=device)
    img = Image.open(args.image).convert("RGB")
    res = pipe(img)
    d = res["predicted_depth"]
    d = d.squeeze().float().cpu().numpy() if hasattr(d, "cpu") else np.asarray(d, dtype=np.float32)
    d = np.asarray(Image.fromarray(d).resize(img.size, Image.BICUBIC), dtype=np.float32)
    lo, hi = np.percentile(d, 0.5), np.percentile(d, 99.5)
    n = np.clip((d - lo) / max(hi - lo, 1e-6), 0, 1)   # model output is relative inverse depth
    Image.fromarray((n * 65535).astype(np.uint16)).save(args.out)
    print("depth %s -> %s (%s, range %.3f..%.3f)" % (args.image, args.out, device, lo, hi))


if __name__ == "__main__":
    main()
