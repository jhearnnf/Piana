import { describe, it, expect } from "vitest";
import { DEFAULT_VOLUME, parseVolume, parseWaitMode, parseZoom } from "../src/ui/preferences.ts";

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

describe("parseVolume", () => {
  it("starts audible for a first-time user", () => {
    expect(parseVolume(null)).toBe(DEFAULT_VOLUME);
    expect(DEFAULT_VOLUME).toBeGreaterThan(0);
  });

  it("reads back a stored level", () => {
    expect(parseVolume("0.4")).toBe(0.4);
    expect(parseVolume("0")).toBe(0);
    expect(parseVolume("1")).toBe(1);
  });

  it("clamps a level from outside the slider", () => {
    expect(parseVolume("1.5")).toBe(1);
    expect(parseVolume("-2")).toBe(0);
  });

  it("falls back to the default rather than to silence when the value is nonsense", () => {
    // "" would be a real trap: Number("") is 0, so an empty value would come back muted.
    expect(parseVolume("")).toBe(DEFAULT_VOLUME);
    expect(parseVolume("   ")).toBe(DEFAULT_VOLUME);
    expect(parseVolume("loud")).toBe(DEFAULT_VOLUME);
    expect(parseVolume("{}")).toBe(DEFAULT_VOLUME);
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
