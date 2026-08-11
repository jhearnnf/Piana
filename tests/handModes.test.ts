import { describe, it, expect } from "vitest";
import type { Note, Song, TrackInfo } from "../src/core/types.ts";
import { applyHandModes, defaultHandModes, handTally } from "../src/song/handModes.ts";

function note(midi: number, time: number, track: number): Note {
  return { midi, time, duration: 0.4, velocity: 0.8, hand: "right", track };
}

function song(notes: Note[], trackCount: number): Song {
  const tracks: TrackInfo[] = Array.from({ length: trackCount }, (_, index) => ({
    index,
    name: `Track ${index + 1}`,
    noteCount: notes.filter((n) => n.track === index).length,
    range: [60, 60],
  }));
  return {
    name: "t",
    notes,
    tracks,
    tempoMap: [{ time: 0, bpm: 120 }],
    timeSignature: { numerator: 4, denominator: 4 },
    durationSec: 10,
  };
}

describe("defaultHandModes", () => {
  it("trusts a two-track file: the lower track is the left hand", () => {
    const s = song([note(48, 0, 0), note(50, 1, 0), note(72, 0, 1), note(74, 1, 1)], 2);
    expect(defaultHandModes(s)).toEqual(["left", "right"]);
  });

  it("does not care which order the two tracks are in", () => {
    const s = song([note(72, 0, 0), note(48, 0, 1)], 2);
    expect(defaultHandModes(s)).toEqual(["right", "left"]);
  });

  it("auto-splits a single-track file, which is claiming nothing about hands", () => {
    const s = song([note(48, 0, 0), note(72, 0, 0)], 1);
    expect(defaultHandModes(s)).toEqual(["auto"]);
  });

  it("auto-splits when there are more tracks than hands", () => {
    const s = song([note(48, 0, 0), note(60, 0, 1), note(72, 0, 2)], 3);
    expect(defaultHandModes(s)).toEqual(["auto", "auto", "auto"]);
  });

  it("ignores tracks with no notes when deciding", () => {
    const s = song([note(48, 0, 1), note(72, 0, 2)], 3); // track 0 is silent
    expect(defaultHandModes(s)).toEqual(["auto", "left", "right"]);
  });
});

describe("applyHandModes", () => {
  it("pins a track to the hand it was given", () => {
    const s = song([note(84, 0, 0), note(30, 1, 0)], 1);
    applyHandModes(s, ["left"]);
    expect(s.notes.every((n) => n.hand === "left")).toBe(true);
  });

  it("splits the auto tracks and leaves the pinned ones alone", () => {
    const notes = [
      note(40, 0, 0), // pinned left, despite being alone down there
      note(60, 0, 1),
      note(84, 0, 1),
    ];
    const s = song(notes, 2);
    applyHandModes(s, ["left", "auto"]);

    expect(notes[0]!.hand).toBe("left");
    // The auto track holds an octave and a half at once, so it has to use both hands.
    expect(notes[1]!.hand).toBe("left");
    expect(notes[2]!.hand).toBe("right");
  });

  it("splits several auto tracks as one pool, not one at a time", () => {
    // Alone, each track is a single line that would go entirely to one hand. Together they
    // are a bass part and a melody, and the split has to see both to say so.
    const notes = [
      ...[0, 1, 2, 3].map((i) => note(43, i * 0.5, 0)),
      ...[0, 1, 2, 3].map((i) => note(79, i * 0.5, 1)),
    ];
    const s = song(notes, 2);
    applyHandModes(s, ["auto", "auto"]);

    expect(notes.filter((n) => n.track === 0).every((n) => n.hand === "left")).toBe(true);
    expect(notes.filter((n) => n.track === 1).every((n) => n.hand === "right")).toBe(true);
  });

  it("treats a note with no track as belonging to the first one", () => {
    const orphan: Note = { midi: 60, time: 0, duration: 1, velocity: 0.8, hand: "right" };
    const s = song([orphan], 1);
    applyHandModes(s, ["left"]);
    expect(orphan.hand).toBe("left");
  });
});

describe("handTally", () => {
  it("counts how a track came out", () => {
    const notes = [note(40, 0, 0), note(80, 0, 0), note(60, 0, 1)];
    const s = song(notes, 2);
    applyHandModes(s, ["auto", "right"]);
    expect(handTally(s, 0)).toEqual({ left: 1, right: 1 });
    expect(handTally(s, 1)).toEqual({ left: 0, right: 1 });
  });
});
