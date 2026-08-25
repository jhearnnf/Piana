import type { SavedLoop } from "../song/savedLoops.ts";
import { timeToX } from "./miniMap.ts";

/**
 * The strip of saved loops across the top of the song map.
 *
 * Each kept loop is a bar spanning the stretch of song it covers, so the answer to "what
 * did I mark out on this piece?" is the same picture as "where in the piece is it" — one
 * glance, no list to open. The lane sits above the notes rather than over them: a band
 * drawn across the map would hide the very bars it is pointing at.
 *
 * Loops overlap — the tricky run inside the section that is hard all the way through is
 * two loops, one inside the other — so bands are stacked into rows, and the lane is as
 * tall as the deepest pile-up. Pure, so the stacking and the hit-testing are unit-tested
 * rather than found by clicking near things.
 */

/** One saved loop as a bar on the lane, in CSS pixels. */
export interface LoopBand {
  id: string;
  name: string;
  x: number;
  w: number;
  y: number;
  h: number;
  row: number;
}

export const BAND_HEIGHT = 6;
export const BAND_GAP = 2;
/** Air above the first row and below the last, so the bands are not welded to the notes. */
export const LANE_PAD = 3;

/**
 * How many rows deep the lane is allowed to go.
 *
 * Beyond three the lane is taller than the map it is captioning. Loops that would need a
 * fourth row wrap back onto the first: they overlap something, which reads a little
 * crowded, and that beats a strip of saved loops that pushes the song off the screen.
 */
export const MAX_ROWS = 3;

/** Narrowest a band may be drawn, so a two-bar loop in a long piece is still clickable. */
export const MIN_BAND_WIDTH = 4;

/** A loop with the row it has been given. */
export interface PackedLoop {
  loop: SavedLoop;
  row: number;
}

/**
 * Give every loop a row, stacking only the ones that would otherwise sit on each other.
 *
 * Packed by time rather than by pixels so the answer does not change with the width of the
 * window: the lane's height feeds the canvas's height, and a strip that grew a row when
 * you widened the app would resize the stage underneath you.
 */
export function packLoops(loops: readonly SavedLoop[]): PackedLoop[] {
  // Earliest first, so a row is filled left to right and the first free one is the lowest
  // that this loop clears.
  const ordered = [...loops].sort((a, b) => a.start - b.start || a.end - b.end);
  const rowEnds: number[] = [];
  const packed: PackedLoop[] = [];

  for (const loop of ordered) {
    let row = rowEnds.findIndex((end) => end <= loop.start);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(loop.end);
    } else {
      rowEnds[row] = loop.end;
    }
    packed.push({ loop, row: row % MAX_ROWS });
  }
  return packed;
}

/** How many rows the packing actually used. */
export function rowCount(packed: readonly PackedLoop[]): number {
  return packed.reduce((rows, { row }) => Math.max(rows, row + 1), 0);
}

/**
 * How tall the lane is for this set of loops, in CSS pixels — zero when there are none.
 *
 * A song with nothing saved on it gets no strip at all, rather than an empty band of dead
 * pixels above every map in the app.
 */
export function laneHeight(loops: readonly SavedLoop[]): number {
  const rows = rowCount(packLoops(loops));
  if (rows === 0) return 0;
  return LANE_PAD * 2 + rows * BAND_HEIGHT + (rows - 1) * BAND_GAP;
}

/** Every saved loop as a bar, laid out across a map `width` wide. */
export function loopBands(
  loops: readonly SavedLoop[],
  durationSec: number,
  width: number,
): LoopBand[] {
  if (!(durationSec > 0) || !(width > 0)) return [];
  return packLoops(loops).map(({ loop, row }) => {
    const x = timeToX(loop.start, durationSec, width);
    const end = timeToX(loop.end, durationSec, width);
    return {
      id: loop.id,
      name: loop.name,
      x,
      // Held inside the map, so a loop running to the last note keeps its full width
      // rather than half of it hanging off the right-hand edge.
      w: Math.max(MIN_BAND_WIDTH, Math.min(end - x, width - x)),
      y: LANE_PAD + row * (BAND_HEIGHT + BAND_GAP),
      h: BAND_HEIGHT,
      row,
    };
  });
}

/**
 * How much slack a pointer is given around a band, in pixels.
 *
 * A six-pixel bar is under a millimetre on a laptop screen, and a strip you have to hit
 * exactly is a strip nobody uses twice. The slack is vertical only — sideways it would
 * make a band claim music it does not cover, which is the one thing the lane must not lie
 * about.
 */
export const BAND_REACH = 3;

/**
 * The band under a point, or null.
 *
 * A band actually covering the point always wins; the slack only decides between bands
 * that none of them does, and there the nearest row takes it. Otherwise a loop three
 * pixels above the pointer could steal a click from the one directly under it.
 */
export function bandAt(bands: readonly LoopBand[], x: number, y: number): LoopBand | null {
  let nearest: LoopBand | null = null;
  let nearestGap = Infinity;

  for (const band of bands) {
    if (x < band.x || x > band.x + band.w) continue;
    if (y >= band.y && y <= band.y + band.h) return band;

    const gap = y < band.y ? band.y - y : y - (band.y + band.h);
    if (gap <= BAND_REACH && gap < nearestGap) {
      nearest = band;
      nearestGap = gap;
    }
  }
  return nearest;
}
