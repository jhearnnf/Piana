import { describe, expect, it } from "vitest";
import type { Attempt } from "../src/game/practiceLog.ts";
import {
  isLapOf,
  loopProgress,
  rollingAverage,
  summarizeProgress,
} from "../src/game/progress.ts";
import { loopSectionId } from "../src/song/loopRegion.ts";

const RANGE = { start: 10, end: 18 };

function lap(over: Partial<Attempt> & { accuracy?: number } = {}): Attempt {
  const { accuracy = 0.8, ...rest } = over;
  return {
    at: 1_000,
    seconds: 10,
    sectionId: loopSectionId(RANGE),
    label: "Bridge",
    difficulty: "hard",
    hand: "both",
    result: {
      totalNotes: 10,
      perfect: 8,
      good: 0,
      missed: 2,
      wrong: 0,
      maxCombo: 8,
      accuracy,
      avgTimingMs: 20,
      score: Math.round(accuracy * 1000),
      stars: 3,
    },
    ...rest,
  };
}

describe("isLapOf", () => {
  it("matches the loop's own range, and one a hair off it", () => {
    expect(isLapOf(lap(), RANGE)).toBe(true);
    expect(isLapOf(lap({ sectionId: "loop:10.01-17.99" }), RANGE)).toBe(true);
    // Seen in a real log: laps of a stretch played before it was saved, 0.03s short.
    expect(isLapOf(lap({ sectionId: "loop:10.00-17.97" }), RANGE)).toBe(true);
  });

  it("does not match another stretch, a section or the whole song", () => {
    expect(isLapOf(lap({ sectionId: "loop:10.00-20.00" }), RANGE)).toBe(false);
    expect(isLapOf(lap({ sectionId: "loop:10.00-18.30" }), RANGE)).toBe(false);
    expect(isLapOf(lap({ sectionId: "2" }), RANGE)).toBe(false);
    expect(isLapOf(lap({ sectionId: "full" }), RANGE)).toBe(false);
  });
});

describe("loopProgress", () => {
  it("splits laps by setup, oldest first within each, most recent setup first", () => {
    const log = [
      lap({ at: 3, hand: "left" }),
      lap({ at: 1 }),
      lap({ at: 2 }),
      lap({ at: 4, sectionId: "full" }),
    ];
    const setups = loopProgress(log, RANGE);
    expect(setups.map((s) => s.hand)).toEqual(["left", "both"]);
    expect(setups[1]!.laps.map((l) => l.at)).toEqual([1, 2]);
  });

  it("is empty for a loop never played", () => {
    expect(loopProgress([lap({ sectionId: "full" })], RANGE)).toEqual([]);
  });
});

describe("rollingAverage", () => {
  it("averages each point with the ones before it, up to the window", () => {
    expect(rollingAverage([2, 4, 6, 8], 2)).toEqual([2, 3, 5, 7]);
    expect(rollingAverage([3], 5)).toEqual([3]);
  });
});

describe("summarizeProgress", () => {
  it("compares the first laps with the latest, never sharing one between them", () => {
    const laps = [0.5, 0.6, 0.9, 1].map((accuracy, i) =>
      lap({ accuracy, seconds: 20 - i * 2, at: i }),
    );
    const s = summarizeProgress(laps)!;
    expect(s.laps).toBe(4);
    expect(s.firstAccuracy).toBeCloseTo(0.55);
    expect(s.recentAccuracy).toBeCloseTo(0.95);
    expect(s.firstSeconds).toBeCloseTo(19);
    expect(s.recentSeconds).toBeCloseTo(15);
    expect(s.seconds).toBe(20 + 18 + 16 + 14);
    expect(s.bestAccuracy).toBe(1);
    expect(s.fastestSeconds).toBe(14);
  });

  it("counts the days practised", () => {
    const day = 24 * 60 * 60 * 1000;
    const laps = [lap({ at: day * 100 }), lap({ at: day * 100 + 60_000 }), lap({ at: day * 103 })];
    expect(summarizeProgress(laps)!.days).toBe(2);
  });

  it("has nothing to say about no laps", () => {
    expect(summarizeProgress([])).toBeNull();
  });
});
