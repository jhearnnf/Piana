import { describe, it, expect } from "vitest";
import type { Note } from "../src/core/types.ts";
import {
  assignHandsBySplitPoint,
  assignHandsByTracks,
  chooseSplitPoint,
} from "../src/song/handSplit.ts";

function note(midi: number, time = 0): Note {
  return { midi, time, duration: 1, velocity: 0.8, hand: "right" };
}

describe("assignHandsBySplitPoint", () => {
  it("puts notes below the split on the left, at/above on the right", () => {
    const notes = [note(48), note(59), note(60), note(72)];
    assignHandsBySplitPoint(notes, 60);
    expect(notes.map((n) => n.hand)).toEqual(["left", "left", "right", "right"]);
  });
});

describe("chooseSplitPoint", () => {
  it("defaults to middle C when there are no notes", () => {
    expect(chooseSplitPoint([])).toBe(60);
  });

  it("snaps to a C near the median and clamps to C3..C5", () => {
    const point = chooseSplitPoint([note(40), note(41), note(42)]);
    expect(point).toBe(48); // clamped up to C3
    expect(point % 12).toBe(0); // lands on a C
  });
});

describe("assignHandsByTracks", () => {
  it("assigns the lower track to the left hand with two tracks", () => {
    const low = [note(48), note(50)];
    const high = [note(72), note(74)];
    assignHandsByTracks([high, low]); // order shouldn't matter
    expect(low.every((n) => n.hand === "left")).toBe(true);
    expect(high.every((n) => n.hand === "right")).toBe(true);
  });

  it("falls back to a split point when there is a single track", () => {
    const notes = [note(40), note(80)];
    assignHandsByTracks([notes]);
    expect(notes[0]!.hand).toBe("left");
    expect(notes[1]!.hand).toBe("right");
  });

  it("ignores empty tracks", () => {
    const low = [note(48)];
    const high = [note(72)];
    assignHandsByTracks([[], low, [], high]);
    expect(low[0]!.hand).toBe("left");
    expect(high[0]!.hand).toBe("right");
  });
});
