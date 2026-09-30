// Tiny synth sound effects (WebAudio). No audio files. The context is created
// lazily on the first sound, which always follows a key press or tap.
const MUTE_KEY = 'loophole.muted';
let ac: AudioContext | null = null;
let muted = loadMuted();

function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function audio(): AudioContext | null {
  if (muted) return null;
  if (!ac) {
    try {
      ac = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ac.state === 'suspended') void ac.resume();
  return ac;
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, when = 0, slideTo?: number): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + when;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

let noiseBuf: AudioBuffer | null = null;

/** A burst of filtered white noise, for splats and impacts. */
function noise(dur: number, vol: number, when = 0, from = 2000, to = 200, q = 1): void {
  const a = audio();
  if (!a) return;
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = a.currentTime + when;
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

/** A semitone ladder for the scoring show: every event of a ride climbs one step (capped). */
const semi = (base: number, n: number) => base * 2 ** (Math.min(n, 30) / 12);

// Major pentatonic steps: combos climb this ladder so a long chain sings upward.
const LADDER = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28];
const note = (n: number) => 392 * 2 ** (LADDER[Math.min(n, LADDER.length - 1)] / 12);

export const sfx = {
  lay: () => tone(140, 0.09, 'square', 0.035, 0, 80),
  blocked: () => tone(95, 0.12, 'sawtooth', 0.03),
  /** n = how many merges so far this swipe (1-based). */
  merge: (n: number) => {
    tone(note(n), 0.12, 'triangle', 0.09);
    tone(note(n) * 2, 0.08, 'square', 0.02, 0.02);
  },
  chain: (n: number) => {
    tone(note(n + 2), 0.16, 'triangle', 0.1);
    tone(note(n + 4), 0.18, 'triangle', 0.07, 0.06);
  },
  hype: () => tone(660, 0.1, 'square', 0.03, 0, 990),
  open: () => [0, 2, 4, 5].forEach((n, i) => tone(note(n + 3), 0.14, 'square', 0.04, i * 0.09)),
  scream: () => tone(700 + Math.random() * 300, 0.25, 'sawtooth', 0.015, 0, 1400),
  happy: (i: number) => tone(note(5 + (i % 4)), 0.12, 'triangle', 0.06),
  sick: () => tone(300, 0.35, 'sawtooth', 0.03, 0, 90),
  meh: () => tone(200, 0.15, 'triangle', 0.04, 0, 170),
  // ---- The live scoring show (n = events so far this ride) ----
  /** Excitement ticks up: a bright blip. */
  chip: (n: number) => {
    tone(semi(330, n), 0.07, 'triangle', 0.08);
    tone(semi(660, n), 0.04, 'square', 0.015, 0.01);
  },
  /** Multiplier bumps: a rising zing. */
  mult: (n: number) => {
    tone(semi(440, n), 0.16, 'square', 0.035, 0, semi(880, n));
    tone(semi(660, n), 0.12, 'triangle', 0.06, 0.03);
  },
  /** ×mult: a heavy hit with a chord on top. */
  xmult: (n: number) => {
    tone(90, 0.35, 'sine', 0.3, 0, 40);
    noise(0.18, 0.12, 0, 3000, 150);
    [0, 4, 7].forEach((k, i) => tone(semi(220, n + k), 0.3, 'sawtooth', 0.03, 0.02 + i * 0.01));
  },
  /** An attraction card fires: a quick ding. */
  card: (n: number) => {
    tone(semi(523, n), 0.1, 'square', 0.03);
    tone(semi(784, n), 0.14, 'triangle', 0.06, 0.05);
  },
  /** Someone pukes: a wet squelch with a falling pitch, plus a coin blip for the payout. */
  puke: (n: number) => {
    noise(0.28, 0.16, 0, 1400, 180, 6);
    tone(260 + Math.random() * 40, 0.3, 'sawtooth', 0.05, 0, 70);
    tone(semi(523, n), 0.08, 'triangle', 0.06, 0.12);
    tone(semi(784, n), 0.1, 'triangle', 0.04, 0.17);
  },
  /** A boss loses their lunch: a big crunchy impact. */
  bossPuke: () => {
    tone(70, 0.8, 'sine', 0.4, 0, 28);
    tone(140, 0.6, 'square', 0.08, 0, 35);
    noise(0.9, 0.3, 0, 2400, 60, 3);
    noise(0.4, 0.2, 0.25, 900, 100, 8);
    tone(220, 0.7, 'sawtooth', 0.06, 0.1, 55);
  },
  /** The day's target is reached: a fanfare arpeggio. */
  target: () => {
    [0, 4, 7, 12, 16, 19, 24].forEach((k, i) => {
      tone(523 * 2 ** (k / 12), 0.2, 'square', 0.035, i * 0.07);
      tone(523 * 2 ** (k / 12), 0.26, 'triangle', 0.07, i * 0.07);
    });
    tone(1047, 0.7, 'triangle', 0.08, 0.5);
    tone(1319, 0.7, 'triangle', 0.06, 0.5);
  },
  /** Chips × mult slam into the total. */
  slam: () => {
    tone(60, 0.7, 'sine', 0.45, 0, 30);
    noise(0.5, 0.3, 0, 5000, 80, 1);
    [0, 7, 12, 16].forEach((k) => tone(262 * 2 ** (k / 12), 0.9, 'sawtooth', 0.025, 0.03));
    [0, 4, 7, 12].forEach((k, i) => tone(523 * 2 ** (k / 12), 0.25, 'triangle', 0.06, 0.25 + i * 0.06));
  },
  /** A firework rocket goes up: a thin rising whistle. */
  whistle: () => tone(900 + Math.random() * 200, 0.6, 'sine', 0.018, 0, 2200),
  /** ...and bursts: a soft crackling pop. */
  pop: () => {
    noise(0.35, 0.12, 0, 2600, 400, 2);
    tone(120, 0.25, 'sine', 0.12, 0, 50);
  },
  /** The total rolls: a soft register click (throttled by the caller). */
  roll: (n: number) => tone(semi(880, n), 0.025, 'square', 0.012),
  isMuted: () => muted,
  setMuted(m: boolean) {
    muted = m;
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {
      // Preference just won't persist.
    }
  },
};
