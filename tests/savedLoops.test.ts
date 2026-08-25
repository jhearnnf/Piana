import { describe, it, expect } from "vitest";
import {
  addLoop,
  cleanName,
  defaultLoopName,
  loopById,
  loopMatching,
  loopsKey,
  MAX_LOOP_NAME,
  nextLoopId,
  parseLoops,
  rangeOf,
  removeLoop,
  renameLoop,
  sortLoops,
  type SavedLoop,
} from "../src/song/savedLoops.ts";

const loop = (id: string, name: string, start: number, end: number): SavedLoop => ({
  id,
  name,
  start,
  end,
});

describe("cleanName", () => {
  it("trims and collapses whitespace", () => {
    expect(cleanName("  the   hard   bit ")).toBe("the hard bit");
  });

  it("gives back nothing for a name that was only spaces", () => {
    expect(cleanName("   ")).toBe("");
  });

  it("caps a name at a length that still fits on the stage", () => {
    expect(cleanName("x".repeat(200))).toHaveLength(MAX_LOOP_NAME);
  });
});

describe("defaultLoopName", () => {
  it("starts at one", () => {
    expect(defaultLoopName([])).toBe("Loop 1");
  });

  it("takes the first number nobody is using", () => {
    const loops = [loop("1", "Loop 1", 0, 4), loop("2", "Loop 3", 8, 12)];
    expect(defaultLoopName(loops)).toBe("Loop 2");
  });

  it("does not count named loops as taking a number", () => {
    expect(defaultLoopName([loop("1", "Bridge", 0, 4)])).toBe("Loop 1");
  });
});

describe("nextLoopId", () => {
  it("hands out one nobody has", () => {
    expect(nextLoopId([loop("1", "a", 0, 4), loop("2", "b", 8, 12)])).toBe("3");
  });

  it("does not reuse an id freed by a deletion", () => {
    // Reusing one would hand a fresh loop the identity of a deleted one, which is how the
    // wrong band ends up lit after an undo of any kind.
    const loops = removeLoop([loop("1", "a", 0, 4), loop("2", "b", 8, 12)], "2");
    expect(nextLoopId(loops)).toBe("2");
  });

  it("copes with ids that are not numbers at all", () => {
    expect(nextLoopId([loop("hand-written", "a", 0, 4)])).toBe("1");
  });
});

describe("addLoop", () => {
  it("keeps a region under the given name", () => {
    const { loops, loop: added } = addLoop([], "Bridge", { start: 4, end: 12 });
    expect(loops).toHaveLength(1);
    expect(added).toMatchObject({ name: "Bridge", start: 4, end: 12 });
  });

  it("names an unnamed loop for you", () => {
    const { loop: added } = addLoop([], "   ", { start: 4, end: 12 });
    expect(added.name).toBe("Loop 1");
  });

  it("holds the list in the order the loops are played", () => {
    const first = addLoop([], "late", { start: 30, end: 40 }).loops;
    const both = addLoop(first, "early", { start: 2, end: 8 }).loops;
    expect(both.map((l) => l.name)).toEqual(["early", "late"]);
  });

  it("gives every loop its own id", () => {
    const first = addLoop([], "a", { start: 0, end: 4 }).loops;
    const both = addLoop(first, "b", { start: 8, end: 12 }).loops;
    expect(new Set(both.map((l) => l.id)).size).toBe(2);
  });
});

describe("renameLoop", () => {
  it("renames just the one asked for", () => {
    const loops = [loop("1", "a", 0, 4), loop("2", "b", 8, 12)];
    expect(renameLoop(loops, "2", "Coda").map((l) => l.name)).toEqual(["a", "Coda"]);
  });

  it("leaves an empty name as it was, rather than wiping the old one", () => {
    const loops = [loop("1", "Bridge", 0, 4)];
    expect(renameLoop(loops, "1", "  ")[0]!.name).toBe("Bridge");
  });
});

