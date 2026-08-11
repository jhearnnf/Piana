import { describe, it, expect } from "vitest";
import {
  attackTime,
  damperTime,
  fundamentalDecay,
  inharmonicity,
  midiToFreq,
  partialAmplitude,
  partialCount,
  partialDecay,
  partialFrequency,
  velocityGain,
  volumeToGain,
} from "../src/audio/piano.ts";

const A0 = 21;
const C4 = 60;
const A4 = 69;
const C8 = 108;

describe("midiToFreq", () => {
  it("puts concert A where it belongs", () => {
    expect(midiToFreq(A4)).toBeCloseTo(440, 6);
  });

  it("doubles every octave", () => {
    expect(midiToFreq(A4 + 12)).toBeCloseTo(880, 6);
    expect(midiToFreq(A4 - 12)).toBeCloseTo(220, 6);
  });

  it("spans the keyboard", () => {
    expect(midiToFreq(A0)).toBeCloseTo(27.5, 4);
    expect(midiToFreq(C8)).toBeCloseTo(4186, 0);
  });
});

describe("partialFrequency", () => {
  it("is a plain multiple of the fundamental with no stiffness", () => {
    expect(partialFrequency(100, 3, 0)).toBeCloseTo(300, 6);
  });

  it("stretches the upper partials sharp", () => {
    const stretched = partialFrequency(100, 4, inharmonicity(C4));
    expect(stretched).toBeGreaterThan(400);
    // Sharp, but musically so — a partial landing a semitone out would be a different note.
    expect(stretched).toBeLessThan(400 * 2 ** (1 / 12));
  });

  it("stretches higher partials more than lower ones", () => {
    const b = inharmonicity(C4);
    const second = partialFrequency(100, 2, b) / 200;
    const eighth = partialFrequency(100, 8, b) / 800;
    expect(eighth).toBeGreaterThan(second);
  });
});

describe("inharmonicity", () => {
  it("rises steeply with pitch, as stiffer strings do", () => {
    expect(inharmonicity(A0)).toBeLessThan(inharmonicity(C4));
    expect(inharmonicity(C4)).toBeLessThan(inharmonicity(C8));
  });

  it("stays small enough to stretch the tone rather than detune it", () => {
    expect(inharmonicity(C8)).toBeLessThan(0.01);
  });
});

describe("partialAmplitude", () => {
  it("normalises the fundamental to 1", () => {
    expect(partialAmplitude(1, 0.2)).toBeCloseTo(1, 6);
    expect(partialAmplitude(1, 1)).toBeCloseTo(1, 6);
  });

  it("falls away up the series", () => {
    expect(partialAmplitude(4, 0.8)).toBeLessThan(partialAmplitude(2, 0.8));
    expect(partialAmplitude(12, 0.8)).toBeLessThan(partialAmplitude(4, 0.8));
  });

  it("silences the mode the hammer lands on", () => {
    expect(partialAmplitude(8, 1)).toBeCloseTo(0, 10);
    expect(partialAmplitude(16, 1)).toBeCloseTo(0, 10);
  });

  it("gets brighter with velocity — harder is not just louder", () => {
    const soft = partialAmplitude(6, 0.2);
    const hard = partialAmplitude(6, 1);
    expect(hard).toBeGreaterThan(soft * 2);
  });
});

describe("partialCount", () => {
  it("spends its oscillators on the bass, where the tone lives in the upper modes", () => {
    expect(partialCount(A0)).toBeGreaterThan(partialCount(C4));
    expect(partialCount(C4)).toBeGreaterThan(partialCount(C8));
  });

  it("never asks for a voice big enough to stall a chord", () => {
    for (let midi = A0; midi <= C8; midi++) {
      expect(partialCount(midi)).toBeLessThanOrEqual(16);
      expect(partialCount(midi)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("decay", () => {
  it("rings for a long time at the bottom and barely at all at the top", () => {
    expect(fundamentalDecay(A0)).toBeGreaterThan(8);
    expect(fundamentalDecay(C4)).toBeGreaterThan(1.5);
    expect(fundamentalDecay(C4)).toBeLessThan(6);
    expect(fundamentalDecay(C8)).toBeLessThan(1);
  });

  it("shortens all the way up the keyboard", () => {
    for (let midi = A0; midi < C8; midi++) {
      expect(fundamentalDecay(midi + 1)).toBeLessThanOrEqual(fundamentalDecay(midi));
    }
  });

  it("loses the upper partials first, which is what makes a note mellow as it rings", () => {
    expect(partialDecay(C4, 8)).toBeLessThan(partialDecay(C4, 1));
  });

  it("keeps even the fastest partial long enough to be a note rather than a click", () => {
    expect(partialDecay(C8, 14)).toBeGreaterThanOrEqual(0.05);
  });
});

describe("attack and damping", () => {
  it("is never instant — an instant edge is heard as a click on top of the note", () => {
    expect(attackTime(C4)).toBeGreaterThan(0);
    expect(damperTime(C4)).toBeGreaterThan(0);
  });

  it("is slower in the bass, where the hammers and dampers are heavier", () => {
    expect(attackTime(A0)).toBeGreaterThan(attackTime(C8));
    expect(damperTime(A0)).toBeGreaterThan(damperTime(C8));
  });

  it("stays short enough to feel immediate", () => {
    expect(attackTime(A0)).toBeLessThan(0.01);
    expect(damperTime(A0)).toBeLessThan(0.2);
  });
});

describe("velocityGain", () => {
  it("is silent at zero and loudest at full", () => {
    expect(velocityGain(0)).toBe(0);
    expect(velocityGain(1)).toBeGreaterThan(velocityGain(0.5));
  });

  it("leaves headroom for a chord", () => {
    expect(velocityGain(1)).toBeLessThanOrEqual(0.5);
  });

  it("clamps rather than trusting an out-of-range velocity", () => {
    expect(velocityGain(2)).toBe(velocityGain(1));
    expect(velocityGain(-1)).toBe(0);
  });
});

describe("volumeToGain", () => {
  it("is silent at the bottom and unity at the top", () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBeCloseTo(1, 6);
  });

  it("rises all the way across the slider", () => {
    expect(volumeToGain(0.25)).toBeLessThan(volumeToGain(0.5));
    expect(volumeToGain(0.5)).toBeLessThan(volumeToGain(0.75));
  });

  it("curves, so the useful settings are not all crammed into the bottom", () => {
    expect(volumeToGain(0.5)).toBeLessThan(0.5);
  });

  it("clamps a nonsense level rather than blasting the speakers", () => {
    expect(volumeToGain(4)).toBeCloseTo(1, 6);
    expect(volumeToGain(-1)).toBe(0);
  });
});
