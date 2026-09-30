// Chiptune park music (WebAudio). No audio files: every note is a tiny
// oscillator made on the fly and thrown away when it ends, NES style. A pulse
// lead, a triangle bass, 32nd-note chord arps, noise drums and a soft pad.
//
// How it hangs together:
// - Each park has a hand-written song: a key, a tempo, a form of 8-bar
//   sections (A, B...) with a chord per bar and a melody written as scale
//   degrees + lengths in 16ths ("5/2" = the 5th for an eighth note).
// - A lookahead scheduler ticks every 25 ms and books notes ~0.12 s ahead on
//   the AudioContext clock, one 16th step at a time, so timing never wobbles.
// - Every voice goes into a layer bus (bass, pad, hats, drums, arps, lead,
//   counter). The intensity level (0-3) picks which buses are open; the mix
//   only changes on a bar line, with a short fade.
// - The mode sets the base level (map 0, build 1, ride 2), combos lift it for
//   a few bars, big combos add a fill and a +2 key lift. Park changes and the
//   results vamp also wait for the next bar line.
// - The ride gets its own faster "coaster chase" theme per park (same hook,
//   each park's key, scale and instruments). setMode('ride') cuts in on the
//   next beat with a two-bar lift-hill climb, then a crash as the theme drops.
//   Leaving the ride for results lands a final cadence hit, then the vamp.
// - Slow motion sweeps a lowpass down and sags the pitch of every live note
//   a little, like a tape slowing; the tempo itself never changes.
// - The whole bus sits behind a gentle compressor and a quiet master so the
//   sound effects always read on top.
import { sharedAudio } from './sfx';

export type ParkId = 'meadow' | 'boardwalk' | 'hollow' | 'finale';
export type MusicMode = 'menu' | 'map' | 'build' | 'ride' | 'results';
export type StingerKind = 'puke' | 'target' | 'boss' | 'lose';

const MUTE_KEY = 'loophole.music';
const LOOKAHEAD = 0.12; // seconds booked ahead of the clock
const TICK_MS = 25;
const MASTER_SCALE = 0.28; // volume 1 -> master gain 0.28 (0.55 -> ~0.15)
const SAG_CENTS = -55; // "tape slow" pitch sag in slow motion
const SLOW_CUTOFF = 600;

// ---------------------------------------------------------------------------
// Note tables
// ---------------------------------------------------------------------------

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10];
const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11];

type Wave = 'square' | 'triangle' | 'sine' | 'sawtooth' | 'p12' | 'p25' | 'organ';
type Layer = 'bass' | 'pad' | 'hats' | 'drums' | 'arps' | 'lead' | 'counter';
const LAYERS: Layer[] = ['bass', 'pad', 'hats', 'drums', 'arps', 'lead', 'counter'];
type Mix = Record<Layer, number>;

interface SectionDef {
  /** One chord symbol per bar (roman numerals, "IV V" splits the bar). */
  chords: string[];
  /** One melody bar per chord bar; every bar adds up to 16 sixteenths. */
  mel: string[];
}

interface SongDef {
  bpm: number;
  /** Swing: for 16th swing, the fraction of a step odd 16ths are late; for 8th swing, where the "and" lands in the beat (0.5 = straight). */
  swing: number;
  swing8: boolean;
  /** MIDI note of melody degree 1. */
  key: number;
  scale: number[];
  tonic: 'I' | 'i';
  lead: 'pulse' | 'surf' | 'theremin' | 'brass';
  echo: number;
  arp: { wave: Wave; rate: 1 | 2; mask: string; busy: string };
  bass: { calm: string; groove: string; busy: string };
  drums: {
    soft: string;
    kick: string;
    snare: string;
    hat: string;
    kickBusy: string;
    snareBusy: string;
    hatBusy: string;
    block?: string;
  };
  fill: 'toms' | 'roll';
  sections: Record<string, SectionDef>;
  form: string[];
}

// Melody tokens: [#|b]degree[' or , octave marks][* tremolo-picked]/length.
// Degrees above 7 climb into the next octave (8 = octave, 9 = the 2nd above).
// "r/4" is a quarter rest. Drum strings: x hit, X accent, g ghost, o open hat.

const MEADOW_A1: SectionDef = {
  chords: ['I', 'I', 'IV', 'I', 'ii', 'V', 'I', 'V'],
  mel: [
    '1/3 3/1 5/3 3/1 8/4 5/4',
    '6/2 5/2 4/2 3/2 5/8',
    '4/3 6/1 8/3 6/1 9/2 8/2 6/4',
    '5/2 3/2 1/2 3/2 5/8',
    '6/3 4/1 6/3 8/1 9/4 8/4',
    '7/2 5/2 7/2 9/2 8/4 7/4',
    '10/2 9/2 8/2 5/2 6/2 7/2 8/4',
    '7/4 5/4 2/8',
  ],
};

const MEADOW_A2: SectionDef = {
  chords: [...MEADOW_A1.chords.slice(0, 6), 'IV V', 'I'],
  mel: [...MEADOW_A1.mel.slice(0, 6), '6/2 8/2 6/2 4/2 2/2 4/2 7,/4', '1/6 5,/2 1/4 r/4'],
};

