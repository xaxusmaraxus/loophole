# Loophole: Concept

Direction B from the first brainstorm ("the grid is the park").

## One-line pitch
Slide and merge coaster pieces 2048-style, but every swipe also lays one piece of real track. Close the circuit back to the station whenever you dare. Then watch the queue of riders board and live with what you built.

## Core loop: the swipe does two things
The board is a 5x5 park. The **station** sits on the edge. The track grows out of the station from its open end, the **head**.

Every swipe:
1. **Slides and merges** the loose tiles (plain 2048 rules). Plank + Plank → Straight → Curve → Hill → Drop → Loop → ...
2. **Extends the head one cell in the swipe direction.** Whatever tile sits in that cell gets bolted into the track as that piece.
3. Spawns a new Plank in an empty cell.

Bolted track is a **wall**. Loose tiles slide up against it and can't pass through it.

That's the whole trick. One input, two consequences, and they pull against each other:
- Swiping left might merge your two Drops into a Loop, while laying a boring Plank into the track.
- Swiping up lays the Loop you wanted into the track, but scatters everything else.

## Where the hard decisions come from
**Cash out anytime.** When the head is next to the station, you can close the circuit. It's push-your-luck, like blackjack. A short ride now is safe. A long ride is worth more, if you make it back.

**You can paint yourself into a corner.** If the head can't reach the station anymore, the ride doesn't open (fail, or a heavily penalized "shuttle" ride).

**Good tiles get stranded.** Track is a wall, so the board carves itself into pockets. A Loop sitting in a pocket the head can no longer reach is gone for good. "Take the Loop now, or keep building?" is a real question, because you may not get another chance.

**The board gets cramped.** More track means less room to slide, which makes merges harder the longer you go. Big pieces come early or not at all.

## The queue (the payoff)
Riders wait at the station, and you can see them the whole time you build. Each one has a want:
- "LOOP. NOW." (teen)
- "Nothing upside down, please." (grandma)
- "Longest ride you've got." (enthusiast)
- "I just ate." (guy holding a corn dog)

**Patience:** every swipe, riders get more impatient. Wait too long and some leave the queue. Longer builds make better rides, but fewer people are left to ride them.

**Conflicting wants:** the queue is mixed, so you can't please everyone. That forces a choice about who you are building for.

## The ride
We watch from the park: a zoomed-out isometric or side view, not first person.
- Riders walk from the queue into the cars.
- The coaster runs the exact circuit you built.
- Faces react live: screaming, cheering, turning green, a hat flying off on the Loop.
- They get off and give a verdict: thumbs up, dizzy stagger, or throwing up in the bushes.
- Score = happy riders (stars), not raw tile values.

**Failure is still a show.** If the design is bad, it plays out anyway and is funny. Comedy beats a game-over screen.

## Step 2 (later): energy budget
Layer in physics: the lift hill gives the train energy, and each element spends it. Loops cost a lot, Drops pay some back. Too many big elements in a row and the train stalls and rolls backwards, in front of everyone. That makes piece order matter, not just which pieces you lay. This fits in cleanly once the core loop is fun.

## Tuning knobs to prototype
- Board size (5x5 vs 6x6)
- Does the head move on every swipe, or only when you choose (a "lay" tap)? Every swipe is harsher and more interesting, so try that first.
- What happens when the swipe direction points into existing track: the swipe is blocked, or tiles slide but no track is laid
- Patience drain per swipe
- Spawn weights (occasional Straight or a rare Curve)

## Core loop (v0.3)
v0.1 tied track-laying to every swipe, which left 3 choices at most and punished long rides through rider patience. v0.3 splits the actions and flips the incentives.

**Two actions; only swiping spends daylight:**
- **Swipe:** pure 2048. Slide, merge, chain. A swipe that moves nothing is refused and costs nothing.
- **Build (free):** tap a highlighted cell next to a track end. The tile there becomes that piece (empty cell = Flat).

**Two track ends.** The track grows out of both sides of the station (red and blue pennants). When the pennants are next to each other, the full circuit can open. Before that, you can cash out any time as a **shuttle** (out and back) at half excitement.

**Daylight is the only clock, and it only limits swipes.** After sunset you can't swipe, but you can keep building and open the ride whenever you're ready.

**Rewards, not punishments:**
- **Excitement** = (thrill + length) × (1 + 10% per distinct piece type past the first). Every rider pays it as a ticket.
- A rider whose wish is met pays double. A rider who gets sick asks for half back.
- The crowd grows over the day. A walk-in arrives every 5 swipes, and each swipe the ride that's already standing draws excitement/80 riders ("word gets around"). So building early pays off even though building is free. Chain links draw one rider each. Nobody leaves.
- Each day has a ticket target. Miss it and the park loses a heart.

**Risk/reward now lives in:** spending daylight on merges vs. building, closing the loop vs. banking a shuttle, and routing the two ends so they can still meet (plus trapping good tiles behind track).

Targets were set from a simple bot (median about 330 tickets on day 1, about 430 later, closing the full circuit only a third of the time). Daylight is 40 swipes (5x5 days) and 48 (6x6). Day targets: 230, 300, 400, 500, 600, 700, 800, then +120 a day.

