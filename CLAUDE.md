# Loophole

A merge-puzzle roguelike about building rollercoasters that make guests puke.
Swipe to merge coaster pieces 2048-style, build track from a station platform,
open the ride, and score every puke (excitement × multiplier, Balatro-style).

## Repo layout
- `src/`, `tests/`, `index.html`: the playable **web prototype** (TypeScript + Vite, Canvas 2D). This is where the game rules live and get tested. `npm install`, `npm run dev`, `npm test`.
- `godot/`: the **Godot 4.3 style test**, a procedural 3D diorama for the art direction. See `godot/README.md`.
- `docs/concepts.md`: design notes and the roadmap. `docs/style-test/`: the latest Godot renders.
- `docs/asset-brief.md`: **the current art task list.** Start here for asset work.

## Two sessions share this repo
A cloud Claude Code session works on game rules and reviews renders. It can't reach this computer's tools (Blender, Godot and ComfyUI MCPs, the local image server, Codex). A session on this computer does the asset work described in `docs/asset-brief.md`.

When you (the local session) do asset work:
- Work on the branch `local/assets`, branched from `claude/playable-prototype`. Don't push to `claude/playable-prototype` directly; the cloud session merges from `local/assets`.
- Export models to `godot/assets/models/<name>.glb` using the exact names in the brief. `godot/main.gd` picks them up automatically and falls back to the procedural placeholder when a file is missing, so you don't need to edit the scene for drop-ins.
- After each batch, render with `godot --path godot -- --shots`, copy `godot/shots/*.png` to `docs/style-test/round-<n>/`, update the "Status" section at the bottom of `docs/asset-brief.md` (what's done, what's blocked, questions), commit, and push.
- Don't change the game rules in `src/` or the procedural fallbacks in `main.gd` unless the brief asks for it.

## Conventions
- Game units: 1 grid cell = 1 m. Guests are about 0.45 m tall; bosses about twice that.
- Commit messages: imperative, with a short bullet list of what changed.
