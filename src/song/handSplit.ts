import type { Hand, Note } from "../core/types.ts";

/**
 * Deciding which hand plays which note.
 *
 * Two strategies, in order of reliability:
 *  1. **By track** — most piano MIDIs are authored with two tracks (right hand / left
 *     hand). If we have two note-bearing tracks we trust that: lower average pitch = left.
 *  2. **By split point** — for single-track files we split around a pitch boundary
 *     (default middle C). `chooseSplitPoint` picks a sensible boundary adaptively.
 *
 * All functions mutate `note.hand` in place; they are pure with respect to everything else
 * and are unit-tested.
 */

const MIDDLE_C = 60;

/** Mean MIDI pitch of a note list, or NaN if empty. */
function meanPitch(notes: readonly Note[]): number {
  if (notes.length === 0) return NaN;
  let sum = 0;
  for (const n of notes) sum += n.midi;
  return sum / notes.length;
}

/**
 * Pick a split pitch for single-track material. We take the median pitch and snap to the
 * nearest C, so the boundary sits at a natural octave line rather than mid-chord. Bounded
 * to a comfortable central range so extreme outliers don't push everything to one hand.
 */
export function chooseSplitPoint(notes: readonly Note[]): number {
  if (notes.length === 0) return MIDDLE_C;
  const pitches = notes.map((n) => n.midi).sort((a, b) => a - b);
  const median = pitches[Math.floor(pitches.length / 2)]!;
  const nearestC = Math.round(median / 12) * 12;
  return Math.min(72, Math.max(48, nearestC)); // clamp to C3..C5
}

/** Assign hands by a pitch boundary: `midi < splitMidi` → left, else right. */
export function assignHandsBySplitPoint(notes: readonly Note[], splitMidi: number): void {
  for (const n of notes) {
    (n as Note).hand = n.midi < splitMidi ? "left" : "right";
  }
}

/**
 * Assign hands given per-track note groups. Groups with notes are ranked by mean pitch;
 * with exactly two groups the lower one is the left hand. With more than two we fall back
 * to a split point over all notes (multi-track arrangements aren't cleanly hand-separated).
 */
export function assignHandsByTracks(trackGroups: readonly Note[][]): void {
  const nonEmpty = trackGroups.filter((g) => g.length > 0);

  if (nonEmpty.length === 2) {
    const [a, b] = nonEmpty as [Note[], Note[]];
    const leftGroup = meanPitch(a) <= meanPitch(b) ? a : b;
    const rightGroup = leftGroup === a ? b : a;
    setHand(leftGroup, "left");
    setHand(rightGroup, "right");
    return;
  }

  const all = nonEmpty.flat();
  assignHandsBySplitPoint(all, chooseSplitPoint(all));
}

function setHand(notes: readonly Note[], hand: Hand): void {
  for (const n of notes) (n as Note).hand = hand;
}
