# Loophole

A merge puzzle where the tiles are rollercoaster pieces. Swipe to merge them 2048-style, tap to build them into track from both sides of the station, and connect the ends before dusk. Then watch the queue ride what you built.

## Run
```
npm install
npm run dev      # http://localhost:5173
npm test
npm run build
```

Controls: drag on the park (or arrows / WASD) to swipe; tap a highlighted cell to build. Shift + arrows builds from the waving pennant, Tab switches pennant, Enter opens the ride, Z undoes.
The game and renderer are on `window.loophole` and `window.loopholeRenderer` in the browser console for playtesting.

## Layout
```
docs/              concept and design notes
src/core/          seeded RNG (runs are reproducible from their seed)
src/puzzle/        board rules and the merge ladder (pure logic, tested)
src/riders/        rider types, their wants, procedural looks
src/run/           roguelike layer: days, perks, park generation
src/render/        the park renderer (Three.js) and palette
src/render3d/      procedural 3D: geometry, toon + ink shaders, track, models, island, effects
src/ride/          end-of-day ride animation
src/ui/            HUD, queue cards, overlays
tests/             unit tests (Vitest)
```

## Stack
TypeScript, Vite, Three.js. No art assets: every model, the track and the island are built in code, then cel-shaded and inked by a post pass.

Add `?noink` to the URL to switch the ink lines off, `?inkdebug` to see its depth (red) and normal (green) edges, and `?fixeddt=100` to step the game 100 ms per frame (for screenshots on slow machines).
