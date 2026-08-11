import { describe, it, expect } from "vitest";
import {
  groupBySong,
  parseScoreKey,
  scoreKey,
  type BestEntry,
  type ScoreContext,
} from "../src/game/highScores.ts";
import type { ScoreResult } from "../src/game/Scoring.ts";

describe("scoreKey", () => {
  it("is distinct per song, difficulty, hand, and section", () => {
    const base = { songName: "Song A", difficulty: "easy", hand: "both", sectionId: "full" } as const;
    const k = scoreKey(base);
    expect(k).toBe(scoreKey({ ...base })); // stable
    expect(k).not.toBe(scoreKey({ ...base, difficulty: "hard" }));
    expect(k).not.toBe(scoreKey({ ...base, hand: "left" }));
    expect(k).not.toBe(scoreKey({ ...base, sectionId: "1" }));
  });

  it("escapes separators in the song name so keys can't collide", () => {
    const a = scoreKey({ songName: "a|b", difficulty: "easy", hand: "both", sectionId: "full" });
    const b = scoreKey({ songName: "a", difficulty: "easy", hand: "both", sectionId: "b|full" });
    expect(a).not.toBe(b);
  });
});

describe("parseScoreKey", () => {
  it("reads back every setup scoreKey can write", () => {
    const setups: ScoreContext[] = [
      { songName: "Song A", difficulty: "easy", hand: "both", sectionId: "full" },
      { songName: "a|b:c%d", difficulty: "hard", hand: "left", sectionId: "3" },
      { songName: "Étude — n°1", difficulty: "medium", hand: "right", sectionId: "0" },
    ];
    for (const setup of setups) {
      expect(parseScoreKey(scoreKey(setup))).toEqual(setup);
    }
  });

  it("ignores anything that isn't a stored score", () => {
    expect(parseScoreKey("piana:zoom")).toBeNull();
    expect(parseScoreKey("piana:best:Song|easy|both")).toBeNull(); // too few parts
    expect(parseScoreKey("piana:best:Song|expert|both|full")).toBeNull(); // not a difficulty
    expect(parseScoreKey("piana:best:Song|easy|foot|full")).toBeNull(); // not a hand
    expect(parseScoreKey("piana:best:%E0%A4%A|easy|both|full")).toBeNull(); // bad encoding
  });
});

describe("groupBySong", () => {
  const entry = (songName: string, score: number, sectionId = "full"): BestEntry => ({
    ctx: { songName, difficulty: "easy", hand: "both", sectionId },
    result: { score } as ScoreResult,
    savedAt: null,
  });

  it("collects each song's runs, best first", () => {
    const groups = groupBySong([entry("A", 100), entry("A", 300, "1"), entry("A", 200, "2")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.topScore).toBe(300);
    expect(groups[0]!.entries.map((e) => e.result.score)).toEqual([300, 200, 100]);
  });

  it("puts the song with the best run first, and breaks ties by name", () => {
    const groups = groupBySong([entry("Zebra", 50), entry("Bee", 900), entry("Ant", 50)]);
    expect(groups.map((g) => g.songName)).toEqual(["Bee", "Ant", "Zebra"]);
  });

  it("has nothing to show when nothing has been played", () => {
    expect(groupBySong([])).toEqual([]);
  });
});
