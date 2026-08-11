import { describe, it, expect } from "vitest";
import type { Note } from "../src/core/types.ts";
import { groupChords, splitPractice } from "../src/game/practice.ts";

function note(midi: number, time: number, hand: Note["hand"]): Note {
  return { midi, time, duration: 0.5, velocity: 0.8, hand };
}

const notes = [
  note(60, 0, "right"),
  note(48, 0, "left"),
  note(62, 1, "right"),
  note(50, 1, "left"),
  note(64, 2, "right"),
];

describe("splitPractice", () => {
  it("with 'both' the player plays everything", () => {
    const { required, auto } = splitPractice(notes, "both");
    expect(required).toHaveLength(5);
    expect(auto).toHaveLength(0);
  });

  it("with 'right' the left hand is auto-played", () => {
    const { required, auto } = splitPractice(notes, "right");
    expect(required.every((n) => n.hand === "right")).toBe(true);
    expect(auto.every((n) => n.hand === "left")).toBe(true);
    expect(required).toHaveLength(3);
    expect(auto).toHaveLength(2);
  });

  it("restricts to a section range", () => {
    const { required } = splitPractice(notes, "both", { start: 1, end: 2 });
    // Only notes at time 1 (2 of them); time 2 is excluded (end is exclusive).
    expect(required).toHaveLength(2);
    expect(required.every((n) => n.time === 1)).toBe(true);
  });
});

describe("groupChords", () => {
  it("groups simultaneous notes into chords", () => {
    const groups = groupChords(notes);
    expect(groups).toHaveLength(3); // times 0, 1, 2
    expect(groups[0]!.midis.sort((a, b) => a - b)).toEqual([48, 60]);
  });

  it("keeps notes apart when spaced beyond tolerance", () => {
    const groups = groupChords([note(60, 0, "right"), note(61, 0.5, "right")]);
    expect(groups).toHaveLength(2);
  });
});
