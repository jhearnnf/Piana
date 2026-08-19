import { describe, it, expect } from "vitest";
import type { BestEntry, SongScores } from "../src/game/highScores.ts";
import type { ScoreResult } from "../src/game/Scoring.ts";
import {
  buildLibrary,
  filterLibrary,
  isPlayed,
  playedCount,
  songTitle,
} from "../src/song/library.ts";

function result(score: number, stars = 3): ScoreResult {
  return {
    totalNotes: 10,
    perfect: 10,
    good: 0,
    missed: 0,
    wrong: 0,
    maxCombo: 10,
    accuracy: 1,
    avgTimingMs: 12,
    score,
    stars,
  };
}

function entry(songName: string, score: number, savedAt: number | null = 1000): BestEntry {
  return {
    ctx: { songName, difficulty: "hard", hand: "both", sectionId: "full" },
    result: result(score),
    savedAt,
  };
}

/** A SongScores as `groupBySong` builds it: entries best-first. */
function scores(songName: string, entries: BestEntry[]): SongScores {
  return {
    songName,
    entries: [...entries].sort((a, b) => b.result.score - a.result.score),
    topScore: entries.reduce((max, e) => Math.max(max, e.result.score), 0),
  };
}

describe("songTitle", () => {
  it("strips .mid and .midi, and nothing else", () => {
    expect(songTitle("Clair de Lune.mid")).toBe("Clair de Lune");
    expect(songTitle("Clair de Lune.MIDI")).toBe("Clair de Lune");
    expect(songTitle("Fugue in D minor.v2.mid")).toBe("Fugue in D minor.v2");
    expect(songTitle("no extension")).toBe("no extension");
  });
});

describe("buildLibrary", () => {
  it("keeps the folder's order and one row per file", () => {
    const songs = buildLibrary(["b.mid", "a.mid", "c.midi"], []);
    expect(songs.map((s) => s.file)).toEqual(["b.mid", "a.mid", "c.midi"]);
    expect(songs.map((s) => s.title)).toEqual(["b", "a", "c"]);
  });

  it("marks a file with no stored score as unplayed", () => {
    const [song] = buildLibrary(["Nocturne.mid"], []);
    expect(isPlayed(song!)).toBe(false);
    expect(song!.best).toBeNull();
    expect(song!.topScore).toBe(0);
    expect(song!.runs).toBe(0);
    expect(song!.lastPlayed).toBeNull();
  });

  it("joins a file to its scores by the title, not the file name", () => {
    const [song] = buildLibrary(["Nocturne.mid"], [scores("Nocturne", [entry("Nocturne", 900)])]);
    expect(isPlayed(song!)).toBe(true);
    expect(song!.topScore).toBe(900);
  });

  it("shows the best run of several, and counts the rest", () => {
    const runs = [entry("Etude", 400), entry("Etude", 1200), entry("Etude", 800)];
    const [song] = buildLibrary(["Etude.mid"], [scores("Etude", runs)]);
    expect(song!.best?.result.score).toBe(1200);
    expect(song!.topScore).toBe(1200);
    expect(song!.runs).toBe(3);
  });

  it("reports the most recent run's date, not the best run's", () => {
    const runs = [entry("Etude", 1200, 500), entry("Etude", 300, 9000)];
    const [song] = buildLibrary(["Etude.mid"], [scores("Etude", runs)]);
    expect(song!.best?.result.score).toBe(1200);
    expect(song!.lastPlayed).toBe(9000);
  });

  it("copes with scores saved before dates were recorded", () => {
    const [song] = buildLibrary(
      ["Etude.mid"],
      [scores("Etude", [entry("Etude", 1200, null)])],
    );
    expect(song!.lastPlayed).toBeNull();
    expect(song!.topScore).toBe(1200);
  });

  it("drops scores for songs that are not in the folder", () => {
    const songs = buildLibrary(["a.mid"], [scores("a", [entry("a", 10)]), scores("gone", [])]);
    expect(songs).toHaveLength(1);
    expect(songs[0]!.title).toBe("a");
  });
});

describe("filterLibrary", () => {
  const songs = buildLibrary(
    ["Beethoven - Moonlight Sonata.mid", "Debussy - Clair de Lune.mid", "Chopin - Nocturne.mid"],
    [],
  );
  const titles = (query: string) => filterLibrary(songs, query).map((s) => s.title);

  it("returns everything for an empty query", () => {
    expect(filterLibrary(songs, "")).toHaveLength(3);
    expect(filterLibrary(songs, "   ")).toHaveLength(3);
  });

  it("matches any part of the name, ignoring case", () => {
    expect(titles("noct")).toEqual(["Chopin - Nocturne"]);
    expect(titles("MOON")).toEqual(["Beethoven - Moonlight Sonata"]);
  });

  it("matches each word separately, so word order doesn't matter", () => {
    expect(titles("moon beet")).toEqual(["Beethoven - Moonlight Sonata"]);
  });

  it("returns nothing when nothing matches", () => {
    expect(titles("ragtime")).toEqual([]);
  });

  it("does not mutate the list it was given", () => {
    filterLibrary(songs, "noct");
    expect(songs).toHaveLength(3);
  });
});

describe("playedCount", () => {
  it("counts only the songs with a stored best", () => {
    const songs = buildLibrary(["a.mid", "b.mid", "c.mid"], [scores("b", [entry("b", 5)])]);
    expect(playedCount(songs)).toBe(1);
    expect(playedCount([])).toBe(0);
  });
});
