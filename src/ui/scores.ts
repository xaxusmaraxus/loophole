// Highscores: the best rides (tickets sold in one ride). Every result is kept on
// this device; a shared board holds each player's best when the page runs
// inside claude.ai with the `db` capability (anywhere else it's device-only).

export interface ScoreEntry {
  name: string;
  score: number;
  park: string;
  day: number;
  pukes: number;
  at: number;
}

const LOCAL_KEY = 'loophole.scores';
const NAME_KEY = 'loophole.name';
const KEEP = 10;

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode: the board just won't remember */
  }
}

export function playerName(): string {
  return read<string>(NAME_KEY, '');
}

export function setPlayerName(n: string): void {
  write(NAME_KEY, cleanName(n));
}

export function cleanName(n: string): string {
  return n.replace(/\s+/g, ' ').trim().slice(0, 18);
}

export function localScores(): ScoreEntry[] {
  const list = read<ScoreEntry[]>(LOCAL_KEY, []);
  return Array.isArray(list) ? list.filter((e) => typeof e?.score === 'number') : [];
}

/** Keeps a ride on this device's board. Returns its rank (1-based) or 0 if it didn't make it. */
export function recordLocal(e: ScoreEntry): number {
  const list = localScores();
  const best = list[0]?.score ?? 0;
  list.push(e);
  list.sort((a, b) => b.score - a.score);
  const kept = list.slice(0, KEEP);
  write(LOCAL_KEY, kept);
  lastRecord = { entry: e, personalBest: e.score > best, rank: kept.indexOf(e) + 1 };
  return lastRecord.rank;
}

/** The ride just recorded, for the results card. */
export let lastRecord: { entry: ScoreEntry; personalBest: boolean; rank: number } | null = null;

// ---- The shared board ----------------------------------------------------------------

interface Snap {
  id: string;
  data(): Record<string, unknown> | undefined;
}
interface DocRef {
  get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
  set(d: Record<string, unknown>): Promise<void>;
}
interface Db {
  doc(path: string): DocRef;
  collection(path: string): { orderBy(f: string, d: 'desc'): { limit(n: number): { get(): Promise<{ docs: Snap[] }> } } };
}
interface UserNs {
  id(): Promise<string | null>;
}
type Host = { use(name: string): Promise<unknown> };

let dbP: Promise<{ db: Db; me: string | null } | null> | null = null;

function shared(): Promise<{ db: Db; me: string | null } | null> {
  dbP ??= (async () => {
    const host = (window as unknown as { claude?: Host }).claude;
    if (!host?.use) return null;
    const db = (await host.use('db')) as Db | null;
    if (!db) return null;
    const user = (await host.use('user')) as UserNs | null;
    const me = user ? await user.id().catch(() => null) : null;
    return { db, me };
  })().catch(() => null);
  return dbP;
}

export interface BoardRow extends ScoreEntry {
  mine: boolean;
}

/** The shared top 20 (each player's best), or null when there's no shared board here. */
export async function globalScores(): Promise<BoardRow[] | null> {
  const s = await shared();
  if (!s) return null;
  const snap = await s.db.collection('scores').orderBy('best', 'desc').limit(20).get();
  return snap.docs.map((d) => {
    const v = d.data() ?? {};
    return {
      name: String(v.name ?? '') || 'Anonymous',
      score: Number(v.best) || 0,
      park: String(v.park ?? ''),
      day: Number(v.day) || 0,
      pukes: Number(v.pukes) || 0,
      at: Number(v.at) || 0,
      mine: d.id === s.me,
    };
  });
}

/** Posts a ride to the shared board if it beats this player's best there. */
export async function postScore(e: ScoreEntry): Promise<'posted' | 'kept' | 'unavailable' | 'denied'> {
  const s = await shared();
  if (!s || !s.me) return 'unavailable';
  const ref = s.db.doc(`scores/${s.me}`);
  try {
    const cur = await ref.get();
    const best = Number(cur.exists ? cur.data()?.best : 0) || 0;
    const name = cleanName(e.name) || 'Anonymous';
    if (best >= e.score) {
      // Still let a new name through.
      if (cur.exists && cur.data()?.name !== name) await ref.set({ ...cur.data(), name });
      return 'kept';
    }
    await ref.set({ name, best: e.score, park: e.park, day: e.day, pukes: e.pukes, at: e.at });
    return 'posted';
  } catch (err) {
    const code = (err as { code?: string }).code;
    return code === 'not_granted' || code === 'permission_denied' ? 'denied' : 'unavailable';
  }
}

/** Puts a name on a ride already kept on this device (they type it after the ride). */
export function nameLocal(at: number, name: string): void {
  const list = localScores();
  const e = list.find((x) => x.at === at);
  if (!e) return;
  e.name = cleanName(name);
  write(LOCAL_KEY, list);
}
