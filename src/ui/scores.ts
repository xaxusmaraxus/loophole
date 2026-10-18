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
  return snap.docs.filter((d) => Number(d.data()?.best) > 0).map((d) => {
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
    // Keep the Daily Ride fields that share this document.
    await ref.set({ ...(cur.exists ? cur.data() : {}), name, best: e.score, park: e.park, day: e.day, pukes: e.pukes, at: e.at });
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

// ---- The Daily Ride ------------------------------------------------------------------
// Each player's latest daily score sits on their own scores document as one sortable
// number: the Daily's number × DAILY_SPAN + score. Sorting by it puts today's rides
// first (best first), so one query reads today's board.

const DAILY_SPAN = 1e11;
const dailyKeyLocal = (date: string) => `loophole.daily.${date}`;

export interface DailyLocal {
  /** The first (official) score today; later runs are practice. */
  official: number | null;
  best: number;
  grade: string;
  tries: number;
}

export function dailyLocal(date: string): DailyLocal {
  return read<DailyLocal>(dailyKeyLocal(date), { official: null, best: 0, grade: '', tries: 0 });
}

/** Records a Daily Ride on this device; returns the updated entry. The first run of the day is the official one. */
export function recordDaily(date: string, score: number, grade: string): DailyLocal {
  const d = dailyLocal(date);
  const first = d.official === null;
  const next: DailyLocal = { official: first ? score : d.official, best: Math.max(d.best, score), grade: first ? grade : d.grade, tries: d.tries + 1 };
  write(dailyKeyLocal(date), next);
  return next;
}

export interface DailyRow {
  name: string;
  score: number;
  grade: string;
  mine: boolean;
}

/** Today's shared board, or null when there's none here. */
export async function dailyScores(num: number): Promise<DailyRow[] | null> {
  const s = await shared();
  if (!s) return null;
  try {
    const snap = await s.db.collection('scores').orderBy('daily', 'desc').limit(40).get();
    return snap.docs
      .map((d) => ({ d, v: d.data() ?? {} }))
      .filter(({ v }) => Math.floor(Number(v.daily) / DAILY_SPAN) === num)
      .map(({ d, v }) => ({ name: String(v.name ?? '') || 'Anonymous', score: Number(v.daily) % DAILY_SPAN, grade: String(v.dailyGrade ?? ''), mine: d.id === s.me }));
  } catch {
    return null;
  }
}

/** Posts today's official Daily Ride score (once). */
export async function postDaily(num: number, score: number, grade: string, name: string): Promise<'posted' | 'unavailable' | 'denied'> {
  const s = await shared();
  if (!s || !s.me) return 'unavailable';
  const ref = s.db.doc(`scores/${s.me}`);
  try {
    const cur = await ref.get();
    const data = cur.exists ? cur.data() ?? {} : {};
    // Only the first ride of the day counts.
    if (Math.floor(Number(data.daily) / DAILY_SPAN) === num) return 'posted';
    await ref.set({ best: 0, ...data, name: cleanName(name) || String(data.name ?? '') || 'Anonymous', daily: num * DAILY_SPAN + Math.min(Math.round(score), DAILY_SPAN - 1), dailyGrade: grade });
    return 'posted';
  } catch (err) {
    const code = (err as { code?: string }).code;
    return code === 'not_granted' || code === 'permission_denied' ? 'denied' : 'unavailable';
  }
}
