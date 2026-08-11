import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

interface Bounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}
interface RestoredState {
  bounds: Bounds;
  maximized: boolean;
  fullScreen: boolean;
}

const { parseState, restoreState, DEFAULT_SIZE, MIN_SIZE } = require("../electron/window-state.cjs") as {
  parseState: (text: string) => unknown;
  restoreState: (saved: unknown, workAreas?: Bounds[]) => RestoredState;
  DEFAULT_SIZE: { width: number; height: number };
  MIN_SIZE: { width: number; height: number };
};

/** A single 1920x1080 monitor at the origin. */
const ONE_SCREEN: Bounds[] = [{ x: 0, y: 0, width: 1920, height: 1080 }];

describe("parseState", () => {
  it("reads a saved object", () => {
    expect(parseState('{"width":800}')).toEqual({ width: 800 });
  });

  it("treats junk on disk as no file at all", () => {
    expect(parseState("not json")).toBeNull();
    expect(parseState("[1,2,3]")).toBeNull();
    expect(parseState("null")).toBeNull();
  });
});

describe("restoreState", () => {
  it("uses the default size on a first run, with no position to centre against", () => {
    const state = restoreState(null, ONE_SCREEN);
    expect(state.bounds).toEqual({ ...DEFAULT_SIZE });
    expect(state.maximized).toBe(false);
    expect(state.fullScreen).toBe(false);
  });

  it("restores a position that is on screen", () => {
    const state = restoreState({ x: 100, y: 80, width: 1000, height: 700 }, ONE_SCREEN);
    expect(state.bounds).toEqual({ x: 100, y: 80, width: 1000, height: 700 });
  });

  it("drops a position on a monitor that is no longer attached", () => {
    // Saved on a second screen to the right, now unplugged.
    const state = restoreState({ x: 2400, y: 100, width: 1000, height: 700 }, ONE_SCREEN);
    expect(state.bounds.x).toBeUndefined();
    expect(state.bounds.y).toBeUndefined();
    expect(state.bounds.width).toBe(1000);
  });

  it("keeps a mostly-offscreen window while enough is left to grab", () => {
    // 170px still on screen: not much, but enough title bar to drag back.
    expect(restoreState({ x: 1750, y: 40, width: 1000, height: 700 }, ONE_SCREEN).bounds.x).toBe(1750);
    // 70px is not, so the window is centred instead of left as a sliver.
    expect(restoreState({ x: 1850, y: 40, width: 1000, height: 700 }, ONE_SCREEN).bounds.x).toBeUndefined();
  });

  it("clamps a size larger than any attached display", () => {
    const state = restoreState({ width: 5000, height: 4000 }, ONE_SCREEN);
    expect(state.bounds.width).toBe(1920);
    expect(state.bounds.height).toBe(1080);
  });

  it("never returns a size below the window minimum", () => {
    const state = restoreState({ width: 10, height: 10 }, ONE_SCREEN);
    expect(state.bounds.width).toBe(MIN_SIZE.width);
    expect(state.bounds.height).toBe(MIN_SIZE.height);
  });

  it("ignores a nonsense size but keeps the flags", () => {
    const state = restoreState({ width: "wide", height: null, maximized: true }, ONE_SCREEN);
    expect(state.bounds).toEqual({ ...DEFAULT_SIZE });
    expect(state.maximized).toBe(true);
  });

  it("carries full screen through", () => {
    expect(restoreState({ fullScreen: true }, ONE_SCREEN).fullScreen).toBe(true);
  });
});
