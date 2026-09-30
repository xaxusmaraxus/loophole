import type { Face } from '../render3d/models';
import type { Rider } from '../riders/riders';

// Who pulls which face. Every kind of guest has a personality in line and on the ride:
// thrill seekers smirk and then laugh through the loops, grandmas smile sweetly and then
// wail, nerds sweat, kids can't stand still.

type Mood = { line: Face; calm: Face; wild: Face };

const MOODS: Record<Rider['kind'], Mood> = {
  tourist: { line: 'smile', calm: 'grin', wild: 'scream' },
  corndog: { line: 'meh', calm: 'nervous', wild: 'scream' },
  grandma: { line: 'smile', calm: 'nervous', wild: 'terror' },
  kid: { line: 'grin', calm: 'grin', wild: 'joy' },
  thrill: { line: 'cocky', calm: 'cocky', wild: 'joy' },
  looper: { line: 'grin', calm: 'grin', wild: 'joy' },
  nerd: { line: 'nervous', calm: 'nervous', wild: 'terror' },
  influencer: { line: 'cocky', calm: 'smile', wild: 'scream' },
  ghost: { line: 'meh', calm: 'smile', wild: 'joy' },
  vip: { line: 'cocky', calm: 'cocky', wild: 'terror' },
  boss: { line: 'cocky', calm: 'cocky', wild: 'terror' },
};

/** Face in line. Anyone the ride will make puke looks a bit worried about it. */
export function lineFace(r: Rider, willPuke: boolean): Face {
  const m = MOODS[r.kind] ?? MOODS.tourist;
  if (willPuke && (m.line === 'smile' || m.line === 'grin')) return 'nervous';
  return m.line;
}

/** Face on the ride: calm on the flat bits, wild through drops and inversions. */
export function rideFace(r: Rider, wild: boolean): Face {
  const m = MOODS[r.kind] ?? MOODS.tourist;
  return wild ? m.wild : m.calm;
}

/** Laughers put their hands up; the scared hold on tight. */
export function rideArms(r: Rider, wild: boolean): number {
  const f = rideFace(r, wild);
  if (!wild) return f === 'grin' || f === 'cocky' ? 0.35 : 0.1;
  return f === 'joy' ? 1 : f === 'terror' ? 0.45 : 0.85;
}

/** Idle antics in line: [arms up 0..1, hop height, wobble]. `t` is seconds. */
export function lineAntics(r: Rider, t: number): { arms: number; hop: number; wobble: number; yaw: number } {
  const ph = t + r.id * 1.37;
  const beat = (period: number, width: number) => Math.max(0, Math.sin((ph * Math.PI * 2) / period) - (1 - width)) / width;
  switch (r.kind) {
    case 'kid':
      // Can't. Stand. Still.
      return { arms: beat(1.6, 0.4) * 0.9, hop: Math.abs(Math.sin(ph * 5)) * 0.05 * (beat(3, 0.5) > 0 ? 1 : 0), wobble: 0, yaw: 0 };
    case 'thrill':
    case 'looper':
      // Fist pumps.
      return { arms: beat(2.4, 0.25), hop: beat(2.4, 0.25) * 0.03, wobble: 0, yaw: 0 };
    case 'nerd':
      return { arms: 0, hop: 0, wobble: 0.05, yaw: Math.sin(ph * 0.9) * 0.4 };
    case 'grandma':
      return { arms: 0, hop: 0, wobble: 0.02, yaw: Math.sin(ph * 0.5) * 0.25 };
    case 'corndog':
      // A bite of corndog now and then.
      return { arms: beat(3.2, 0.3) * 0.55, hop: 0, wobble: 0, yaw: 0 };
    case 'influencer':
      // Selfie.
      return { arms: 0.25 + beat(4, 0.5) * 0.45, hop: 0, wobble: 0, yaw: Math.sin(ph * 0.6) * 0.3 };
    case 'tourist':
      return { arms: 0, hop: beat(5, 0.15) * 0.04, wobble: 0, yaw: Math.sin(ph * 0.7) * 0.6 };
    default:
      return { arms: 0, hop: beat(4.5, 0.12) * 0.035, wobble: 0, yaw: 0 };
  }
}