## Cascades (v0.2)
The v0.1 board drained: the track eats a tile each swipe and only one spawned, so merges rarely snowballed. Now:
- **Chain reactions:** after the slide, every freshly merged tile grabs one matching orthogonal neighbor and merges again. The result can grab again in the next wave, and so on. Waves resolve one at a time, on screen.
- **Two spawns per swipe** keep the board under pressure. In random play about 1 in 3 swipes chains, and 1 in 4 merges 3+ tiles.
- **Payoff inside the puzzle:** each chain link draws one more rider to the queue (v0.2 gave patience instead; patience was removed in v0.3).
- **Juice escalates with each link:** rising pentatonic pitch, bigger bursts, screen shake, a pop-up COMBO / MEGA counter.

## Art direction
*(v0.10: the pixel canvas became a 3D diorama; see "The 3D park" below. The principles still hold, except the outlines: ink lines are now part of the look.)*

A modern take on the cozy RCT2 theme-park look, without copying it:
- Square grid in a 3/4 top-down view instead of isometric, so swipe directions stay readable.
- The park is a small diorama slab with a visible earth edge.
- Tiles are crates with a front face; track is raised on timber (low) or steel (tall) supports and casts shadows.
- Hue-shifted color ramps with no black outlines. Each piece tier has its own rail color, like coaster paint schemes.
- Tiny guests with thought bubbles that show how they'd feel if you opened the ride now.
- Everything is procedural: tree shapes, pavers, grass, guest looks.

## Roguelike layer (light, puzzle stays in front)
- A run is a series of **days**. Each day is a fresh, seeded park: the station on a random edge, obstacles (trees, rocks, ponds, snack stands), and starting tiles.
- Each day has a **ticket target**. Missing it costs one of 3 hearts.
- After each day, **pick 1 of 3 perks** (Late Closing, Tip Jar, Barf Bags, Hype Guy, Scenic Route...). They bend the puzzle without replacing it.
- The board grows from 5x5 to 6x6 on day 3, with more obstacles and pickier riders (Kid and Just Ate unlock on day 2).

## Rewards (v0.5)
After each day you pick 1 of 3 rewards. There's always at least one of each kind:
- **Upgrades (permanent, stackable):** Late Closing (+5 swipes), Better Lumber, Hype Guy, Barf Bags, Billboard, Landscaper, Scenic Route, Tip Jar, Toolbox (+1 undo).
- **Tools (charges you spend when you like):** Coffee (+5 swipes, works after sunset), Paint Can (a tile +1 tier, can start a chain), Crane (move a tile anywhere), Dynamite (remove an obstacle), Megaphone (+3 riders now). A run starts with one Paint Can.

