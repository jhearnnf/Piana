import { describe, it, expect } from "vitest";
import { parseWaitMode, parseZoom } from "../src/ui/preferences.ts";

describe("parseZoom", () => {
  it("reads back the named zooms", () => {
    expect(parseZoom("auto")).toBe("auto");
    expect(parseZoom("full")).toBe("full");
  });

  it("reads back an octave count", () => {
    expect(parseZoom("3")).toBe(3);
  });

  it("has nothing to restore when nothing was stored", () => {
    expect(parseZoom(null)).toBeNull();
    expect(parseZoom("")).toBeNull();
  });

  it("rejects anything that isn't a zoom setting", () => {
    expect(parseZoom("Auto")).toBeNull(); // we only ever write lowercase
    expect(parseZoom("2.5")).toBeNull();
    expect(parseZoom("0")).toBeNull();
    expect(parseZoom("-3")).toBeNull();
    expect(parseZoom("{}")).toBeNull();
  });
});

describe("parseWaitMode", () => {
  it("is on for a first-time user", () => {
    expect(parseWaitMode(null)).toBe(true);
  });

  it("stays off once it has been switched off", () => {
    expect(parseWaitMode("false")).toBe(false);
    expect(parseWaitMode("true")).toBe(true);
  });

  it("falls back to waiting when the stored value is nonsense", () => {
    expect(parseWaitMode("")).toBe(true);
    expect(parseWaitMode("{}")).toBe(true);
  });
});
