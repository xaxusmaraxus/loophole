# Loophole

A merge puzzle where the tiles are rollercoaster pieces. Every swipe merges tiles 2048-style *and* lays one piece of track. Close the circuit back to the station, then watch the queue ride what you built.

## Run
```
npm install
npm run dev      # http://localhost:5173
npm test
npm run build
```

Controls: swipe on the park, arrow keys / WASD, or the on-screen pad. Z undoes.
The current game is on `window.loophole` in the browser console for playtesting.

## Layout
```
docs/              concept and design notes
src/core/          seeded RNG (runs are reproducible from their seed)
src/puzzle/        board rules and the merge ladder (pure logic, tested)
src/riders/        rider types, their wants, procedural looks
src/run/           roguelike layer: days, perks, park generation
src/render/        procedural pixel art: palette, sprites, font, renderer
src/ride/          end-of-day ride animation
src/ui/            HUD, queue cards, overlays
tests/             unit tests (Vitest)
```

## Stack
TypeScript, Vite, Canvas 2D. No art assets: every sprite is drawn in code.
