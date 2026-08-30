import { describe, it, expect } from "vitest";
import { fundamentalDecay, midiToFreq } from "../src/audio/piano.ts";
import {
  INSTRUMENT_BUDGET_BYTES,
  loadOrder,
  mapBytes,
  nearestSample,
  playbackRate,
  sampleCutoff,
  thinToBudget,
  usefulLength,
  type SampleRef,
} from "../src/audio/sampleMap.ts";

/**
 * Playing a whole keyboard out of a handful of recordings.
 *
 * All arithmetic, and checked as arithmetic — the wiring these numbers end up in is
 * SampleEngine's, and the point of keeping them apart is that the decisions which make an
 * instrument sound right or wrong can be argued about without an audio device.
 */

/** An instrument sampled every `step` semitones from `from` to `to`. */
function sampled(from: number, to: number, step: number): SampleRef[] {
  const refs: SampleRef[] = [];
  for (let midi = from; midi <= to; midi += step) {
    refs.push({ midi, file: `${String(midi).padStart(3, "0")}.flac` });
  }
  return refs;
}

describe("which recording to reach for", () => {
  const chromatic = sampled(21, 108, 1);
  const everyFourth = sampled(24, 96, 4);

  it("uses the note itself when the library has it", () => {
    expect(nearestSample(chromatic, 60)?.midi).toBe(60);
    expect(nearestSample(everyFourth, 60)?.midi).toBe(60);
  });

  it("reaches for the nearest one when it does not", () => {
    expect(nearestSample(everyFourth, 61)?.midi).toBe(60);
    expect(nearestSample(everyFourth, 63)?.midi).toBe(64);
  });

  /**
   * Stretching a recording up shortens and thins it — the chipmunk direction. Stretching
   * down lengthens and thickens it, which is much the more forgiving of the two at the
   * half-semitone where the choice is actually being made.
   */
  it("breaks a tie downwards, towards the more forgiving stretch", () => {
    expect(nearestSample(everyFourth, 62)?.midi).toBe(60);
  });

  it("extends the ends of the library outwards", () => {
    expect(nearestSample(everyFourth, 12)?.midi).toBe(24);
    expect(nearestSample(everyFourth, 120)?.midi).toBe(96);
  });

  it("has nothing to offer when the library is empty", () => {
    expect(nearestSample([], 60)).toBeNull();
  });

  it("copes with a library sampled at no particular spacing", () => {
    const scattered: SampleRef[] = [
      { midi: 30, file: "a.wav" },
      { midi: 55, file: "b.wav" },
      { midi: 90, file: "c.wav" },
    ];
    expect(nearestSample(scattered, 40)?.midi).toBe(30);
    expect(nearestSample(scattered, 70)?.midi).toBe(55);
    expect(nearestSample(scattered, 89)?.midi).toBe(90);
  });
});

describe("how fast to play it", () => {
  it("leaves the note it was recorded at alone", () => {
    expect(playbackRate(60, 60)).toBe(1);
  });

  it("doubles an octave up and halves an octave down", () => {
    expect(playbackRate(60, 72)).toBeCloseTo(2, 10);
    expect(playbackRate(60, 48)).toBeCloseTo(0.5, 10);
  });

  /** The rate is the pitch: playing at this speed has to land on the note asked for. */
  it("lands on the frequency of the note being played", () => {
    for (const [from, to] of [[60, 63], [24, 22], [96, 101]] as const) {
      expect(midiToFreq(from) * playbackRate(from, to)).toBeCloseTo(midiToFreq(to), 6);
    }
  });
});

describe("the order an instrument loads in", () => {
  const chromatic = sampled(21, 108, 1);

  it("starts in the middle of the keyboard, where the music is", () => {
    const order = loadOrder(chromatic);
    expect(order[0]!.midi).toBe(60);
    expect(order.slice(0, 13).map((s) => s.midi).sort((a, b) => a - b))
      .toEqual([54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66]);
  });

  it("still loads every sample, and does not invent any", () => {
    const order = loadOrder(chromatic);
    expect(order).toHaveLength(chromatic.length);
    expect(new Set(order.map((s) => s.midi))).toEqual(new Set(chromatic.map((s) => s.midi)));
  });

  it("leaves the list it was given alone", () => {
    const refs = sampled(21, 108, 1);
    loadOrder(refs);
    expect(refs[0]!.midi).toBe(21);
  });
});

