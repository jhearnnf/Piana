import type { Hand, Note } from "../core/types.ts";
import { pitchRange } from "../core/songUtils.ts";

/**
 * Laying the whole song out as one small picture.
 *
 * The stage shows three seconds. The question it cannot answer is the one you ask between
 * runs — *where in the piece is the hard bit?* — so the timeline draws every note of the
 * song at once, pitch up the side and time across, small enough that you read it as a
 * shape rather than as notes: the melody line rising, the block where both hands are busy,
 * the gap before the last section.
 *
 * Pure geometry, so the whole layout is unit-tested rather than eyeballed on a canvas.
 */

/** One note as a rectangle on the map, in CSS pixels. */
export interface MiniNote {
  x: number;
  y: number;
  w: number;
  h: number;
  hand: Hand;
}

export interface MiniMapSize {
  width: number;
  height: number;
}

/**
 * Smallest a note may be drawn, in pixels.
 *
 * A grace note in a five-minute song is worth a fraction of a pixel of width, and a piece
 * spanning six octaves gives each semitone well under a pixel of height. Drawn honestly
 * both would disappear, and a map with the fast passages missing is worse than no map —
 * so every note is given enough to leave a mark, and dense passages read as solid blocks.
 */
export const MIN_NOTE_WIDTH = 1;
export const MIN_NOTE_HEIGHT = 1.5;

/** Breathing room above and below the notes, so the outermost ones are not cut in half. */
const PADDING_Y = 2;

/** Where a time sits across the map. */
export function timeToX(timeSec: number, durationSec: number, width: number): number {
  if (!(durationSec > 0)) return 0;
  return (clamp(timeSec, 0, durationSec) / durationSec) * width;
}

/** The time a point on the map stands for — clicking to jump, read backwards. */
export function xToTime(x: number, durationSec: number, width: number): number {
  if (!(width > 0) || !(durationSec > 0)) return 0;
  return clamp(x / width, 0, 1) * durationSec;
}

/**
 * Every note of the song as a rectangle.
 *
 * The pitch axis is fitted to the notes the song actually uses rather than to all 88 keys:
 * a piece living in two octaves would otherwise be a flat line across the middle of an
 * empty band, when the whole point is to see its shape.
 */
export function miniMapNotes(
  notes: readonly Note[],
  durationSec: number,
  size: MiniMapSize,
): MiniNote[] {
  const used = pitchRange(notes);
  if (!used || !(durationSec > 0) || !(size.width > 0) || !(size.height > 0)) return [];

  const [low, high] = used;
  const rows = high - low + 1;
  const usable = Math.max(MIN_NOTE_HEIGHT, size.height - PADDING_Y * 2);
  const rowHeight = usable / rows;
  const h = Math.max(MIN_NOTE_HEIGHT, rowHeight);
  // A note given a floor height would otherwise hang off the bottom of the map; holding
  // the top back by the overhang keeps the lowest note inside it.
  const top = PADDING_Y;
  const bottom = PADDING_Y + usable - h;

  const out: MiniNote[] = [];
  for (const note of notes) {
    const x = timeToX(note.time, durationSec, size.width);
    const end = timeToX(note.time + note.duration, durationSec, size.width);
    // Pitch runs up the map, so the highest note sits at the top.
    const y = clamp(top + (high - note.midi) * rowHeight, top, Math.max(top, bottom));
    out.push({
      x,
      y,
      w: Math.max(MIN_NOTE_WIDTH, Math.min(end - x, size.width - x)),
      h,
      hand: note.hand,
    });
  }
  return out;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
