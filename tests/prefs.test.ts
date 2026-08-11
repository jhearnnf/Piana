import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parsePrefs, songFolder, startFolder } = require("../electron/prefs.cjs") as {
  parsePrefs: (text: string) => Record<string, unknown> | null;
  songFolder: (prefs: unknown) => string | null;
  startFolder: (
    prefs: unknown,
    exists: (p: string) => boolean,
    fallback?: string,
  ) => string | undefined;
};

const MUSIC = "C:\\Users\\Someone\\Music";
const SONGS = "D:\\MIDI\\Songs";

/** Stands in for the filesystem: only the listed folders are there. */
const only = (...present: string[]) => (p: string) => present.includes(p);

describe("parsePrefs", () => {
  it("reads a saved object", () => {
    expect(parsePrefs(`{"songFolder":"${SONGS.replace(/\\/g, "\\\\")}"}`)).toEqual({ songFolder: SONGS });
  });

  it("treats junk on disk as no file at all", () => {
    expect(parsePrefs("not json")).toBeNull();
    expect(parsePrefs("[1,2]")).toBeNull();
    expect(parsePrefs("null")).toBeNull();
  });
});

describe("songFolder", () => {
  it("ignores a missing or non-string entry", () => {
    expect(songFolder(null)).toBeNull();
    expect(songFolder({})).toBeNull();
    expect(songFolder({ songFolder: "" })).toBeNull();
    expect(songFolder({ songFolder: 42 })).toBeNull();
  });
});

describe("startFolder", () => {
  it("starts where the last song came from", () => {
    expect(startFolder({ songFolder: SONGS }, only(SONGS, MUSIC), MUSIC)).toBe(SONGS);
  });

  it("falls back to Music before anything has been opened", () => {
    expect(startFolder(null, only(MUSIC), MUSIC)).toBe(MUSIC);
  });

  it("falls back when the remembered folder has gone", () => {
    // The USB stick with the MIDI files on it is unplugged.
    expect(startFolder({ songFolder: "E:\\Songs" }, only(MUSIC), MUSIC)).toBe(MUSIC);
  });

  it("suggests nothing when neither exists, leaving it to the system", () => {
    expect(startFolder({ songFolder: "E:\\Songs" }, only(), MUSIC)).toBeUndefined();
    expect(startFolder(null, only())).toBeUndefined();
  });
});
