import { describe, it, expect } from "vitest";
import type { Note } from "../src/core/types.ts";
import { ScoringSession, starsFor } from "../src/game/Scoring.ts";

function note(midi: number, time: number): Note {
  return { midi, time, duration: 0.5, velocity: 0.8, hand: "right" };
}

const expected = [note(60, 1), note(62, 2), note(64, 3)];

describe("ScoringSession", () => {
  it("scores a perfect run", () => {
    const s = new ScoringSession(expected);
    expect(s.registerHit(60, 1.0)).toBe("perfect");
    expect(s.registerHit(62, 2.0)).toBe("perfect");
    expect(s.registerHit(64, 3.0)).toBe("perfect");
    s.finalize();
    const r = s.result();
    expect(r.perfect).toBe(3);
    expect(r.missed).toBe(0);
    expect(r.accuracy).toBe(1);
    expect(r.stars).toBe(3);
    expect(r.maxCombo).toBe(3);
  });

  it("classifies a slightly-late hit as good, not perfect", () => {
    const s = new ScoringSession(expected);
    expect(s.registerHit(60, 1.1)).toBe("good"); // 100ms late: within good, outside perfect
  });

  it("counts wrong notes and breaks the combo", () => {
    const s = new ScoringSession(expected);
    s.registerHit(60, 1.0); // perfect, combo 1
    expect(s.registerHit(99, 1.0)).toBe("wrong");
    s.registerHit(62, 2.0); // perfect, combo restarts
    const r = s.result();
    expect(r.wrong).toBe(1);
    expect(r.maxCombo).toBe(1);
  });

  it("marks notes as missed once their window closes", () => {
    const s = new ScoringSession(expected);
    s.registerHit(60, 1.0); // hit first
    s.update(2.5); // note at 2 is now past its window -> missed
    const r = s.result();
    expect(r.missed).toBe(1);
  });

  it("does not match a hit outside the good window", () => {
    const s = new ScoringSession([note(60, 1)]);
    expect(s.registerHit(60, 1.5)).toBe("wrong"); // 500ms off
  });

  it("picks the nearest note when two of the same pitch are close", () => {
    const s = new ScoringSession([note(60, 1.0), note(60, 1.1)]);
    s.registerHit(60, 1.09); // should match the 1.1 note (nearest)
    s.registerHit(60, 1.0); // then the 1.0 note
    const r = s.result();
    expect(r.perfect + r.good).toBe(2);
    expect(r.wrong).toBe(0);
  });

  it("applies the difficulty multiplier", () => {
    const s = new ScoringSession([note(60, 1)]);
    s.registerHit(60, 1.0); // 100 raw points
    expect(s.result("easy").score).toBe(100);
    expect(s.result("hard").score).toBe(150);
  });

  it("handles an empty expected list", () => {
    const s = new ScoringSession([]);
    s.finalize();
    const r = s.result();
    expect(r.totalNotes).toBe(0);
    expect(r.accuracy).toBe(0);
  });
});

describe("starsFor", () => {
  it("maps accuracy to 0-3 stars", () => {
    expect(starsFor(1)).toBe(3);
    expect(starsFor(0.85)).toBe(2);
    expect(starsFor(0.6)).toBe(1);
    expect(starsFor(0.2)).toBe(0);
  });
});
