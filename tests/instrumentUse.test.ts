import { describe, it, expect } from "vitest";
import {
  filterInstruments,
  MAX_REMEMBERED,
  mostPlayed,
  parseUses,
  playTimeLabel,
  rank,
  recordUse,
  type InstrumentUse,
} from "../src/audio/instrumentUse.ts";

/**
 * Which sounds get to the top of the picker.
 *
 * A sample library ships two hundred-odd presets and you use about five. The whole value
 * of this is in the ordering being right often enough that you stop reading the list — so
 * what is checked here is that time played beats everything else, and that a name which
 * has left the library cannot sit at the top of it being unclickable.
 */

const use = (name: string, seconds: number, lastUsed = 0): InstrumentUse => ({
  name,
  seconds,
  lastUsed,
});

describe("banking time played", () => {
  it("starts a sound off at the time it was just played for", () => {
    expect(recordUse([], ["Grand Piano"], 30, 1000)).toEqual([
      { name: "Grand Piano", seconds: 30, lastUsed: 1000 },
    ]);
  });

  it("adds to a sound that has been played before", () => {
    const before = [use("Grand Piano", 100, 500)];
    expect(recordUse(before, ["Grand Piano"], 30, 1000)).toEqual([
      { name: "Grand Piano", seconds: 130, lastUsed: 1000 },
    ]);
  });

  /**
   * Not a share of it. Three sounds layered for an hour is an hour of each, because each
   * is a sound you chose to listen to for an hour — dividing it would rank a layered
   * favourite below something used briefly on its own.
   */
  it("credits every sound in a stack the whole time", () => {
    const after = recordUse([], ["Grand Piano", "Ancient Choir"], 60, 1000);
    expect(after.map((u) => u.seconds)).toEqual([60, 60]);
  });

  it("counts a sound named twice in a stack only once", () => {
    const after = recordUse([], ["Vibes", "Vibes"], 60, 1000);
    expect(after).toEqual([{ name: "Vibes", seconds: 60, lastUsed: 1000 }]);
  });

  it("has nothing to record for no time or no sounds", () => {
    const before = [use("Grand Piano", 100)];
    expect(recordUse(before, ["Grand Piano"], 0, 1000)).toEqual(before);
    expect(recordUse(before, [], 30, 1000)).toEqual(before);
  });

  it("leaves the list it was given alone", () => {
    const before = [use("Grand Piano", 100, 500)];
    recordUse(before, ["Grand Piano"], 30, 1000);
    expect(before[0]!.seconds).toBe(100);
  });

  /**
   * Trimmed by time played, not by recency, so an evening spent auditioning presets
   * cannot push out the piano that has been used for a month.
   */
  it("remembers only the most-played, however many are tried", () => {
    let uses: InstrumentUse[] = [use("Old Favourite", 10_000, 1)];
    for (let i = 0; i < MAX_REMEMBERED + 20; i++) {
      uses = recordUse(uses, [`Preset ${i}`], 5, 100 + i);
    }
    expect(uses).toHaveLength(MAX_REMEMBERED);
    expect(uses[0]!.name).toBe("Old Favourite");
  });
});

describe("the ranking", () => {
  it("puts the most played first", () => {
    const ranked = rank([use("a", 10), use("b", 300), use("c", 60)]);
    expect(ranked.map((u) => u.name)).toEqual(["b", "c", "a"]);
  });

  /** Everything never played sits on nought together, so this decides the whole tail. */
  it("breaks a tie on which was used most recently", () => {
    const ranked = rank([use("old", 60, 100), use("new", 60, 900)]);
    expect(ranked.map((u) => u.name)).toEqual(["new", "old"]);
  });
});

describe("the shortlist", () => {
  const uses = [use("Grand Piano", 6000, 3), use("Vibes", 600, 2), use("Ghost Flute", 60, 1)];
  const names = ["Ghost Flute", "Grand Piano", "Vibes", "Zoo Book"];

  it("is the sounds you have played, most first", () => {
    expect(mostPlayed(names, uses, 6)).toEqual(["Grand Piano", "Vibes", "Ghost Flute"]);
  });

  it("leaves out sounds that have never been played", () => {
    expect(mostPlayed(names, uses, 6)).not.toContain("Zoo Book");
    expect(mostPlayed(names, [...uses, use("Zoo Book", 0, 9)], 6)).not.toContain("Zoo Book");
  });

  /**
   * A remembered name whose folder has been renamed is a row that cannot be chosen — and
   * it would sit at the very top, since that is where the most-played end up.
   */
  it("leaves out sounds the library no longer has", () => {
    expect(mostPlayed(["Vibes"], uses, 6)).toEqual(["Vibes"]);
  });

  it("stops at the limit", () => {
    expect(mostPlayed(names, uses, 2)).toEqual(["Grand Piano", "Vibes"]);
  });
});

describe("searching the list", () => {
  const names = ["Ghost Flute", "Bliss Flute", "Grand Piano", "Zoo Book"];

  it("shows everything when nothing has been typed", () => {
    expect(filterInstruments(names, "")).toEqual(names);
    expect(filterInstruments(names, "   ")).toEqual(names);
  });

  it("matches anywhere in the name, whatever the case", () => {
    expect(filterInstruments(names, "flute")).toEqual(["Ghost Flute", "Bliss Flute"]);
    expect(filterInstruments(names, "PIANO")).toEqual(["Grand Piano"]);
  });

  it("keeps the order it was given", () => {
    expect(filterInstruments(names, "o")).toEqual(names.filter((n) => /o/i.test(n)));
  });

  it("comes back empty when nothing matches", () => {
    expect(filterInstruments(names, "trombone")).toEqual([]);
  });
});

describe("saying how long something was played for", () => {
  it("is the coarsest thing that is still true", () => {
    expect(playTimeLabel(0)).toBe("0s");
    expect(playTimeLabel(48)).toBe("48s");
    expect(playTimeLabel(60)).toBe("1m");
    expect(playTimeLabel(2100)).toBe("35m");
    expect(playTimeLabel(3600)).toBe("1h");
    expect(playTimeLabel(6480)).toBe("1h 48m");
  });

  it("does not go backwards on junk", () => {
    expect(playTimeLabel(-5)).toBe("0s");
    expect(playTimeLabel(NaN)).toBe("0s");
  });
});

describe("reading back what was stored", () => {
  it("restores a list, ranked", () => {
    const raw = JSON.stringify([use("a", 10, 1), use("b", 300, 2)]);
    expect(parseUses(raw).map((u) => u.name)).toEqual(["b", "a"]);
  });

  /**
   * Junk is dropped rather than repaired. The worst a lost entry costs is a sound sitting
   * lower in the picker than it has earned — much better than a ranking built on
   * half-read numbers.
   */
  it("drops entries that are not whole, keeping the ones that are", () => {
    const raw = JSON.stringify([
      null,
      { name: "no seconds" },
      { name: "bad seconds", seconds: "lots", lastUsed: 1 },
      { name: "negative", seconds: -5, lastUsed: 1 },
      { name: "", seconds: 5, lastUsed: 1 },
      { name: "good", seconds: 5, lastUsed: 1 },
    ]);
    expect(parseUses(raw)).toEqual([{ name: "good", seconds: 5, lastUsed: 1 }]);
  });

  it("has nothing to restore from junk or from nothing", () => {
    expect(parseUses(null)).toEqual([]);
    expect(parseUses("not json")).toEqual([]);
    expect(parseUses(JSON.stringify({ name: "a" }))).toEqual([]);
  });
});
