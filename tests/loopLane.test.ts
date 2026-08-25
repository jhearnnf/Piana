import { describe, it, expect } from "vitest";
import {
  bandAt,
  BAND_GAP,
  BAND_HEIGHT,
  BAND_REACH,
  LANE_PAD,
  laneHeight,
  loopBands,
  MAX_ROWS,
  MIN_BAND_WIDTH,
  packLoops,
  rowCount,
} from "../src/render/loopLane.ts";
import type { SavedLoop } from "../src/song/savedLoops.ts";

const loop = (id: string, start: number, end: number): SavedLoop => ({
  id,
  name: `loop ${id}`,
  start,
  end,
});

/** A lane's worth of loops, none of which touches another. */
const spread = (count: number): SavedLoop[] =>
  Array.from({ length: count }, (_, i) => loop(String(i), i * 10, i * 10 + 4));

/** `count` loops all sitting on top of each other, so every one needs its own row. */
const stacked = (count: number): SavedLoop[] =>
  Array.from({ length: count }, (_, i) => loop(String(i), i, 20 + i));

describe("packLoops", () => {
  it("puts loops that never meet on one row", () => {
    expect(packLoops(spread(3)).map((p) => p.row)).toEqual([0, 0, 0]);
  });

  it("stacks a loop that overlaps the one before it", () => {
    const rows = packLoops(stacked(2)).map((p) => p.row);
    expect(rows).toEqual([0, 1]);
  });

  it("lets a row be used again once its loop has finished", () => {
    const loops = [loop("a", 0, 10), loop("b", 5, 15), loop("c", 12, 20)];
    expect(packLoops(loops).map((p) => p.row)).toEqual([0, 1, 0]);
  });

  it("treats two loops that meet end to end as clearing each other", () => {
    expect(packLoops([loop("a", 0, 10), loop("b", 10, 20)]).map((p) => p.row)).toEqual([0, 0]);
  });

  it("wraps back onto the first row rather than growing without limit", () => {
    const rows = packLoops(stacked(MAX_ROWS + 2)).map((p) => p.row);
    expect(Math.max(...rows)).toBe(MAX_ROWS - 1);
  });

  it("packs earliest first, whatever order the loops arrive in", () => {
    const packed = packLoops([loop("late", 20, 30), loop("early", 0, 5)]);
    expect(packed.map((p) => p.loop.id)).toEqual(["early", "late"]);
  });

  it("does not disturb the list it was given", () => {
    const loops = [loop("late", 20, 30), loop("early", 0, 5)];
    packLoops(loops);
    expect(loops[0]!.id).toBe("late");
  });
});

describe("rowCount", () => {
  it("counts nothing for no loops", () => {
    expect(rowCount(packLoops([]))).toBe(0);
  });

  it("counts the rows the packing actually used", () => {
    expect(rowCount(packLoops(stacked(2)))).toBe(2);
  });
});

describe("laneHeight", () => {
  it("takes no room at all on a song with nothing saved", () => {
    expect(laneHeight([])).toBe(0);
  });

  it("is one band and its padding for a single row", () => {
    expect(laneHeight(spread(3))).toBe(LANE_PAD * 2 + BAND_HEIGHT);
  });

  it("grows by a band and a gap for each row after the first", () => {
    expect(laneHeight(stacked(2)) - laneHeight(spread(1))).toBe(BAND_HEIGHT + BAND_GAP);
  });

  it("stops growing at the row limit", () => {
    expect(laneHeight(stacked(MAX_ROWS + 3))).toBe(laneHeight(stacked(MAX_ROWS)));
  });
});

describe("loopBands", () => {
  it("lays a loop out across the width in proportion to its times", () => {
    const [band] = loopBands([loop("a", 30, 60)], 120, 400);
    expect(band).toMatchObject({ x: 100, w: 100 });
  });

  it("gives a band the row its packing earned it", () => {
    const bands = loopBands(stacked(2), 120, 400);
    expect(bands.map((b) => b.y)).toEqual([LANE_PAD, LANE_PAD + BAND_HEIGHT + BAND_GAP]);
  });

  it("keeps a loop too short to see wide enough to point at", () => {
    const [band] = loopBands([loop("a", 0, 0.6)], 600, 400);
    expect(band!.w).toBe(MIN_BAND_WIDTH);
  });

  it("keeps a loop running to the last note inside the map", () => {
    const [band] = loopBands([loop("a", 100, 120)], 120, 400);
    expect(band!.x + band!.w).toBeLessThanOrEqual(400);
  });

  it("carries the name across, so the lane can label itself", () => {
    expect(loopBands([loop("a", 0, 4)], 120, 400)[0]!.name).toBe("loop a");
  });

  it("has nothing to draw without a song or a canvas", () => {
    expect(loopBands([loop("a", 0, 4)], 0, 400)).toEqual([]);
    expect(loopBands([loop("a", 0, 4)], 120, 0)).toEqual([]);
  });
});

describe("bandAt", () => {
  const bands = loopBands([loop("a", 0, 30), loop("b", 60, 90)], 120, 400);
  const first = bands[0]!;

  it("finds the band under the point", () => {
    expect(bandAt(bands, first.x + 2, first.y + 2)?.id).toBe("a");
  });

  it("finds nothing beyond a band's end", () => {
    expect(bandAt(bands, first.x + first.w + 5, first.y + 2)).toBeNull();
  });

  it("finds nothing below the lane, where the map begins", () => {
    expect(bandAt(bands, first.x + 2, first.y + first.h + BAND_REACH + 1)).toBeNull();
  });

  it("gives a six-pixel bar a little room either side", () => {
    expect(bandAt(bands, first.x + 2, first.y - BAND_REACH)?.id).toBe("a");
  });

  it("gives the press to the band actually under it, not to a neighbour's slack", () => {
    // Two rows of loops covering the same bars: a point inside the lower band is within
    // reach of the upper one, and must still be read as the lower one.
    const stackedBands = loopBands(stacked(2), 120, 400);
    const lower = stackedBands[1]!;
    expect(bandAt(stackedBands, lower.x + 5, lower.y + 1)?.id).toBe(lower.id);
  });

  it("finds nothing on a lane with no loops on it", () => {
    expect(bandAt([], 10, 4)).toBeNull();
  });
});
