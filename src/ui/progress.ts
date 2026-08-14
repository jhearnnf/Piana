import type { TimeRange } from "../game/practice.ts";

/**
 * How far the clock has moved through a run, as 0..1.
 *
 * The range is the run's own — a section, or the whole song — so practising eight bars
 * shows those eight bars filling up, not a sliver of the piece they came from.
 *
 * Clamped, because the clock can sit slightly outside its range: wait mode holds at a gate
 * on the last chord, and the conductor stops on the duration itself.
 */
export function progressFraction(nowSec: number, range: TimeRange): number {
  const length = range.end - range.start;
  if (!(length > 0)) return 0; // an empty section (or a NaN one) is not "half done"
  return Math.min(1, Math.max(0, (nowSec - range.start) / length));
}

/** Seconds elapsed into a run, clamped to it, for the readout beside the bar. */
export function elapsedInRange(nowSec: number, range: TimeRange): number {
  return progressFraction(nowSec, range) * (range.end - range.start);
}

/**
 * Seconds as `m:ss`, growing to `h:mm:ss` only once there is an hour to show.
 *
 * Rounded down so the elapsed time never reads as the total while notes are still coming.
 */
export function formatTime(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const pad = (n: number) => String(n).padStart(2, "0");
  const secs = total % 60;
  const mins = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours > 0 ? `${hours}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
}
