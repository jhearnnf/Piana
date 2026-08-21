import type { TimeRange } from "../game/practice.ts";

/**
 * Hand-picking the stretch of song that Loop plays.
 *
 * The detected sections in `sections.ts` are a guess at where the phrases are, and a good
 * one, but the eight bars you actually cannot play rarely line up with them. This is the
 * other half: two markers you drop yourself, wherever the music needs them.
 *
 * Pure, so the rules about which marker may sit where are unit-tested rather than
 * discovered by pushing buttons.
 */

/**
 * The two points that bound a hand-picked stretch of song.
 *
 * Either can exist without the other: you drop the start, scroll on through the music
 * looking for where the phrase ends, and drop the end when you find it. Only once both
 * are down is there a region to practise.
 */
export interface LoopMarks {
  start: number | null;
  end: number | null;
}

/** No marks at all — the whole song. */
export const NO_MARKS: LoopMarks = { start: null, end: null };

/**
 * Shortest region that can be marked, in seconds.
 *
 * Below this a loop is a stutter rather than a passage, and the two markers are close
 * enough on screen that you cannot see which of them you are moving.
 */
export const MIN_LOOP_SEC = 0.5;

/**
 * Drop one of the two markers at `time`.
 *
 * A marker placed on the wrong side of its partner clears the partner rather than
 * swapping with it. Swapping would quietly rename the point you just placed — you asked
 * for a start and were given an end — where clearing leaves exactly what you did: one
 * marker down, at the moment you chose, and the song still open for where the other goes.
 */
export function placeMark(marks: LoopMarks, which: "start" | "end", time: number): LoopMarks {
  if (which === "start") {
    const end = marks.end !== null && marks.end - time >= MIN_LOOP_SEC ? marks.end : null;
    return { start: time, end };
  }
  const start = marks.start !== null && time - marks.start >= MIN_LOOP_SEC ? marks.start : null;
  return { start, end: time };
}

/**
 * Slide one marker to `time`, held clear of its partner.
 *
 * The rule that separates dragging from dropping. A point *dropped* on the wrong side of
 * its partner clears it, because you plainly meant to start a new region there; a point
 * *dragged* into its partner has just been pushed too far by a hand that can see exactly
 * where both of them are, and should stop rather than throw the other one away.
 */
export function moveMark(marks: LoopMarks, which: "start" | "end", time: number): LoopMarks {
  if (which === "start") {
    const limit = marks.end === null ? Infinity : marks.end - MIN_LOOP_SEC;
    return { ...marks, start: Math.max(0, Math.min(time, limit)) };
  }
  const limit = marks.start === null ? 0 : marks.start + MIN_LOOP_SEC;
  return { ...marks, end: Math.max(limit, Math.max(0, time)) };
}

/** The region the marks describe, or null while one of them is still missing. */
export function markedRegion(marks: LoopMarks): TimeRange | null {
  const { start, end } = marks;
  if (start === null || end === null || end - start < MIN_LOOP_SEC) return null;
  return { start, end };
}

/** The marks that describe a range — how a chosen section arrives on the stage. */
export function marksOf(range: TimeRange | null): LoopMarks {
  return range ? { start: range.start, end: range.end } : NO_MARKS;
}

/**
 * How many times over a region may be repeated into one view of the stage.
 *
 * A guard rather than a design: a two-second loop under a three-second look-ahead needs
 * three copies, and there is no sensible loop that needs many. It exists so a region
 * shrunk to almost nothing cannot ask for ten thousand of them.
 */
const MAX_REPEATS = 8;

/**
 * The time shifts at which a looped region's music falls inside a window.
 *
 * What makes a loop look like a loop. The stage can only show the next few seconds, so as
 * the end of the region comes down the screen there is nothing above it — the piece simply
 * stops, and the jump back is a surprise every single time. Shifting the region's own
 * notes up by a whole lap puts its opening bars directly above its last one, so the music
 * arrives continuously and your hands are ready for the repeat before it happens.
 *
 * Returns the offsets in seconds, always including 0, earliest first.
 */
export function loopOffsets(region: TimeRange, windowStart: number, windowEnd: number): number[] {
  const length = region.end - region.start;
  if (!(length > 0)) return [0];

  // A copy shifted by k laps covers [start + kL, end + kL); it is in view when that
  // overlaps the window at all.
  let first = Math.ceil((windowStart - region.end) / length);
  let last = Math.floor((windowEnd - region.start) / length);
  if (last < first) return [0];

  // Trimmed around the present lap, which is the one that must never be dropped.
  if (last - first + 1 > MAX_REPEATS) {
    first = Math.max(first, -Math.floor((MAX_REPEATS - 1) / 2));
    last = Math.min(last, first + MAX_REPEATS - 1);
  }

  const offsets: number[] = [];
  for (let k = first; k <= last; k++) {
    const offset = k * length;
    // Rounding towards zero from below yields a negative zero, which is the same shift as
    // no shift at all but does not read like it anywhere it is printed or compared.
    offsets.push(offset === 0 ? 0 : offset);
  }
  if (!offsets.includes(0)) offsets.push(0); // the lap being played is never left out
  return offsets.sort((a, b) => a - b);
}

/**
 * The section id a hand-picked region is scored under.
 *
 * It carries the times themselves, so two different hand-picked regions of one song keep
 * separate best scores — a single "custom" id would file the eight bars you can play and
 * the eight you cannot under the same heading.
 */
export function loopSectionId(range: TimeRange): string {
  return `loop:${range.start.toFixed(2)}-${range.end.toFixed(2)}`;
}

/** Read a loop section id back into its range, or null if it isn't one of ours. */
export function parseLoopSectionId(id: string): TimeRange | null {
  const match = /^loop:(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(id);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return end > start ? { start, end } : null;
}