const SONG_DEFS: Record<ParkId, SongDef> = {
  // Sunny carnival bounce in F major: dotted "da-da DAH" hooks over an oom-pah bass.
  meadow: {
    bpm: 116,
    swing: 0.12,
    swing8: false,
    key: 65,
    scale: MAJOR,
    tonic: 'I',
    lead: 'pulse',
    echo: 0.12,
    arp: { wave: 'p25', rate: 2, mask: 'x.x.x.x.x.x.x.x.', busy: 'xxxxxxxxxxxxxxxx' },
    bass: {
      calm: 'R/8 5/8',
      groove: 'R/3 R/1 5/4 R/3 R/1 5/2 a/2',
      busy: 'R/2 8/2 5/2 8/2 R/2 8/2 5/2 a/2',
    },
    drums: {
      soft: '..x...x...x...x.',
      kick: 'x.......x.x.....',
      snare: '....x.......x...',
      hat: 'x.x.x.x.x.x.x.x.',
      kickBusy: 'x.....x.x.x...x.',
      snareBusy: '....x..g....x.gx',
      hatBusy: 'x.xxx.xox.xxx.xo',
    },
    fill: 'toms',
    sections: {
      A1: MEADOW_A1,
      A2: MEADOW_A2,
      B: {
        chords: ['IV', 'I', 'IV', 'V', 'vi', 'iii', 'IV V', 'I'],
        mel: [
          'r/2 6/2 8/2 10/2 9/6 8/2',
          '8/4 5/4 3/8',
          'r/2 6/2 8/2 10/2 11/6 10/2',
          '9/8 7/4 5/4',
          '10/3 10/1 9/2 8/2 6/4 8/4',
          '7/3 7/1 8/2 7/2 5/8',
          '6/2 8/2 11/4 9/2 7/2 5/4',
          '8/8 r/4 5,/4',
        ],
      },
    },
    form: ['A1', 'A2', 'B', 'A2'],
  },

  // Surf rock in E mixolydian: I - bVII - IV, a driving 8th bass and a
  // tremolo lead that goes full tremolo-picking in the B section.
  boardwalk: {
    bpm: 132,
    swing: 0,
    swing8: false,
    key: 64,
    scale: MIXOLYDIAN,
    tonic: 'I',
    lead: 'surf',
    echo: 0.26,
    arp: { wave: 'p25', rate: 2, mask: 'x..x..x...x..x..', busy: 'xxxxxxxxxxxxxxxx' },
    bass: {
      calm: 'R/6 R/2 5/8',
      groove: 'R/2 R/2 8/2 R/2 5/2 R/2 7/2 8/2',
      busy: 'R/1 R/1 R/2 8/2 R/2 5/2 R/2 7/2 a/2',
    },
    drums: {
      soft: '..x...x...x...x.',
      kick: 'x.....x.x.....x.',
      snare: '....x.......x...',
      hat: 'x.x.x.x.x.x.x.x.',
      kickBusy: 'x.x...x.x.x...x.',
      snareBusy: '....X..g.g..X.gg',
      hatBusy: 'xxxxxxxxxxxxxxxx',
    },
    fill: 'toms',
    sections: {
      A: {
        chords: ['I', 'I', 'bVII', 'IV', 'I', 'I', 'bVII IV', 'V'],
        mel: [
          '1/2 3/2 5/3 5/1 6/2 5/2 3/4',
          '5/2 3/2 1/2 7,/2 1/8',
          '7/2 7/1 7/1 6/2 7/2 9/4 7/4',
          '8/2 6/2 4/4 6/8',
          '1/2 3/2 5/3 5/1 8/2 7/2 5/4',
          '6/2 5/2 3/2 5/2 3/2 2/2 1/4',
          '7/2 9/2 11/4 10/2 8/2 6/4',
          '5/6 4/2 #7,/2 2/2 5,/4',
        ],
      },
      B: {
        chords: ['IV', 'IV', 'I', 'I', 'bVII', 'bVII', 'V', 'V'],
        mel: [
          '8*/6 9/2 8*/8',
          '6*/6 8/2 6*/4 4/4',
          '5*/6 6/2 5*/4 3/4',
          '1*/8 3/4 5/4',
          '7*/6 9/2 11*/8',
          '11/2 12/2 11/2 9/2 7*/8',
          '#7/4 9/4 12/8',
          '12/2 11/2 9/2 #7/2 5/4 r/4',
        ],
      },
    },
    form: ['A', 'A', 'B', 'A'],
  },

  // Halloween cartoon in D harmonic minor, swung: a wobbly theremin creeps
  // chromatically, a bII (Eb) chord adds a phrygian wink, the B section is a
  // staccato skeleton dance over a walking bass and organ arps.
  hollow: {
    bpm: 104,
    swing: 0.64,
    swing8: true,
    key: 62,
    scale: HARMONIC_MINOR,
    tonic: 'i',
    lead: 'theremin',
    echo: 0.3,
    arp: { wave: 'organ', rate: 1, mask: 'x.x.x.x.x.x.x.x.', busy: 'xxx.xxx.xxx.xxxx' },
    bass: {
      calm: 'R/8 5/8',
      groove: 'R/4 3/4 5/4 a/4',
      busy: 'R/2 8/2 3/2 8/2 5/2 3/2 R/2 a/2',
    },
    drums: {
      soft: '..x...x...x...x.',
      kick: 'x.......x.......',
      snare: '....x.......x...',
      hat: 'x.x.x.x.x.x.x.x.',
      kickBusy: 'x.....x.x.....x.',
      snareBusy: '....x..g....x..g',
      hatBusy: 'x.x.x.xox.x.x.xo',
      block: '..x...x...x.x.x.',
    },
    fill: 'toms',
    sections: {
      A: {
        chords: ['i', 'i', 'iv', 'i', 'bVI', 'bII', 'V', 'V'],
        mel: [
          '1/4 3/2 5/2 #4/2 5/2 r/4',
          '8/3 7/1 8/2 5/2 3/4 r/4',
          '4/4 6/2 8/2 6/2 4/2 2/4',
          '3/2 2/2 1/4 5,/4 r/4',
          '6/4 8/2 10/2 b9/2 8/4 r/2',
          'b9/4 11/2 13/2 11/2 b9/6',
          '7/2 8/2 7/2 6/2 5/4 7,/4',
          '5/2 r/2 5/2 r/2 5/2 6/2 7/4',
        ],
      },
      B: {
        chords: ['iv', 'i', 'iv', 'V', 'bVI', 'bII', 'V', 'i'],
        mel: [
          '8/2 r/2 6/2 r/2 4/4 6/4',
          '5/2 r/2 3/2 r/2 1/4 3/4',
          '8/2 r/2 6/2 r/2 4/2 5/2 6/2 7/2',
          '8/6 7/2 5/8',
          '10/3 10/1 b9/2 8/2 6/8',
          '11/3 11/1 b9/2 11/2 13/8',
          '12/2 11/2 10/2 9/2 8/2 7/2 6/2 7/2',
          '8/4 5/2 3/2 1/4 r/4',
        ],
      },
    },
    form: ['A', 'B', 'A', 'B'],
  },

  // Victory march in Bb major: dotted fanfare calls in brassy squares doubled
  // a third below, oom-pah tuba bass, snare rolls into every section.
  finale: {
    bpm: 124,
    swing: 0,
    swing8: false,
    key: 70,
    scale: MAJOR,
    tonic: 'I',
    lead: 'brass',
    echo: 0.1,
    arp: { wave: 'p25', rate: 2, mask: 'x.x.x.x.x.x.x.x.', busy: 'xxxxxxxxxxxxxxxx' },
    bass: {
      calm: 'R/8 5/8',
      groove: 'R/4 5/4 R/4 5/4',
      busy: 'R/2 r/2 5/2 r/2 R/2 3/2 5/2 a/2',
    },
    drums: {
      soft: '..x...x...x...x.',
      kick: 'x.......x.......',
      snare: '....x.....x.x.x.',
      hat: 'x...x...x...x...',
      kickBusy: 'x...x...x...x...',
      snareBusy: 'x.gxx.g.x.gxx.xx',
      hatBusy: 'x.x.x.x.x.x.x.x.',
    },
    fill: 'roll',
    sections: {
      A: {
        chords: ['I', 'I', 'IV', 'I', 'ii', 'V', 'I IV', 'V I'],
        mel: [
          '5,/2 r/1 5,/1 1/3 1/1 3/3 3/1 5/4',
          '8/6 5/2 3/4 1/4',
          '4/3 4/1 6/3 6/1 8/4 6/4',
          '5/6 4/2 3/4 1/4',
          '2/3 2/1 4/3 4/1 6/4 5/4',
          '5/3 5/1 7/3 7/1 9/8',
          '8/3 8/1 10/2 8/2 11/3 10/1 9/2 8/2',
          '7/4 9/4 8/8',
        ],
      },
      B: {
        chords: ['IV', 'IV', 'I', 'I', 'ii', 'V', 'I', 'V'],
        mel: [
          '4/8 6/4 8/4',
          '11/6 10/2 9/4 8/4',
          '8/8 5/4 3/4',
          '3/2 4/2 5/2 6/2 7/2 8/2 9/2 10/2',
          '11/6 9/2 6/4 9/4',
          '10/6 9/2 7/4 5/4',
          '8/3 8/1 8/3 8/1 12/4 10/4',
          '9/8 7/4 5/4',
        ],
      },
    },
    form: ['A', 'B', 'A', 'B'],
  },
};

// ---------------------------------------------------------------------------
// Parsing the tables into bars
// ---------------------------------------------------------------------------

interface MelNote {
  step: number;
  len: number;
  /** Scale index from degree 1 (can be negative or past 7). */
  di: number;
  acc: number;
  /** Tremolo-picked: one short re-pluck per 16th. */
  pick: boolean;
}

interface Chord {
  step: number;
  len: number;
  /** Root in semitones above the key's tonic. */
  root: number;
  /** Chord tones in semitones above the root. */
  tones: number[];
}

interface Bar {
  chords: Chord[];
  notes: MelNote[];
  at: (MelNote | undefined)[];
  sectionStart: boolean;
  sectionEnd: boolean;
  /** The results vamp: everyone hits the melody rhythm together. */
  tutti: boolean;
  /** A lift-hill build bar (ride intro). */
  lift: boolean;
}

interface BassTok {
  len: number;
  kind: string;
}

interface Song {
  def: SongDef;
  bars: Bar[];
  vamp: Bar[];
  /** Two lift-hill bars and a final cadence hit, for the ride theme. */
  lift: Bar[];
  ending: Bar;
  bass: { calm: (BassTok | undefined)[]; groove: (BassTok | undefined)[]; busy: (BassTok | undefined)[] };
}

const mod = (a: number, n: number) => ((a % n) + n) % n;
const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);
/** Moves a MIDI note by octaves into [lo, lo + 11]. */
const placeIn = (m: number, lo: number) => lo + mod(m - lo, 12);

function degSemi(scale: number[], di: number, acc: number): number {
  const oct = Math.floor(di / 7);
  return scale[di - oct * 7] + 12 * oct + acc;
}