describe("how much of a recording is worth keeping", () => {
  /**
   * The reason this exists is memory — an AudioBuffer is 32 bits per sample per channel
   * however the file was compressed, so a full piano recorded to silence is a quarter of a
   * gigabyte. What is kept has to outlast the note being heard, and no more.
   */
  it("keeps a bass note ringing far longer than a treble one", () => {
    expect(usefulLength(21)).toBeGreaterThan(usefulLength(60));
    expect(usefulLength(60)).toBeGreaterThan(usefulLength(108));
    expect(usefulLength(21) / usefulLength(108)).toBeGreaterThan(20);
  });

  it("outlasts the string it is a recording of", () => {
    for (const midi of [21, 40, 60, 84, 108]) {
      expect(usefulLength(midi)).toBeGreaterThan(fundamentalDecay(midi));
    }
  });

  /** The top of the keyboard decays in a blink, but a note still has to have an end. */
  it("never trims a note to nothing", () => {
    expect(usefulLength(127)).toBeGreaterThanOrEqual(0.6);
  });
});

describe("fitting an instrument into memory", () => {
  const chromatic = sampled(21, 109, 1);
  const everyFourth = sampled(24, 96, 4);

  /**
   * The estimate is load-bearing: it decides how much of a library is dropped. A grand
   * piano sampled every semitone measures about 265 MB of decoded audio in the real app,
   * so an estimate in that neighbourhood is one the thinning can be trusted to.
   */
  it("estimates a chromatic piano at about a quarter of a gigabyte", () => {
    const megabytes = mapBytes(chromatic) / 1024 / 1024;
    expect(megabytes).toBeGreaterThan(220);
    expect(megabytes).toBeLessThan(300);
  });

  it("leaves a sparsely sampled instrument completely alone", () => {
    expect(mapBytes(everyFourth)).toBeLessThan(INSTRUMENT_BUDGET_BYTES);
    expect(thinToBudget(everyFourth)).toEqual(everyFourth);
  });

  it("thins a chromatic one until it fits", () => {
    const thin = thinToBudget(chromatic);
    expect(mapBytes(thin)).toBeLessThanOrEqual(INSTRUMENT_BUDGET_BYTES);
    expect(thin.length).toBeLessThan(chromatic.length);
  });

  /**
   * Half the notes then play a semitone off their own recording, which is what a great
   * many respected libraries ship as. Dropping further than that starts to be audible, so
   * the budget is set where one step is enough.
   */
  it("does not thin a piano further than every second semitone", () => {
    const thin = thinToBudget(chromatic);
    const gaps = thin.slice(1).map((sample, i) => sample.midi - thin[i]!.midi);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(2);
  });

  /** They decide how far the instrument can be stretched at the edges of its range. */
  it("always keeps both ends, however hard it thins", () => {
    for (const budget of [INSTRUMENT_BUDGET_BYTES, 1024, 0]) {
      const thin = thinToBudget(chromatic, budget);
      expect(thin[0]).toEqual(chromatic[0]);
      expect(thin[thin.length - 1]).toEqual(chromatic[chromatic.length - 1]);
    }
  });

  it("has nothing to thin when there is nothing there", () => {
    expect(thinToBudget([])).toEqual([]);
  });

  it("leaves the list it was given alone", () => {
    const refs = sampled(21, 109, 1);
    thinToBudget(refs);
    expect(refs).toHaveLength(89);
  });
});

describe("how bright a note is at this velocity", () => {
  /**
   * A library like this has one recording per note, at one strength, so velocity cannot
   * pick a softer take — it has to be made. Loudness alone is the giveaway of a cheap
   * sampler: a piano played gently is not the same sound quieter, it is a darker one.
   */
  it("opens up as the note is played harder", () => {
    const quiet = sampleCutoff(60, 0.2);
    const middling = sampleCutoff(60, 0.6);
    const loud = sampleCutoff(60, 1);
    expect(quiet).toBeLessThan(middling);
    expect(middling).toBeLessThan(loud);
  });

  it("leaves a full-strength note as it was recorded", () => {
    expect(sampleCutoff(60, 1)).toBeGreaterThan(18000); // past hearing
  });

  /** A filter that ate the pitch it was shaping would turn a quiet top note into nothing. */
  it("never closes below the note's own fundamental", () => {
    for (const midi of [21, 60, 96, 108]) {
      expect(sampleCutoff(midi, 0)).toBeGreaterThan(midiToFreq(midi));
    }
  });

  it("treats a velocity outside 0..1 as the end it is nearest", () => {
    expect(sampleCutoff(60, -1)).toBe(sampleCutoff(60, 0));
    expect(sampleCutoff(60, 5)).toBe(sampleCutoff(60, 1));
  });
});
