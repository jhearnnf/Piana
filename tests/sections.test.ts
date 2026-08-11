import { describe, it, expect } from "vitest";
import type { Note, Song } from "../src/core/types.ts";
import { detectSections } from "../src/song/sections.ts";

function note(time: number, duration = 0.4): Note {
  return { midi: 60, time, duration, velocity: 0.8, hand: "right" };
}

function song(notes: Note[], durationSec = 100): Song {
  return {
    name: "t",
    notes,
    tracks: [],
    tempoMap: [{ time: 0, bpm: 120 }],
    timeSignature: { numerator: 4, denominator: 4 },
    durationSec,
  };
}

describe("detectSections", () => {
  it("returns a full-song section when there are no notes", () => {
    const s = detectSections(song([]));
    expect(s).toHaveLength(1);
    expect(s[0]!.id).toBe("full");
  });

  it("splits at a clear rest", () => {
    // Two phrases (each > minLen) with a ~2.6s gap between them.
    const notes = [
      note(0), note(0.5), note(1.0), note(1.5), note(2.0),
      note(4.6), note(5.1), note(5.6), note(6.1), note(6.6),
    ];
    const s = detectSections(song(notes));
    expect(s).toHaveLength(2);
    expect(s[0]!.start).toBe(0);
    expect(s[1]!.start).toBe(4.6);
  });

  it("produces contiguous ranges that cover the material", () => {
    const notes = [note(0), note(3.0), note(6.0)]; // gaps > 0.6 each -> 3 phrases
    const s = detectSections(song(notes));
    for (let i = 1; i < s.length; i++) {
      expect(s[i]!.start).toBe(s[i - 1]!.end); // no gaps or overlaps between sections
    }
  });

  it("does not split a continuous passage on gaps", () => {
    // Notes every 0.4s (no rest >= 0.6) -> a single phrase (before long-split).
    const notes = Array.from({ length: 10 }, (_, i) => note(i * 0.4));
    const s = detectSections(song(notes), { maxLenSec: 100 });
    expect(s).toHaveLength(1);
  });

  it("splits an overly long section into equal pieces", () => {
    const notes = Array.from({ length: 60 }, (_, i) => note(i)); // ~60s continuous
    const s = detectSections(song(notes), { gapSec: 2, maxLenSec: 20 });
    expect(s.length).toBeGreaterThanOrEqual(3);
    for (const sec of s) expect(sec.end - sec.start).toBeLessThanOrEqual(20 + 1e-6);
  });

  it("merges a tiny fragment into its neighbour", () => {
    // A lone note far away creates a tiny final section that should merge back.
    const notes = [note(0), note(0.5), note(1.0), note(5.0)];
    const s = detectSections(song(notes), { minLenSec: 2 });
    // The tiny phrase at 5.0 (length ~0.4) should not stand alone.
    expect(s.every((sec) => sec.end - sec.start >= 2 || s.length === 1)).toBe(true);
  });
});