function parseMel(src: string): MelNote[] {
  const out: MelNote[] = [];
  let step = 0;
  for (const tok of src.trim().split(/\s+/)) {
    const m = /^(?:(r)|([b#]?)(\d+)([',]*))(\*?)\/(\d+)$/.exec(tok);
    if (!m) continue;
    const len = Number(m[6]);
    if (!m[1]) {
      const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
      let oct = 0;
      for (const c of m[4]) oct += c === "'" ? 1 : -1;
      const di = Number(m[3]) - 1 + 7 * oct;
      if (m[5]) for (let k = 0; k < len; k++) out.push({ step: step + k, len: 1, di, acc, pick: true });
      else out.push({ step, len, di, acc, pick: false });
    }
    step += len;
  }
  return out.filter((n) => n.step < 16).map((n) => ({ ...n, len: Math.min(n.len, 16 - n.step) }));
}

const NUMERALS: Record<string, number> = { i: 0, ii: 1, iii: 2, iv: 3, v: 4, vi: 5, vii: 6 };

function parseChord(sym: string): { root: number; tones: number[] } {
  const m = /^([b#]?)([ivIV]+)(o|\+)?(M7|7|sus4)?$/.exec(sym);
  const deg = m ? NUMERALS[m[2].toLowerCase()] : undefined;
  if (!m || deg === undefined) return { root: 0, tones: [0, 4, 7] };
  const root = MAJOR[deg] + (m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0);
  const upper = m[2] === m[2].toUpperCase();
  let tones = m[3] === 'o' ? [0, 3, 6] : m[3] === '+' ? [0, 4, 8] : upper ? [0, 4, 7] : [0, 3, 7];
  if (m[4] === 'sus4') tones = [0, 5, 7];
  else if (m[4] === '7') tones.push(m[3] === 'o' ? 9 : 10);
  else if (m[4] === 'M7') tones.push(11);
  return { root, tones };
}

function parseChords(src: string): Chord[] {
  const syms = src.trim().split(/\s+/);
  const len = Math.round(16 / syms.length);
  return syms.map((s, i) => ({ step: i * len, len: i === syms.length - 1 ? 16 - i * len : len, ...parseChord(s) }));
}

function parseBass(src: string): (BassTok | undefined)[] {
  const at = new Array<BassTok | undefined>(16).fill(undefined);
  let step = 0;
  for (const tok of src.trim().split(/\s+/)) {
    const m = /^(R|3|5|7|8|a|r)\/(\d+)$/.exec(tok);
    if (!m) continue;
    const len = Number(m[2]);
    if (m[1] !== 'r' && step < 16) at[step] = { len: Math.min(len, 16 - step), kind: m[1] };
    step += len;
  }
  return at;
}

function makeBar(chords: string, mel: string, first: boolean, last: boolean, tutti = false, lift = false): Bar {
  const notes = parseMel(mel);
  const at = new Array<MelNote | undefined>(16).fill(undefined);
  for (const n of notes) at[n.step] = n;
  return { chords: parseChords(chords), notes, at, sectionStart: first, sectionEnd: last, tutti, lift };
}

function buildSong(def: SongDef): Song {
  const bars: Bar[] = [];
  for (const name of def.form) {
    const sec = def.sections[name];
    if (!sec) continue;
    const n = Math.min(sec.chords.length, sec.mel.length);
    for (let i = 0; i < n; i++) bars.push(makeBar(sec.chords[i], sec.mel[i], i === 0, i === n - 1));
  }
  // The results vamp: "shave and a haircut... two bits", in the song's own scale.
  const lead = def.scale[6] === 11 ? '7' : '#7';
  const vamp = [
    makeBar(def.tonic, '8/4 5/2 5/2 6/4 5/4', true, false, true),
    makeBar(`V ${def.tonic}`, `r/4 ${lead}/4 8/4 r/4`, false, true, true),
  ];
  return {
    def,
    bars,
    vamp,
    lift: [makeBar(def.tonic, 'r/16', true, false, false, true), makeBar(def.tonic, 'r/16', false, true, false, true)],
    ending: makeBar(`V ${def.tonic}`, '5/2 5/2 5/2 r/2 8/8', true, true, true),
    bass: { calm: parseBass(def.bass.calm), groove: parseBass(def.bass.groove), busy: parseBass(def.bass.busy) },
  };
}

const SONGS: Record<ParkId, Song> = {
  meadow: buildSong(SONG_DEFS.meadow),
  boardwalk: buildSong(SONG_DEFS.boardwalk),
  hollow: buildSong(SONG_DEFS.hollow),
  finale: buildSong(SONG_DEFS.finale),
};

// ---- The ride theme: one coaster-chase hook, played in each park's own
// key, scale and instruments at a gallop. Degrees are chosen to sit on the
// chords in major, mixolydian and harmonic minor alike (no 7ths over bVII).
const RIDE_A_MEL = [
  '1/2 1/1 3/1 5/2 1/2 8/4 5/4',
  '6/2 5/2 3/2 5/2 3/2 2/2 1/4',
  '4/2 4/1 2/1 4/2 9/2 11/4 9/4',
  '8/3 6/1 8/2 6/2 8/4 r/4',
  '1/2 1/1 3/1 5/2 1/2 8/2 10/2 12/4',
  '10/2 8/2 5/2 8/2 10/2 12/2 10/4',
  '11/3 11/1 10/2 8/2 6/4 8/4',
  '9/4 12/4 9/2 5/2 9/2 r/2',
];
const RIDE_B_MEL = [
  '8/1 8/1 r/1 8/1 r/1 8/1 6/2 4/2 6/2 8/4',
  '11/2 10/2 8/2 6/2 8/8',
  '5/1 5/1 r/1 5/1 r/1 5/1 3/2 1/2 3/2 5/4',
  '8/2 5/2 3/2 5/2 8/8',
  '8/1 8/1 r/1 8/1 r/1 8/1 6/2 8/2 13/2 13/4',
  '13/4 8/4 6/4 8/4',
  '12/2 12/1 12/1 9/2 12/2 r/2 9/2 5/4',
  '5/1 5/1 5/1 5/1 9/2 9/2 12/2 12/2 r/4',
];
const GALLOP = 'R/2 R/1 R/1 R/2 R/1 R/1 5/2 5/1 5/1 8/2 5/1 R/1';

function rideDef(id: ParkId, bpm: number, key: number, swing: number): SongDef {
  const base = SONG_DEFS[id];
  const minor = base.tonic === 'i';
  return {
    ...base,
    bpm,
    key,
    swing,
    echo: base.echo * 0.6,
    arp: { ...base.arp, mask: 'x.x.x.x.x.x.x.x.', busy: 'xxxxxxxxxxxxxxxx' },
    bass: { calm: GALLOP, groove: GALLOP, busy: 'R/2 R/1 R/1 8/2 R/1 R/1 5/2 5/1 5/1 8/2 a/1 a/1' },
    drums: {
      soft: '..x...x...x...x.',
      kick: 'x...x...x...x...',
      snare: '....x.......x...',
      hat: 'xXxXxXxXxXxXxXxX',
      kickBusy: 'x..xx...x..xx..x',
      snareBusy: '....x..g....x.gx',
      hatBusy: 'xXxoxXxXxXxoxXxX',
      block: base.drums.block,
    },
    sections: {
      A: {
        chords: minor ? ['i', 'i', 'bVII', 'bVI', 'i', 'i', 'iv', 'V'] : ['I', 'I', 'bVII', 'IV', 'I', 'I', 'IV', 'V'],
        mel: RIDE_A_MEL,
      },
      B: {
        chords: minor ? ['iv', 'iv', 'i', 'i', 'bVI', 'bVI', 'V', 'V'] : ['IV', 'IV', 'I', 'I', 'IV', 'IV', 'V', 'V'],
        mel: RIDE_B_MEL,
      },
    },
    form: ['A', 'B', 'A', 'B'],
  };
}

const RIDE_SONGS: Record<ParkId, Song> = {
  meadow: buildSong(rideDef('meadow', 152, 65, 0.06)),
  boardwalk: buildSong(rideDef('boardwalk', 160, 64, 0)),
  hollow: buildSong(rideDef('hollow', 150, 62, 0.58)),
  finale: buildSong(rideDef('finale', 164, 63, 0)),
};

// Which buses are open at each intensity level.
const MIXES: Mix[] = [
  { bass: 0.8, pad: 1, hats: 0.5, drums: 0, arps: 0, lead: 0, counter: 0 },
  { bass: 1, pad: 0.7, hats: 0.85, drums: 0.85, arps: 0.75, lead: 0, counter: 0 },
  { bass: 1, pad: 0.5, hats: 1, drums: 1, arps: 0.85, lead: 1, counter: 0 },
  { bass: 1, pad: 0.4, hats: 1, drums: 1, arps: 1, lead: 1, counter: 0.8 },
];
const LIFT_MIX: Mix = { bass: 1, pad: 0, hats: 0, drums: 1, arps: 1, lead: 0, counter: 0 };
const SILENT: Mix = { bass: 0, pad: 0, hats: 0, drums: 0, arps: 0, lead: 0, counter: 0 };
const BASE_LEVEL: Record<MusicMode, number> = { menu: 0, map: 0, build: 1, ride: 2, results: 0 };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface Graph {
  master: GainNode;
  filter: BiquadFilterNode;
  duck: GainNode;
  sting: GainNode;
  bus: Record<Layer, GainNode>;
  echo: DelayNode;
  echoWet: GainNode;
  waves: { p12: PeriodicWave; p25: PeriodicWave; organ: PeriodicWave };
  noise: AudioBuffer;
  maxCutoff: number;
}

let ctx: AudioContext | null = null;
let graph: Graph | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let started = false;
let muted = loadMuted();
let volume = 0.55;

let song: Song = SONGS.meadow;
let pending: Song | null = null;
let mode: MusicMode = 'menu';
let park: ParkId = 'meadow';
/** Scripted bars (lift hill, ending hit, results vamp) played before the song's form resumes. */
let queue: { song: Song; bar: Bar }[] = [];
let scripted = false;
/** Cut the current bar short at the next beat (entering or leaving the ride). */
let cutPending = false;

let barNo = 0; // bars played since start (never resets)
let barIdx = 0; // position in the song's form
let loops = 0; // times through the form
let step = 0; // next 16th to book
let nextT = 0; // clock time of that 16th (unswung)
let cur: Bar | null = null;
let curLevel = 0;
let curMix: Mix = SILENT;
let prevMix: Mix = SILENT;
let shift = 0; // semitones of key lift in this bar
let arpN = 0;

let boost = 0;
let boostUntil = 0;
let liftFrom = -1;
let liftUntil = -1;
let fillBar = -1;
let fillFrom = 16;
let crashBar = -1;

let slow = false;
let sag = 0;
let lastLead = { midi: -1, end: 0 };

/** Every live pitched oscillator, with its own detune offset, so slow motion can sag them. */
const live = new Map<OscillatorNode, number>();

function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

const running = () => timer !== undefined && ctx !== null && graph !== null;
const stepDur = () => 60 / song.def.bpm / 4;

/** Offset of (swung) step s from the bar start, in seconds. s may be 16. */
function offs(s: number): number {
  const d = song.def;
  const sd = stepDur();
  if (d.swing8) {
    const beat = Math.floor(s / 4);
    const r = d.swing;
    const map = [0, r / 2, r, r + (1 - r) / 2];
    return (beat + map[s % 4]) * 4 * sd;
  }
  return s * sd + (s % 2 === 1 ? d.swing * sd : 0);
}

function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// The audio graph
// ---------------------------------------------------------------------------

function pulseWave(c: AudioContext, duty: number): PeriodicWave {
  const n = 48;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k++) real[k] = (2 * Math.sin(k * Math.PI * duty)) / (k * Math.PI);
  return c.createPeriodicWave(real, imag);
}

function organWave(c: AudioContext): PeriodicWave {
  // Drawbar-ish: fundamental, octave, 12th, two octaves, a hint of the 3rd octave.
  const imag = new Float32Array([0, 1, 0.75, 0.45, 0.35, 0, 0.18, 0, 0.12]);
  return c.createPeriodicWave(new Float32Array(imag.length), imag);
}

function buildGraph(c: AudioContext): Graph {
  const master = c.createGain();
  master.gain.value = 0;
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 12;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.25;
  const maxCutoff = Math.min(18000, c.sampleRate / 2 - 200);
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = maxCutoff;
  filter.Q.value = 0.7;
  const duck = c.createGain();
  duck.connect(filter);
  filter.connect(comp);
  comp.connect(master);
  master.connect(c.destination);
  // Stingers skip the slow-mo filter and the ducking, so they always cut through.
  const sting = c.createGain();
  sting.connect(comp);

  const bus = {} as Record<Layer, GainNode>;
  for (const l of LAYERS) {
    const g = c.createGain();
    g.gain.value = 0;
    g.connect(duck);
    bus[l] = g;
  }

  // A dotted-8th echo on the lead and countermelody.
  const echo = c.createDelay(1.5);
  const fb = c.createGain();
  fb.gain.value = 0.3;
  const tone = c.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 2600;
  const echoWet = c.createGain();
  echoWet.gain.value = 0;
  bus.lead.connect(echo);
  bus.counter.connect(echo);
  echo.connect(tone);
  tone.connect(fb);
  fb.connect(echo);
  tone.connect(echoWet);
  echoWet.connect(duck);

  const noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  return {
    master,
    filter,
    duck,
    sting,
    bus,
    echo,
    echoWet,
    waves: { p12: pulseWave(c, 0.125), p25: pulseWave(c, 0.25), organ: organWave(c) },
    noise,
    maxCutoff,
  };
}

function setEcho(t: number): void {
  if (!graph) return;
  graph.echo.delayTime.setTargetAtTime(Math.min(1.4, stepDur() * 3), t, 0.05);
  graph.echoWet.gain.setTargetAtTime(song.def.echo, t, 0.1);
}

// ---------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------

function makeOsc(c: AudioContext, g: Graph, wave: Wave, cents: number, sagged: boolean): OscillatorNode {
  const o = c.createOscillator();
  if (wave === 'p12' || wave === 'p25' || wave === 'organ') o.setPeriodicWave(g.waves[wave]);
  else o.type = wave;
  if (sagged) {
    o.detune.value = sag + cents;
    live.set(o, cents);
  } else o.detune.value = cents;
  return o;
}

/** Stops every source at stopAt and disconnects the whole chain once the last one ends. */
function cleanup(srcs: AudioScheduledSourceNode[], chain: AudioNode[], start: number, stopAt: number): void {
  let left = srcs.length;
  for (const s of srcs) {
    s.onended = () => {
      if (s instanceof OscillatorNode) live.delete(s);
      s.disconnect();
      if (--left === 0) for (const n of chain) n.disconnect();
    };
    s.start(start);
    s.stop(stopAt);
  }
}

interface ToneOpts {
  t: number;
  dur: number;
  midi: number;
  wave: Wave;
  vol: number;
  dest: AudioNode;
  /** Attack time, sustain fraction reached by the note end, release time. */
  a?: number;
  s?: number;
  r?: number;
  /** A second oscillator, detuned by cents2, at mix2 of the level. */
  wave2?: Wave;
  cents2?: number;
  mix2?: number;
  vib?: number;
  vibRate?: number;
  vibDelay?: number;
  /** Glide in from this MIDI note over `glide` seconds. */
  from?: number;
  glide?: number;
  /** Slide to this MIDI note over the note's length. */
  bend?: number;
  /** Lowpass envelope: start, peak (after the attack), end. */
  lp?: [number, number, number];
  q?: number;
  trem?: number;
  tremRate?: number;
  sagged?: boolean;
}

function tone(o: ToneOpts): void {
  const c = ctx;
  const gr = graph;
  if (!c || !gr) return;
  const dur = Math.max(0.02, o.dur);
  const a = Math.min(o.a ?? 0.004, dur * 0.5);
  const r = Math.max(0.01, o.r ?? 0.04);
  const t = o.t;
  const end = t + dur;
  const stopAt = end + r + 0.03;
  const peak = Math.max(0.0002, o.vol);

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * (o.s ?? 0.6)), end);
  g.gain.exponentialRampToValueAtTime(0.0001, end + r);
  const chain: AudioNode[] = [g];
  const srcs: AudioScheduledSourceNode[] = [];

  let head: AudioNode = g;
  if (o.lp) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = o.q ?? 1;
    f.frequency.setValueAtTime(o.lp[0], t);
    f.frequency.exponentialRampToValueAtTime(o.lp[1], t + a + 0.03);
    f.frequency.exponentialRampToValueAtTime(o.lp[2], Math.max(end, t + a + 0.05));
    f.connect(g);
    head = f;
    chain.push(f);
  }

  let out: AudioNode = g;
  if (o.trem) {
    const tg = c.createGain();
    tg.gain.value = 1 - o.trem / 2;
    const lfo = c.createOscillator();
    lfo.frequency.value = o.tremRate ?? 7;
    const lg = c.createGain();
    lg.gain.value = o.trem / 2;
    lfo.connect(lg).connect(tg.gain);
    g.connect(tg);
    out = tg;
    chain.push(tg, lg);
    srcs.push(lfo);
  }
  out.connect(o.dest);

  let vibGain: GainNode | null = null;
  if (o.vib) {
    const lfo = c.createOscillator();
    lfo.frequency.value = o.vibRate ?? 5.5;
    vibGain = c.createGain();
    const vd = t + (o.vibDelay ?? 0.15);
    vibGain.gain.setValueAtTime(0, t);
    vibGain.gain.setValueAtTime(0, vd);
    vibGain.gain.linearRampToValueAtTime(o.vib, vd + 0.2);
    lfo.connect(vibGain);
    chain.push(vibGain);
    srcs.push(lfo);
  }

  const sagged = o.sagged ?? true;
  const addOsc = (wave: Wave, cents: number, level: number) => {
    const osc = makeOsc(c, gr, wave, cents, sagged);
    osc.frequency.setValueAtTime(mtof(o.from ?? o.midi), t);
    if (o.from !== undefined) osc.frequency.exponentialRampToValueAtTime(mtof(o.midi), t + (o.glide ?? 0.05));
    if (o.bend !== undefined) osc.frequency.exponentialRampToValueAtTime(mtof(o.bend), end + r);
    if (vibGain) vibGain.connect(osc.detune);
    if (level === 1) osc.connect(head);
    else {
      const lg = c.createGain();
      lg.gain.value = level;
      osc.connect(lg).connect(head);
      chain.push(lg);
    }
    srcs.push(osc);
  };
  addOsc(o.wave, 0, 1);
  if (o.wave2) addOsc(o.wave2, o.cents2 ?? 0, o.mix2 ?? 1);

  cleanup(srcs, chain, t, stopAt);
}

function noiseHit(
  t: number,
  len: number,
  vol: number,
  type: BiquadFilterType,
  freq: number,
  dest: AudioNode,
  q = 0.7,
  sweepTo?: number,
): void {
  const c = ctx;
  const gr = graph;
  if (!c || !gr) return;
  const src = c.createBufferSource();
  src.buffer = gr.noise;
  src.loop = true; // long hits (crashes) never run off the end of the buffer
  const f = c.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + len);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(Math.max(0.0002, vol), t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(f).connect(g).connect(dest);
  src.onended = () => {
    src.disconnect();
    f.disconnect();
    g.disconnect();
  };
  src.start(t, Math.random() * 0.5);
  src.stop(t + len + 0.02);
}

function kick(t: number, vol: number, dest: AudioNode): void {
  tone({ t, dur: 0.16, midi: 50, bend: 28, wave: 'sine', vol, dest, a: 0.002, s: 0.25, r: 0.06, sagged: false });
  noiseHit(t, 0.012, vol * 0.25, 'highpass', 2500, dest);
}

function snare(t: number, vol: number, dest: AudioNode): void {
  noiseHit(t, 0.13, vol, 'highpass', 1100, dest, 0.8, 3000);
  tone({ t, dur: 0.05, midi: 54, bend: 49, wave: 'triangle', vol: vol * 0.6, dest, a: 0.002, s: 0.3, r: 0.03, sagged: false });
}

function hat(t: number, vol: number, open: boolean, dest: AudioNode): void {
  noiseHit(t, open ? 0.16 : 0.035, vol, 'highpass', 7500, dest, 0.9);
}

function crash(t: number, vol: number, dest: AudioNode): void {
  noiseHit(t, 1.1, vol, 'highpass', 3800, dest, 0.6, 6000);
}

function tom(t: number, midi: number, vol: number, dest: AudioNode): void {
  tone({ t, dur: 0.14, midi, bend: midi - 7, wave: 'triangle', vol, dest, a: 0.002, s: 0.3, r: 0.05, sagged: false });
}

function block(t: number, midi: number, vol: number, dest: AudioNode): void {
  tone({ t, dur: 0.03, midi, wave: 'p12', vol, dest, a: 0.001, s: 0.1, r: 0.02 });
}

// ---------------------------------------------------------------------------
// The scheduler
// ---------------------------------------------------------------------------

function chordAt(b: Bar, s: number): Chord {
  let ch = b.chords[0];
  for (const c of b.chords) if (c.step <= s) ch = c;
  return ch;
}

function chordAfter(b: Bar, s: number): Chord {
  if (s < 16) return chordAt(b, s);
  const next = b.tutti ? song.bars[0] : song.bars[(barIdx + 1) % song.bars.length];
  return next.chords[0];
}

function mixFor(level: number): Mix {
  const m = { ...MIXES[level] };
  if (mode === 'menu' && level === 0) m.lead = 0.4; // the tune, softly, on the title screen
  return m;
}

function onBarStart(t: number): void {
  const gr = graph;
  if (!gr) return;
  const wasLift = cur?.lift ?? false;
  const q = queue.shift();
  const next = q ? q.song : pending;
  if (!q) pending = null;
  if (next && next !== song) {
    song = next;
    barIdx = 0;
    loops = 0;
    lastLead = { midi: -1, end: 0 };
    setEcho(t);
    if (!q && BASE_LEVEL[mode] >= 1) crashBar = barNo;
  }
  scripted = !!q;
  cur = q ? q.bar : song.bars[barIdx % song.bars.length];
  if (wasLift && !cur.lift) crashBar = barNo; // over the top of the lift hill
  const lifted = barNo < boostUntil ? boost : 0;
  curLevel = cur.tutti ? 3 : Math.min(3, BASE_LEVEL[mode] + lifted);
  shift = barNo >= liftFrom && barNo < liftUntil ? 2 : 0;
  prevMix = curMix;
  curMix = cur.lift ? LIFT_MIX : mixFor(curLevel);
  for (const l of LAYERS) {
    const v = curMix[l];
    gr.bus[l].gain.setTargetAtTime(v, t, v >= prevMix[l] ? 0.04 : 0.25);
  }
}

function advanceBar(): void {
  if (scripted) {
    if (queue.length === 0) barIdx = 0;
  } else {
    barIdx++;
    if (barIdx >= song.bars.length) {
      barIdx = 0;
      loops++;
    }
  }
  barNo++;
}

function tick(): void {
  try {
    const c = ctx;
    if (!c || !graph) return;
    const now = c.currentTime;
    // Fell behind (the tab was asleep): skip ahead rather than blurt out a pile of notes.
    if (nextT < now - 0.05) nextT = now + 0.05;
    const hidden = typeof document !== 'undefined' && document.hidden;
    const ahead = hidden ? 1.1 : LOOKAHEAD;
    let guard = 0;
    while (nextT < now + ahead && guard++ < 64) {
      if (cutPending && step % 4 === 0) {
        // Entering or leaving the ride: end this bar early, right on the beat.
        cutPending = false;
        if (step !== 0) {
          step = 0;
          barNo++;
        }
      }
      if (step === 0) onBarStart(nextT);
      scheduleStep(step, nextT - step * stepDur());
      nextT += stepDur();
      step++;
      if (step >= 16) {
        step = 0;
        advanceBar();
      }
    }
  } catch {
    // Music is never worth a crash.
  }
}

function scheduleStep(s: number, base: number): void {
  const gr = graph;
  const b = cur;
  if (!gr || !b) return;
  const t = base + offs(s);
  if (b.lift) {
    liftStep(b, s, t);
    return;
  }
  const on = (l: Layer) => curMix[l] > 0.001 || (prevMix[l] > 0.001 && s < 4);
  const ch = chordAt(b, s);

  if (on('pad')) for (const c of b.chords) if (c.step === s) padChord(c, t, base + offs(c.step + c.len) - t);
  if (on('bass')) bassStep(b, s, t, base, ch);
  if (on('arps') && !b.tutti) arpStep(s, t, ch);
  if (on('hats') && !b.tutti) hatStep(s, t);
  drumStep(b, s, t, on('drums'));

  const n = b.at[s];
  if (n) {
    const end = base + offs(n.step + n.len);
    if (on('lead')) leadNote(n, t, end);
    if (on('counter')) counterNote(n, t, end, ch);
  }
}

/** A noise sweep: bandpass from f0 to f1 over len, swelling to vol at peak (fraction of len). */
function riser(t: number, len: number, f0: number, f1: number, vol: number, peak: number, dest: AudioNode, q = 2): void {
  const c = ctx;
  const gr = graph;
  if (!c || !gr || len <= 0.02) return;
  const src = c.createBufferSource();
  src.buffer = gr.noise;
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + len);
  const g = c.createGain();
  const tp = t + Math.max(0.005, len * peak);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(Math.max(0.0002, vol), tp);
  g.gain.exponentialRampToValueAtTime(0.0001, Math.max(tp + 0.01, t + len));
  src.connect(f).connect(g).connect(dest);
  src.onended = () => {
    src.disconnect();
    f.disconnect();
    g.disconnect();
  };
  src.start(t, Math.random() * 0.5);
  src.stop(Math.max(tp + 0.01, t + len) + 0.02);
}

