import { describe, it, expect } from "vitest";
import type { Note } from "../src/core/types.ts";
import {
  autoRange,
  PIANO_HIGH,
  PIANO_LOW,
  visibleRange,
} from "../src/render/visibleRange.ts";

function note(midi: number): Note {
  return { midi, time: 0, duration: 0.5, velocity: 0.8, hand: "right" };
}

describe("autoRange", () => {
  it("snaps a used range outward to whole octaves", () => {
    // Used C4(60)..E4(64) -> C4..B4
    expect(autoRange([60, 64])).toEqual([60, 71]);
  });

  it("falls back when there is no used range", () => {
    expect(autoRange(null)).toEqual([48, 83]);
  });
});

// With no song loaded the app still has to draw a keyboard, and the Keys setting still
// has to mean something — picking "Full 88" on the empty screen used to leave the
// renderer's default three octaves up until a song was loaded.
describe("visibleRange with no song", () => {
  it("shows all 88 keys for full", () => {
    expect(visibleRange([], "full")).toEqual([PIANO_LOW, PIANO_HIGH]);
  });

  it("falls back to a sensible middle range for auto", () => {
    expect(visibleRange([], "auto")).toEqual([48, 83]);
  });

  it("centres an octave zoom on middle C", () => {
    expect(visibleRange([], 2)).toEqual([48, 71]);
  });
});

describe("visibleRange", () => {
  const notes = [note(60), note(64), note(67)]; // centred around ~E4

  it("full shows the whole 88-key piano", () => {
    expect(visibleRange(notes, "full")).toEqual([PIANO_LOW, PIANO_HIGH]);
  });

  it("auto fits the used range to octaves", () => {
    expect(visibleRange(notes, "auto")).toEqual([60, 71]);
  });

  it("a numeric zoom shows that many octaves", () => {
    const [low, high] = visibleRange(notes, 2);
    expect(high - low + 1).toBe(24); // two octaves of keys
    expect(low % 12).toBe(0); // starts on a C
  });

  it("keeps the window on the real keyboard for high music", () => {
    const [low, high] = visibleRange([note(105)], 2);
    expect(low).toBeGreaterThanOrEqual(PIANO_LOW);
    expect(high).toBeLessThanOrEqual(PIANO_HIGH);
  });

  it("keeps the window on the keyboard for very low music", () => {
    const [low, high] = visibleRange([note(24)], 3);
    expect(low).toBeGreaterThanOrEqual(PIANO_LOW);
    expect(high).toBeLessThanOrEqual(PIANO_HIGH);
  });
});
