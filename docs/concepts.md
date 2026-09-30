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
- **Rival park across the road:** your excitement must beat theirs or part of the line walks over.
- **Multiple stations:** two rides on one board, sharing space. Track crossings need a Tunnel or Bridge piece.

### Stuff that makes it more awesome
- *(Built in v0.12.)* **On-ride photo:** the classic camera flash on the biggest drop, showing every rider's face. It becomes a shareable card with the ride's stats.
- **Guest thought feed** (RCT nod): little quotes pop up ("This looks too intense for me", "I want to go on something more thrilling").
- **Special pieces:** Launch (speed boost), Water Splash (soaks the front row), Tunnel (passes under your own track), Brake Run (cancels nausea).
- **Daily seed challenge**, since runs are already seeded; later a leaderboard.
- **Chiptune park music** that layers up with combos, and fireworks when you beat the target by a lot.
- **Meta-progression:** unlock new pieces, riders, station styles and starting tools across runs.

## Name
**Loophole** (picked). Other candidates: Thrill Issues, Hold Your Lunch, Queasy Does It.