/** The lift hill: chain clacks, a chromatic climb from tonic to dominant, a snare roll into the drop. */
function liftStep(b: Bar, s: number, t: number): void {
  const gr = graph;
  if (!gr) return;
  const d = song.def;
  const sd = stepDur();
  const pos = (b.sectionStart ? 0 : 16) + s; // 0..31 across the two bars
  if (pos === 0) riser(t, sd * 32, 300, 6500, 0.05, 0.97, gr.bus.drums, 1.5);
  noiseHit(t, 0.018, s % 4 === 0 ? 0.07 : 0.04, 'bandpass', 3200, gr.bus.drums, 5);
  const semi = Math.floor(pos / 4);
  if (s % 2 === 0) {
    const m = placeIn(d.key, 60) + semi + shift;
    tone({ t, dur: sd * 1.6, midi: m, wave: 'p25', vol: 0.035 + (0.02 * pos) / 32, dest: gr.bus.arps, s: 0.5, r: 0.03 });
    tone({ t, dur: sd, midi: m + 12, wave: 'p12', vol: 0.02, dest: gr.bus.arps, s: 0.3 });
    tone({ t, dur: sd * 1.7, midi: placeIn(d.key, 40) + semi + shift, wave: 'triangle', vol: 0.3, dest: gr.bus.bass, s: 0.7 });
  }
  const dr = gr.bus.drums;
  if (pos < 16) {
    if (s % 4 === 0) kick(t, 0.3, dr);
    if (s === 4 || s === 12) snare(t, 0.12, dr);
  } else if (s < 12) {
    if (s % 2 === 0) kick(t, 0.32, dr);
    snare(t, 0.05 + (0.1 * s) / 12, dr);
  } else {
    snare(t, 0.12 + 0.03 * (s - 12), dr);
    snare(t + sd / 2, 0.13 + 0.03 * (s - 12), dr);
  }
}

