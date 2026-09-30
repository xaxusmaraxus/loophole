# Coaster Merge (working title)

A merge puzzle game where the tiles are rollercoaster pieces. Solve the board, then ride what you built.

## Stack (proposed)
- TypeScript + Vite
- Three.js for the ride sequence
- Vitest for tests

## Layout
```
docs/            concepts, design docs
src/puzzle/      board, tiles, merge rules (game logic, no rendering)
src/track/       tiles -> 3D track spline
src/ride/        end-of-level ride: physics, cameras, rider reactions
src/levels/      level definitions and goals
src/ui/          HUD, input, menus
public/assets/   audio, models, textures
tests/           unit tests
```

## Run
```
npm install
npm run dev
npm test
```

See [docs/concepts.md](docs/concepts.md) for game directions.
