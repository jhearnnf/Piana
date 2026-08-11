/**
 * The shape of a piano note, as numbers.
 *
 * This is the "what should this sound like" half of the audio engine, kept apart from the
 * Web Audio plumbing in `Player.ts` so it can be reasoned about and tested without an audio
 * device. Everything here is a pure function of pitch and velocity.
 *
 * The model is a struck string rather than a synth patch, because that is what makes the
 * difference between "a beep at the right pitch" and something you would call a piano:
 *
 *  - a string vibrates in many modes at once, and the higher ones die away first, so a note
 *    starts bright and mellows as it rings (`partialDecay`);
 *  - real strings are stiff, so those modes are not exact multiples of the fundamental but
 *    stretched slightly sharp (`inharmonicity`) — this is why octaves on a piano are tuned
 *    wide, and why a perfectly harmonic tone sounds like an organ instead;
 *  - the hammer hits about an eighth of the way along, which cancels every eighth mode and
 *    gives the piano its particular hollowness (`partialAmplitude`);
 *  - hitting harder does not just make it louder, it makes it brighter, which is most of
 *    what velocity actually sounds like.
 */

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** MIDI note number -> frequency in Hz (A4 = 69 = 440 Hz). */
export function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/**
 * The string's stiffness coefficient, `B` in the standard partial formula.
 *
 * Short, thick treble strings are far stiffer relative to their length than the long bass
 * ones, so the stretch grows steeply with pitch — roughly two orders of magnitude across
 * the keyboard, which is what this curve is fitted to.
 */
export function inharmonicity(midi: number): number {
  return 8e-5 * 2 ** ((midi - 21) / 16);
}

/** Frequency of the `n`th mode (n = 1 is the fundamental), stretched by stiffness. */
export function partialFrequency(fundamental: number, n: number, b: number): number {
  return fundamental * n * Math.sqrt(1 + b * n * n);
}

/**
 * How many modes are worth synthesising at this pitch.
 *
 * A bass note needs a lot of them — its fundamental is barely audible on small speakers and
 * the tone is carried almost entirely by the upper modes. A top-octave note needs very few,
 * because the rest are above hearing anyway. Each one costs an oscillator, so this is also
 * the knob that keeps a ten-finger chord affordable.
 */
export function partialCount(midi: number): number {
  if (midi < 48) return 14;
  if (midi < 72) return 10;
  if (midi < 90) return 6;
  return 4;
}

/**
 * Relative loudness of the `n`th mode, normalised so the fundamental is 1.
 *
 * Two things are going on. The `n ** -rolloff` term is the basic loss of energy in the
 * higher modes, and its exponent falls as velocity rises — that brightening is what a hard
 * strike sounds like. The `sin` term is the strike point: a hammer landing an eighth of the
 * way along a string cannot excite a mode with a node there, so the 8th and 16th vanish.
 */
export function partialAmplitude(n: number, velocity: number): number {
  const rolloff = 2.5 - 0.9 * clamp01(velocity);
  const strikeRatio = 1 / 8;
  const strike = Math.abs(Math.sin(Math.PI * n * strikeRatio)) / Math.sin(Math.PI * strikeRatio);
  return strike * n ** -rolloff;
}

/**
 * Time constant of the fundamental's decay, in seconds.
 *
 * The bottom of the keyboard rings for the best part of a minute and the top is gone almost
 * before you hear it — about a hundredfold across the 88 keys. Getting this wrong in either
 * direction is instantly recognisable: too short everywhere and it is a music box, too long
 * and it is a synth pad.
 */
export function fundamentalDecay(midi: number): number {
  const seconds = 14 * 2 ** (-(midi - 21) / 17.5);
  return Math.min(16, Math.max(0.25, seconds));
}

/** Time constant for the `n`th mode: the higher it is, the sooner it goes. */
export function partialDecay(midi: number, n: number): number {
  return Math.max(0.05, fundamentalDecay(midi) / (1 + 0.32 * (n - 1)));
}

/**
 * Time the note takes to reach full loudness.
 *
 * Not zero: a hammer takes a moment to give up its energy, and a bass string with a heavy
 * hammer takes noticeably longer than a treble one. Also the difference between a note and
 * a click — an instant attack is heard as a pop on top of the note.
 */
export function attackTime(midi: number): number {
  const t = clamp01((84 - midi) / 63);
  return 0.0015 + 0.005 * t;
}

/**
 * How fast the damper stops the string once the key comes up.
 *
 * Quick, but not instant — a hard cut is heard as a click, and the felt on a bass damper
 * takes longer to settle a heavy string than a treble one.
 */
export function damperTime(midi: number): number {
  const t = clamp01((84 - midi) / 63);
  return 0.035 + 0.075 * t;
}

/**
 * Peak level of a note at this velocity, before the partials are mixed.
 *
 * Compressed relative to velocity (the exponent is well under the ~2.5 that raw energy
 * would suggest) because so much of the loudness of a hard strike is carried by its
 * brightness instead, and because a trainer being played on laptop speakers wants its
 * quiet notes to still be audible.
 */
export function velocityGain(velocity: number): number {
  return 0.5 * clamp01(velocity) ** 1.3;
}

/**
 * Volume slider position (0..1) -> linear gain.
 *
 * Curved, because loudness is not linear in amplitude: a straight mapping puts every useful
 * setting in the bottom third of the slider and leaves the top half doing nothing.
 */
export function volumeToGain(level: number): number {
  return clamp01(level) ** 1.8;
}
