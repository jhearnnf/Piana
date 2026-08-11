import { describe, it, expect } from "vitest";
import {
  computeKeyboard,
  countWhiteKeys,
  isBlackKey,
} from "../src/render/keyboardLayout.ts";

describe("isBlackKey", () => {
  it("identifies the five black keys per octave", () => {
    // C=60 white, C#=61 black, ... B=71 white
    expect(isBlackKey(60)).toBe(false); // C
    expect(isBlackKey(61)).toBe(true); // C#
    expect(isBlackKey(63)).toBe(true); // D#
    expect(isBlackKey(65)).toBe(false); // F
    expect(isBlackKey(66)).toBe(true); // F#
    expect(isBlackKey(71)).toBe(false); // B
  });
});

describe("countWhiteKeys", () => {
  it("counts 7 white keys per octave", () => {
    expect(countWhiteKeys(60, 72)).toBe(7); // C4..B4
  });
});

describe("computeKeyboard", () => {
  it("returns one rect per key in the range", () => {
    const keys = computeKeyboard(60, 72, 800); // C4..C5 inclusive = 13 keys
    expect(keys).toHaveLength(13);
  });

  it("tiles white keys evenly and edge-to-edge", () => {
    const keys = computeKeyboard(60, 71, 700); // C4..B4 = 7 white + 5 black
    const whites = keys.filter((k) => !k.isBlack);
    expect(whites).toHaveLength(7);
    const whiteWidth = 700 / 7;
    // White keys start at 0 and each abuts the next.
    expect(whites[0]!.x).toBeCloseTo(0, 5);
    for (let i = 1; i < whites.length; i++) {
      expect(whites[i]!.x).toBeCloseTo(i * whiteWidth, 5);
    }
    // Last white key's right edge is the full width.
    const last = whites[whites.length - 1]!;
    expect(last.x + last.width).toBeCloseTo(700, 5);
  });

  it("centres black keys on the boundary between neighbouring white keys", () => {
    const keys = computeKeyboard(60, 71, 700);
    const whiteWidth = 700 / 7;
    const cSharp = keys.find((k) => k.midi === 61)!; // between C(0) and D(1)
    expect(cSharp.isBlack).toBe(true);
    expect(cSharp.x + cSharp.width / 2).toBeCloseTo(whiteWidth, 5);
  });

  it("handles an empty range", () => {
    expect(computeKeyboard(60, 59, 700)).toEqual([]);
  });
});
