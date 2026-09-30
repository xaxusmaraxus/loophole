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
