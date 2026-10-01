import type { Rider } from './riders';

// Guest thoughts (a nod to RollerCoaster Tycoon): little quotes that pop up over
// guests in line and after the ride. They read the ride as it stands, so they
// double as hints: who's going to puke, who's bored, who wants loops.

export interface ThoughtContext {
  /** Times this ride would make the guest puke if it opened now. */
  pukes: number;
  /** Track cells built so far. */
  length: number;
  inversions: number;
  thrill: number;
  /** The ends meet: it can open as a full circuit. */
  ready: boolean;
  /** The board is nearly full. */
  dark: boolean;
}

const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];

const BY_KIND: Partial<Record<Rider['kind'], { calm: string[]; scared: string[]; bored: string[] }>> = {
  tourist: {
    calm: ['Is this the line for the big one?', 'I hope my camera survives.', 'Postcard material!'],
    scared: ['This looks too intense for me.', 'Is it too late to get a refund?'],
    bored: ['I came all this way for THAT?', 'My nan’s stairlift is scarier.'],
  },
  corndog: {
    calm: ['Mmm, corn dog.', 'Just one more bite before we go.'],
    scared: ['Maybe I shouldn’t have eaten that…', 'Why did I get the extra-large?', 'Uh oh. Uh oh.'],
    bored: ['At least my lunch is safe.'],
  },
  grandma: {
    calm: ['Back in my day, coasters were made of wood.', 'Such a lovely day for it!'],
    scared: ['Upside down? At my age?', 'I’ve knitted scarier things.', 'Oh my stars.'],
    bored: ['Wake me when it gets exciting, dear.'],
  },
  kid: {
    calm: ['Are we there yet?', 'Am I tall enough? I’m tall enough!', 'Can I go twice?'],
    scared: ['I’m not scared. YOU’RE scared.', 'Mooom, hold my balloon.'],
    bored: ['This is a baby ride!', 'BORING.'],
  },
  thrill: {
    calm: ['Is that all you’ve got?', 'Make it faster.', 'Loops. I need loops.'],
    scared: ['Finally, a real ride!', 'Now we’re talking.'],
    bored: ['I want to go on something more thrilling.', 'My grandma could ride this.', 'Yawn.'],
  },
  looper: {
    calm: ['Loops don’t bother me. Nothing else, please.', 'Round and round!'],
    scared: ['Wait, that’s a DROP, not a loop!', 'Too many hills. Way too many.'],
    bored: ['All loops? Easy.'],
  },
  nerd: {
    calm: ['Interesting G-force profile.', 'I’ve read about this track layout.', 'Is that a Corkscrew? Actually, it’s a…'],
    scared: ['The Helix numbers are… concerning.', 'I have a spreadsheet for this. It says no.'],
    bored: ['No Helix? No thanks.', 'Statistically unimpressive.'],
  },
  influencer: {
    calm: ['Like and subscribe!', 'Getting content, don’t mind me.', 'This lighting is everything.'],
    scared: ['If I puke, it’s going viral.', 'Chat, I think I’m gonna…'],
    bored: ['Nobody’s going to watch this.', 'Zero engagement ride.'],
  },
  ghost: {
    calm: ['Boooo-ring. Unless it’s upside down.', 'Haven’t felt a thing in 200 years.'],
    scared: ['Upside down! I can FEEL again!', 'Ooooh, loops.'],
    bored: ['Only loops can move a ghost.', 'Wake me when we’re upside down.'],
  },
  vip: {
    calm: ['I expect the premium experience.', 'Do you know who I am?'],
    scared: ['I did NOT sign up for this.', 'My lawyer will hear about this.'],
    bored: ['Is this what I paid for?', 'Underwhelming.'],
  },
  boss: {
    calm: ['Nothing makes me puke.', 'Bring it on.', 'I’ve ridden worse.'],
    scared: ['…this might actually get me.', 'Okay, THAT looks nasty.'],
    bored: ['Pathetic.', 'Is that a kiddie ride?'],
  },
};

/** What a guest in line thinks right now. */
export function lineThought(r: Rider, c: ThoughtContext): string {
  const k = BY_KIND[r.kind] ?? BY_KIND.tourist!;
  if (c.length === 0) return pick(['Where’s the ride?', 'Is it built yet?', 'I heard there’s a coaster.', ...k.calm]);
  if (c.pukes >= 3) return pick(k.scared);
  if (c.pukes > 0) return pick([...k.scared, ...k.calm]);
  if (c.ready && Math.random() < 0.3) return pick(['Open it already!', 'Let us on!', 'Is it ready? It looks ready!']);
  if (c.dark && Math.random() < 0.3) return pick(['It’s getting crowded in there…', 'Is that track going to fit?']);
  if (c.thrill < 10 || c.length < 4) return pick([...k.bored, ...k.calm]);
  return pick([...k.calm, ...k.bored.slice(0, 1)]);
}

/** What a guest says after the ride. */
export function rideThought(r: Rider, pukes: number): string {
  if (r.boss) return pukes > 0 ? pick(['You… win this time.', 'I need to sit down.', 'Ugh. Worth it.']) : pick(['Ha! Not even close.', 'Is that the best you’ve got?']);
  if (pukes >= 4) return pick(['Never again.', 'My lunch… my breakfast…', 'I can see sounds.', 'Again! Again! …no.']);
  if (pukes >= 1) return pick(['Blergh.', 'That was AWESOME. Also, ew.', 'Worth it!', 'Where’s the bathroom?', 'Again!']);
  if (r.kind === 'thrill' || r.kind === 'looper') return pick(['That’s it?', 'Meh. Make it wilder.']);
  return pick(['That was nice!', 'Wheee!', 'Can we go again?', 'Not bad!']);
}
