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

## Roadmap ideas

### Progression: a season of parks
- A run is a **season**: 3 parks × 3 days, then a **Grand Opening** finale. Each park has a theme and one rule twist that later parks keep stacking.
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
- **On-ride photo:** the classic camera flash on the biggest drop, showing every rider's face. It becomes a shareable card with the ride's stats.
- **Guest thought feed** (RCT nod): little quotes pop up ("This looks too intense for me", "I want to go on something more thrilling").
- **Special pieces:** Launch (speed boost), Water Splash (soaks the front row), Tunnel (passes under your own track), Brake Run (cancels nausea).
- **Daily seed challenge**, since runs are already seeded; later a leaderboard.
- **Chiptune park music** that layers up with combos, and fireworks when you beat the target by a lot.
- **Meta-progression:** unlock new pieces, riders, station styles and starting tools across runs.

## Name
**Loophole** (picked). Other candidates: Thrill Issues, Hold Your Lunch, Queasy Does It.