function padChord(c: Chord, t: number, len: number): void {
  const gr = graph;
  if (!gr) return;
  const root = placeIn(song.def.key + c.root, 52) + shift;
  for (const x of c.tones.slice(0, 3)) {
    tone({
      t,
      dur: len,
      midi: root + x,
      wave: 'triangle',
      wave2: 'triangle',
      cents2: 9,
      vol: 0.026,
      dest: gr.bus.pad,
      a: Math.min(0.25, len * 0.3),
      s: 0.8,
      r: 0.35,
    });
  }
}

function bassStep(b: Bar, s: number, t: number, base: number, ch: Chord): void {
  const gr = graph;
  if (!gr) return;
  const root = placeIn(song.def.key + ch.root, 40) + shift;
  if (b.tutti) {
    const n = b.at[s];
    if (n) tone({ t, dur: (base + offs(s + n.len) - t) * 0.8, midi: root, wave: 'triangle', vol: 0.32, dest: gr.bus.bass, s: 0.6 });
    return;
  }
  const pat = curLevel === 0 ? song.bass.calm : curLevel >= 3 ? song.bass.busy : song.bass.groove;
  const tok = pat[s];
  if (!tok) return;
  let midi = root;
  switch (tok.kind) {
    case '3':
      midi = root + ch.tones[1];
      break;
    case '5':
      midi = root + ch.tones[2];
      break;
    case '7':
      midi = root + (ch.tones[3] ?? 10);
      break;
    case '8':
      midi = root + 12;
      break;
    case 'a': {
      const next = chordAfter(b, s + tok.len);
      const nr = placeIn(song.def.key + next.root, 40) + shift;
      midi = nr === root ? root + 7 : nr - 1;
      break;
    }
  }
  const dur = (base + offs(s + tok.len) - t) * 0.85;
  tone({ t, dur, midi, wave: 'triangle', vol: 0.3, dest: gr.bus.bass, a: 0.004, s: 0.7, r: 0.03 });
}

