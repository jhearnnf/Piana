import { velocityGain } from "./piano.ts";
import {
  nearestSample,
  playbackRate,
  sampleCutoff,
  usefulLength,
  type SampleRef,
} from "./sampleMap.ts";

/**
 * A sampled instrument, as Web Audio nodes.
 *
 * This is the sampled counterpart to the additive synthesis in `Player.ts`: the same job —
 * turn a note and a velocity into something audible — done by playing a recording instead
 * of building a tone. Everything downstream of the voice (the room, the compressor, the
 * mute, the volume) is the player's and is shared, so switching instruments changes what a
 * note sounds like and nothing else about how the app behaves.
 *
 * Loading is progressive, and a note whose recording has not arrived yet reports itself as
 * unplayable rather than waiting — which is what lets the player fall back to its synth for
 * that one note. The keyboard therefore works from the first frame and turns real
 * underneath you, middle outwards, instead of holding the app up behind a progress bar.
 */

/** Where an instrument's bytes come from. The desktop shell, in practice. */
export type SampleReader = (file: string) => Promise<ArrayBuffer | null>;

/** The nodes a struck note is made of, and how long it will sound for. */
export interface StruckVoice {
  sources: AudioScheduledSourceNode[];
  /** Seconds until it has died away on its own, for scheduling the teardown. */
  tail: number;
  /**
   * This layer's share of the note, as its own gain.
   *
   * Separate from the velocity envelope so that moving a blend slider can reach a note
   * that is already sounding without having to know what velocity it was played at.
   * Absent on a synthesised voice, which is a fallback rather than a layer and has
   * nothing to be blended against.
   */
  blend?: GainNode;
}

/**
 * Balance against the synthesised piano, so switching sounds is not also a volume change.
 *
 * The synth normalises a note to `velocityGain` by construction; a recording arrives at
 * whatever level it was mastered at, which for a commercial library is close to full
 * scale. Trimming a little is what keeps a two-handed chord off the compressor's threshold.
 */
const SAMPLE_LEVEL = 0.55;

/** Long enough to be inaudible, short enough not to be heard as a fade — see `trimBuffer`. */
const TRIM_FADE_SEC = 0.15;

export class SampleEngine {
  /** Decoded recordings, keyed by the note that was recorded — not the note being played. */
  private readonly buffers = new Map<number, AudioBuffer>();
  private refs: readonly SampleRef[] = [];

  /** The instrument these samples are for, or null when nothing is loaded. */
  name: string | null = null;

  /** What this instrument has recordings of, whether or not they have arrived yet. */
  setSamples(name: string, refs: readonly SampleRef[]): void {
    this.clear();
    this.name = name;
    this.refs = refs;
  }

  add(midi: number, buffer: AudioBuffer): void {
    this.buffers.set(midi, buffer);
  }

  /** Forget everything, so switching instruments gives the memory back. */
  clear(): void {
    this.buffers.clear();
    this.refs = [];
    this.name = null;
  }

  get loaded(): number {
    return this.buffers.size;
  }

  get total(): number {
    return this.refs.length;
  }

  /** Has this instrument got anything, and is all of it here? */
  get ready(): boolean {
    return this.total > 0 && this.loaded === this.total;
  }

  /**
   * Play `midi`, or null if this instrument cannot yet.
   *
   * Null when the recording it *would* use has not been decoded — not when some other
   * recording could be stretched to cover it. Reaching for a distant neighbour would make
   * the first second of loading into a keyboard of badly shifted copies of middle C, which
   * is a worse sound than the synth it would be replacing.
   */
  strike(
    ctx: BaseAudioContext,
    destination: AudioNode,
    midi: number,
    velocity: number,
    t0: number,
    level = 1,
  ): StruckVoice | null {
    const ref = nearestSample(this.refs, midi);
    if (ref === null) return null;
    const buffer = this.buffers.get(ref.midi);
    if (buffer === undefined) return null;

    const rate = playbackRate(ref.midi, midi);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;

    // How velocity is heard when there is one recording at one strength: darker as well
    // as quieter. See `sampleCutoff`.
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = sampleCutoff(midi, velocity);
    tone.Q.value = 0.7;

    const env = ctx.createGain();
    // Ramped up from zero over a moment rather than started at level: a recording that was
    // cut mid-waveform begins on a step, and a step is a click. Short enough not to blunt
    // the attack of one that was cut properly.
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(velocityGain(velocity) * SAMPLE_LEVEL, t0 + 0.0015);

    // This layer's share of the note, behind the velocity envelope and in front of the
    // damper: a place a blend change can reach without disturbing either.
    const blend = ctx.createGain();
    blend.gain.value = level;

    source.connect(tone);
    tone.connect(env);
    env.connect(blend);
    blend.connect(destination);
    source.start(t0);

    // Played faster, a recording is over sooner — the pitch shift and the length are the
    // same operation, so the tail has to be measured after it rather than before.
    return { sources: [source], tail: buffer.duration / rate, blend };
  }
}

/**
 * Cut a decoded recording down to the part worth keeping in memory.
 *
 * See `usefulLength` for why this is not optional. The last fraction of a second is faded
 * rather than cut square, because a waveform that stops at a non-zero value is a click —
 * and a click at the end of every long note is far more noticeable than the barely audible
 * tail it would be there to save.
 */
export function trimBuffer(
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  seconds: number,
): AudioBuffer {
  if (buffer.duration <= seconds) return buffer;

  const frames = Math.max(1, Math.floor(seconds * buffer.sampleRate));
  const fade = Math.min(Math.floor(TRIM_FADE_SEC * buffer.sampleRate), frames);
  const cut = ctx.createBuffer(buffer.numberOfChannels, frames, buffer.sampleRate);

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const from = buffer.getChannelData(channel);
    const to = cut.getChannelData(channel);
    to.set(from.subarray(0, frames));
    for (let i = 0; i < fade; i++) {
      to[frames - fade + i]! *= 1 - i / fade;
    }
  }
  return cut;
}

/** How a load is getting on, for whatever is showing it. */
export interface LoadProgress {
  loaded: number;
  total: number;
}

/**
 * Read, decode and trim an instrument's recordings into `engine`.
 *
 * One file at a time, in the order `loadOrder` gave them, so the notes most likely to be
 * played next are the ones that arrive first. Sequential rather than all at once because
 * the alternative is holding ninety undecoded files and ninety untrimmed decoded ones in
 * memory at the same moment, to finish a couple of seconds sooner.
 *
 * A file that cannot be read or decoded is skipped: one bad sample in a library should
 * cost that one note, which the synth then covers, and not the instrument.
 *
 * `cancelled` is checked either side of every await, so changing your mind about an
 * instrument stops the old load rather than racing it.
 */
export async function loadSamples(
  ctx: BaseAudioContext,
  engine: SampleEngine,
  refs: readonly SampleRef[],
  read: SampleReader,
  options: { cancelled?: () => boolean; onProgress?: (progress: LoadProgress) => void } = {},
): Promise<void> {
  const { cancelled = () => false, onProgress } = options;
  let loaded = 0;

  for (const ref of refs) {
    if (cancelled()) return;
    try {
      const bytes = await read(ref.file);
      if (cancelled()) return;
      if (bytes !== null && bytes.byteLength > 0) {
        const decoded = await ctx.decodeAudioData(bytes);
        if (cancelled()) return;
        engine.add(ref.midi, trimBuffer(ctx, decoded, usefulLength(ref.midi)));
      }
    } catch {
      /* one unreadable note, covered by the synth — not worth losing the instrument over */
    }
    loaded++;
    onProgress?.({ loaded, total: refs.length });
  }
}
