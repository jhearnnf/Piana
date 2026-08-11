/**
 * Core data model for Piana.
 *
 * Everything downstream (rendering, scoring, difficulty, sections) operates on the
 * `Song` type below. Keeping a single normalized model is what lets us swap the *source*
 * of a song later (upload today; online search or audio->MIDI later) without touching the
 * rest of the app.
 */

/** Which hand a note belongs to. `both` is only used transiently before a split. */
export type Hand = "left" | "right";

/** A single playable note, with time expressed in seconds from the song start. */
export interface Note {
  /** MIDI note number, 0-127 (middle C = 60). */
  midi: number;
  /** Start time in seconds. */
  time: number;
  /** Duration in seconds. */
  duration: number;
  /** Velocity, 0-1 (how hard it was struck). */
  velocity: number;
  /** Assigned hand. */
  hand: Hand;
  /**
   * Index of the MIDI track this note came from, when it came from a file.
   *
   * Kept so hand assignment can be steered per track after parsing — a note's track is the
   * composer's own grouping and is often (not always) the hand they meant.
   */
  track?: number;
}

/** A tempo change: `bpm` takes effect at `time` seconds. */
export interface TempoEvent {
  time: number;
  bpm: number;
}

/** Time signature, e.g. 4/4. */
export interface TimeSignature {
  numerator: number;
  denominator: number;
}

/** One note-bearing track of the source file, for the per-track hand controls. */
export interface TrackInfo {
  /** Index into `Song.tracks`, and the value carried by `Note.track`. */
  index: number;
  /** Track or instrument name from the file, or "Track N" if it had neither. */
  name: string;
  noteCount: number;
  /** Pitch range of the track, as [lowest, highest] MIDI numbers. */
  range: [number, number];
}

/** A fully normalized, source-agnostic song. */
export interface Song {
  name: string;
  /** Notes sorted ascending by `time`. */
  notes: Note[];
  /** The note-bearing tracks the notes came from; empty for songs built by hand. */
  tracks: TrackInfo[];
  /** Tempo map; always has at least one entry. */
  tempoMap: TempoEvent[];
  /** Time signature (first one found, or a 4/4 default). */
  timeSignature: TimeSignature;
  /** Total duration in seconds (end of the last note). */
  durationSec: number;
}

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Which hand(s) the player is practising. */
export type HandSelection = "left" | "right" | "both";
