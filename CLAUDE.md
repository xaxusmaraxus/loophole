# Loophole

A merge-puzzle roguelike about building rollercoasters that make guests puke.
Swipe to merge coaster pieces 2048-style, build track from a station platform,
open the ride, and score every puke (excitement × multiplier, Balatro-style).

**Start with `docs/HANDOVER.md`:** current state, commands, decisions, next steps.

## Repo layout
- `src/`, `tests/`, `index.html`: the playable **web prototype** (TypeScript + Vite, Canvas 2D). The game rules live and get tested here.
- `godot/`: the **Godot 4.3 style test**, a procedural 3D diorama for the art direction. Models dropped into `godot/assets/models/<name>.glb` replace placeholders automatically (see `godot/README.md`).
- `tools/`: `season-bot.ts` (balance simulation) and `bundle-artifact.py` (single-file build for the playable link).
- `docs/concepts.md`: design notes and roadmap. `docs/asset-brief.md`: art tasks. `docs/style-test/`: Godot renders.

## Commands
- `npm install`, `npm run dev`, `npm test`, `npx tsc --noEmit -p .`, `npm run build`
- `npx vite-node tools/season-bot.ts`: rerun after any balance change
- `godot --path godot -- --shots`: renders comparison shots to `godot/shots/`

## Conventions
- Work on `claude/playable-prototype` (or a branch from it); merge to `main` when the user is happy.
- Keep game rules pure and tested (`src/puzzle`, `src/riders`, `src/run`, `src/game.ts`). The renderer and HUD only read state and events.
- After meaningful changes: run the tests, rebuild, republish the playable link, and update `docs/concepts.md` with what changed and why.
- Game units in Godot: 1 grid cell = 1 m. Guests are about 0.45 m tall; bosses about twice that.
- Commit messages: imperative, with a short bullet list of what changed.
