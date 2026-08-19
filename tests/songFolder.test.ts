import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { isMidiFile, listMidiNames, resolveInFolder } = require("../electron/library.cjs") as {
  isMidiFile: (name: unknown) => boolean;
  listMidiNames: (names: string[]) => string[];
  resolveInFolder: (folder: string, name: string) => string | null;
};

const FOLDER = path.resolve("/music/piana");

describe("isMidiFile", () => {
  it("accepts .mid and .midi in any case", () => {
    expect(isMidiFile("a.mid")).toBe(true);
    expect(isMidiFile("a.MIDI")).toBe(true);
    expect(isMidiFile("a.Mid")).toBe(true);
  });

  it("rejects everything else, including things that aren't names", () => {
    expect(isMidiFile("a.mp3")).toBe(false);
    expect(isMidiFile("a.mid.txt")).toBe(false);
    expect(isMidiFile("mid")).toBe(false);
    expect(isMidiFile(undefined)).toBe(false);
    expect(isMidiFile(42)).toBe(false);
  });
});

describe("listMidiNames", () => {
  it("keeps only the MIDI files", () => {
    expect(listMidiNames(["a.mid", "notes.txt", "b.midi", "cover.png"])).toEqual([
      "a.mid",
      "b.midi",
    ]);
  });

  it("sorts numbers the way a person reads them", () => {
    expect(listMidiNames(["Prelude 10.mid", "Prelude 2.mid", "Prelude 1.mid"])).toEqual([
      "Prelude 1.mid",
      "Prelude 2.mid",
      "Prelude 10.mid",
    ]);
  });

  it("does not split a mixed-case folder into two alphabets", () => {
    expect(listMidiNames(["banjo.mid", "Apple.mid", "cherry.mid", "Bee.mid"])).toEqual([
      "Apple.mid",
      "banjo.mid",
      "Bee.mid",
      "cherry.mid",
    ]);
  });

  it("has an answer for an empty folder", () => {
    expect(listMidiNames([])).toEqual([]);
  });
});

/**
 * The guard, which is the point of the module: a file name arrives from the renderer and
 * turns into a filesystem read, so it is checked rather than trusted.
 */
describe("resolveInFolder", () => {
  it("resolves a plain name inside the folder", () => {
    expect(resolveInFolder(FOLDER, "Nocturne.mid")).toBe(path.join(FOLDER, "Nocturne.mid"));
  });

  it("refuses anything that isn't a MIDI file", () => {
    expect(resolveInFolder(FOLDER, "secrets.txt")).toBeNull();
    expect(resolveInFolder(FOLDER, "")).toBeNull();
  });

  it("refuses a name that tries to climb out of the folder", () => {
    expect(resolveInFolder(FOLDER, "../elsewhere.mid")).toBeNull();
    expect(resolveInFolder(FOLDER, "../../../etc/passwd.mid")).toBeNull();
  });

  it("refuses a name carrying a path separator of either kind", () => {
    expect(resolveInFolder(FOLDER, "sub/song.mid")).toBeNull();
    expect(resolveInFolder(FOLDER, "sub\\song.mid")).toBeNull();
  });

  it("refuses an absolute path dressed up as a name", () => {
    expect(resolveInFolder(FOLDER, "/etc/song.mid")).toBeNull();
    expect(resolveInFolder(FOLDER, "C:\\Windows\\song.mid")).toBeNull();
  });

  it("refuses a name with a NUL in it, which truncates in the syscall", () => {
    expect(resolveInFolder(FOLDER, "ok.mid\0.png")).toBeNull();
  });
});
