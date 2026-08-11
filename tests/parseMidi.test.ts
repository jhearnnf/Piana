import { describe, it, expect } from "vitest";
import { Midi } from "@tonejs/midi";
import { parseMidi } from "../src/midi/parseMidi.ts";

/** Build a small two-track MIDI (low = left hand, high = right hand) and export it. */
function makeTwoHandMidi(): Uint8Array {
  const midi = new Midi();

  const left = midi.addTrack();
  left.addNote({ midi: 48, time: 0, duration: 1 });
  left.addNote({ midi: 50, time: 1, duration: 1 });

  const right = midi.addTrack();
  right.addNote({ midi: 72, time: 0, duration: 0.5 });
  right.addNote({ midi: 74, time: 2, duration: 1 }); // ends at 3s -> song duration

  return midi.toArray();
}

describe("parseMidi", () => {
  it("normalizes notes, hands, and duration from a two-track file", () => {
    const song = parseMidi(makeTwoHandMidi(), "Test Song");

    expect(song.name).toBe("Test Song");
    expect(song.notes).toHaveLength(4);

    // Notes are sorted by time then pitch.
    const times = song.notes.map((n) => n.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));

    // Low track -> left, high track -> right.
    const low = song.notes.filter((n) => n.midi < 60);
    const high = song.notes.filter((n) => n.midi >= 60);
    expect(low.every((n) => n.hand === "left")).toBe(true);
    expect(high.every((n) => n.hand === "right")).toBe(true);

    // Duration is the end of the last note.
    expect(song.durationSec).toBeCloseTo(3, 2);
  });

  it("describes each note-bearing track, and tags its notes with it", () => {
    const song = parseMidi(makeTwoHandMidi());

    expect(song.tracks).toHaveLength(2);
    expect(song.tracks.map((t) => t.index)).toEqual([0, 1]);
    expect(song.tracks[0]!.noteCount).toBe(2);
    expect(song.tracks[0]!.range).toEqual([48, 50]);
    expect(song.tracks[1]!.range).toEqual([72, 74]);
    // Unnamed tracks still need something to put on the row.
    expect(song.tracks[0]!.name).toBeTruthy();

    for (const note of song.notes) {
      expect(note.track).toBe(note.midi < 60 ? 0 : 1);
    }
  });

  it("provides sensible tempo and time-signature defaults", () => {
    const song = parseMidi(makeTwoHandMidi());
    expect(song.tempoMap.length).toBeGreaterThanOrEqual(1);
    expect(song.tempoMap[0]!.bpm).toBeGreaterThan(0);
    expect(song.timeSignature).toEqual({ numerator: 4, denominator: 4 });
  });
});
