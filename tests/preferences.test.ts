import { describe, it, expect } from "vitest";
import {
  DEFAULT_VOLUME,
  parseInstruments,
  parseMidiDevice,
  parseVolume,
  parseWaitMode,
  parseZoom,
} from "../src/ui/preferences.ts";

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

describe("parseMidiDevice", () => {
  it("listens to every device for a first-time user", () => {
    expect(parseMidiDevice(null)).toBeNull();
  });

  it("reads back a chosen device", () => {
    expect(parseMidiDevice("Digital Piano")).toBe("Digital Piano");
  });

  it("treats an empty choice as every device", () => {
    // This is how "All devices" is written: the empty value of its <option>.
    expect(parseMidiDevice("")).toBeNull();
    expect(parseMidiDevice("   ")).toBeNull();
  });

  it("keeps names a keyboard might really report", () => {
    expect(parseMidiDevice("  CASIO USB-MIDI  ")).toBe("CASIO USB-MIDI");
    expect(parseMidiDevice("{}")).toBe("{}");
  });
});

describe("parseInstruments", () => {
  it("plays the built-in piano for a first-time user", () => {
    expect(parseInstruments(null)).toEqual([]);
    expect(parseInstruments("")).toEqual([]);
  });

  it("reads back a stack, in the order it was chosen", () => {
    const raw = JSON.stringify([
      { name: "Grand Piano", level: 1 },
      { name: "Ancient Choir", level: 0.4 },
    ]);
    expect(parseInstruments(raw)).toEqual([
      { name: "Grand Piano", level: 1 },
      { name: "Ancient Choir", level: 0.4 },
    ]);
  });

  /** A sound you asked to hear, with no level recorded, is a sound you want all of. */
  it("takes a missing or unreadable level as full", () => {
    expect(parseInstruments(JSON.stringify([{ name: "Vibes" }]))).toEqual([
      { name: "Vibes", level: 1 },
    ]);
    expect(parseInstruments(JSON.stringify([{ name: "Vibes", level: "loud" }]))).toEqual([
      { name: "Vibes", level: 1 },
    ]);
  });

  it("clamps a level rather than dropping the instrument", () => {
    const raw = JSON.stringify([{ name: "a", level: 1.4 }, { name: "b", level: -2 }]);
    expect(parseInstruments(raw)).toEqual([
      { name: "a", level: 1 },
      { name: "b", level: 0 },
    ]);
  });

  it("skips entries that are not instruments, keeping the ones that are", () => {
    const raw = JSON.stringify([null, 7, { level: 1 }, { name: "" }, { name: "Vibes", level: 0.5 }]);
    expect(parseInstruments(raw)).toEqual([{ name: "Vibes", level: 0.5 }]);
  });

  it("has nothing to restore from junk", () => {
    expect(parseInstruments("not json")).toEqual([]);
    expect(parseInstruments(JSON.stringify({ name: "Vibes" }))).toEqual([]);
  });

  /**
   * Whatever the folder is called. There is no list of valid instruments here to check a
   * name against — the caller has that, and drops the ones its library does not have.
   */
  it("keeps names a sample library might really use", () => {
    const raw = JSON.stringify([{ name: "S.K.Y. Keys", level: 1 }]);
    expect(parseInstruments(raw)[0]?.name).toBe("S.K.Y. Keys");
  });
});