describe("loopMatching", () => {
  const loops = [loop("1", "Bridge", 4, 12)];

  it("finds the loop a region is", () => {
    expect(loopMatching(loops, { start: 4, end: 12 })?.id).toBe("1");
  });

  it("forgives the pixel a dragged marker lands on", () => {
    expect(loopMatching(loops, { start: 4.004, end: 11.997 })?.id).toBe("1");
  });

  it("does not claim a region that has been moved off it", () => {
    expect(loopMatching(loops, { start: 4, end: 13 })).toBeNull();
  });

  it("has nothing to match when no region is marked", () => {
    expect(loopMatching(loops, null)).toBeNull();
  });
});

describe("loopById", () => {
  it("finds one, and answers null for an id that has gone", () => {
    const loops = [loop("1", "Bridge", 4, 12)];
    expect(loopById(loops, "1")?.name).toBe("Bridge");
    expect(loopById(loops, "9")).toBeNull();
    expect(loopById(loops, null)).toBeNull();
  });
});

describe("rangeOf", () => {
  it("hands a loop over as the range the rest of the app speaks in", () => {
    expect(rangeOf(loop("1", "Bridge", 4, 12))).toEqual({ start: 4, end: 12 });
  });
});

describe("sortLoops", () => {
  it("orders by where they start, then by where they end", () => {
    const loops = [loop("1", "long", 4, 30), loop("2", "short", 4, 9), loop("3", "late", 20, 24)];
    expect(sortLoops(loops).map((l) => l.name)).toEqual(["short", "long", "late"]);
  });

  it("leaves the list it was given alone", () => {
    const loops = [loop("1", "late", 20, 24), loop("2", "early", 4, 9)];
    sortLoops(loops);
    expect(loops[0]!.name).toBe("late");
  });
});

describe("parseLoops", () => {
  it("has nothing to read back from an empty store", () => {
    expect(parseLoops(null)).toEqual([]);
    expect(parseLoops("")).toEqual([]);
  });

  it("survives a value that is not JSON, or not a list", () => {
    expect(parseLoops("{oh dear")).toEqual([]);
    expect(parseLoops('{"start":1}')).toEqual([]);
  });

  it("reads back what was written", () => {
    const raw = JSON.stringify([loop("1", "Bridge", 4, 12)]);
    expect(parseLoops(raw)).toEqual([loop("1", "Bridge", 4, 12)]);
  });

  it("drops entries that are not loops, keeping the ones that are", () => {
    const raw = JSON.stringify([
      { id: "1", name: "fine", start: 4, end: 12 },
      { id: "2", name: "no times" },
      { id: "3", name: "backwards", start: 12, end: 4 },
      { id: "4", name: "negative", start: -3, end: 6 },
      { id: "5", name: "not a number", start: "4", end: 12 },
      { id: "6", name: "too short to loop", start: 4, end: 4.1 },
      null,
    ]);
    expect(parseLoops(raw).map((l) => l.name)).toEqual(["fine"]);
  });

  it("re-ids a loop that shares an id with one already read", () => {
    // A hand-edited store; the second loop would otherwise be unselectable, since every
    // click on it would find the first.
    const raw = JSON.stringify([loop("1", "a", 0, 4), loop("1", "b", 8, 12)]);
    const ids = parseLoops(raw).map((l) => l.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("puts what it read into playing order", () => {
    const raw = JSON.stringify([loop("1", "late", 30, 40), loop("2", "early", 2, 8)]);
    expect(parseLoops(raw).map((l) => l.name)).toEqual(["early", "late"]);
  });
});

describe("loopsKey", () => {
  it("keeps each song's loops apart", () => {
    expect(loopsKey("Für Elise")).not.toBe(loopsKey("Gymnopédie"));
  });

  it("escapes a name that would otherwise run into the key's own punctuation", () => {
    expect(loopsKey("a:b")).toBe("piana:loops:a%3Ab");
  });
});
