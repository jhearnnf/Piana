import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

// The desktop shell is CommonJS so Electron's main process can load it directly.
const require = createRequire(import.meta.url);
const {
  isSampleFile,
  noteNameToMidi,
  sampleNote,
  buildSampleMap,
  listInstrumentNames,
  resolveInstrument,
  resolveSample,
} = require("../electron/instruments.cjs") as {
  isSampleFile: (name: unknown) => boolean;
  noteNameToMidi: (text: string) => number | null;
  sampleNote: (name: unknown) => number | null;
  buildSampleMap: (names: string[]) => { midi: number; file: string }[];
  listInstrumentNames: (entries: { name: string; directory: boolean }[]) => string[];
  resolveInstrument: (root: string, instrument: unknown) => string | null;
  resolveSample: (root: string, instrument: unknown, file: unknown) => string | null;
};

/**
 * Reading a folder of audio files as an instrument.
 *
 * The whole approach rests on file names meaning what they look like they mean, so this is
 * where that gets pinned down — against the two conventions that are actually out there,
 * and against the names that look like one of them and are not.
 */

describe("which files are samples", () => {
  it("takes the formats the browser can decode", () => {
    for (const name of ["a.flac", "a.wav", "a.ogg", "a.mp3", "a.m4a", "a.WAV"]) {
      expect(isSampleFile(name)).toBe(true);
    }
  });

  it("leaves everything else alone", () => {
    for (const name of ["readme.txt", "cover.png", "patch.nki", "a.wav.bak", "flac", 7, null]) {
      expect(isSampleFile(name)).toBe(false);
    }
  });
});

describe("a spelled note", () => {
  it("puts middle C at 60, the way MIDI defines it", () => {
    expect(noteNameToMidi("C4")).toBe(60);
    expect(noteNameToMidi("A4")).toBe(69); // the tuning fork
    expect(noteNameToMidi("A0")).toBe(21); // bottom of a piano
    expect(noteNameToMidi("C8")).toBe(108); // top of one
  });

  it("reads both spellings of a black key, and both ways of writing a sharp", () => {
    expect(noteNameToMidi("A#3")).toBe(58);
    expect(noteNameToMidi("As3")).toBe(58);
    expect(noteNameToMidi("Bb3")).toBe(58);
  });

  it("does not mistake the note B for a flat", () => {
    expect(noteNameToMidi("B3")).toBe(59);
    expect(noteNameToMidi("Bb3")).toBe(58);
  });

  it("is case-insensitive about the letter, since folders are not consistent", () => {
    expect(noteNameToMidi("c4")).toBe(60);
  });

  it("refuses what is not a note", () => {
    for (const text of ["H4", "C", "4", "Cx4", "", "C99"]) {
      expect(noteNameToMidi(text)).toBeNull();
    }
  });
});

describe("the note a sample file is for", () => {
  it("reads a leading number — how S.K.Y. Keys and most numbered sets name them", () => {
    expect(sampleNote("060-one.flac")).toBe(60);
    expect(sampleNote("021-do1.flac")).toBe(21);
    expect(sampleNote("036-ev4.flac")).toBe(36);
    expect(sampleNote("109-top.flac")).toBe(109);
    expect(sampleNote("048.wav")).toBe(48);
  });

  it("reads a spelled note at either end of the name", () => {
    expect(sampleNote("C4.wav")).toBe(60);
    expect(sampleNote("piano-A#3.flac")).toBe(58);
    expect(sampleNote("Db2 soft.wav")).toBe(37);
  });

  /**
   * A number in the middle of a name is a take number, a layer, a sample rate — anything
   * but the pitch. Only the front of the name is a promise about which note this is.
   */
  it("does not take a number from the middle of a name", () => {
    expect(sampleNote("piano 3 loud.wav")).toBeNull();
    expect(sampleNote("strings-2024-master.wav")).toBeNull();
  });

  it("refuses a number that is not a MIDI note", () => {
    expect(sampleNote("999-one.flac")).toBeNull();
  });

  it("has nothing to say about files that are not audio", () => {
    expect(sampleNote("060-one.txt")).toBeNull();
    expect(sampleNote("C4.nki")).toBeNull();
  });
});

