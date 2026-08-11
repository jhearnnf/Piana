import type { Note, Song } from "./types.ts";

/** Sort notes in place, ascending by start time then pitch. Returns the same array. */
export function sortNotes(notes: Note[]): Note[] {
  notes.sort((a, b) => a.time - b.time || a.midi - b.midi);
  return notes;
}

/** End time (time + duration) of a note. */
export function noteEnd(note: Note): number {
  return note.time + note.duration;
}

/** Duration of a song = the latest note end, or 0 if empty. */
export function computeDuration(notes: readonly Note[]): number {
  let max = 0;
  for (const n of notes) max = Math.max(max, n.time + n.duration);
  return max;
}

/** The set of MIDI pitches actually used, as [min, max]. Null if there are no notes. */
export function pitchRange(notes: readonly Note[]): [number, number] | null {
  if (notes.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const n of notes) {
    if (n.midi < min) min = n.midi;
    if (n.midi > max) max = n.midi;
  }
  return [min, max];
}

/** Notes for a single hand, preserving order. */
export function notesForHand(song: Song, hand: Note["hand"]): Note[] {
  return song.notes.filter((n) => n.hand === hand);
}

/**
 * Return a shallow-copied Song with new notes, re-sorted and with duration recomputed.
 * Central helper so every transform (difficulty, sections) stays DRY and consistent.
 */
export function withNotes(song: Song, notes: Note[]): Song {
  const sorted = sortNotes(notes.slice());
  return { ...song, notes: sorted, durationSec: computeDuration(sorted) };
}
