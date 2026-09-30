"""Generate art candidates with GPT image generation through ima2-gen (OAuth).

ima2-gen (https://github.com/lidge-jun/ima2-gen) owns the ChatGPT OAuth login and
proxy; this script only calls its CLI, so no credentials pass through here.
One-time setup (you do this, in your own terminal):

    npm install -g ima2-gen     # then: ima2 login   (ChatGPT account, OAuth)
    ima2 serve                  # keep running while generating

A job is a small JSON file in art/gen/ (kept in git, so every image can be regenerated):

    {"prompt": "...",                      or "prompt_file": "art/gen/x.txt"
     "refs": ["art/renders/market_bg.png", "docs/mood.png"],   up to 5 images total, repo-relative
     "edit": "art/paintovers/x.png",       optional: edit this image instead of generating
     "size": "2048x1152", "quality": "high", "count": 2,
     "model": "gpt-6-astra"}               optional OAuth model id (see `ima2 models --lane oauth`)

    python3 tools/gen_image.py art/gen/market_bg.json [--count N] [--quality q] [--dry-run]

Each run lands in art/gen/out/<job>/<timestamp>/ with the candidates, run.json
(job, exact command, ima2 result) and contact.png (refs + candidates side by side).
Pick a winner and copy it to art/paintovers/ (backgrounds) or art/sprites/ (characters).

Note: the OAuth backend caps images at ~1.57 MP (16:9 comes out 1672x941) and
picks the image model itself; see ima2's docs/IMAGE_RESOLUTION.md. It uses the
ChatGPT plan's Codex usage limits (no per-image charge): each run prints the usage
windows before and after, and refuses to start when a window is at 100%.
Edit jobs pass refs natively when supported. Older ima2 versions use the
multi-image gen route with the edit target first, so references are not lost.
"""

import argparse
import datetime
import json
import os
import shutil
import subprocess
import sys
import urllib.request

from PIL import Image, ImageDraw

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_ROOT = os.path.join(REPO, "art", "gen", "out")
SERVER = os.environ.get("IMA2_SERVER", "http://127.0.0.1:3333")


def quota():
    """ChatGPT/Codex usage windows as reported by ima2 ([] if the server can't tell)."""
    try:
        with urllib.request.urlopen(SERVER + "/api/quota", timeout=20) as r:
            return json.load(r).get("codex", {}).get("windows", [])
    except (OSError, ValueError):
        return []


def quota_line(windows):
    if not windows:
        return "quota: unknown"
    return "quota: " + ", ".join("%s window %s%% used (resets %s)" % (w.get("label"), w.get("percent"),
                                 w.get("resetsAt", "?")) for w in windows)


def repo_path(p):
    return p if os.path.isabs(p) else os.path.join(REPO, p)


def load_job(path):
    job = json.load(open(path))
    if "prompt_file" in job:
        job["prompt"] = open(repo_path(job["prompt_file"])).read().strip()
    if not job.get("prompt"):
        sys.exit("job has no prompt: %s" % path)
    if job.get("edit") and not os.path.exists(repo_path(job["edit"])):
        sys.exit("missing image to edit: %s" % job["edit"])
    refs = job.get("refs", [])
    if len(refs) + bool(job.get("edit")) > 5:
        sys.exit("ima2 accepts at most 5 images total, including the edit target")
    for r in refs:
        if not os.path.exists(repo_path(r)):
            sys.exit("missing reference image: %s" % r)
    return job


def build_commands(job, out_dir, edit_refs_supported=True):
    """One `ima2 gen` for all candidates, or one `ima2 edit` per candidate (edit has no -n)."""
    size, quality = job.get("size", "1536x1024"), job.get("quality", "high")
    if job.get("edit") and job.get("refs") and not edit_refs_supported:
        # Older ima2 versions silently ignore unknown edit flags and their edit
        # route discards refs. The multi-image gen route preserves all inputs.
        compat = dict(job)
        compat.pop("edit")
        compat["refs"] = [job["edit"]] + job["refs"]
        compat["prompt"] = ("IMAGE EDIT: Image 1 is the edit target. Return ONLY a painted edit of image 1, "
                            "with its exact silhouette and composition. Images 2 onward are design/style "
                            "references, not alternative compositions. In the instructions below, "
                            "reference 1 means image 2, reference 2 means image 3.\n\n" + job["prompt"])
        return build_commands(compat, out_dir)
    if not job.get("edit"):
        cmd = ["ima2", "gen", job["prompt"]]
        cmd += ["--model", "oauth/" + job["model"]] if job.get("model") else ["--provider", "oauth"]
        for r in job.get("refs", []):
            cmd += ["--ref", repo_path(r)]
        return [cmd + ["-s", size, "-q", quality, "-n", str(job.get("count", 1)), "-d", out_dir, "--json"]]
    cmds = []
    for i in range(job.get("count", 1)):
        cmd = ["ima2", "edit", repo_path(job["edit"]), "--prompt", job["prompt"], "--provider", "oauth"]
        if job.get("model"):
            cmd += ["--model", job["model"]]
        for r in job.get("refs", []):
            cmd += ["--ref", repo_path(r)]
        cmds.append(cmd + ["-s", size, "-q", quality, "-o", os.path.join(out_dir, "edit-%d.png" % i),
                           "--timeout", "600", "--json"])
    return cmds