## Season (v0.6)
- A season is **Meadow Park → Sunny Boardwalk → Haunted Hollow**, 3 days each, then **The Grand Opening** (day 10, 7x7, every twist). Win the finale to win the season. Missing it costs a heart, and it runs again the next day.
- **Sand / mud:** a loose tile that ends a swipe on a soft cell sinks one tier; a Bump sinks away. Track over sand is fine.
- **Fog (Hollow, finale):** tiles more than 2 steps from the station and track show as mystery crates.
- **Ghost riders (Hollow, finale):** can't get sick; they tip for high nausea.
- **Park funds:** tickets beyond each day's target. Spend them in the **shop** at the end of each park on tools (40–70), an upgrade (140) or a heart repair (160).
- Targets (bot-calibrated; the bot's daily median is about 250–340, and 520 in the finale): 230, 260, 300 · 320, 360, 400 · 400, 450, 500 · 700.

## Puke economy, map and escalation (v0.7)
**The goal is to make riders puke.** The more they puke, the more you score.
- Nausea builds piece by piece as the train runs. A rider pukes each time their total passes another **stomach**, up to 5 times. Riders who keep it down pay nothing.
- **Every puke pays excitement × multiplier** (Balatro's chips × mult). Excitement = thrill + length; multiplier = 1, +0.5 per piece type past the first.
- **Riders are stomach puzzles:** Tourist (8), Just Ate (4), Grandma (inversions ×3), Kid (Drops ×2), Thrill Seeker (15+), Loop Lover (immune to loops, everything else ×2), Coaster Nerd (only Helix+ counts, ×3), Influencer and Ghost (puke worth ×2), VIP (×5).
- **Shuttle:** passes each piece twice (double nausea) but pays half.
- **Attractions** (the jokers): 5 slots; they apply left to right and can be reordered or sold. 15 of them, including Splash Zone (+1 mult per puker), Season Pass (grows every cleared day), Corn Dog Cart (stomachs −2) and Tilt Table (Helixes +3 nausea).
- **Bosses are riders.** Each park ends with one: Big Barry (stomach 24), Iron-Gut Ivy (20, only Drops and inversions, ×2), Dr. Vertigo (26, Corkscrews and Mega Loops ×3, everything else ×0.5), and the Mayor at the Grand Opening (40). **The boss must puke to clear the day**, and their pukes are worth 8–12×.
- **Station:** a two-cell platform below the board. Red leaves from its left cell, blue from its right. The smallest ride is a U.
- **Route map per park:** Day or VIP → Day, Storm or VIP → Shop, Repair or Treasure → Boss. Then the next park.
- **Targets** start at 1,000 and grow ×1.35 per day, with the finale at ×1.5. Shop prices and funds scale with them. A random-ish bot reaches day 8 at the median and almost never wins (it doesn't build for bosses), so human playtesting decides the final numbers.

## Capsule machine (v0.8)
Packs, our way: the park's capsule machine sells **eggs**. Pay, the egg wobbles, crack it, and pick from what's inside.
- **Golden Egg:** pick 1 of 3 attractions.
- **Bus Tour Egg:** pick 1 of 3 rider types. One of that type joins your line **every morning for the rest of the run**, so you build your crowd like a deck.
- **Snack Egg:** pick 2 of 4 tools.
Shops stock two eggs; Treasure stops give one free. Next egg idea: **Blueprint Egg**, with special pieces (Launch, Water Splash, Tunnel) added to your spawn pool.

Bug fixed in v0.8: at the end of every swipe animation, the board drew no tiles for one frame (the animation layer retired itself after the board had already skipped drawing tiles).

## The live scoring show (v0.9)
The score is no longer revealed after the ride: it **builds up while the train runs**, Balatro-style, so scoring is part of the fun.
- **The timeline** (`src/run/timeline.ts`, tested): opening the ride breaks the final score into ordered events that sum *exactly* to the day's total, so balance is unchanged. When the lead car passes a piece: **+excitement** (its thrill plus 1 for length; thrill upgrades are rounded on the running sum so the pieces add up). The first piece of each new type past the first: **+0.5 mult**. When a rider's nausea passes another stomachful on a piece: **a puke**, paid right away at the rating so far × their worth. Back at the station the **attractions fire left to right** (their cards wiggle), and then **the slam**: chips × mult crash together into the final rating and every puke of the ride is re-paid at it. That last hit is usually the biggest jump of the day, so the attractions visibly feed the payout. A shuttle's half pay is baked into every rating from the start, so the numbers only ever go up.
- **On screen:** a score board beside the park (below it on phones) with the ticket total rolling up like an odometer, a target bar that turns green and shimmers when the target falls, and big blue EXCITEMENT × red MULT boxes that punch on every event; the mult box glows hotter as it grows and catches fire from ×8. Popups rise from the piece or the rider (+12 blue, +0.5 mult red, +340 gold with "BLEH ×2"), green puke bursts scale with the payout, rider cards in the line fill their puke pips live, and the screen shakes harder for bigger hits. Crossing the target (and 2×, 5×, 10×...) gets a banner, confetti and a fanfare.
- **Sound** (all WebAudio synth): every event climbs one semitone, reset each ride. Chip ticks, a mult zing, a heavy ×mult hit with a chord, a wet puke squelch with a falling pitch, a crunchy boss puke with a beat of slow motion and a green flash, a register-click roll on the total, a fanfare arpeggio for the target, and a big slam.
- **Skip:** click the park or press Space/Enter during the ride to resolve everything at once (same totals). The results card is now brief (verdict, total, rating × pukes, funds, with the breakdown folded away) since the show already did the counting.
- Screenshots: `docs/ride-scoring/`.

## The 3D park (v0.10)
The web park is now a real-time **cel-shaded, ink-lined toy diorama** in Three.js, built entirely in code (no model or texture files). Game rules, the scoring timeline and the balance are untouched; only the presentation changed.
- **Look:** two-band toon light with a cool shade, a hard specular blob on glossy paint and a warm rim. A post pass draws ink where depth creases or normals turn (so every crate, rail and guest gets a hand-drawn outline), then grades the frame: saturation, warm lights, cool shade, vignette, paper grain. A small bloom pass makes bulbs, lanterns and the mega loop's lights glow at dusk.
- **The island:** a slab of stepped rock strata in a toon sea (color bands, drifting foam rings, glints), flat pavers or boardwalk planks, the grass board inside a stone kerb, a verge of trees, hedges and flower beds, lamps with bunting, benches, and islets with a Ferris wheel, a swing ride, a circling sailboat and drifting clouds. Each park has its own palette and flora (autumn trees, palms, spooky pines and mist, blossoms).
- **The coaster:** the laid track is one continuous 3D centerline through the station U-turn, with a frame at every sample. Each piece is sculpted: Bump and Hill are camelbacks, the Drop has a lift chain and a plunge, the Helix is a banked 360° climbing turn round a central pylon, Loops are teardrops that drift sideways so the exit clears the entry, the Corkscrew is a heartline roll hung from a gantry, and the gold Mega Loop has bulbs. Rails keep the tier colors; corners bank. Newly built pieces pop out of the ground.
- **The train** rides the same samples as the rails, so it banks, climbs and goes upside down with them. Its speed follows the height of the train (slow over the crowns, fast in the dips, steady on the lift chain), and the camera leans in and follows it. Riders throw their arms up and scream on the big pieces, turn green when they're sick, and their puke is voxels that fall with gravity (from wherever the car is, upside down included) and splat into puddles that stay for the day. Hats fly off on inversions.
- **Guests** are chibi models with faces tilted up at the camera: hair styles, glasses, shades, cameras, corn dogs, balloons, ghosts, and big bosses with a cap and a moustache. They hop in the snaking queue with thought bubbles, walk to the platform, and wander off afterwards. Rider cards show 3D portraits of the same models.
- **Juice:** crates squash as they slide, pop and flash on merges; chain hops arc over; voxel bursts, dust and sparkles; confetti that flutters; fireworks (with a whistle and a pop) when the target falls; shouts pinned to the 3D scene; mega crates glint.
- **Time of day:** golden light and warm water streaks late in the day, then dusk: blue-violet shade, the lamps cast warm pools of light, bulbs bloom. The Haunted Hollow is always half in dusk.
- Code: `src/render/renderer.ts` (scene, camera framing, people, crates, effects), `src/render3d/` (`geo` batcher, `toon` material, `post` ink/bloom, `track` centerline + frames, `trackmesh`, `models`, `island`, `fx`, `portrait`), `src/ride/ride.ts` (route, speed, event timing).

## Painterly look, puke finale, slow motion (v0.11)
- **Painterly instead of cel-shaded:** soft wrapped light, no black ink lines. A Kuwahara (oil-paint) filter turns flat areas into soft dabs while keeping edges; edges pool a little darker pigment of their own color; a canvas weave and a slow mottle sit on top.
- **The puke finale:** after the attractions fire, the riders line up in front of the station for a curtain call. Chips × mult slam into the final rating ("496 a puke"), then every rider who puked steps up in turn, smallest payout first: they double over and puke for the crowd, and a popup shows "NANA ×3 × 496 = +1,488" while the total climbs. Each rider's payout is their pukes re-paid at the final rating minus what their pukes already paid during the ride, so the pieces add up to the old slam exactly (balance unchanged). Then the total lands with the slam, confetti and fireworks. Skipping lands it at once.
- **Slow motion, product-video style:** time drops to about an eighth, the camera pushes in on the subject from a lower angle with a slow orbit, cinema bars slide in, the frame desaturates a touch, and a swoosh plays in and out. It goes to the wildest pieces of the ride, picked up front: Mega Loops first, then Corkscrews, then Loops (up to 3 per ride, at the crown or the upside-down middle; a Drop's lip only if nothing inverts), longer and closer for bigger pieces, on the first puke of every boss and special rider (VIPs, influencers, ghosts), and for bosses and special riders during the finale. Particles, the train and the scoring timeline all run on the slowed game clock; the odometer keeps rolling in real time. Reduced-motion users get no slow motion.

## Bigger rides, wilder slow motion, the on-ride photo (v0.12)
- **Scale:** the park stays a tiny diorama, but the finished coaster is bigger: higher decks, taller camelbacks and drops, loops about 1.6× taller (the mega loop almost a full cell high), thicker rails, cars 25% larger, and a closer ride camera. The ride is also a little slower.
- **Slow motion is a show now:** a hit-stop freeze and a flash as it starts, a heartbeat thumping through it, manga speed lines streaming from the subject, a big stretched shout ("WHOOOAAA", "BLEEEEEGH" for a boss), every rider screaming with their arms flailing, a stretched, pitched-down scream, a wider orbit, and a speed ramp that snaps time back fast for a moment.
- **The on-ride photo:** at the wildest piece of the ride (or partway round if there isn't one), a camera flash goes off and a track-mounted camera ahead of the train catches every face, upside down included. A polaroid slides in during the ride; the results card shows it as a photo card with the park, the day and the ride's stats, with a "Save the photo" button. Presentation only: no score effect yet (an idea for later: pukes caught on camera pay a bonus).

## Full-width station, in-your-face shots (v0.13)
- **The station runs the whole bottom edge:** the track drops out of the blue end's cell, runs an upper lane to the right end, turns, runs back along a long lower lane where the train waits, turns up and runs along the upper lane into the red end's cell. Riders board from an island platform between the lanes under a long striped canopy, and the train can be up to 16 cars (one per rider). Queue and curtain call moved down to make room.
- **Slower again:** a lower base speed, smaller speed-up in the dips, a slower lift chain.
- **Slow motion goes pop art:** a wide-angle lens (the field of view nearly doubles) right up close, a tilted "dutch" horizon, punchier color and contrast, and halftone dots in the shade, on top of the speed lines and captions.
- **The ride photo is a comic panel:** a wide-angle, tilted close-up from just ahead of the lead car, color cranked, halftone shade, a heavy border, and a yellow starburst with the loudest scream in it.

## Claymation (v0.14)
The park is now a **stop-motion clay set**, shot like a miniature.
- **Plasticine material** (`src/render3d/toon.ts`): every vertex wanders a little by a slow 3D noise (hand-molded, nothing perfectly straight), and a finer wander re-seeds on every stop-motion frame (the "boil" of real clay animation). Thumbprints are pressed into every surface (a bump made in the shader: pits of concentric ridges in random cells, plus lumps and fine grain), colours are mottled, the shade glows a little warm (light scattering in clay), and highlights are a broad waxy sheen. Flat ground layers get prints but no wander, so they don't poke through each other.
- **Soft forms:** normals are smoothed across any edge flatter than ~63°, so bevels round off and blobs turn soft while real corners stay.
- **Stop motion:** tried at 12 fps ("on twos") and dropped after playtesting: it read as lag. Every frame renders; `?stopmotion` brings the stepping and the clay boil back for comparison.
- **Miniature camera** (`src/render3d/post.ts`): screen-space ambient occlusion for contact shadows, a film curve, light grain, bloom and a vignette. (A tilt-shift depth of field was tried and dropped: it read as blurry; the code stays behind `uDof`.)
- **Aardman faces:** googly eyes with pupils (tiny and terrified when screaming, heavy lids when sick), a big clay nose, a wide grin with teeth, a gaping scream, a queasy wobble with puffed green cheeks.
- **Clay everywhere else:** puke, confetti and sparks are lumpy clay pellets; the sea is sculpted clay swells lit by the key light that shift each frame.
- **Plasticine UI:** panels, cards and buttons are squished slabs with a soft top highlight and bottom shade, buttons squash when pressed, and the park sits in a chunky clay frame.

## Sharing, highscores, boarding (v0.15)
- **Share every ride report.** The results card has a Share button (the system share sheet, with the photo card attached where the browser takes files), plus X, Facebook, WhatsApp, Reddit and Bluesky links, Copy, and Save photo. The text brags about how many riders went green and how many tickets the ride sold.
- **Highscores:** the best single rides (tickets sold in one ride). Every ride goes on this device's top 10; posting puts your best on a shared board (each player's best, top 20) when the game runs inside claude.ai. A Highscores button in the header opens both boards.
- **On-ride photo, take two:** a flash camera straight ahead of the train at face height, looking back into the riders' faces. A real flash light at the lens lights them up; the photo has flash falloff and an orange date stamp, but no comic filter.
- **Boarding:** each rider walks to their own car and hops in with a plop; the dispatch bell rings and the train leaves only when the last one is seated.
- **Bigger coaster:** taller hills, drops, helixes, loops and Mega Loops; smaller cars and riders; the camera sits closer. The ride is a little slower again, the chain lift clacks, and the lens widens a touch in the fast dips.
- **Track:** rounder, smoother rails with less clay wobble. The piece into the station already leans into the station's turn, and the piece out of it leans back out.

## Full-screen park, guests with personality, hills (v0.16)
- **The park fills the screen.** A slim clay top bar (park and day, hearts, target, daylight, funds, and icon buttons for highscores, help, sound, full screen) and a bottom bar with today's ride in one line (excitement × multiplier = tickets a puke, length, thrill, variety, inversions, nausea, best combo) next to the controls. The camera frames the board, station and queue in the space between the bars, so the rides come out much bigger. While the train runs, the score show docks where the bottom bar was.
- **No list of people.** Hover a guest in the park (or tap one on a phone) to meet them: name, type, stomach, weakness, and how often the ride will make them puke. They wave back. The full line is still one hover away on the "in line" chip. Only guests the ride will make puke get a (green) thought bubble.
- **Funnier guests.** Bigger heads, thick clay eyebrows, ears, mitten hands, round bodies and chunky shoes. Every type has a personality: thrill seekers smirk in line and laugh through the loops with their hands up, grandmas smile sweetly and then wail, nerds sweat and grimace, kids can't stand still, influencers take selfies, VIPs and bosses look smug until the first inversion. Faces: smile, grin, cocky, nervous, meh, joy, scream, terror, sick.
- **Hills and high stations.** Later parks aren't flat. The Boardwalk station stands on a pier, the Hollow's on a crag, the Grand Opening's on gold scaffolding, with a flight of stairs the riders climb, so every ride starts with a drop. Grassy hills rise out of the board and lift the crates and the track built on them. It's scenery: the puzzle and scoring don't change.

## The painted route map and a park that shows what you bought (v0.17)
- **Route map, Slay the Spire style.** A painted map of the park, read from the gates at the bottom up to the boss's lair at the top. Every stop is a little clay diorama (a loop for a day, a crown on a red carpet for a VIP, a storm cloud, the shop's striped tent, a patched-up heart, the capsule machine, the boss on a pedestal). Inked trails join each stop to every stop in the next row; the ones you can take next march toward you in gold, the route you took is red, and a coaster-car token marks where you are. Each park has its own terrain: a duck pond in the Meadow, the sea and palms on the Boardwalk, a moon and tombstones in the Hollow, bunting at the Grand Opening.
- **What you buy stands in the park.** Every attraction gets its own landmark on a lot beside or behind the board, in the same left-to-right order as the cards (Splash Zone is a fountain, Photo Booth a booth with a flash, Adrenaline Junkie a drop tower, Corn Dog Cart a cart with a giant corn dog, Twilight Ride a moon lamp, and so on); it bounces when it scores and when you hover its card. Upgrades are props on the free side of the plaza (a clock tower for Late Closing, a fry stand for Greasy Fries, a billboard, a tool shed...). Every bus tour parks a bus behind the board.

## Park twists, crossings, special pieces, unlocks, thoughts, music (v0.18)
- **Crossings (bridges and tunnels).** The track may cross itself at right angles through a straight Flat, Bump or Hill that nothing crosses yet; the crossing pass then runs straight on. Over flat track it's a bridge on trestles; under a Bump or Hill it's a tunnel through a clay mound, and the train disappears inside. Each crossing is a near miss: +3 thrill. It gives the puzzle new room: the ends can weave past each other.
- **Boardwalk piers.** On the Boardwalk (and at the Grand Opening), track can be built out over ponds on a plank pier: flat, with a sea breeze (+2 thrill). The Boardwalk has more water to make it matter.
- **Hollow ghosts.** Ghosts only feel upside-down pieces, but those hit them double (and a ghost puke is still worth double). Build loops for the Hollow.
- **Special pieces**, fitted onto built track like a tool: **Launch** (+10 thrill, and the next piece hits every rider double; the train fires off with a whoosh), **Water Splash** (+1 multiplier; a pool under the track and a splash that soaks the riders), **Brake Run** (+3 nausea for every rider; the train slams to a near stop in a shower of sparks). They come from rewards and the shop once unlocked.
- **Unlocks across seasons**, kept in local storage: Launch (make Big Barry puke), Water Splash (Iron-Gut Ivy), Brake Run (Dr. Vertigo), a Thermos (+1 Coffee every season, 100 pukes), a Crane license (+1 Crane, 500 pukes), Headliner (a free Launch every season, a 100,000-ticket ride), and two station paint jobs (candy stripe after 3 seasons, gold after a win). The 🎁 button lists them all with how to earn each.
- **Guest thoughts** (RCT nod): now and then a guest in line says what they think, and it reads the ride: grandmas fret about loops, thrill seekers are bored by bumps, the corn dog guy regrets lunch, ghosts only want to go upside down; anyone the ride will make puke gets nervous. After the ride, the lineup reacts ("Never again.", "Again!").
- **Chiptune park music.** Four hand-written songs (Meadow carnival in F, Boardwalk surf in E mixolydian, Hollow spooky-silly swing in D minor, a Grand Opening march in Bb), synthesized live. Layers build from bass and pad (map) to drums and arps (building) to the full band (the ride); chain reactions lift the band for a few bars, and big ones add a drum fill and a key change. Slow motion sweeps a filter down; the target, boss pukes and a lost day get stingers. Its own 🎵 toggle.
- **New piece tiles.** Soft clay plinths instead of slatted crates, with a chunky 3D clay model of the actual coaster element on the lid and tier pips on the front. The hierarchy reads at a glance: plain pillows for Bump and Hill, stepped feet and belts from Drop and Helix, gold trim from Loop, aqua gems on the Corkscrew, and pearl, rubies and a gold crown on the Mega Loop. Fog tiles are lavender with a big clay question mark.
- **The route map, take two.** Calmer and more premium: a lit, painted gradient, a few big soft shapes, one themed feature (a river, the sea, the moon, bunting), a gilt frame, and only your route and the trails you can take now drawn strongly. The car token drives along the trail to the stop you pick.

## Puke from the mouth, the puke cam, leaving in character (v0.19)
- **Puking, properly.** Every puke is now a gush out of the rider's actual mouth (each guest model knows where its mouth is), emitted over half a second or more and carried along with the moving train, so it arcs out of the car and splats into puddles below, the odd chunk included. The rider pulls a proper puke face: eyes squeezed shut, green puffed cheeks, mouth wide open. Bosses gush longer and harder. The curtain-call pukes work the same way.
- **The on-ride photo is a puke cam.** It fires a quarter second into the first puke of the ride (the boss's, if the boss goes), from three-quarters in front of the puking rider, so the photo catches the face and the stream. Half the time the lens gets hit too. Rides where nobody pukes still get the old face-on shot.
- **Leaving in character.** After the curtain call, pukers wobble off to two porta-potties at the plaza corners and queue up; one by one they go in, the door slams, the potty rocks and burps a green puff. Riders who kept their lunch run back to the line shouting "AGAIN!". Ghosts spin, shrink and float away.
- **Ride music.** The music switches to a dedicated, faster coaster theme the moment the train leaves, starting with a lift-hill build.

## Boss fights and the park plot (v0.20)
A playtester got to park 3 and said something was missing: a reason to keep going. Balatro and Slay the Spire hook you with a known threat you plan around, bosses that change the rules, rewards that change your run, and a build you can see getting stronger. This version adds all four.
- **A pool of bosses per park,** drawn when you arrive and shown on the map from the start, so the whole park is preparation: Meadow has Big Barry or Granny Grit, the Boardwalk Iron-Gut Ivy or Lifeguard Lou, the Hollow Dr. Vertigo or Count Queasy, and the Grand Opening the Mayor.
- **Every boss bends the rules** (Balatro boss blinds):
  - *Second Helpings* (Barry): his stomach grows by 1 every 4 swipes, so open early.
  - *Seen It All* (Granny): only the first piece of each type gets to her, so variety is everything.
  - *Rough Seas* (Ivy): every 5 swipes a wave slides the whole board one way. The next wave's direction is forecast.
  - *No Running!* (Lou): a swipe that merges nothing costs 2 daylight.
  - *Spin Cycle* (Vertigo): every 6 swipes your swipe controls turn a quarter turn. A compass shows where each swipe really goes.
  - *Lights Out* (Count): the fog closes in, so only tiles next to the track can be seen.
  - *Inspection Day* (Mayor): three random demands, like 12+ pieces, something upside down, a bridge or tunnel, or no shuttles. If any isn't met, the Mayor won't get on.
- **Composure and three rides.** A boss has 2–3 composure (pukes it takes to break them). You get up to three rides: after each, the track comes down, the tiles stay, the boss gets back in line, and you go again with half the daylight. Tickets bank across rides. Run out of rides and you lose a heart.
- **Spectacle:**
  - A title card slams in with the boss's portrait, a quip, their rule and the goal.
  - The boss bar shows composure pips (they pulse when the current ride would crack them, and crack live when the boss pukes), the ride count and the rule's live state.
  - "Ride 2" slams in for rematches.
  - Boss music plays (a harder, faster minor-key variant of the park's song), with stingers for the intro, each crack and each round.
- **Park conquered.** Breaking a boss gives a gold-rayed screen with the boss's trophy and a victory fanfare. **The park plot grows a row**, and you pick **1 of 3 legendary attractions**, which only bosses drop. Bosses go on a **trophy shelf** that carries over between seasons and shows on the park intro and the end screens. The season win gets the same treatment.
- **The park plot** (backpack management). Everything you build for the park, attractions and upgrades alike, sits on a 5-wide grid. It starts 2 rows tall and grows to 5. Shapes:

  | What | Shape |
  | --- | --- |
  | Commons and upgrades | 1×1 |
  | Rares | 2×1, can be turned |
  | Legendaries | 2×2 |

  - Space is the budget. Things that don't fit wait on a 2-space loading dock, where they don't count.
  - Attractions score in reading order: top row first, left to right.
  - Each attraction gets **+1 multiplier for every touching spot of its theme** (Thrills, Food, Shows, Gardens). Upgrades count as neighbors, so where you put them matters too.
  - Some attractions read their neighbors: the Ferris Wheel, the Hall of Mirrors and the Funnel Cake Stand.
  - You rearrange, turn, dock or sell between days on the map, shop and reward screens. Dropping a spot onto one of the same shape swaps them. The plot replaces the old 5 attraction slots.
  - The panel's header shows the boss waiting at the top of this park, so every placement is preparation for that fight.
- **New attractions:**
  - Common: Funnel Cake Stand (stomachs 1 smaller per touching Food spot).
  - Legendary:
    - Ferris Wheel of Fortune: ×1.3 per touching attraction.
    - Hall of Mirrors: touching attractions fire twice.
    - Gravity Well: inversions +2 nausea, but Drops do nothing.
    - All-You-Can-Eat Buffet: stomachs 3 smaller, but the line holds 3 fewer.
    - Puke Fountain: +1 multiplier per puke.
    - Thunder Mountain: ×4 for rides of 12+ pieces.
  - Each has its own clay landmark; legendaries stand on gold stages with marquee bulbs. The park now has 11 lots, with legendaries behind the board.
- **Unlocks** now ask for breaking any boss of a park (Launch for the Meadow, Water Splash for the Boardwalk, Brake Run for the Hollow).
- **Balance** (bot, 200 seasons): boss days fail 73% (was 78%). The bot never builds for bosses, so treat that as a floor. Median day reached 8 (unchanged), 1 win (was 5). By boss, the bot breaks Barry 53% of the time, Ivy 38%, Lou 36%, Granny 34%, Count 12% and Vertigo 4%. It almost never satisfies the Mayor's demands. Human play decides the final numbers.

## Park pieces: every park its own kind of ride (v0.21)
The user wanted every park to feel like a different ride: the Boardwalk water-based, the Hollow hanging, and spinning carts somewhere, with fresh things showing up on the track, in upgrades and from combos.
- **Park pieces** are tiles with a flavor. Chain reactions of two links or more turn the merged tile into the park's piece, and 5% of fresh tiles spawn as one. The flavor rides up the merge ladder (merging keeps it) and goes into the track when you build on it.

  | Park | Piece | Effect |
  | --- | --- | --- |
  | Meadow | 🌀 Spinning cars | The car whirls through it: nausea ×1.5 (rounded up), +2 thrill |
  | Boardwalk | 💧 Water (flume) | +1 multiplier |
  | Hollow | 🦇 Hanging | The train hangs under the rail: +3 thrill, and it counts as upside down (ghosts and Grandma feel it, Loop-de-Loop and the Gravity Well count it) |
  | Grand Opening | All three, mixed | |

  Park pieces can't be crossed by bridges or tunnels. The stats bar counts them.
- **Upgrades for them:**
  - Teacup Works: spinning hits 2×.
  - Flood Gates: water +1 more multiplier.
  - Steel Gantry: hanging +3 more thrill.
  - Blueprint Office: fresh tiles 15% more likely to be park pieces.
- **Combo prizes:** 6, 9 and 12 merges in one swipe each pay a free special piece (Launch, Water Splash or Brake Run), once per day per threshold.
- **The look:**
  - Flavored tiles wear their park's mark.
  - Water track runs in a flume trough, and spinning track has candy swirls.
  - Hanging track gets an overhead steel gantry, and the cars swing under the rail.
  - The cars whirl on spinning pieces, and water pieces spray as the train passes.
- **Balance** (bot, 200 seasons): park pieces end up as about 1 in 5 tiles. Boss days fail 67%, median day 9, 3 wins. Count Queasy's stomach went from 8 to 12, because hanging pieces count as upside down for him.

## The track eats tiles (v0.22): one verb, no turn limit
The user found building track a chore: once the tiles were merged, tapping a path through them was plain pathfinding with one obvious answer. They asked for one simple, elegant mechanic with endless depth, and then to drop the swipe limit so it plays like Snake.
- **One verb.** You only swipe. A tile that slides into another tile of the same kind merges, as before. **A tile that slides into an open end of the track gets eaten: it becomes the next piece of track, right where it stopped.** Each end (red and blue, starting on the platform) eats at most one tile per swipe. There's no tap-to-build.
- **What that does:**
  - Every swipe both merges and feeds.
  - You merge before you feed, because a Drop is a better meal than two Hills.
  - You keep junk away from the mouths.
  - You steer an end by where you feed it from.
  - The track you've built becomes the walls your tiles slide against.
  - The two ends compete for tiles.
- **No daylight.** The day runs until you open the ride: the full circuit once the ends touch, or a half-price shuttle any time. Every swipe drops in a tile and the track takes up room, so the board fills. When no swipe can move anything, it's **gridlock** and the ride opens by itself.
- **Things that used daylight, reworked:**
  - Coffee became the **Track Crew** tool: lay one piece by hand next to an end. It's the escape hatch.
  - Late Closing became **Street Sweepers**: every 8 swipes, the smallest tile is swept away.
  - Twilight Ride became **Open Air**: +5 excitement per free cell when you open.
  - Storms blow in two tiles a swipe.
  - Lifeguard Lou's dry swipes drop in two extra tiles.
  - Boss rematches restock the board.
  - The Mayor's bridge demand became "a park piece".
  - The evening light now comes as the board fills.
- **Dropped for now:** bridges, tunnels and piers. The track only grows into cells where it eats a tile. The rules are still in `board.ts` for later.
- **Balance** (bot with one-swipe lookahead, 200 seasons): targets are now 2,400 ×1.85 a day, the finale ×2.5, and bosses need 3 pukes to break (the Mayor 4). The bot reaches day 8 at the median, wins 19% of seasons, and fails 30% of boss days. This bot is smarter than the old one, so it isn't a floor any more. Human play decides.

## Roadmap ideas

### Progression: a season of parks
- *(Built in v0.6: Meadow, Boardwalk, Hollow, finale, shop.)* A run is a **season**: 3 parks × 3 days, then a **Grand Opening** finale. Each park has a theme and one rule twist that later parks keep stacking.
  1. *Meadow:* the basics.
  2. *Boardwalk:* sand tiles sink back a tier if not merged within a few swipes; the pier can take track over water.
  3. *Haunted Hollow:* fog hides tiles until track is next to them; ghost riders only pay for inversions.
  4. *Mountain:* elevation and the **energy budget** (lift hills vs. loops) arrive here.
  5. *Space Park:* low gravity; loops count double, but the train can float off a Mega Loop.
- **A route map between days** (Slay the Spire style): regular days, **VIP days** (one rider with a huge, specific contract), **Storm days** (harder, better reward), the **Shop** (spend surplus tickets on tools or upgrades), and **Repair** (regain a heart).
- **Your park grows across the run.** Each day's coaster stays in the park, and the season finale ends on a panorama of everything you built.

### What keeps later stages hard
- **Contracts:** VIPs and inspectors with exact demands ("exactly 2 inversions, length 12+, nausea under 10").
- **Board modifiers:** rusty tiles that fall a tier each swipe until merged, locked crates that open after a merge next to them, puddles from rain, wind that shifts one row.
- **Rival park across the road (multiplayer):** saved for a multiplayer version: two players build side by side, and the better ride pulls the other's line over.
- **Multiple stations:** two rides on one board, sharing space. Track crossings need a Tunnel or Bridge piece.

### Stuff that makes it more awesome
- **Achievements:** (the boss trophy shelf is the first piece, v0.20) a proper achievement system (first puke, a boss in one ride, five pukes from one guest, a ride with three crossings, 1,000,000 tickets...) with badges, and some unlocks tied to them.
- *(Built in v0.17, v0.18.)* **An illustrated route map** (Slay the Spire style), with the car token driving along the trail.
- *(Built in v0.12.)* **On-ride photo:** the classic camera flash on the biggest drop, showing every rider's face. It becomes a shareable card with the ride's stats.
- *(Built in v0.18.)* **Guest thoughts.**
- *(Built in v0.18.)* **Special pieces and crossings:** Launch, Water Splash, Brake Run, bridges and tunnels. Brake Run became a nausea jolt instead of cancelling nausea, since puking is the goal.
- **Daily seed challenge**, since runs are already seeded; a leaderboard per seed (the highscore board is built in v0.15).
- *(Built in v0.18.)* **Chiptune park music** that layers up with combos (fireworks were already in).
- *(Started in v0.18.)* **Meta-progression:** special pieces, starting tools and station paint jobs unlock. Next: unlockable riders and attractions.

## Name
**Loophole** (picked). Other candidates: Thrill Issues, Hold Your Lunch, Queasy Does It.
