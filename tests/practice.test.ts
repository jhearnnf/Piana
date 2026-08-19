import { describe, it, expect } from "vitest";
import type { Note } from "../src/core/types.ts";
import { advanceGate, findGate, groupChords, splitPractice } from "../src/game/practice.ts";

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

describe("findGate", () => {
  // Two notes written 40ms apart: too far to be one chord, close enough to be struck together.
  const spread = groupChords([note(60, 1.0, "right"), note(64, 1.04, "right")]);
  const none = new Map<number, ReadonlySet<number>>();

  it("makes them separate gates in the first place", () => {
    expect(spread).toHaveLength(2);
  });

  it("takes the note due now", () => {
    expect(findGate(spread, 0, 60, none)).toBe(0);
  });

  it("reaches ahead for the one played early, instead of calling it wrong", () => {
    expect(findGate(spread, 0, 64, none)).toBe(1);
  });

  it("still calls a note that is in no nearby gate wrong", () => {
    expect(findGate(spread, 0, 61, none)).toBeNull();
  });

  it("won't reach past a gate that is genuinely later", () => {
    const apart = groupChords([note(60, 1.0, "right"), note(64, 1.5, "right")]);
    expect(findGate(apart, 0, 64, none)).toBeNull();
  });

  it("fills the nearer gate first when a pitch repeats", () => {
    const repeat = groupChords([note(60, 1.0, "right"), note(60, 1.04, "right")]);
    expect(findGate(repeat, 0, 60, none)).toBe(0);
    expect(findGate(repeat, 0, 60, new Map([[0, new Set([60])]]))).toBe(1);
  });

  it("has nothing to offer once every gate is played", () => {
    expect(findGate(spread, 2, 60, none)).toBeNull();
  });
});

describe("advanceGate", () => {
  const spread = groupChords([note(60, 1.0, "right"), note(64, 1.04, "right")]);

  it("holds while the gate due now is unplayed, even if a later one is done", () => {
    expect(advanceGate(spread, 0, new Map([[1, new Set([64])]]))).toBe(0);
  });

  it("steps over both once the held gate is filled — the stall this fixes", () => {
    const satisfied = new Map([
      [1, new Set([64])], // played early, out of order
      [0, new Set([60])], // and now the note it was waiting for
    ]);
    expect(advanceGate(spread, 0, satisfied)).toBe(2);
  });

  it("stays put when nothing has been played", () => {
    expect(advanceGate(spread, 0, new Map())).toBe(0);
  });
});