function arpStep(s: number, t: number, ch: Chord): void {
  const gr = graph;
  if (!gr) return;
  const d = song.def;
  const mask = curLevel >= 3 ? d.arp.busy : d.arp.mask;
  if (mask[s] !== 'x') return;
  const root = placeIn(d.key + ch.root, 60) + shift;
  const tones = ch.tones.map((x) => root + x);
  if (tones.length < 4) tones.push(root + 12);
  // Up on the first pass, up-and-down on repeats; the odd bar runs downward.
  const seq = loops % 2 === 1 ? [0, 1, 2, 3, 2, 1] : [0, 1, 2, 3];
  const down = hash(barNo, 7) > 0.75;
  const sub = stepDur() / d.arp.rate;
  for (let k = 0; k < d.arp.rate; k++) {
    let i = seq[arpN++ % seq.length];
    if (down) i = 3 - i;
    tone({
      t: t + k * sub,
      dur: sub * 0.8,
      midi: tones[i],
      wave: d.arp.wave,
      vol: d.arp.wave === 'organ' ? 0.05 : 0.045,
      dest: gr.bus.arps,
      a: 0.002,
      s: 0.35,
      r: 0.02,
    });
  }
}

function hatStep(s: number, t: number): void {
  const gr = graph;
  if (!gr) return;
  const d = song.def.drums;
  const pat = curLevel === 0 ? d.soft : curLevel >= 3 ? d.hatBusy : d.hat;
  let c = pat[s];
  if (c === '.' && curLevel >= 3 && hash(barNo, s) > 0.88) c = 'g';
  if (c === 'x') hat(t, 0.06, false, gr.bus.hats);
  else if (c === 'X') hat(t, 0.08, false, gr.bus.hats);
  else if (c === 'g') hat(t, 0.03, false, gr.bus.hats);
  else if (c === 'o') hat(t, 0.05, true, gr.bus.hats);
}

function drumStep(b: Bar, s: number, t: number, drumsOn: boolean): void {
  const gr = graph;
  if (!gr) return;
  const d = song.def.drums;
  const comboFill = fillBar === barNo && s >= fillFrom;
  if (comboFill) {
    // Combo fills play even when the drum layer is closed.
    fillStep(s, t, true, drumsOn ? gr.bus.drums : gr.sting);
    return;
  }
  if (!drumsOn) return;
  const dest = gr.bus.drums;
  if (s === 0 && (crashBar === barNo || (b.sectionStart && curLevel >= 2 && !b.tutti))) crash(t, 0.07, dest);
  if (b.tutti) {
    const n = b.at[s];
    if (n) {
      kick(t, 0.42, dest);
      snare(t, 0.15, dest);
      if (b.sectionEnd && n === b.notes[b.notes.length - 1]) crash(t, 0.09, dest);
    }
    return;
  }
  if (b.sectionEnd && s >= 12) {
    fillStep(s, t, false, dest);
    return;
  }
  const busy = curLevel >= 3;
  const k = (busy ? d.kickBusy : d.kick)[s];
  if (k === 'x' || k === 'X') kick(t, k === 'X' ? 0.46 : 0.4, dest);
  else if (busy && s === 14 && hash(barNo, 99) > 0.55) kick(t, 0.3, dest);
  const sn = (busy ? d.snareBusy : d.snare)[s];
  if (sn === 'x') snare(t, 0.16, dest);
  else if (sn === 'X') snare(t, 0.2, dest);
  else if (sn === 'g') snare(t, 0.05, dest);
  if (busy && d.block && d.block[s] === 'x') block(t, 84 + (hash(barNo, s) > 0.5 ? 5 : 0), 0.05, dest);
}

function fillStep(s: number, t: number, combo: boolean, dest: AudioNode): void {
  const sub = stepDur() / 2;
  const start = combo ? fillFrom : 12;
  const prog = (s - start) / Math.max(1, 16 - start);
  if (song.def.fill === 'roll' || (combo && s >= 12)) {
    // 32nd snare roll with a crescendo.
    snare(t, 0.05 + 0.12 * prog, dest);
    snare(t + sub, 0.06 + 0.12 * prog, dest);
    if (s === 15) kick(t, 0.4, dest);
    return;
  }
  const i = (s - start) % 4;
  if (i < 2) snare(t, 0.13 + 0.05 * prog, dest);
  else tom(t, i === 2 ? 55 : 48, 0.3, dest);
  if (combo && s % 2 === 0) kick(t, 0.32, dest);
}

