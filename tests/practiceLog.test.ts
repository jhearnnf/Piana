import { describe, it, expect } from "vitest";
import {
  logKey,
  MAX_ATTEMPTS,
  parseLog,
  parseLogKey,
  recordAttempt,
  summarize,
  type Attempt,
} from "../src/game/practiceLog.ts";
import type { ScoreResult } from "../src/game/Scoring.ts";

function result(over: Partial<ScoreResult> = {}): ScoreResult {
  return {
    totalNotes: 8,
    perfect: 6,
    good: 2,
    missed: 0,
    wrong: 0,
    maxCombo: 8,
    accuracy: 1,
    avgTimingMs: 30,
    score: 720,
    stars: 3,
    ...over,
  };
}

function attempt(over: Partial<Attempt> = {}): Attempt {
  return {
    at: 1_000,
    seconds: 12,
    sectionId: "loop:4.00-12.00",
    label: "Bridge",
    difficulty: "easy",
    hand: "both",
    result: result(),
    ...over,
  };
}

describe("recordAttempt", () => {
  it("keeps attempts in the order they were played", () => {
    const log = [attempt({ at: 1 }), attempt({ at: 2 })].reduce(recordAttempt, [] as Attempt[]);
    expect(log.map((a) => a.at)).toEqual([1, 2]);
  });

  it("drops the oldest once the song is full, so practice is never refused", () => {
    let log: Attempt[] = [];
    for (let i = 0; i < MAX_ATTEMPTS + 3; i++) log = recordAttempt(log, attempt({ at: i }));

    expect(log).toHaveLength(MAX_ATTEMPTS);
    expect(log[0]!.at).toBe(3);
    expect(log[log.length - 1]!.at).toBe(MAX_ATTEMPTS + 2);
  });
});

describe("summarize", () => {
  it("gathers one row per setup, most recently practised first", () => {
    const rows = summarize([
      attempt({ at: 10, sectionId: "full", label: "" }),
      attempt({ at: 20 }),
      attempt({ at: 30 }),
    ]);

    expect(rows.map((row) => row.sectionId)).toEqual(["loop:4.00-12.00", "full"]);
    expect(rows[0]!.attempts).toBe(2);
    expect(rows[1]!.attempts).toBe(1);
  });

  it("keeps the same passage apart by difficulty and hand", () => {
    const rows = summarize([
      attempt({ at: 10 }),
      attempt({ at: 20, hand: "left" }),
      attempt({ at: 30, difficulty: "hard" }),
    ]);
    expect(rows).toHaveLength(3);
  });

  it("totals the time spent, takes the best score, and holds both ends of the trend", () => {
    const rows = summarize([
      attempt({ at: 10, seconds: 30, result: result({ score: 400, accuracy: 0.5 }) }),
      attempt({ at: 20, seconds: 25, result: result({ score: 900, accuracy: 0.9 }) }),
      attempt({ at: 30, seconds: 20, result: result({ score: 800, accuracy: 0.95 }) }),
    ]);

    const row = rows[0]!;
    expect(row.seconds).toBe(75);
    expect(row.bestScore).toBe(900);
    expect(row.first.result.accuracy).toBe(0.5);
    expect(row.last.result.accuracy).toBe(0.95);
  });

  it("names a passage what it was called most recently", () => {
    const rows = summarize([
      attempt({ at: 10, label: "Loop 1" }),
      attempt({ at: 20, label: "Left hand run" }),
    ]);
    expect(rows[0]!.label).toBe("Left hand run");
  });

  it("reads the ends off the times, not off the order it was handed", () => {
    const rows = summarize([attempt({ at: 30, seconds: 5 }), attempt({ at: 10, seconds: 9 })]);
    expect(rows[0]!.first.seconds).toBe(9);
    expect(rows[0]!.last.seconds).toBe(5);
  });
});

describe("parseLog", () => {
  it("reads back what was written, oldest first", () => {
    const log = [attempt({ at: 30 }), attempt({ at: 10 })];
    expect(parseLog(JSON.stringify(log)).map((a) => a.at)).toEqual([10, 30]);
  });

  it("has nothing to say about missing or unreadable storage", () => {
    expect(parseLog(null)).toEqual([]);
    expect(parseLog("{oh dear")).toEqual([]);
    expect(parseLog('{"not":"an array"}')).toEqual([]);
  });

  it("drops attempts that are not entirely well-formed", () => {
    const bad: unknown[] = [
      { ...attempt(), at: "yesterday" },
      { ...attempt(), seconds: -1 },
      { ...attempt(), seconds: Number.POSITIVE_INFINITY },
      { ...attempt(), sectionId: "" },
      { ...attempt(), label: null },
      { ...attempt(), difficulty: "impossible" },
      { ...attempt(), hand: "foot" },
      { ...attempt(), result: undefined },
      { ...attempt(), result: { ...result(), score: "lots" } },
      null,
      7,
    ];
    expect(parseLog(JSON.stringify([...bad, attempt({ at: 99 })]))).toEqual([attempt({ at: 99 })]);
  });
});

describe("logKey", () => {
  it("reads back into the song it belongs to", () => {
    for (const name of ["Song A", "a|b:c%d", "Étude — n°1"]) {
      expect(parseLogKey(logKey(name))).toBe(name);
    }
  });

  it("ignores keys that are not ours", () => {
    expect(parseLogKey("piana:best:Song A|easy|both|full")).toBeNull();
    expect(parseLogKey("piana:loops:Song A")).toBeNull();
    expect(parseLogKey("piana:log:")).toBeNull();
  });
});
