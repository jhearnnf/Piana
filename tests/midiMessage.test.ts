import { describe, it, expect } from "vitest";
import { decodeMidiMessage } from "../src/input/midiMessage.ts";

/**
 * What a message off the wire means.
 *
 * Bit twiddling with a lot of ways to be quietly wrong, and the symptom of each is a
 * keyboard that half works — so it is pinned down here rather than discovered on a piano.
 */

describe("notes", () => {
  it("reads a key going down, with its velocity as 0..1", () => {
    expect(decodeMidiMessage([0x90, 60, 127])).toEqual({
      kind: "noteOn",
      midi: 60,
      velocity: 1,
    });
    const half = decodeMidiMessage([0x90, 60, 64]);
    expect(half?.kind === "noteOn" && half.velocity).toBeCloseTo(64 / 127, 6);
  });

  it("reads a key coming up", () => {
    expect(decodeMidiMessage([0x80, 60, 0])).toEqual({ kind: "noteOff", midi: 60 });
  });

  /**
   * The classic way to end up with every key stuck down. A great many keyboards release a
   * key with a zero-velocity note-on, because it lets them send a run of notes under one
   * status byte.
   */
  it("reads a note-on at zero velocity as the key coming up", () => {
    expect(decodeMidiMessage([0x90, 60, 0])).toEqual({ kind: "noteOff", midi: 60 });
  });

  /** Sixteen channels, all of them this app's — nobody is going to be told to use one. */
  it("listens on every channel", () => {
    for (const channel of [0x0, 0x7, 0xf]) {
      expect(decodeMidiMessage([0x90 | channel, 60, 100])?.kind).toBe("noteOn");
      expect(decodeMidiMessage([0x80 | channel, 60, 0])?.kind).toBe("noteOff");
    }
  });
});

describe("the sustain pedal", () => {
  it("is down at the top of its travel and up at the bottom", () => {
    expect(decodeMidiMessage([0xb0, 64, 127])).toEqual({ kind: "sustain", down: true });
    expect(decodeMidiMessage([0xb0, 64, 0])).toEqual({ kind: "sustain", down: false });
  });

  /**
   * A pedal is not the switch it feels like: a half-damper one sweeps the whole range as
   * it travels. Piana's dampers are on or off, so the halfway point is where the sweep
   * becomes a decision — the same place the MIDI spec puts it.
   */
  it("takes halfway as the point it goes down", () => {
    expect(decodeMidiMessage([0xb0, 64, 63])).toEqual({ kind: "sustain", down: false });
    expect(decodeMidiMessage([0xb0, 64, 64])).toEqual({ kind: "sustain", down: true });
  });

  it("is only controller 64, not whatever else the board sends", () => {
    expect(decodeMidiMessage([0xb0, 1, 127])).toBeNull(); // modulation wheel
    expect(decodeMidiMessage([0xb0, 7, 127])).toBeNull(); // channel volume
    expect(decodeMidiMessage([0xb0, 67, 127])).toBeNull(); // soft pedal
  });
});

describe("everything else", () => {
  /** Messages from an instrument this app is not. Better ignored than guessed at. */
  it("is left alone", () => {
    expect(decodeMidiMessage([0xe0, 0, 64])).toBeNull(); // pitch bend
    expect(decodeMidiMessage([0xd0, 80, 0])).toBeNull(); // channel aftertouch
    expect(decodeMidiMessage([0xa0, 60, 80])).toBeNull(); // polyphonic aftertouch
    expect(decodeMidiMessage([0xc0, 1, 0])).toBeNull(); // program change
  });

  it("is not tripped up by a message too short to read", () => {
    expect(decodeMidiMessage([])).toBeNull();
    expect(decodeMidiMessage([0xf8])).toBeNull(); // clock
    expect(decodeMidiMessage([0x90, 60])).toBeNull();
  });

  it("reads a real Uint8Array the same as an array", () => {
    expect(decodeMidiMessage(new Uint8Array([0xb0, 64, 127]))).toEqual({
      kind: "sustain",
      down: true,
    });
  });
});
