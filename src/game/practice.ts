import type { HandSelection, Note } from "../core/types.ts";

/** A time window within a song (used for section practice). */
export interface TimeRange {
  start: number;
  end: number;
}

/** The split of a song for a practice run. */
export interface PracticeSplit {
  /** Notes the player must play (the selected hand(s), within range). */
  required: Note[];
  /** Notes the app plays for them (the other hand, within range). */
  auto: Note[];
}

/** True if the note falls inside the range (or there's no range). */
export function inRange(note: Note, range: TimeRange | null): boolean {
  return !range || (note.time >= range.start && note.time < range.end);
}

/** True if the player is responsible for this note given the hand selection. */
export function isPracticed(note: Note, hand: HandSelection): boolean {
  return hand === "both" || note.hand === hand;
}

/**
 * Split a song's notes into what the player plays vs what the app auto-plays, honouring
 * the selected hand(s) and an optional section range. Notes outside the range are dropped
 * entirely (the run only covers the section).
 */
export function splitPractice(
  notes: readonly Note[],
  hand: HandSelection,
  range: TimeRange | null = null,
): PracticeSplit {
  const required: Note[] = [];
  const auto: Note[] = [];
  for (const note of notes) {
    if (!inRange(note, range)) continue;
    if (isPracticed(note, hand)) required.push(note);
    else auto.push(note);
  }
  return { required, auto };
}

/** A set of notes struck together (a chord), used to gate wait-mode on complete chords. */
export interface NoteGroup {
  time: number;
  midis: number[];
}

/**
 * Group notes that start at effectively the same time into chords. Input need not be
 * sorted. `toleranceSec` decides how close counts as "together".
 */
export function groupChords(notes: readonly Note[], toleranceSec = 0.03): NoteGroup[] {
  const sorted = [...notes].sort((a, b) => a.time - b.time);
  const groups: NoteGroup[] = [];
  for (const note of sorted) {
    const last = groups[groups.length - 1];
    if (last && note.time - last.time <= toleranceSec) {
      if (!last.midis.includes(note.midi)) last.midis.push(note.midi);
    } else {
      groups.push({ time: note.time, midis: [note.midi] });
    }
  }
  return groups;
}
