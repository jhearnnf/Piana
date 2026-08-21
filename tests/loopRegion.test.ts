import { describe, it, expect } from "vitest";
import {
  loopOffsets,
  loopSectionId,
  markedRegion,
  marksOf,
  MIN_LOOP_SEC,
  moveMark,
  NO_MARKS,
  parseLoopSectionId,
  placeMark,
} from "../src/song/loopRegion.ts";

describe("placeMark", () => {
  it("drops a start on its own", () => {
    expect(placeMark(NO_MARKS, "start", 4)).toEqual({ start: 4, end: null });
  });

  it("drops an end on its own", () => {
    expect(placeMark(NO_MARKS, "end", 9)).toEqual({ start: null, end: 9 });
  });

  it("keeps a partner that is far enough away", () => {
    expect(placeMark({ start: null, end: 12 }, "start", 4)).toEqual({ start: 4, end: 12 });
    expect(placeMark({ start: 4, end: null }, "end", 12)).toEqual({ start: 4, end: 12 });
  });

  it("moves a point that is already down", () => {
    expect(placeMark({ start: 4, end: 12 }, "start", 6)).toEqual({ start: 6, end: 12 });
  });

  it("clears a partner left on the wrong side rather than swapping with it", () => {
    expect(placeMark({ start: 4, end: 12 }, "start", 20)).toEqual({ start: 20, end: null });
    expect(placeMark({ start: 4, end: 12 }, "end", 1)).toEqual({ start: null, end: 1 });
  });

  it("clears a partner that is too close to loop", () => {
    const marks = placeMark({ start: 4, end: 12 }, "end", 4 + MIN_LOOP_SEC / 2);
    expect(marks.start).toBeNull();
  });
});

describe("markedRegion", () => {
  it("is nothing until both points are down", () => {
    expect(markedRegion(NO_MARKS)).toBeNull();
    expect(markedRegion({ start: 4, end: null })).toBeNull();
    expect(markedRegion({ start: null, end: 4 })).toBeNull();
  });

  it("is the stretch between the two points", () => {
    expect(markedRegion({ start: 4, end: 12 })).toEqual({ start: 4, end: 12 });
  });

  it("refuses a region too short to be a passage", () => {
    expect(markedRegion({ start: 4, end: 4 + MIN_LOOP_SEC / 2 })).toBeNull();
  });
});

describe("marksOf", () => {
  it("puts a range's edges under the markers", () => {
    expect(marksOf({ start: 2, end: 8 })).toEqual({ start: 2, end: 8 });
  });

  it("gives the whole song no markers at all", () => {
    expect(marksOf(null)).toEqual(NO_MARKS);
  });
});

describe("loop section ids", () => {
  it("round-trips a region", () => {
    const range = { start: 12.5, end: 34.25 };
    expect(parseLoopSectionId(loopSectionId(range))).toEqual(range);
  });

  it("keeps two different regions of one song apart", () => {
    expect(loopSectionId({ start: 0, end: 8 })).not.toBe(loopSectionId({ start: 8, end: 16 }));
  });

  it("is not confused with a section number or the whole song", () => {
    expect(parseLoopSectionId("full")).toBeNull();
    expect(parseLoopSectionId("3")).toBeNull();
    expect(parseLoopSectionId("loop:9")).toBeNull();
    expect(parseLoopSectionId("loop:9.00-9.00")).toBeNull(); // an empty region is not one
  });
});

describe("moveMark", () => {
  it("slides a point to where it is dragged", () => {
    expect(moveMark({ start: 4, end: 12 }, "start", 7)).toEqual({ start: 7, end: 12 });
    expect(moveMark({ start: 4, end: 12 }, "end", 9)).toEqual({ start: 4, end: 9 });
  });

  // Dropping a point on the wrong side clears its partner, because you plainly meant to
  // start again there. Dragging into one is a hand that has gone too far, and stops.
  it("stops against its partner instead of clearing it", () => {
    expect(moveMark({ start: 4, end: 12 }, "start", 99)).toEqual({
      start: 12 - MIN_LOOP_SEC,
      end: 12,
    });
    expect(moveMark({ start: 4, end: 12 }, "end", 0)).toEqual({
      start: 4,
      end: 4 + MIN_LOOP_SEC,
    });
  });

  it("cannot be dragged out of the front of the song", () => {
    expect(moveMark({ start: 4, end: null }, "start", -9).start).toBe(0);
  });

  it("moves freely while it is on its own", () => {
    expect(moveMark({ start: null, end: null }, "end", 30)).toEqual({ start: null, end: 30 });
  });
});

describe("loopOffsets", () => {
  const region = { start: 10, end: 20 };

  it("is just the lap being played when nothing else is in view", () => {
    expect(loopOffsets(region, 12, 15)).toEqual([0]);
  });

  it("brings the next lap in as the end of the region comes into view", () => {
    // The window reaches past the end of the region, so the region's own opening bars are
    // shifted a lap later to fall directly above its closing ones.
    expect(loopOffsets(region, 18, 22)).toEqual([0, 10]);
  });

  it("keeps the previous lap below the start", () => {
    expect(loopOffsets(region, 8, 12)).toEqual([-10, 0]);
  });

  it("repeats a region shorter than the window as often as it fits", () => {
    const offsets = loopOffsets({ start: 0, end: 1 }, 0, 3);
    expect(offsets.length).toBeGreaterThanOrEqual(4);
    expect(offsets).toContain(0);
    expect(offsets.every((o, i) => i === 0 || o > offsets[i - 1]!)).toBe(true);
  });

  it("never asks for more copies than a stage could use", () => {
    expect(loopOffsets({ start: 0, end: 0.001 }, 0, 3).length).toBeLessThanOrEqual(8);
  });

  it("always includes the lap being played", () => {
    for (const window of [[0, 1], [100, 200], [-50, -40]] as const) {
      expect(loopOffsets(region, window[0], window[1])).toContain(0);
    }
  });

  it("has one answer for a region with no length", () => {
    expect(loopOffsets({ start: 5, end: 5 }, 0, 10)).toEqual([0]);
  });
});