function leadNote(n: MelNote, t: number, end: number): void {
  const gr = graph;
  if (!gr) return;
  const d = song.def;
  const midi = d.key + degSemi(d.scale, n.di, n.acc) + shift;
  const dur = Math.max(0.04, end - t - (n.pick ? stepDur() * 0.3 : 0.015));
  const dest = gr.bus.lead;
  const long = n.len >= 4;
  switch (d.lead) {
    case 'pulse':
      tone({
        t,
        dur,
        midi,
        wave: loops % 2 === 1 ? 'p12' : 'p25',
        wave2: 'p25',
        cents2: 8,
        mix2: 0.5,
        vol: 0.075,
        dest,
        s: 0.55,
        r: 0.05,
        vib: long ? 18 : 0,
        vibRate: 5.5,
        vibDelay: 0.14,
      });
      break;
    case 'surf':
      tone({
        t,
        dur,
        midi,
        wave: 'p12',
        wave2: 'p25',
        cents2: -7,
        mix2: 0.6,
        vol: n.pick ? 0.07 : 0.08,
        dest,
        s: n.pick ? 0.4 : 0.55,
        r: n.pick ? 0.02 : 0.06,
        trem: n.pick ? 0 : 0.5,
        tremRate: 1 / stepDur(),
        vib: long && !n.pick ? 12 : 0,
        vibDelay: 0.2,
      });
      break;
    case 'theremin': {
      const glideIn = lastLead.midi >= 0 && t - lastLead.end < 0.3;
      tone({
        t,
        dur,
        midi,
        from: glideIn ? lastLead.midi : undefined,
        glide: 0.08,
        wave: 'sine',
        wave2: 'sine',
        cents2: 1200,
        mix2: 0.18,
        vol: 0.17,
        dest,
        a: 0.03,
        s: 0.85,
        r: 0.12,
        vib: 30,
        vibRate: 5.8,
        vibDelay: 0.04,
      });
      break;
    }
    case 'brass': {
      const brass = (m: number, v: number) =>
        tone({
          t,
          dur,
          midi: m,
          from: m - 1,
          glide: 0.04,
          wave: 'square',
          wave2: 'p25',
          cents2: 6,
          mix2: 0.6,
          vol: v,
          dest,
          a: 0.012,
          s: 0.7,
          r: 0.06,
          lp: [700, 3800, 1700],
          q: 2,
          vib: long ? 14 : 0,
          vibDelay: 0.18,
        });
      brass(midi, 0.06);
      brass(d.key + degSemi(d.scale, n.di - 2, 0) + shift, 0.04); // a third below
      break;
    }
  }
  lastLead = { midi, end: t + dur };
}

