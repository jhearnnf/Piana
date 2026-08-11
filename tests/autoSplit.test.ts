import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Note } from "../src/core/types.ts";
import { autoSplitHands } from "../src/song/autoSplit.ts";
import { parseMidi } from "../src/midi/parseMidi.ts";

function note(midi: number, time: number, duration = 0.4): Note {
  return { midi, time, duration, velocity: 0.8, hand: "right" };
}

/** Compact view of a split: "L" / "R" per note, in the order given. */
const hands = (notes: readonly Note[]): string => notes.map((n) => (n.hand === "left" ? "L" : "R")).join("");

describe("autoSplitHands", () => {
  it("has nothing to do with no notes", () => {
    expect(() => autoSplitHands([])).not.toThrow();
  });

  it("splits a bass line from a melody played over it", () => {
    const notes: Note[] = [];
    for (let i = 0; i < 8; i++) {
      notes.push(note(48 + (i % 3), i * 0.5)); // walking bass, C3-ish
      notes.push(note(72 + (i % 4), i * 0.5)); // melody, C5-ish
    }
    autoSplitHands(notes);

    expect(notes.filter((n) => n.midi < 60).every((n) => n.hand === "left")).toBe(true);
    expect(notes.filter((n) => n.midi > 60).every((n) => n.hand === "right")).toBe(true);
  });

  it("keeps a one-hand melody in one hand instead of cutting it in half", () => {
    // A single line wandering around C5: there is no second part, so a fixed split at
    // middle C would be right by luck and a split at the median would be wrong on purpose.
    const line = [76, 74, 72, 74, 76, 76, 76, 74, 74, 74, 76, 79, 79].map((m, i) =>
      note(m, i * 0.4),
    );
    autoSplitHands(line);
    expect(hands(line)).toBe("R".repeat(line.length));
  });

  it("follows a hand up the keyboard past a fixed split point", () => {
    // The left hand climbs from C2 to C5 while the right sits still. A boundary at middle C
    // would hand the top half of the climb to the right hand.
    const notes: Note[] = [];
    for (let i = 0; i < 12; i++) {
      notes.push(note(36 + i * 3, i * 0.5)); // the climb
      notes.push(note(84, i * 0.5)); // a held-ish high pedal note, clearly the other hand
    }
    autoSplitHands(notes);

    const climb = notes.filter((n) => n.midi !== 84);
    expect(hands(climb)).toBe("L".repeat(climb.length));
  });

  it("cuts a wide chord rather than asking one hand for an impossible reach", () => {
    // Two octaves and a fifth in one grab: no hand does that, so it has to be shared.
    const chord = [36, 43, 48, 64, 67, 72].map((m) => note(m, 0));
    autoSplitHands(chord);

    for (const hand of ["left", "right"] as const) {
      const side = chord.filter((n) => n.hand === hand);
      if (side.length === 0) continue;
      const span = side[side.length - 1]!.midi - side[0]!.midi;
      expect(span).toBeLessThanOrEqual(14);
    }
  });

  it("gives a distant run to whichever hand is nearer, not to a fixed register", () => {
    // Both hands are established; then a run appears well below either of them. It belongs
    // to the left purely because the left is closer, which is the whole idea.
    const notes: Note[] = [];
    for (let i = 0; i < 6; i++) {
      notes.push(note(48, i * 0.5));
      notes.push(note(84, i * 0.5));
    }
    for (let i = 0; i < 4; i++) notes.push(note(30 + i, 3 + i * 0.25)); // deep run
    autoSplitHands(notes);

    expect(notes.filter((n) => n.midi < 40).every((n) => n.hand === "left")).toBe(true);
  });

  it("uses the free hand rather than swallowing a chord whole", () => {
    // A bass note under a melody note. One hand can reach both, and if idleness were free
    // it would — leaving half the piece in one hand and the stage in one colour.
    const notes = [note(55, 0), note(60, 0), note(55, 1), note(62, 1)];
    autoSplitHands(notes);
    expect(hands(notes)).toBe("LRLR");
  });

  it("still lets one hand hold a chord the other cannot help with", () => {
    // A right-hand triad while the left is busy an octave and a half below: sharing it
    // would mean abandoning the bass, so the triad stays in one hand.
    const notes = [
      note(36, 0),
      note(60, 0),
      note(64, 0),
      note(67, 0),
      note(36, 0.5),
      note(60, 0.5),
      note(64, 0.5),
      note(67, 0.5),
    ];
    autoSplitHands(notes);
    expect(hands(notes)).toBe("LRRRLRRR");
  });

  it("recovers the hand separation a real two-track file was written with", () => {
    // The strongest check there is: throw away what the file says about tracks, split the
    // notes on their own merits, and see whether the composer's own answer comes back.
    //
    // This is the test that earns its keep. Both of the interesting costs — travel judged
    // by the time available, and the price of swallowing a chord one hand could share —
    // exist because this song came out wrong without them, in ways no invented example
    // here had shown.
    const file = path.join(process.cwd(), "public", "samples", "twinkle-twinkle.mid");
    const song = parseMidi(new Uint8Array(fs.readFileSync(file)));
    const byTrack = new Map(song.notes.map((n) => [n, n.track]));

    autoSplitHands(song.notes);

    const bass = song.notes.filter((n) => byTrack.get(n) === 1);
    const melody = song.notes.filter((n) => byTrack.get(n) === 0);
    expect(bass.length).toBeGreaterThan(0);
    expect(melody.length).toBeGreaterThan(0);
    expect(bass.every((n) => n.hand === "left")).toBe(true);
    expect(melody.every((n) => n.hand === "right")).toBe(true);
  });

  it("is deterministic", () => {
    const build = (): Note[] =>
      [60, 64, 67, 48, 55, 72, 36, 76, 79].map((m, i) => note(m, i * 0.3));
    const a = build();
    const b = build();
    autoSplitHands(a);
    autoSplitHands(b);
    expect(hands(a)).toBe(hands(b));
  });
});
