# /// script
# requires-python = ">=3.10"
# dependencies = ["requests", "pillow"]
# ///
"""Paint with Krea 2 Turbo in a local ComfyUI (~/comfyui, running on 127.0.0.1:8188).

    uv run tools/krea_bg.py art/comfy/<job>.json [--seed N] [--count N]

A job JSON (paths repo-relative):
    {"prompt": "...",
     "size": [1536, 864],
     "krea": {"style_ref": "x.png",           paint like this image (Krea's style-reference LoRA)
              "depth": "d.png",               lock the composition to a depth map (community
                                              depth-control LoRA; can't be combined with style_ref)
              "init": "i.png", "denoise": 0.4,   image-to-image
              "steps": 8},
     "out": "art/comfy/out/<name>"}

Each run writes <out>/krea_<seed>.png and the exact graph as JSON next to it.
Models (in ~/comfyui/ComfyUI/models): unet/krea2_turbo-Q8_0.gguf (ComfyUI-GGUF),
text_encoders/qwen3vl_4b_bf16.safetensors, vae/krea2_qwen_image_vae.safetensors,
loras/krea2_style_reference.safetensors, loras/krea2_depth_control_lora.safetensors
(custom node comfyui-krea2-controlnet).
"""

import argparse
import json
import os
import random
import sys
import time
import uuid

import requests

SERVER = os.environ.get("COMFY_SERVER", "http://127.0.0.1:8188")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def upload(path):
    with open(os.path.join(REPO, path), "rb") as f:
        r = requests.post(SERVER + "/upload/image", files={"image": (os.path.basename(path), f)},
                          data={"overwrite": "true"})
    r.raise_for_status()
    return r.json()["name"]


class Graph:
    def __init__(self):
        self.nodes = {}

    def add(self, cls, **inputs):
        nid = str(len(self.nodes) + 1)
        self.nodes[nid] = {"class_type": cls, "inputs": inputs}
        return nid

    @staticmethod
    def out(nid, i=0):
        return [nid, i]


def krea_graph(job, seed):
    """Krea 2 Turbo (GGUF): an aesthetic model. Optional "style_ref" (Krea's style-reference
    LoRA: paint like this image), "depth" (community depth-control LoRA: lock the layout) and
    "init" + "denoise" (image-to-image; a low denoise keeps every position, restyles the look)."""
    g, o = Graph(), Graph.out
    k = dict({"model": "krea2_turbo-Q8_0.gguf"}, **job.get("krea", {}))
    w, h = job.get("size", [1536, 864])
    model = o(g.add("UnetLoaderGGUF", unet_name=k["model"]))
    clip = g.add("CLIPLoader", clip_name=k.get("text_encoder", "qwen3vl_4b_bf16.safetensors"), type="krea2", device="default")
    vae = g.add("VAELoader", vae_name=k.get("vae", "krea2_qwen_image_vae.safetensors"))
    if k.get("style_ref"):
        model = o(g.add("LoraLoaderModelOnly", model=model, lora_name="krea2_style_reference.safetensors",
                        strength_model=k.get("style_strength", 1.0)))
    if k.get("init"):
        init = g.add("LoadImage", image=upload(k["init"]))
        sc = g.add("ImageScale", image=o(init), upscale_method="lanczos", width=w, height=h, crop="disabled")
        latent = o(g.add("VAEEncode", pixels=o(sc), vae=o(vae)))
        denoise = k.get("denoise", 0.4)
    else:
        latent = o(g.add("EmptyLatentImage", width=w, height=h, batch_size=1))
        denoise = 1.0
    if k.get("depth"):
        # (can't be combined with style_ref: the control node expects no reference tokens)
        model = o(g.add("Krea2ControlLoRALoader", model=model, lora_name="krea2_depth_control_lora.safetensors",
                        strength=k.get("depth_strength", 1.0)))
        dimg = g.add("LoadImage", image=upload(k["depth"]))
        enc = g.add("Krea2ControlImageEncode", control_image=o(dimg), vae=o(vae), resize="match_latent_size",
                    upscale_method="lanczos", crop="disabled", channel_mode="grayscale",
                    normalize="per_image_minmax", invert=False, batch_mode="independent_images", latent=latent)
        model = o(g.add("Krea2ControlApply", model=model, control_latent=o(enc)))
    model = o(g.add("ModelSamplingFlux", model=model, max_shift=1.15, base_shift=0.5, width=w, height=h))
    if k.get("style_ref"):
        ref = g.add("LoadImage", image=upload(k["style_ref"]))
        c = g.add("TextEncodeQwenImageEditPlus", clip=o(clip), prompt=job["prompt"], vae=o(vae), image1=o(ref))
        pos = o(g.add("FluxKontextMultiReferenceLatentMethod", conditioning=o(c),
                      reference_latents_method="index_timestep_zero"))
    else:
        pos = o(g.add("CLIPTextEncode", clip=o(clip), text=job["prompt"]))
    neg = o(g.add("ConditioningZeroOut", conditioning=pos))
    guider = g.add("CFGGuider", model=model, positive=pos, negative=neg, cfg=1.0)
    sched = g.add("BasicScheduler", model=model, scheduler="simple", steps=k.get("steps", 8), denoise=denoise)
    sampler = g.add("KSamplerSelect", sampler_name="euler")
    noise = g.add("RandomNoise", noise_seed=seed)
    run_ = g.add("SamplerCustomAdvanced", noise=o(noise), guider=o(guider), sampler=o(sampler),
                 sigmas=o(sched), latent_image=latent)
    dec = g.add("VAEDecode", samples=o(run_), vae=o(vae))
    g.add("SaveImage", images=o(dec), filename_prefix="loophole_krea")
    return g


def run(graph, out_png):
    cid = str(uuid.uuid4())
    r = requests.post(SERVER + "/prompt", json={"prompt": graph.nodes, "client_id": cid})
    if r.status_code != 200:
        print(r.text[:3000])
        r.raise_for_status()
    pid = r.json()["prompt_id"]
    t0 = time.time()
    while True:
        time.sleep(2)
        h = requests.get(SERVER + "/history/" + pid).json()
        if pid in h:
            entry = h[pid]
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                print(json.dumps(status.get("messages", [])[-2:], indent=1)[:3000])
                sys.exit(1)
            for node in entry["outputs"].values():
                for im in node.get("images", []):
                    data = requests.get(SERVER + "/view", params={"filename": im["filename"],
                                        "subfolder": im["subfolder"], "type": im["type"]}).content
                    open(out_png, "wb").write(data)
                    print("%s  (%.0f s)" % (out_png, time.time() - t0))
                    return
            sys.exit("no image in output")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("job")
    ap.add_argument("--seed", type=int)
    ap.add_argument("--count", type=int, default=1)
    args = ap.parse_args()
    job = json.load(open(args.job))
    out = os.path.join(REPO, job["out"])
    os.makedirs(out, exist_ok=True)
    for i in range(args.count):
        seed = args.seed + i if args.seed is not None else random.randint(0, 2**31)
        g = krea_graph(job, seed)
        base = os.path.join(out, "krea_%d" % seed)
        json.dump(g.nodes, open(base + ".graph.json", "w"), indent=1)
        run(g, base + ".png")


if __name__ == "__main__":
    main()
