import { describe, it, expect } from "vitest";
import type { Note } from "../src/core/types.ts";
import {
  MIN_NOTE_HEIGHT,
  MIN_NOTE_WIDTH,
  miniMapNotes,
  timeToX,
  xToTime,
} from "../src/render/miniMap.ts";

function note(midi: number, time: number, duration = 1, hand: Note["hand"] = "right"): Note {
  return { midi, time, duration, velocity: 0.8, hand };
}

const size = { width: 200, height: 40 };

describe("timeToX / xToTime", () => {
  it("spreads the song across the width", () => {
    expect(timeToX(0, 100, 200)).toBe(0);
    expect(timeToX(50, 100, 200)).toBe(100);
    expect(timeToX(100, 100, 200)).toBe(200);
  });

  it("reads a point on the map back as the moment it stands for", () => {
    expect(xToTime(100, 100, 200)).toBe(50);
    expect(xToTime(0, 100, 200)).toBe(0);
    expect(xToTime(200, 100, 200)).toBe(100);
  });

  it("holds a click outside the map inside the song", () => {
    expect(xToTime(-40, 100, 200)).toBe(0);
    expect(xToTime(999, 100, 200)).toBe(100);
  });

  it("has one answer for a song with no length", () => {
    expect(timeToX(5, 0, 200)).toBe(0);
    expect(xToTime(100, 0, 200)).toBe(0);
  });
});

describe("miniMapNotes", () => {
  const notes = [note(60, 0), note(72, 10), note(48, 20)];

  it("places a note by its time across and its pitch up", () => {
    const [middle, high, low] = miniMapNotes(notes, 40, size);
    expect(middle!.x).toBe(0);
    expect(high!.x).toBe(50);
    expect(low!.x).toBe(100);
    // The highest note sits above the lowest.
    expect(high!.y).toBeLessThan(middle!.y);
    expect(middle!.y).toBeLessThan(low!.y);
  });

  it("fits the pitch axis to the notes the song actually uses", () => {
    const map = miniMapNotes(notes, 40, size);
    const tops = map.map((n) => n.y);
    // The outermost notes reach the outermost rows rather than sitting in a narrow band
    // in the middle of an otherwise empty map.
    expect(Math.min(...tops)).toBeLessThan(size.height * 0.25);
    expect(Math.max(...tops)).toBeGreaterThan(size.height * 0.5);
  });

  it("keeps every note inside the map", () => {
    for (const n of miniMapNotes(notes, 40, size)) {
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y + n.h).toBeLessThanOrEqual(size.height);
      expect(n.x + n.w).toBeLessThanOrEqual(size.width + 0.001);
    }
  });

  it("gives a note too small to see a mark of its own", () => {
    // A grace note in a long song is worth a fraction of a pixel; drawn honestly it would
    // simply not be there, and a map with the fast passages missing is worse than none.
    const [only] = miniMapNotes([note(60, 0, 0.001)], 600, size);
    expect(only!.w).toBe(MIN_NOTE_WIDTH);
    expect(only!.h).toBeGreaterThanOrEqual(MIN_NOTE_HEIGHT);
  });

  it("carries the hand through, since that is what colours it", () => {
    const map = miniMapNotes([note(60, 0, 1, "left"), note(64, 1, 1, "right")], 4, size);
    expect(map.map((n) => n.hand)).toEqual(["left", "right"]);
  });

  it("has nothing to draw for an empty song, or none to draw it in", () => {
    expect(miniMapNotes([], 40, size)).toEqual([]);
    expect(miniMapNotes(notes, 0, size)).toEqual([]);
    expect(miniMapNotes(notes, 40, { width: 0, height: 40 })).toEqual([]);
  });

  it("does not collapse when every note is the same pitch", () => {
    const flat = miniMapNotes([note(60, 0), note(60, 10)], 20, size);
    expect(flat).toHaveLength(2);
    for (const n of flat) expect(n.h).toBeGreaterThanOrEqual(MIN_NOTE_HEIGHT);
  });
});