function counterNote(n: MelNote, t: number, end: number, ch: Chord): void {
  const gr = graph;
  if (!gr) return;
  const d = song.def;
  const m = d.key + degSemi(d.scale, n.di, n.acc) + shift;
  const dur = Math.max(0.04, end - t - 0.02);
  const dest = gr.bus.counter;
  if (d.lead === 'brass') {
    // The whole band doubles the tune an octave down.
    tone({ t, dur, midi: m - 12, wave: 'triangle', vol: 0.1, dest, s: 0.7, r: 0.06 });
    return;
  }
  // The nearest chord tone a 3rd to a 6th below the melody.
  const pcs = ch.tones.map((x) => mod(d.key + ch.root + x + shift, 12));
  for (let p = m - 3; p >= m - 9; p--) {
    if (pcs.includes(mod(p, 12))) {
      tone({
        t,
        dur,
        midi: p,
        wave: d.lead === 'theremin' ? 'organ' : 'p12',
        vol: d.lead === 'theremin' ? 0.05 : 0.04,
        dest,
        s: 0.6,
        r: 0.05,
      });
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Combos and stingers
// ---------------------------------------------------------------------------

function duck(t: number, depth: number, len: number): void {
  if (!graph) return;
  const g = graph.duck.gain;
  g.cancelScheduledValues(t);
  g.setTargetAtTime(depth, t, 0.03);
  g.setTargetAtTime(1, t + len, 0.3);
}

/** Time of the next beat that hasn't been booked yet. */
function nextBeat(): { t: number; s: number } {
  const s = step === 0 ? 0 : Math.ceil(step / 4) * 4;
  return { t: nextT + (s - step) * stepDur(), s };
}

function sparkle(n: number): void {
  const gr = graph;
  if (!gr || !cur) return;
  const { t, s } = nextBeat();
  const ch = chordAt(cur, Math.min(s, 15));
  const root = placeIn(song.def.key + ch.root + shift, 67);
  const count = Math.min(4 + n, 12);
  const sub = stepDur() / 2;
  const L = ch.tones.length;
  for (let i = 0; i < count; i++) {
    const midi = root + ch.tones[i % L] + 12 * Math.floor(i / L);
    const last = i === count - 1;
    tone({
      t: t + i * sub,
      dur: last ? 0.3 : sub * 0.9,
      midi,
      wave: 'p12',
      vol: 0.04,
      dest: gr.sting,
      s: last ? 0.3 : 0.5,
      r: last ? 0.15 : 0.02,
      vib: last ? 20 : 0,
      vibDelay: 0.05,
    });
    if (i % 2 === 0) tone({ t: t + i * sub, dur: sub * 1.6, midi: midi - 12, wave: 'triangle', vol: 0.05, dest: gr.sting, s: 0.4 });
  }
}

function chordHit(t: number, root: number, tones: number[], dur: number, vol: number, dest: AudioNode, wave: Wave = 'square', lp: [number, number, number] = [1200, 5000, 2200]): void {
  for (const x of tones) {
    tone({
      t,
      dur,
      midi: root + x,
      wave,
      wave2: 'p25',
      cents2: 9,
      mix2: 0.6,
      vol,
      dest,
      a: 0.006,
      s: 0.7,
      r: 0.12,
      lp,
      vib: dur > 0.3 ? 18 : 0,
      vibDelay: 0.12,
      vibRate: 6,
    });
  }
}

function stingTarget(t: number, dest: AudioNode): void {
  const k = placeIn(song.def.key + shift, 60);
  [0, 4, 7, 12, 16, 19, 24].forEach((x, i) => {
    tone({ t: t + i * 0.055, dur: 0.09, midi: k + x, wave: 'p25', vol: 0.05, dest, s: 0.4, r: 0.05 });
    tone({ t: t + i * 0.055, dur: 0.1, midi: k + x - 12, wave: 'triangle', vol: 0.07, dest, s: 0.4 });
  });
  // Ta-ta-DAAA: bVI, bVII, I.
  chordHit(t + 0.42, k - 4, [0, 4, 7, 12], 0.1, 0.028, dest);
  chordHit(t + 0.56, k - 2, [0, 4, 7, 12], 0.1, 0.028, dest);
  chordHit(t + 0.7, k, [0, 4, 7, 12], 0.85, 0.032, dest);
  tone({ t: t + 0.42, dur: 0.1, midi: k - 16, wave: 'triangle', vol: 0.25, dest });
  tone({ t: t + 0.56, dur: 0.1, midi: k - 14, wave: 'triangle', vol: 0.25, dest });
  tone({ t: t + 0.7, dur: 0.8, midi: k - 12, wave: 'triangle', vol: 0.28, dest, s: 0.5 });
  kick(t + 0.7, 0.4, dest);
  crash(t + 0.7, 0.09, dest);
  duck(t, 0.5, 1.5);
}

function stingBoss(t: number, dest: AudioNode): void {
  const k = placeIn(song.def.key + shift, 48);
  // dun... DUNNN: a bII stab falling onto a big minor chord.
  chordHit(t, k + 1, [0, 4, 7, 12], 0.16, 0.03, dest);
  tone({ t, dur: 0.16, midi: k + 1 - 12, wave: 'triangle', vol: 0.3, dest });
  kick(t, 0.4, dest);
  const t2 = t + 0.3;
  chordHit(t2, k, [0, 7, 12, 15, 19], 1.0, 0.026, dest, 'sawtooth', [2400, 6000, 700]);
  tone({ t: t2, dur: 1.1, midi: k - 12, wave: 'triangle', vol: 0.35, dest, s: 0.4 });
  kick(t2, 0.5, dest);
  crash(t2, 0.12, dest);
  snare(t2, 0.18, dest);
  duck(t, 0.4, 1.4);
}

function stingPuke(t: number, dest: AudioNode): void {
  const k = placeIn(song.def.key + shift, 40) + 12;
  // A drunken chromatic slide down, then one big wobbly blarp.
  [7, 6, 5, 4].forEach((x, i) =>
    tone({ t: t + i * 0.09, dur: 0.07, midi: k + x, wave: 'p25', vol: 0.07, dest, lp: [500, 2200, 600], q: 6, s: 0.5, r: 0.03 }),
  );
  tone({
    t: t + 0.36,
    dur: 0.5,
    midi: k,
    bend: k - 12,
    wave: 'p25',
    wave2: 'triangle',
    cents2: -1200,
    mix2: 0.8,
    vol: 0.08,
    dest,
    lp: [400, 2500, 300],
    q: 8,
    s: 0.5,
    r: 0.08,
    vib: 60,
    vibRate: 9,
    vibDelay: 0.05,
  });
  duck(t, 0.55, 0.9);
}

function stingLose(t: number, dest: AudioNode): void {
  const k = placeIn(song.def.key + shift - 5, 50);
  // Wah, wah, wah, wahhhhh.
  const lens = [0.36, 0.36, 0.36, 1.3];
  let tt = t;
  [3, 2, 1, 0].forEach((x, i) => {
    const last = i === 3;
    tone({
      t: tt,
      dur: lens[i],
      midi: k + x,
      bend: last ? k - 0.6 : undefined,
      wave: 'square',
      wave2: 'p25',
      cents2: 7,
      mix2: 0.7,
      vol: 0.05,
      dest,
      a: 0.03,
      s: 0.8,
      r: 0.1,
      lp: [300, 1600, 450],
      q: 4,
      vib: last ? 45 : 0,
      vibRate: 6.5,
      vibDelay: 0.25,
    });
    tt += lens[i] + 0.06;
  });
  duck(t, 0.25, 2.8);
}

// ---------------------------------------------------------------------------
// Start / stop
// ---------------------------------------------------------------------------

function run(): void {
  const c = sharedAudio();
  if (!c) return;
  ctx = c;
  if (!graph) graph = buildGraph(c);
  if (timer !== undefined) return;
  const now = c.currentTime;
  const g = graph.master.gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.setTargetAtTime(volume * MASTER_SCALE, now, 0.08);
  graph.duck.gain.cancelScheduledValues(now);
  graph.duck.gain.setValueAtTime(1, now);
  setEcho(now);
  graph.filter.frequency.cancelScheduledValues(now);
  graph.filter.frequency.setValueAtTime(slow ? SLOW_CUTOFF : graph.maxCutoff, now);
  step = 0;
  nextT = now + 0.08;
  curMix = SILENT;
  timer = setInterval(tick, TICK_MS);
  tick();
}

function halt(): void {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
  if (!ctx || !graph) return;
  const now = ctx.currentTime;
  const g = graph.master.gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.setTargetAtTime(0, now, 0.03);
}

function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    // Music is never worth a crash.
  }
}

export const music = {
  /** Call from a key press or tap. Safe to call again and again. */
  start(): void {
    safe(() => {
      started = true;
      if (!muted) run();
    });
  },

  /** Switch song; the change lands on the next bar line. */
  setPark(id: ParkId): void {
    safe(() => {
      if (!SONGS[id]) return;
      park = id;
      const target = mode === 'ride' ? RIDE_SONGS[id] : SONGS[id];
      if (!running()) {
        song = target;
        pending = null;
        queue = [];
        barIdx = 0;
        loops = 0;
        return;
      }
      pending = target === song ? null : target;
    });
  },

  /**
   * menu/map gentle, build groove. ride cuts to the ride theme on the next beat
   * (lift hill, then the drop); results ends a ride with a cadence hit, then an outro vamp.
   */
  setMode(m: MusicMode): void {
    safe(() => {
      if (m === mode) return;
      const prev = mode;
      mode = m;
      const ride = RIDE_SONGS[park];
      const home = SONGS[park];
      if (!running()) {
        queue = [];
        pending = null;
        song = m === 'ride' ? ride : home;
        barIdx = 0;
        loops = 0;
        return;
      }
      if (m === 'ride') {
        queue = ride.lift.map((bar) => ({ song: ride, bar }));
        pending = null;
        cutPending = true;
      } else if (prev === 'ride') {
        if (m === 'results') {
          queue = [{ song: ride, bar: ride.ending }, ...home.vamp.map((bar) => ({ song: home, bar }))];
          pending = null;
          cutPending = true;
        } else {
          queue = [];
          pending = home;
          cutPending = false;
        }
      } else if (m === 'results') {
        queue = home.vamp.map((bar) => ({ song: home, bar }));
      } else {
        queue = [];
        if (song !== home) pending = home;
      }
    });
  },

  /** A quick whoosh on the next beat for big drops and inversions (ride only, subtle). */
  rideEvent(kind: 'drop' | 'loop'): void {
    safe(() => {
      if (!running() || !ctx || !graph) return;
      const now = ctx.currentTime;
      const beat = stepDur() * 4;
      let t = nextBeat().t;
      if (t - now < 0.15) t += beat;
      const pre = Math.min(t - now - 0.01, beat);
      const dest = graph.sting;
      if (kind === 'drop') {
        riser(t - pre, pre + 0.05, 700, 5000, 0.03, 0.95, dest);
        riser(t, beat * 1.5, 5000, 250, 0.028, 0.03, dest);
        tone({ t, dur: 0.25, midi: 40, bend: 28, wave: 'sine', vol: 0.18, dest, s: 0.3, sagged: false });
      } else {
        riser(t - pre, pre + 0.05, 400, 2500, 0.022, 0.95, dest);
        riser(t, beat * 2, 2500, 400, 0.022, 0.4, dest);
        const k = placeIn(song.def.key + shift, 72);
        tone({ t, dur: beat * 2, midi: k, bend: k + 12, wave: 'sine', vol: 0.03, dest, a: 0.1, s: 0.5, r: 0.2, vib: 25, vibRate: 6 });
      }
    });
  },

  /** A chain reaction of n merges: lifts the band for a few bars; big ones get a fill and a key lift. */
  combo(n: number): void {
    safe(() => {
      if (!running() || !cur) return;
      const k = Math.max(1, Math.floor(Number.isFinite(n) ? n : 1));
      const nb = step === 0 ? barNo : barNo + 1;
      const lift = k >= 6 ? 2 : 1;
      const bars = k >= 6 ? 4 : k >= 3 ? 3 : 2;
      boost = barNo < boostUntil ? Math.max(boost, lift) : lift;
      boostUntil = Math.max(boostUntil, nb + bars);
      if (k >= 3) sparkle(k);
      if (k >= 6) {
        if (step === 0) {
          fillBar = barNo;
          fillFrom = 12;
        } else {
          fillBar = barNo;
          fillFrom = step <= 8 ? 8 : step;
        }
        liftFrom = fillBar + 1;
        liftUntil = liftFrom + 2;
        crashBar = liftFrom;
      }
    });
  },

  /** Slow-motion camera: lowpass down to ~600 Hz and a slight tape sag. */
  slowmo(on: boolean): void {
    safe(() => {
      if (on === slow) return;
      slow = on;
      sag = on ? SAG_CENTS : 0;
      if (!ctx || !graph) return;
      const now = ctx.currentTime;
      const f = graph.filter.frequency;
      f.cancelScheduledValues(now);
      f.setValueAtTime(Math.max(40, f.value), now);
      f.exponentialRampToValueAtTime(on ? SLOW_CUTOFF : graph.maxCutoff, now + (on ? 0.6 : 0.35));
      graph.filter.Q.setTargetAtTime(on ? 2.5 : 0.7, now, 0.15);
      for (const [o, cents] of live) {
        o.detune.cancelScheduledValues(now);
        o.detune.setTargetAtTime(sag + cents, now, on ? 0.18 : 0.08);
      }
    });
  },

  /** A short musical sting on top of the song. */
  stinger(kind: StingerKind): void {
    safe(() => {
      if (!running() || !ctx || !graph) return;
      const t = Math.max(ctx.currentTime + 0.01, Math.min(nextT, ctx.currentTime + 0.2));
      const dest = graph.sting;
      if (kind === 'target') stingTarget(t, dest);
      else if (kind === 'boss') stingBoss(t, dest);
      else if (kind === 'puke') stingPuke(t, dest);
      else if (kind === 'lose') stingLose(t, dest);
    });
  },

  setMuted(m: boolean): void {
    safe(() => {
      muted = m;
      try {
        localStorage.setItem(MUTE_KEY, m ? '1' : '0');
      } catch {
        // Preference just won't persist.
      }
      if (m) halt();
      else if (started) run();
    });
  },

  isMuted(): boolean {
    return muted;
  },

  /** 0..1, default 0.55. */
  setVolume(v: number): void {
    safe(() => {
      volume = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.55));
      if (!running() || !ctx || !graph) return;
      const now = ctx.currentTime;
      const g = graph.master.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.setTargetAtTime(volume * MASTER_SCALE, now, 0.05);
    });
  },
};
