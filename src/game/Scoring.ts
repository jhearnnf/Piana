import type { Difficulty, Note } from "../core/types.ts";

/**
 * Real-time scoring.
 *
 * A {@link ScoringSession} is fed the notes the player is expected to hit, then receives
 * their key presses (`registerHit`) and the advancing playhead (`update`). It judges each
 * hit as perfect / good / wrong and marks notes whose window closed as missed, keeping
 * running totals for a final {@link ScoreResult}.
 *
 * It's deliberately free of audio, canvas, and timers so it can be driven deterministically
 * from tests.
 */

export interface ScoringOptions {
  /** |timing error| ≤ this (seconds) is a "perfect" hit. */
  perfectSec: number;
  /** |timing error| ≤ this (seconds) is at least a "good" hit; beyond it there's no match. */
  goodSec: number;
  /** Point penalty for each wrong (unexpected) note. */
  wrongPenalty: number;
}

export const DEFAULT_SCORING: ScoringOptions = {
  perfectSec: 0.06,
  goodSec: 0.15,
  wrongPenalty: 20,
};

/** Score multiplier per difficulty (harder = worth more for the same accuracy). */
export const DIFFICULTY_MULTIPLIER: Record<Difficulty, number> = {
  easy: 1,
  medium: 1.25,
  hard: 1.5,
};

export type HitResult = "perfect" | "good" | "wrong";

export interface ScoreResult {
  totalNotes: number;
  perfect: number;
  good: number;
  missed: number;
  wrong: number;
  maxCombo: number;
  /** Fraction of expected notes hit (perfect or good), 0-1. */
  accuracy: number;
  /** Mean absolute timing error of hits, in milliseconds. */
  avgTimingMs: number;
  /** Final points (after difficulty multiplier and wrong-note penalty, floored at 0). */
  score: number;
  /** 0-3 star rating derived from accuracy. */
  stars: number;
}

const POINTS = { perfect: 100, good: 60 } as const;

interface Tracked {
  note: Note;
  matched: boolean;
  missed: boolean;
}

export class ScoringSession {
  private readonly tracked: Tracked[];
  private readonly opts: ScoringOptions;

  private perfect = 0;
  private good = 0;
  private missed = 0;
  private wrong = 0;
  private combo = 0;
  private maxCombo = 0;
  private timingErrorSum = 0;
  private hits = 0;
  /** Notes before this index have been resolved (matched or missed). */
  private cursor = 0;

  constructor(expected: readonly Note[], opts: ScoringOptions = DEFAULT_SCORING) {
    // Sorted by time so we can advance a cursor for miss detection.
    this.tracked = [...expected]
      .sort((a, b) => a.time - b.time)
      .map((note) => ({ note, matched: false, missed: false }));
    this.opts = opts;
  }

  /** Register a played note at `timeSec`. Returns how it was judged. */
  registerHit(midi: number, timeSec: number): HitResult {
    const best = this.findMatch(midi, timeSec);
    if (best === null) {
      this.wrong++;
      this.combo = 0;
      return "wrong";
    }

    const target = this.tracked[best]!;
    target.matched = true;
    const errorSec = Math.abs(timeSec - target.note.time);
    this.timingErrorSum += errorSec;
    this.hits++;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);

    const result: HitResult = errorSec <= this.opts.perfectSec ? "perfect" : "good";
    if (result === "perfect") this.perfect++;
    else this.good++;
    return result;
  }

  /** Advance the playhead to `nowSec`, marking notes whose window has closed as missed. */
  update(nowSec: number): void {
    const deadline = nowSec - this.opts.goodSec;
    while (this.cursor < this.tracked.length) {
      const t = this.tracked[this.cursor]!;
      if (t.note.time > deadline) break; // still within a hittable window
      if (!t.matched && !t.missed) {
        t.missed = true;
        this.missed++;
        this.combo = 0;
      }
      this.cursor++;
    }
  }

  /** Mark every remaining unhit note as missed (call when playback ends). */
  finalize(): void {
    this.update(Infinity);
  }

  /** Find the nearest unmatched expected note of this pitch within the good window. */
  private findMatch(midi: number, timeSec: number): number | null {
    let bestIndex: number | null = null;
    let bestError = this.opts.goodSec + 1e-9;
    for (let i = this.cursor; i < this.tracked.length; i++) {
      const t = this.tracked[i]!;
      if (t.note.time > timeSec + this.opts.goodSec) break; // sorted: no later note can match
      if (t.matched || t.missed || t.note.midi !== midi) continue;
      const error = Math.abs(timeSec - t.note.time);
      if (error <= bestError) {
        bestError = error;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  result(difficulty: Difficulty = "easy"): ScoreResult {
    const totalNotes = this.tracked.length;
    const rawPoints = this.perfect * POINTS.perfect + this.good * POINTS.good;
    const penalty = this.wrong * this.opts.wrongPenalty;
    const multiplier = DIFFICULTY_MULTIPLIER[difficulty];
    const score = Math.max(0, Math.round((rawPoints - penalty) * multiplier));
    const accuracy = totalNotes === 0 ? 0 : (this.perfect + this.good) / totalNotes;

    return {
      totalNotes,
      perfect: this.perfect,
      good: this.good,
      missed: this.missed,
      wrong: this.wrong,
      maxCombo: this.maxCombo,
      accuracy,
      avgTimingMs: this.hits === 0 ? 0 : (this.timingErrorSum / this.hits) * 1000,
      score,
      stars: starsFor(accuracy),
    };
  }
}

/** 0-3 stars from accuracy (0-1). */
export function starsFor(accuracy: number): number {
  if (accuracy >= 0.95) return 3;
  if (accuracy >= 0.8) return 2;
  if (accuracy >= 0.5) return 1;
  return 0;
}
