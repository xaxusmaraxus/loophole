# Loophole: handover

Everything needed to pick the project up in a new session. Read this first, then `docs/concepts.md` for the full design history and `docs/asset-brief.md` for the art tasks.

## The game in one paragraph
A merge puzzle roguelike where the goal is to make theme park guests **puke**. On a 5–7 cell plot you **swipe** tiles 2048-style through a ladder of coaster elements: Airtime Hill, Lift Hill, Helix, Vertical Loop, Corkscrew, Cobra Roll, Top Hat. A fresh merge grabs a matching neighbor and **chains**. The day starts with a small open loop above the station. **Tap a tile next to the loop** to buy it into the ride: the loop bulges out over that tile and its neighbor. Prices scale with the tier and with how long the ride already is. The ride's rating draws **guests**, and each one buys a ticket; that wallet pays for growing. **Lift Hills** store height that the next element pays off ×(1 + lifts). Nobody rides until you **close the park**: then everyone in line rides once, every rider pukes each time the ride's nausea passes their **stomach** (up to 5 times), and every puke pays **excitement × multiplier** (Balatro's chips × mult). The day's score is the wallet plus that payout. **Attractions** sit on a backpack-style **park plot** and push the multiplier. A **season** is three parks (Meadow → Sunny Boardwalk with sand → Haunted Hollow with mud and fog) on a Slay-the-Spire-style **route map**, each ending with a **boss rider** whose composure you must break. Then comes **The Grand Opening** against the Mayor. The **capsule machine** sells eggs (our packs): Golden (attractions), Bus Tour (a rider type joins your line every morning), Snack (tools).

## Where things are
- **Repo:** `xaxusmaraxus/loophole`. The latest work is on **`claude/visual-overhaul`** (branched from `claude/playable-prototype`); `main` only has the first scaffold. Merge into `main` when you're happy (no PR has been opened).
- **Playable build (private):** https://claude.ai/artifact/4rGPoEjpKaMQVwXhZYPNpW. It's published from a single-file bundle (see Commands). Republish to that same URL so the link stays the same.
- **Godot style test:** `godot/`, with renders in `docs/style-test/`.
- **Design notes and history:** `docs/concepts.md`, including a roadmap of ideas the user liked and wants kept.
- **Art tasks:** `docs/asset-brief.md` (round 1, not started).

## Commands
| What | How |
| --- | --- |
| Web prototype | `npm install`, `npm run dev` |
| Tests (80, Vitest) | `npm test` |
| Typecheck and build | `npx tsc --noEmit -p .`, `npm run build` |
| Balance simulation | `npx vite-node tools/season-bot.ts`: 200 seeded seasons, score percentiles per day vs. targets |
| Single-file build for the artifact | `npm run build && python3 tools/bundle-artifact.py out/loophole.html`, then publish to the URL above |
| Godot style test | Open `godot/` in Godot 4.3+ and press Play (arrows swipe, C cameras, T sunset). `godot --path godot -- --shots` renders comparison shots to `godot/shots/`. |
| Debug in the browser | `window.loophole` (the Game) and `window.loopholeRenderer` are exposed in the console |

## Code map (web prototype)
- `src/puzzle/board.ts`: board, slide, chains, sand sinking, building from two ends, ride order, station platform. Pure logic.
- `src/puzzle/pieces.ts`: the piece ladder (thrill, nausea, inversion) and ride stats (chips, mult).
- `src/riders/riders.ts`: rider kinds (stomach, weakness, worth), bosses, VIPs, puke math.
- `src/run/run.ts`: parks, route map, day configs and targets, upgrades, tools, rewards, shop, eggs.
- `src/run/attractions.ts`: attractions (themes, legendaries) and the scoring pipeline.
- `src/run/plot.ts`: the park plot grid (shapes, fitting, reading order, districts). `src/run/bossday.ts`: boss-day rules (demands, spin, rounds).
- `src/game.ts`: the controller: phases, actions, undo, scoring, season flow.
- `src/render/renderer.ts` + `src/render3d/*`: the Three.js park renderer (procedural models, toon and ink shaders, the 3D track and island). `src/ride/ride.ts`: the ride animation on the 3D track. `src/ui/hud.ts`: HUD, map, tally, shop, egg screens. `src/core/sfx.ts`: synth sound.

## Decisions so far (and why)
1. **Swipe and build are separate actions,** so the player has real choices each turn. Early versions laid track on every swipe and felt cramped.
2. **Reward long, wild rides instead of punishing them.** Riders never leave; the standing ride draws a crowd each swipe, and chain links draw extra riders.
3. **Only swipes spend daylight;** sunset stops swiping but never ends the day.
4. **Puke is the goal.** Wishes and tips were replaced by stomachs and weaknesses.
5. **Balatro escalation:** targets grow ×1.35 per day (base 1,000), and attractions have to carry you by park 3.
6. **The station is always a platform below the board;** the smallest ride is a U.
7. **Art direction:** a cozy painted diorama like the user's mockup (warm autumn, island, cliffs, waterfall). We're going for stylized **3D in Godot** with a fixed camera. The 2D canvas renderer is a placeholder.
8. **Engine:** keep the rules in the web prototype while they still change fast, and port to Godot once the style test proves the look.

## Current state and known gaps
- **Balance has never been played by a human.** The bot (a floor, since it never builds for bosses) reaches day 7 at the median, fails about 75% of boss days, and wins about 1% of seasons. The user asked for bosses to be "superhard". Tune after real play: boss stomachs in `riders.ts` (BOSSES), and `BASE_TARGET`/`TARGET_GROWTH` in `run.ts`.
- **Godot style test:** procedural placeholders with drop-in hooks for `godot/assets/models/<name>.glb`. The recommended camera is the gameplay isometric view (`docs/style-test/03_play_iso_day.png`). Swipes there still need mapping to the board's diagonals, which isn't built yet.
- **Built since the first handover (see `docs/concepts.md` v0.7–v0.18):** the claymation look, the on-ride photo with sharing, highscores (device + shared board through the artifact's db), a full-screen HUD, guests with personalities and hover cards, hills and high stations, the painted route map, park structures for what you buy, crossings (bridges and tunnels), Boardwalk piers, Hollow ghosts, special pieces (Launch, Water Splash, Brake Run), unlocks across seasons, guest thoughts, and chiptune music.
- **v0.20, boss fights and the park plot:** boss pools with rule twists, composure over up to three rides, a conquered screen with legendaries and a trophy shelf, and the backpack-style park plot (`src/run/plot.ts`, `src/run/bossday.ts`, `src/ui/plot.ts`). See `docs/concepts.md`.
- **v0.21, park pieces:** tiles carry a park flavor (spinning, water, hanging) through merges into the track (`Board.flav`, `Flavor` in `src/puzzle/pieces.ts`), plus combo prizes.
- **v0.22, the track eats tiles:** the core loop changed. One verb (swipe); tiles that slide into an open end become track; no daylight, the day ends when you open or at gridlock. See `docs/concepts.md`.
- **v0.23, the ride is always running:** the current core loop. The day starts with a small open loop; tap a tile next to it to grow it; every move rolls the train a stop and every lap pays; close the park or jam to end the day. See `docs/concepts.md`.
- **v0.24, incremental economy:** every move earns the ride's rate; growing the loop costs tickets (scaling prices); pukes are jackpots; the wallet is the day's score.
- **v0.25, the hype economy and the new ladder:** the current core loop. The ride's rating draws guests who buy tickets; growing the loop costs tickets; nobody rides until you close the park, then everyone rides once. The new ladder is Airtime Hill, Lift Hill (stores height for the next element), Helix, Vertical Loop, Corkscrew, Cobra Roll and Top Hat. See `docs/concepts.md`.
- **Not built yet:** the energy budget (Mountain park), Space Park, the daily seed, contracts, board modifiers, unlockable riders and attractions, and the rival park (saved for multiplayer). All are in the roadmap in `docs/concepts.md`.
- **Balance after v0.18** (`tools/season-bot.ts`, 200 seasons): median run reaches day 8, 5 wins, boss days fail 402 of 514. Crossings and piers made the season a touch easier than before (median day 7, ~1% wins).
- **Nothing is blocked.**

## Suggested next steps
1. **Asset round 1:** `docs/asset-brief.md`. Start with guests and Big Barry, render, and compare against the mockup.
2. **Play a full season by hand** in the web build and retune bosses and targets; rerun `tools/season-bot.ts` after any balance change.
3. **Godot:** choose the camera, map swipes to the iso diagonals, and try the feel.
4. **Port the rules to Godot** (GDScript): `board`, `pieces`, `riders`, `run`, `attractions`, `game`. Use the Vitest tests as the spec.
5. **From the roadmap:** the on-ride photo (a camera flash mid-puke), guest thoughts, then the Blueprint Egg.

## How the user likes to work
- Fast iterations, with a playable link after each meaningful change.
- The puzzle stays in the foreground; the roguelike layer supports it.
- Reward the player rather than punish: bigger, wilder rides should pay.
- Balatro-style escalation, and original twists (the capsule eggs, puke scoring) rather than straight copies.
- Honest status: say what was tested and what wasn't.