def parse_result(stdout):
    try:
        return json.loads(stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return {"ok": False, "stdout": stdout[-2000:]}


def result_images(result, cmd):
    """gen returns {"images": [{path, actualSize}]}; edit returns a single image."""
    if "images" in result:
        return result["images"]
    path = result.get("path") or result.get("out") or cmd[cmd.index("-o") + 1]
    return [{"path": path, "actualSize": result.get("actualSize")}] if os.path.exists(path) else []


def contact_sheet(paths, dest, height=360):
    tiles = []
    for p in (p for p in paths if os.path.exists(p)):
        im = Image.open(p).convert("RGB")
        im = im.resize((max(1, im.width * height // im.height), height))
        d = ImageDraw.Draw(im)
        d.rectangle([0, 0, im.width, 18], fill=(0, 0, 0))
        d.text((4, 3), os.path.basename(p), fill=(255, 255, 255))
        tiles.append(im)
    sheet = Image.new("RGB", (sum(t.width for t in tiles) + 8 * (len(tiles) - 1), height), "white")
    x = 0
    for t in tiles:
        sheet.paste(t, (x, 0))
        x += t.width + 8
    sheet.save(dest)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("job")
    ap.add_argument("--count", type=int)
    ap.add_argument("--quality", choices=["low", "medium", "high"])
    ap.add_argument("--dry-run", action="store_true", help="print the ima2 command and exit")
    ap.add_argument("--force", action="store_true", help="run even if a usage window is at 100%%")
    args = ap.parse_args()

    job = load_job(args.job)
    if args.count:
        job["count"] = args.count
    if args.quality:
        job["quality"] = args.quality
    name = os.path.splitext(os.path.basename(args.job))[0]
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = os.path.join(OUT_ROOT, name, stamp)
    edit_refs_supported = True
    if job.get("edit") and job.get("refs") and shutil.which("ima2"):
        help_text = subprocess.run(["ima2", "edit", "--help"], capture_output=True, text=True, check=True).stdout
        edit_refs_supported = "--ref" in help_text
        if not edit_refs_supported:
            print("ima2 edit lacks --ref support; using multi-image gen with the edit target first")
    cmds = build_commands(job, out_dir, edit_refs_supported=edit_refs_supported)

    if args.dry_run:
        for cmd in cmds:
            print(" ".join(repr(c) if " " in c else c for c in cmd))
        return
    if shutil.which("ima2") is None:
        sys.exit("ima2 not found. Install it with `npm install -g ima2-gen`, run `ima2 login`, "
                 "then keep `ima2 serve` running.")

    windows = quota()
    print(quota_line(windows))
    if any((w.get("percent") or 0) >= 100 for w in windows) and not args.force:
        sys.exit("usage limit reached; wait for the reset (or pass --force to try anyway)")

    os.makedirs(out_dir, exist_ok=True)
    print("generating %d x %s (%s) -> %s" % (job.get("count", 1), job.get("size"), name,
                                              os.path.relpath(out_dir, REPO)))
    procs = [subprocess.Popen(c, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for c in cmds]
    runs, found = [], []
    for cmd, p in zip(cmds, procs):
        stdout, stderr = p.communicate()
        result = parse_result(stdout)
        runs.append({"command": cmd, "exit_code": p.returncode, "stderr": stderr[-2000:], "result": result})
        if p.returncode != 0 or not result.get("ok"):
            print("FAILED (exit %d): %s" % (p.returncode, result.get("code") or result.get("error")
                                             or stderr.strip()[-500:]))
            continue
        found += result_images(result, cmd)
    after_windows = quota()
    json.dump({"job": args.job, "spec": job, "runs": runs,
               "quota_before": windows, "quota_after": after_windows}, open(os.path.join(out_dir, "run.json"), "w"),
              indent=1)
    if not found:
        print("hint: is `ima2 serve` running and `ima2 status` logged in?")
        sys.exit(1)
    images = [img["path"] for img in found]
    for img in found:
        print("  %s  (%s)" % (os.path.relpath(img["path"], REPO), img.get("actualSize")))
    refs = [repo_path(r) for r in ([job["edit"]] if job.get("edit") else []) + job.get("refs", [])]
    contact_sheet(refs + images, os.path.join(out_dir, "contact.png"))
    print("contact sheet: %s" % os.path.relpath(os.path.join(out_dir, "contact.png"), REPO))
    print(quota_line(after_windows))


if __name__ == "__main__":
    main()
