import type { Difficulty, Hand, Note, Song } from "../core/types.ts";
import { withNotes } from "../core/songUtils.ts";

/**
 * Rule-based difficulty generation.
 *
 * Instead of asking an AI to invent notes (unreliable), we *simplify* the real MIDI in
 * deterministic, testable ways:
 *  - **easy** keeps a single note per hand at each moment (the melody on the right, the
 *    bass on the left).
 *  - **medium** keeps up to a triad.
 *  - **hard** keeps the full texture, capped for playability.
 *
 * Every level then passes through the same playability floor — no more than five notes per
 * hand at once and no reach wider than an octave — so even "hard" stays physically playable
 * with normal-size hands. All functions are pure `Song → Song` and unit-tested.
 */

/** Widest reach we'll ever ask a single hand to make, in semitones (one octave). */
export const MAX_HAND_SPAN = 12;
/** Hard cap on simultaneous notes per hand, regardless of difficulty. */
export const MAX_NOTES_PER_HAND = 5;

const MAX_NOTES: Record<Difficulty, number> = {
  easy: 1,
  medium: 3,
  hard: MAX_NOTES_PER_HAND,
};

/** Notes starting within this many seconds are treated as one chord. */
const CHORD_TOLERANCE = 0.03;

/** Produce a difficulty-adjusted copy of the song. */
export function applyDifficulty(song: Song, difficulty: Difficulty): Song {
  const maxNotes = Math.min(MAX_NOTES[difficulty], MAX_NOTES_PER_HAND);
  const result: Note[] = [];
  for (const hand of ["left", "right"] as const) {
    const handNotes = song.notes.filter((n) => n.hand === hand);
    for (const chord of groupByOnset(handNotes)) {
      result.push(...reduceChord(chord, hand, maxNotes));
    }
  }
  return withNotes(song, result);
}

/** Group a single hand's notes into chords by near-equal start time. */
function groupByOnset(notes: readonly Note[]): Note[][] {
  const sorted = [...notes].sort((a, b) => a.time - b.time);
  const groups: Note[][] = [];
  let current: Note[] = [];
  let anchor = -Infinity;
  for (const note of sorted) {
    if (note.time - anchor > CHORD_TOLERANCE) {
      current = [];
      groups.push(current);
      anchor = note.time;
    }
    current.push(note);
  }
  return groups;
}

/**
 * Reduce one chord to the allowed number of notes and a playable span.
 * The melody hand (right) keeps its highest notes; the bass hand (left) keeps its lowest.
 */
function reduceChord(chord: Note[], hand: Hand, maxNotes: number): Note[] {
  const byPitch = [...chord].sort((a, b) => a.midi - b.midi);

  // Keep the notes that carry the line for this hand.
  const kept = hand === "right" ? byPitch.slice(-maxNotes) : byPitch.slice(0, maxNotes);

  return enforceSpan(kept, hand);
}

/** Drop out-of-reach notes so the remaining span is at most one octave. */
function enforceSpan(kept: Note[], hand: Hand): Note[] {
  if (kept.length <= 1) return kept;
  if (hand === "right") {
    const top = kept[kept.length - 1]!.midi;
    return kept.filter((n) => top - n.midi <= MAX_HAND_SPAN);
  }
  const bottom = kept[0]!.midi;
  return kept.filter((n) => n.midi - bottom <= MAX_HAND_SPAN);
}
