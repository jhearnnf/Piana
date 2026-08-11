import type { Note, Song } from "../core/types.ts";
import { autoSplitHands } from "./autoSplit.ts";

/**
 * What to do with one track's notes.
 *
 * A MIDI file's tracks are the composer's own grouping, and in a two-track piano score they
 * usually *are* the two hands — so when the file says so we believe it. When it doesn't, or
 * when it says something silly (both hands crammed into one track, or four tracks for a
 * two-hand piece), `auto` hands the decision to {@link autoSplitHands}, which reads the notes
 * instead of the file.
 */
export type HandMode = "auto" | "left" | "right";

export const HAND_MODES: readonly HandMode[] = ["auto", "left", "right"];

/** Mean MIDI pitch of a note list, or NaN if empty. */
function meanPitch(notes: readonly Note[]): number {
  if (notes.length === 0) return NaN;
  let sum = 0;
  for (const n of notes) sum += n.midi;
  return sum / notes.length;
}

/** Notes belonging to each track, indexed to match `song.tracks`. */
function notesByTrack(song: Song): Note[][] {
  const groups: Note[][] = song.tracks.map(() => []);
  for (const note of song.notes) {
    const group = groups[note.track ?? 0];
    if (group) group.push(note);
  }
  return groups;
}

/**
 * The modes a freshly loaded song should start with.
 *
 * Exactly two tracks is the shape of a hand-separated piano score, so those become left and
 * right by their average pitch — the reading the file itself is asserting, and the one that
 * has always been used. Anything else is not a claim about hands, so it goes to `auto`.
 */
export function defaultHandModes(song: Song): HandMode[] {
  const groups = notesByTrack(song);
  const playing = groups.map((notes, index) => ({ notes, index })).filter((g) => g.notes.length > 0);

  if (playing.length === 2) {
    const [a, b] = playing as [(typeof playing)[number], (typeof playing)[number]];
    const lower = meanPitch(a.notes) <= meanPitch(b.notes) ? a : b;
    const higher = lower === a ? b : a;
    // A silent track is claiming nothing either way, so it stays neutral rather than being
    // labelled with a hand it never plays.
    return groups.map((_, index) =>
      index === lower.index ? "left" : index === higher.index ? "right" : "auto",
    );
  }
  return groups.map(() => "auto");
}

/**
 * Apply per-track modes to a song, setting `note.hand` in place.
 *
 * Every track set to `auto` is split *together*, as one pool: a piece spread over three
 * tracks is still one pianist, and the hands have to travel around all of it. Tracks pinned
 * to a hand are left out of that pool — the user has already answered for them.
 */
export function applyHandModes(song: Song, modes: readonly HandMode[]): void {
  const auto: Note[] = [];
  for (const note of song.notes) {
    const mode = modes[note.track ?? 0] ?? "auto";
    if (mode === "auto") auto.push(note);
    else note.hand = mode;
  }
  autoSplitHands(auto);
}

/** How many of a track's notes ended up in each hand. Drives the per-track summary. */
export function handTally(song: Song, trackIndex: number): { left: number; right: number } {
  let left = 0;
  let right = 0;
  for (const note of song.notes) {
    if ((note.track ?? 0) !== trackIndex) continue;
    if (note.hand === "left") left++;
    else right++;
  }
  return { left, right };
}
