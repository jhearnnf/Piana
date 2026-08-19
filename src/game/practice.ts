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

/**
 * How far past the current gate a press may still reach, in seconds.
 *
 * Notes written a few milliseconds apart become separate gates, but two keys struck
 * together arrive in whatever order the keyboard's scan happens to produce — so the
 * second one would land on a gate that isn't current yet and be judged wrong, leaving
 * its own gate waiting for a note already played. Wider than {@link groupChords}'
 * tolerance because this only decides *ordering*: every note must still be played, and
 * the run stays held until it is. Sized from real files, where the rolled chords and
 * near-simultaneous onsets that cause this sit under 80ms.
 */
export const TOGETHER_SEC = 0.08;

/**
 * Which pending gate a press belongs to, or null if it belongs to none (a wrong note).
 *
 * Looks at the current gate first, then any that follow within `toleranceSec` of it, so a
 * chord written slightly spread can be played in any order. Checking the current gate
 * first is what keeps a repeated note honest: when the same pitch is due twice in a row,
 * the press fills the gate that is due now, not the one after it.
 */
export function findGate(
  groups: readonly NoteGroup[],
  gateIndex: number,
  midi: number,
  satisfied: ReadonlyMap<number, ReadonlySet<number>>,
  toleranceSec = TOGETHER_SEC,
): number | null {
  const current = groups[gateIndex];
  if (!current) return null;
  for (let i = gateIndex; i < groups.length; i++) {
    const group = groups[i]!;
    if (group.time - current.time > toleranceSec) break;
    if (group.midis.includes(midi) && !satisfied.get(i)?.has(midi)) return i;
  }
  return null;
}

/** Step the gate past every group that is now complete, so the song resumes. */
export function advanceGate(
  groups: readonly NoteGroup[],
  gateIndex: number,
  satisfied: ReadonlyMap<number, ReadonlySet<number>>,
): number {
  let i = gateIndex;
  while (i < groups.length && (satisfied.get(i)?.size ?? 0) >= groups[i]!.midis.length) i++;
  return i;
}
