import { describe, it, expect } from "vitest";
import type { Note, Song } from "../src/core/types.ts";
import {
  applyDifficulty,
  MAX_HAND_SPAN,
  MAX_NOTES_PER_HAND,
} from "../src/song/difficulty.ts";
import { groupChords } from "../src/game/practice.ts";

function note(midi: number, time: number, hand: Note["hand"], duration = 0.5): Note {
  return { midi, time, duration, velocity: 0.8, hand };
}

function song(notes: Note[]): Song {
  return {
    name: "t",
    notes,
    tracks: [],
    tempoMap: [{ time: 0, bpm: 120 }],
    timeSignature: { numerator: 4, denominator: 4 },
    durationSec: 10,
  };
}

/** Largest number of notes any single hand plays at once. */
function maxSimultaneousPerHand(s: Song, hand: Note["hand"]): number {
  const groups = groupChords(s.notes.filter((n) => n.hand === hand));
  return groups.reduce((m, g) => Math.max(m, g.midis.length), 0);
}

describe("applyDifficulty", () => {
  const rightChord = [note(60, 0, "right"), note(64, 0, "right"), note(67, 0, "right")];
  const leftChord = [note(36, 0, "left"), note(43, 0, "left"), note(48, 0, "left")];

  it("easy keeps one note per hand (melody on top, bass on bottom)", () => {
    const out = applyDifficulty(song([...rightChord, ...leftChord]), "easy");
    const right = out.notes.filter((n) => n.hand === "right");
    const left = out.notes.filter((n) => n.hand === "left");
    expect(right.map((n) => n.midi)).toEqual([67]); // highest of the right chord
    expect(left.map((n) => n.midi)).toEqual([36]); // lowest of the left chord
  });

  it("medium keeps up to three notes", () => {
    const five = [0, 4, 7, 11, 14].map((p) => note(60 + p, 0, "right"));
    const out = applyDifficulty(song(five), "medium");
    expect(out.notes).toHaveLength(3);
    // Keeps the top three (melody-leaning).
    expect(out.notes.map((n) => n.midi).sort((a, b) => a - b)).toEqual([67, 71, 74]);
  });

  it("hard keeps the full texture when already playable", () => {
    const out = applyDifficulty(song(rightChord), "hard");
    expect(out.notes).toHaveLength(3);
  });

  it("caps simultaneous notes per hand at the playability limit", () => {
    const big = [0, 2, 4, 5, 7, 9, 11].map((p) => note(60 + p, 0, "right"));
    const out = applyDifficulty(song(big), "hard");
    expect(maxSimultaneousPerHand(out, "right")).toBeLessThanOrEqual(MAX_NOTES_PER_HAND);
  });

  it("never leaves a hand span wider than an octave", () => {
    // A wide right-hand voicing: C2 up to C5.
    const wide = [36, 48, 72].map((m) => note(m, 0, "right"));
    const out = applyDifficulty(song(wide), "hard");
    const rights = out.notes.filter((n) => n.hand === "right").map((n) => n.midi);
    const span = Math.max(...rights) - Math.min(...rights);
    expect(span).toBeLessThanOrEqual(MAX_HAND_SPAN);
  });

  it("preserves separate chords over time", () => {
    const seq = [note(60, 0, "right"), note(62, 1, "right"), note(64, 2, "right")];
    const out = applyDifficulty(song(seq), "easy");
    expect(out.notes).toHaveLength(3);
    expect(out.durationSec).toBeGreaterThan(0);
  });

  it("keeps notes sorted by time", () => {
    const seq = [note(64, 2, "right"), note(60, 0, "right"), note(62, 1, "right")];
    const out = applyDifficulty(song(seq), "hard");
    const times = out.notes.map((n) => n.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});
