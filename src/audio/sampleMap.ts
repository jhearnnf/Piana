import { fundamentalDecay, midiToFreq } from "./piano.ts";

/**
 * Playing a keyboard out of a handful of recordings.
 *
 * A sample library is a set of notes somebody actually recorded, and it is never the set
 * of notes you want to play — it is every semitone for a piano, every fourth semitone for
 * most other things, and a couple of dozen scattered points for a cheap one. This is the
 * arithmetic that spans the gaps: which recording to reach for, how far to bend it, how
 * bright to make it, and how much of its tail is worth keeping in memory.
 *
 * Pure, and separate from `SampleEngine.ts` for the reason `piano.ts` is separate from
 * `Player.ts`: these are the decisions that make an instrument sound right or wrong, and
 * they should be arguable without an audio device in the room.
 */

/** One recorded note: which note it is, and the file it is in. */
export interface SampleRef {
  midi: number;
  file: string;
}

/**
 * The recording to play for `midi`, or null if there are none at all.
 *
 * Nearest wins, and on a tie the one below. Stretching a recording upwards shortens it and
 * thins it out — the chipmunk direction — while stretching down lengthens and thickens it,
 * which is much the more forgiving of the two mistakes at the half-semitone where it is
 * being chosen. `samples` is in pitch order, as `buildSampleMap` leaves it.
 */
export function nearestSample(
  samples: readonly SampleRef[],
  midi: number,
): SampleRef | null {
  let best: SampleRef | null = null;
  let bestDistance = Infinity;
  for (const sample of samples) {
    const distance = Math.abs(sample.midi - midi);
    // `<` rather than `<=`, over a list that ascends: the first of two equal distances is
    // the lower note, and keeping it is what makes ties resolve downwards.
    if (distance < bestDistance) {
      best = sample;
      bestDistance = distance;
    }
    // Ascending, so once the gap starts widening again nothing later can beat it.
    if (sample.midi > midi) break;
  }
  return best;
}

/** How fast to run a recording of `from` to hear `to`. 1 when they are the same note. */
export function playbackRate(from: number, to: number): number {
  return 2 ** ((to - from) / 12);
}

/**
 * The order to load an instrument's samples in: the middle of the keyboard first.
 *
 * Loading is progressive and the synthesised piano covers whatever has not arrived, so
 * this is not about speed but about which notes stop sounding synthetic first. Music
 * mostly happens in the middle two octaves, so that is where the real recordings are
 * worth the most, and the top and bottom of the keyboard can catch up in their own time.
 */
export function loadOrder(samples: readonly SampleRef[]): SampleRef[] {
  const middle = 60;
  return [...samples].sort(
    (a, b) => Math.abs(a.midi - middle) - Math.abs(b.midi - middle),
  );
}

/**
 * How much of a recording is worth keeping, in seconds.
 *
 * The reason this exists is memory, and the numbers are worth stating plainly: a full
 * eighty-eight-key piano recorded to its natural silence is a quarter of a gigabyte once
 * Web Audio has decoded it to floats, because an AudioBuffer is 32 bits per sample per
 * channel however the file was compressed. Most of that is the ends of notes at a level
 * nobody can hear over the next bar.
 *
 * So each note is cut to a multiple of how long its string would actually ring — the same
 * curve the synthesised piano decays on, which is fitted to a real instrument. Generous
 * enough that a note held under the sustain of a slow piece is still sounding from its
 * recording, short enough that the last inaudible seconds are not paid for eighty-eight
 * times over.
 */
export const TAIL_KEPT = 2.2;

export function usefulLength(midi: number): number {
  return Math.max(0.6, fundamentalDecay(midi) * TAIL_KEPT);
}

/**
 * What one trimmed recording of `midi` will cost in memory, in bytes.
 *
 * Decoded audio is 32-bit floats per channel whatever the file was, so this is a property
 * of the length and nothing else — a FLAC and a WAV of the same take cost exactly the same
 * once they are playable. Stereo at CD rate is assumed because that is what sample
 * libraries ship; a mono or 48 kHz one is estimated a little out, which only moves where
 * the thinning below kicks in by one step.
 */
const BYTES_PER_SECOND = 44100 * 2 * 4;

export function sampleBytes(midi: number): number {
  return usefulLength(midi) * BYTES_PER_SECOND;
}

export function mapBytes(samples: readonly SampleRef[]): number {
  return samples.reduce((total, sample) => total + sampleBytes(sample.midi), 0);
}

/**
 * What one instrument is allowed to hold.
 *
 * Measured, not guessed: a chromatically sampled grand piano is about 265 MB of decoded
 * audio once trimmed, which is fine on its own and not fine four deep. This is the number
 * that lets sounds be stacked without the app quietly growing to a gigabyte.
 */
export const INSTRUMENT_BUDGET_BYTES = 144 * 1024 * 1024;

/**
 * Drop recordings until the instrument fits its budget, keeping the spread.
 *
 * The thing being traded away is real but small. A piano sampled every semitone and one
 * sampled every second semitone differ by half the notes being played a semitone off their
 * own recording — which is what a great many respected libraries ship as, because a
 * semitone of stretch is very hard to hear and half the memory is very easy to notice.
 * Sparse libraries — most things that are not pianos are recorded every fourth semitone —
 * are far inside the budget and come through untouched.
 *
 * Both ends are always kept, whatever the step, because they are the notes that decide how
 * far the instrument can be stretched at the edges of its range.
 */
export function thinToBudget(
  samples: readonly SampleRef[],
  budgetBytes = INSTRUMENT_BUDGET_BYTES,
): SampleRef[] {
  if (samples.length === 0 || mapBytes(samples) <= budgetBytes) return [...samples];

  for (let step = 2; step < samples.length; step++) {
    const kept = everyNth(samples, step);
    if (mapBytes(kept) <= budgetBytes) return kept;
  }
  // Nothing thins far enough — one recording at each end is as small as an instrument gets.
  return everyNth(samples, samples.length);
}

/** Every `step`th sample, and always the last one so the range still reaches the top. */
function everyNth(samples: readonly SampleRef[], step: number): SampleRef[] {
  const kept: SampleRef[] = [];
  for (let i = 0; i < samples.length; i += step) kept.push(samples[i]!);

  const last = samples[samples.length - 1]!;
  if (kept[kept.length - 1] !== last) kept.push(last);
  return kept;
}

/**
 * Where to roll the top off a recording played at `velocity`, in Hz.
 *
 * A library like this has one recording per note, taken at one strength, so velocity
 * cannot pick a softer take — it has to be made. Loudness alone is not enough and is the
 * giveaway of a cheap sampler: a piano played gently is not the same sound quieter, it is
 * a *darker* sound, because a slow hammer excites far less of the string's upper modes.
 * That is the same fact `partialAmplitude` spends its velocity term on, applied from the
 * outside because here the partials are already baked into a recording.
 *
 * Full velocity opens the filter past hearing, so a loud note is the recording untouched.
 * The floor never falls below the note's own fundamental and a little above — a filter
 * that ate the pitch it was shaping would turn a quiet top-octave note into nothing.
 */
export function sampleCutoff(midi: number, velocity: number): number {
  const level = velocity < 0 ? 0 : velocity > 1 ? 1 : velocity;
  return Math.max(800 * 2 ** (level * 4.64), midiToFreq(midi) * 2.5);
}