describe("a folder as a sample map", () => {
  it("comes back in pitch order whatever order the folder was read in", () => {
    const map = buildSampleMap(["072-one.flac", "024-one.flac", "060-one.flac"]);
    expect(map.map((s) => s.midi)).toEqual([24, 60, 72]);
    expect(map[0]!.file).toBe("024-one.flac");
  });

  it("skips everything that is not a named note", () => {
    const map = buildSampleMap(["readme.txt", "060-one.flac", "cover.png", "notes.wav"]);
    expect(map).toEqual([{ midi: 60, file: "060-one.flac" }]);
  });

  /**
   * Velocity layers and round-robins are out of scope (see the module comment), and the
   * cost of that is picking one file per note. Picking it by name rather than by whichever
   * order the filesystem happened to hand them over is what makes it the *same* one every
   * launch, which is the part that matters.
   */
  it("keeps one file per note, chosen the same way every time", () => {
    const names = ["060-v3.wav", "060-v1.wav", "060-v2.wav"];
    expect(buildSampleMap(names)).toEqual([{ midi: 60, file: "060-v1.wav" }]);
    expect(buildSampleMap([...names].reverse())).toEqual([{ midi: 60, file: "060-v1.wav" }]);
  });

  it("handles a real S.K.Y. Keys instrument, sampled every fourth semitone", () => {
    const map = buildSampleMap([
      "012-dow.flac", "016-ev4.flac", "020-ev4.flac", "068-top.flac",
    ]);
    expect(map.map((s) => s.midi)).toEqual([12, 16, 20, 68]);
  });
});

describe("which folders are instruments", () => {
  const entries = [
    { name: "-Settings", directory: true },
    { name: ".git", directory: true },
    { name: "Grand Piano", directory: true },
    { name: "beautiful rhodes", directory: true },
    { name: "readme.txt", directory: false },
  ];

  it("lists the sub-folders, leaving out the ones that are not sounds", () => {
    expect(listInstrumentNames(entries)).toEqual(["beautiful rhodes", "Grand Piano"]);
  });

  it("sorts them the way the song list sorts songs — one alphabet, not two", () => {
    const mixed = [
      { name: "zither", directory: true },
      { name: "Piano 10", directory: true },
      { name: "Piano 2", directory: true },
    ];
    expect(listInstrumentNames(mixed)).toEqual(["Piano 2", "Piano 10", "zither"]);
  });
});

describe("turning names back into paths", () => {
  const root = path.resolve("/library");

  it("resolves a name inside the library", () => {
    expect(resolveInstrument(root, "Grand Piano")).toBe(path.join(root, "Grand Piano"));
    expect(resolveSample(root, "Grand Piano", "060-one.flac"))
      .toBe(path.join(root, "Grand Piano", "060-one.flac"));
  });

  /**
   * The renderer asks for sounds by name, and a name is all it is ever given back. So
   * anything that is really a path is a request that could not have come from a listing
   * this module produced, and is refused rather than cleaned up.
   */
  it("refuses an instrument name that is really a path", () => {
    for (const bad of ["..", ".", "sub/dir", "sub\\dir", "", "\0", "/etc"]) {
      expect(resolveInstrument(root, bad)).toBeNull();
      expect(resolveSample(root, bad, "060-one.flac")).toBeNull();
    }
  });

  /**
   * Both separators, on either platform. A backslash is an ordinary character in a POSIX
   * file name, so leaving this to `path.basename` would make the check mean something
   * different depending on where the tests happened to run.
   */
  it("refuses a sample name that is really a path", () => {
    for (const bad of ["../x.wav", "..\\x.wav", "sub/x.wav", "sub\\x.wav", "/x.wav"]) {
      expect(resolveSample(root, "Grand Piano", bad)).toBeNull();
    }
  });

  it("refuses a file that is not audio, whatever it is called", () => {
    expect(resolveSample(root, "Grand Piano", "prefs.json")).toBeNull();
  });

  it("refuses anything that is not a string at all", () => {
    expect(resolveInstrument(root, 7)).toBeNull();
    expect(resolveSample(root, "Grand Piano", null)).toBeNull();
  });
});
