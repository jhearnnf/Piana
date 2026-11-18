import type { Difficulty, HandSelection } from "../core/types.ts";
import type { TimeRange } from "./practice.ts";
import { parseLoopSectionId } from "../song/loopRegion.ts";
import type { Attempt } from "./practiceLog.ts";

/**
 * How the playing of one saved loop has gone, lap by lap.
 *
 * The practice log keeps every lap; this is the slice of it a progress screen draws: the
 * laps of one loop, split by the setup they were played under, with a smoothed line through
 * them and the two ends of the trend to compare. Pure, so what the chart claims is
 * unit-tested rather than eyeballed.
 */

/**
 * How far a lap's recorded range may sit from the loop's and still be a lap of it, in
 * seconds.
 *
 * A lap is filed under the range that was playing, rounded to hundredths, and that range
 * need not be the saved loop's to the digit: a stretch played before it was saved, or one
 * whose marks settled a few hundredths differently, is still the same bars. A tenth of a
 * second is far below the gap between two loops anyone would mean as different, and real
 * laps have been seen three hundredths off the loop they were laps of.
 */
const SAME_RANGE_TOLERANCE = 0.1;

/** How many laps the smoothed line, and each end of the trend, are averaged over. */
export const TREND_WINDOW = 5;

/** The laps of one loop under one difficulty and hand, oldest first. */
export interface ProgressSetup {
  difficulty: Difficulty;
  hand: HandSelection;
  laps: Attempt[];
}

/** Whether an attempt was a lap of the stretch `range`. */
export function isLapOf(attempt: Attempt, range: TimeRange): boolean {
  const lapRange = parseLoopSectionId(attempt.sectionId);
  return (
    lapRange !== null &&
    Math.abs(lapRange.start - range.start) <= SAME_RANGE_TOLERANCE &&
    Math.abs(lapRange.end - range.end) <= SAME_RANGE_TOLERANCE
  );
}

/**
 * Every lap of the loop at `range`, one group per difficulty and hand, most recently
 * practised first.
 *
 * Split by setup for the same reason the scores are: your left hand at Easy and both hands
 * at Hard averaged together is a line that wanders for reasons that have nothing to do with
 * how you are getting on.
 */
export function loopProgress(log: readonly Attempt[], range: TimeRange): ProgressSetup[] {
  const bySetup = new Map<string, ProgressSetup>();
  for (const attempt of log) {
    if (!isLapOf(attempt, range)) continue;
    const key = `${attempt.difficulty}|${attempt.hand}`;
    const setup = bySetup.get(key);
    if (setup) setup.laps.push(attempt);
    else bySetup.set(key, { difficulty: attempt.difficulty, hand: attempt.hand, laps: [attempt] });
  }

  const setups = [...bySetup.values()];
  for (const setup of setups) setup.laps.sort((a, b) => a.at - b.at);
  const lastAt = (s: ProgressSetup) => s.laps[s.laps.length - 1]!.at;
  return setups.sort((a, b) => lastAt(b) - lastAt(a));
}

/**
 * The trailing average at each point: each value averaged with up to `window - 1` before it.
 *
 * Laps are noisy — one fluffed chord drops a lap by ten points — and a line through the raw
 * dots zig-zags so hard the direction is lost. Trailing rather than centred so the last
 * point means "lately", which is the question.
 */
export function rollingAverage(values: readonly number[], window = TREND_WINDOW): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= window) sum -= values[i - window]!;
    out.push(sum / Math.min(i + 1, window));
  }
  return out;
}

/** The headline numbers for one setup's laps. */
export interface ProgressSummary {
  laps: number;
  /** Wall-clock seconds spent across every lap. */
  seconds: number;
  /** Mean accuracy (0..1) of the first few laps, and of the most recent few. */
  firstAccuracy: number;
  recentAccuracy: number;
  /** Mean seconds per lap at each end, the same way. */
  firstSeconds: number;
  recentSeconds: number;
  bestAccuracy: number;
  fastestSeconds: number;
  /** Distinct calendar days a lap was played on, in local time. */
  days: number;
}

/**
 * Sum up a setup's laps. Each end of the trend is the mean of up to `TREND_WINDOW` laps, and
 * the two ends never share a lap — with fewer than two windows' worth, the laps are split
 * down the middle, so "then" and "now" are never the same evening read twice.
 */
export function summarizeProgress(laps: readonly Attempt[]): ProgressSummary | null {
  if (laps.length === 0) return null;
  const size = Math.max(1, Math.min(TREND_WINDOW, Math.floor(laps.length / 2)));
  const first = laps.slice(0, size);
  const recent = laps.slice(laps.length - size);
  const mean = (list: readonly Attempt[], pick: (a: Attempt) => number) =>
    list.reduce((total, a) => total + pick(a), 0) / list.length;
  const accuracy = (a: Attempt) => a.result.accuracy;
  const seconds = (a: Attempt) => a.seconds;

  return {
    laps: laps.length,
    seconds: laps.reduce((total, a) => total + a.seconds, 0),
    firstAccuracy: mean(first, accuracy),
    recentAccuracy: mean(recent, accuracy),
    firstSeconds: mean(first, seconds),
    recentSeconds: mean(recent, seconds),
    bestAccuracy: Math.max(...laps.map(accuracy)),
    fastestSeconds: Math.min(...laps.map(seconds)),
    days: new Set(laps.map((a) => new Date(a.at).toDateString())).size,
  };
}
