import type { Difficulty, HandSelection } from "../core/types.ts";
import { starsFor } from "./Scoring.ts";
import type { ScoreResult } from "./Scoring.ts";

/**
 * Best-score persistence in localStorage.
 *
 * Scores are kept per unique practice setup — song + difficulty + hand + section — exactly
 * as the user asked, so improving your "left hand, hard, chorus" run is tracked separately
 * from "both hands, easy, full song". The key builder is pure and unit-tested.
 */
export interface ScoreContext {
  songName: string;
  difficulty: Difficulty;
  hand: HandSelection;
  /** Section identifier, or "full" for the whole song. */
  sectionId: string;
}

const PREFIX = "piana:best:";

const DIFFICULTIES = new Set<string>(["easy", "medium", "hard"]);
const HANDS = new Set<string>(["left", "both", "right"]);

/** A best score as stored: the result plus when it was set (absent on older entries). */
export type StoredBest = ScoreResult & { savedAt?: number };

/** One stored best, with the setup it belongs to. */
export interface BestEntry {
  ctx: ScoreContext;
  result: ScoreResult;
  /** Epoch ms the score was set, or null for entries saved before this was recorded. */
  savedAt: number | null;
}

/** Every best for one song, its own runs best-first. */
export interface SongScores {
  songName: string;
  entries: BestEntry[];
  /** The highest score across all this song's setups. */
  topScore: number;
}

/** Build the stable storage key for a practice setup. */
export function scoreKey(ctx: ScoreContext): string {
  const parts = [ctx.songName, ctx.difficulty, ctx.hand, ctx.sectionId].map(encodeURIComponent);
  return PREFIX + parts.join("|");
}

/**
 * Read a storage key back into the setup that produced it, or null if it isn't one of ours.
 *
 * The inverse of {@link scoreKey}, so the scores screen can list what has been played
 * without a second index to keep in sync. Anything that doesn't decode into a valid
 * difficulty and hand is ignored rather than shown as a broken row — the app shares
 * localStorage with the preference keys, and users' storage is not ours to trust.
 */
export function parseScoreKey(key: string): ScoreContext | null {
  if (!key.startsWith(PREFIX)) return null;
  const parts = key.slice(PREFIX.length).split("|");
  if (parts.length !== 4) return null;

  try {
    const [songName, difficulty, hand, sectionId] = parts.map(decodeURIComponent);
    if (!DIFFICULTIES.has(difficulty!) || !HANDS.has(hand!)) return null;
    return {
      songName: songName!,
      difficulty: difficulty as ScoreContext["difficulty"],
      hand: hand as ScoreContext["hand"],
      sectionId: sectionId!,
    };
  } catch {
    return null; // malformed percent-encoding
  }
}

/**
 * Recompute a stored result's accuracy and stars from its own counts.
 *
 * Runs saved before accuracy counted wrong notes recorded (perfect + good) / expected
 * notes, which in wait mode is always 1 — so those bests all read 100% however many wrong
 * keys were hit. Every record keeps its raw tallies, so the honest figure can be recomputed
 * exactly rather than guessed at; applied on read, this corrects old entries and leaves new
 * ones unchanged. A record missing a tally is passed through as it is, since there is
 * nothing to recompute from.
 */
export function repairResult(stored: ScoreResult): ScoreResult {
  const counts = [stored.perfect, stored.good, stored.totalNotes, stored.wrong];
  if (counts.some((n) => typeof n !== "number")) return stored;

  const judged = stored.totalNotes + stored.wrong;
  const accuracy = judged === 0 ? 0 : (stored.perfect + stored.good) / judged;
  return { ...stored, accuracy, stars: starsFor(accuracy) };
}

/** Read the stored best score for this setup, or null. */
export function getBest(ctx: ScoreContext): ScoreResult | null {
  try {
    const raw = localStorage.getItem(scoreKey(ctx));
    return raw ? repairResult(JSON.parse(raw) as ScoreResult) : null;
  } catch {
    return null;
  }
}

/**
 * Save `result` if it beats the stored best. Returns true if it was a new best.
 */
export function saveIfBest(ctx: ScoreContext, result: ScoreResult, now = Date.now()): boolean {
  const previous = getBest(ctx);
  if (previous && previous.score >= result.score) return false;
  try {
    const stored: StoredBest = { ...result, savedAt: now };
    localStorage.setItem(scoreKey(ctx), JSON.stringify(stored));
  } catch {
    /* storage unavailable — non-fatal */
  }
  return true;
}

/** Every best score in storage, in no particular order. */
export function listBests(): BestEntry[] {
  const entries: BestEntry[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const ctx = key === null ? null : parseScoreKey(key);
      if (!key || !ctx) continue;

      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const stored = JSON.parse(raw) as StoredBest;
      if (typeof stored?.score !== "number") continue; // not a score record after all
      entries.push({ ctx, result: repairResult(stored), savedAt: stored.savedAt ?? null });
    }
  } catch {
    return entries; // storage unavailable or a corrupt record — show what we have
  }
  return entries;
}

/**
 * Group bests by song: songs by their best run first, and within a song, best run first.
 *
 * Pure so it can be unit-tested; the ordering is what makes the screen readable, and it
 * would otherwise only be checkable by eye.
 */
export function groupBySong(entries: readonly BestEntry[]): SongScores[] {
  const bySong = new Map<string, BestEntry[]>();
  for (const entry of entries) {
    const list = bySong.get(entry.ctx.songName);
    if (list) list.push(entry);
    else bySong.set(entry.ctx.songName, [entry]);
  }

  const songs: SongScores[] = [...bySong].map(([songName, list]) => ({
    songName,
    entries: [...list].sort((a, b) => b.result.score - a.result.score),
    topScore: list.reduce((max, e) => Math.max(max, e.result.score), 0),
  }));
  // Ties go alphabetical, so the list doesn't reshuffle itself between openings.
  return songs.sort((a, b) => b.topScore - a.topScore || a.songName.localeCompare(b.songName));
}

/** Delete every stored best. Returns how many were removed. */
export function clearBests(): number {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && parseScoreKey(key)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
    return keys.length;
  } catch {
    return 0;
  }
}
