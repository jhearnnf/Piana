import { describe, it, expect, vi } from "vitest";
import { loadSamples, SampleEngine, trimBuffer } from "../src/audio/SampleEngine.ts";
import type { SampleRef } from "../src/audio/sampleMap.ts";

/**
 * The sampled instrument: what it does before it is loaded, and what it keeps once it is.
 *
 * Two things here are easy to get wrong and silent when they are. A note whose recording
 * has not arrived has to say so rather than play something else, because that answer is
 * what lets the synthesised piano cover for it — get it wrong and a library loads over a
 * keyboard of badly stretched copies of middle C. And a load that has been abandoned has
 * to actually stop, because the alternative is two instruments racing to fill the same map
 * and a keyboard that ends up half of each.
 *
 * Web Audio is stood in for by the smallest thing that holds a buffer, as in
 * playerRouting.test.ts.
 */

const SAMPLE_RATE = 44100;

class FakeBuffer {
  readonly duration: number;
  private readonly channels: Float32Array[];

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel]!;
  }
}

class FakeNode {
  readonly outputs: unknown[] = [];
  connect(node: unknown): unknown {
    this.outputs.push(node);
    return node;
  }
  disconnect(): void {}
}

class FakeParam {
  value = 0;
  setValueAtTime(value: number): void {
    this.value = value;
  }
  linearRampToValueAtTime(value: number): void {
    this.value = value;
  }
}

class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  readonly playbackRate = new FakeParam();
  started: number | null = null;
  start(when: number): void {
    this.started = when;
  }
  stop(): void {}
}

/** Just enough context to build a voice in and to make buffers with. */
function fakeContext(decode?: (bytes: ArrayBuffer) => FakeBuffer) {
  return {
    sampleRate: SAMPLE_RATE,
    createBuffer: (channels: number, length: number, rate: number) =>
      new FakeBuffer(channels, length, rate),
    createBufferSource: () => new FakeSource(),
    createGain: () => Object.assign(new FakeNode(), { gain: new FakeParam() }),
    createBiquadFilter: () =>
      Object.assign(new FakeNode(), { type: "", frequency: new FakeParam(), Q: new FakeParam() }),
    decodeAudioData: async (bytes: ArrayBuffer) =>
      decode ? decode(bytes) : new FakeBuffer(1, SAMPLE_RATE, SAMPLE_RATE),
  } as unknown as BaseAudioContext;
}

/** A buffer of a constant value, so a fade is visible in the numbers. */
function filled(seconds: number, value = 1, channels = 1): FakeBuffer {
  const buffer = new FakeBuffer(channels, Math.round(seconds * SAMPLE_RATE), SAMPLE_RATE);
  for (let c = 0; c < channels; c++) buffer.getChannelData(c).fill(value);
  return buffer;
}

const refs = (...midis: number[]): SampleRef[] =>
  midis.map((midi) => ({ midi, file: `${midi}.flac` }));

describe("an instrument before it has loaded", () => {
  it("plays nothing at all when it has no samples", () => {
    const ctx = fakeContext();
    const engine = new SampleEngine();
    expect(engine.strike(ctx, new FakeNode() as never, 60, 0.8, 0)).toBeNull();
  });

  /**
   * The important one. Reaching for a distant neighbour instead would make the first
   * second of every load a keyboard of shifted copies of one note — worse than the synth
   * it would be replacing, and it would look like the library itself sounded wrong.
   */
  it("declines a note whose own recording has not arrived, rather than stretching another", () => {
    const ctx = fakeContext();
    const engine = new SampleEngine();
    engine.setSamples("Grand Piano", refs(48, 60, 72));
    engine.add(60, filled(1) as never);

    expect(engine.strike(ctx, new FakeNode() as never, 60, 0.8, 0)).not.toBeNull();
    expect(engine.strike(ctx, new FakeNode() as never, 72, 0.8, 0)).toBeNull();
  });

  it("knows how far along it is", () => {
    const engine = new SampleEngine();
    expect(engine.ready).toBe(false); // an empty instrument is not a loaded one

    engine.setSamples("Grand Piano", refs(48, 60));
    expect(engine.total).toBe(2);
    expect(engine.ready).toBe(false);

    engine.add(48, filled(1) as never);
    engine.add(60, filled(1) as never);
    expect(engine.loaded).toBe(2);
    expect(engine.ready).toBe(true);
  });

  it("gives the memory back when it is cleared", () => {
    const ctx = fakeContext();
    const engine = new SampleEngine();
    engine.setSamples("Grand Piano", refs(60));
    engine.add(60, filled(1) as never);

    engine.clear();
    expect(engine.loaded).toBe(0);
    expect(engine.name).toBeNull();
    expect(engine.strike(ctx, new FakeNode() as never, 60, 0.8, 0)).toBeNull();
  });
});

describe("a note played from a recording", () => {
  it("runs the recording at the rate that makes it the note asked for", () => {
    const ctx = fakeContext();
    const engine = new SampleEngine();
    engine.setSamples("Flute", refs(60));
    engine.add(60, filled(2) as never);

    const struck = engine.strike(ctx, new FakeNode() as never, 72, 0.8, 0)!;
    const source = struck.sources[0] as unknown as FakeSource;
    expect(source.playbackRate.value).toBeCloseTo(2, 10);
  });

  /**
   * The pitch shift and the length are the same operation, so a note played an octave up
   * is over in half the time — and the teardown is scheduled off this number.
   */
  it("reports a tail shortened by the shift, not the length on disk", () => {
    const ctx = fakeContext();
    const engine = new SampleEngine();
    engine.setSamples("Flute", refs(60));
    engine.add(60, filled(2) as never);

    expect(engine.strike(ctx, new FakeNode() as never, 72, 0.8, 0)!.tail).toBeCloseTo(1, 6);
    expect(engine.strike(ctx, new FakeNode() as never, 48, 0.8, 0)!.tail).toBeCloseTo(4, 6);
  });

  it("starts when it was asked to, not when it got round to it", () => {
    const ctx = fakeContext();
    const engine = new SampleEngine();
    engine.setSamples("Flute", refs(60));
    engine.add(60, filled(2) as never);

    const struck = engine.strike(ctx, new FakeNode() as never, 60, 0.8, 4.25)!;
    expect((struck.sources[0] as unknown as FakeSource).started).toBe(4.25);
  });
});

describe("trimming a recording down", () => {
  it("leaves one that is already short enough exactly as it was", () => {
    const ctx = fakeContext();
    const buffer = filled(1) as never;
    expect(trimBuffer(ctx, buffer, 4)).toBe(buffer);
  });

  it("cuts a long one to length, keeping every channel", () => {
    const ctx = fakeContext();
    const cut = trimBuffer(ctx, filled(10, 1, 2) as never, 2.5);
    expect(cut.duration).toBeCloseTo(2.5, 3);
    expect(cut.numberOfChannels).toBe(2);
  });

  /** A waveform that stops at a non-zero value is a click, on the end of every long note. */
  it("fades the new end instead of cutting it square", () => {
    const ctx = fakeContext();
    const cut = trimBuffer(ctx, filled(10) as never, 2);
    const data = cut.getChannelData(0);

    expect(data[0]).toBe(1); // the start is untouched
    expect(data[data.length - 1]).toBeLessThan(0.01); // and the end has gone quiet
    expect(data[Math.floor(data.length * 0.5)]).toBe(1); // the fade is only at the end
  });
});

describe("loading an instrument", () => {
  /** In the order it was given, which is `loadOrder`'s: the middle of the keyboard first. */
  it("reads the samples in the order it was asked to", async () => {
    const ctx = fakeContext();
    const engine = new SampleEngine();
    const asked: string[] = [];

    await loadSamples(ctx, engine, refs(60, 61, 59), async (file) => {
      asked.push(file);
      return new ArrayBuffer(8);
    });
    expect(asked).toEqual(["60.flac", "61.flac", "59.flac"]);
    expect(engine.loaded).toBe(3);
  });

  it("reports how far it has got, once per sample", async () => {
    const ctx = fakeContext();
    const progress: string[] = [];

    await loadSamples(ctx, new SampleEngine(), refs(60, 61), async () => new ArrayBuffer(8), {
      onProgress: (p) => progress.push(`${p.loaded}/${p.total}`),
    });
    expect(progress).toEqual(["1/2", "2/2"]);
  });

  /**
   * One bad file should cost that one note, which the synth then covers. Losing the whole
   * instrument to it would mean a library with a single corrupt sample simply refusing to
   * load, with nothing on screen to say which one.
   */
  it("skips a sample it cannot read or decode, and carries on", async () => {
    const ctx = fakeContext((bytes) => {
      if (bytes.byteLength === 1) throw new Error("not audio");
      return filled(1);
    });
    const engine = new SampleEngine();

    await loadSamples(ctx, engine, refs(59, 60, 61), async (file) => {
      if (file === "59.flac") return null; // unreadable
      if (file === "60.flac") return new ArrayBuffer(1); // undecodable
      return new ArrayBuffer(8);
    });

    expect(engine.loaded).toBe(1);
  });

  /** Changing your mind about an instrument has to stop the old one, not race it. */
  it("stops as soon as it has been cancelled", async () => {
    const ctx = fakeContext();
    const engine = new SampleEngine();
    let done = 0;

    await loadSamples(ctx, engine, refs(60, 61, 62, 63), async () => new ArrayBuffer(8), {
      cancelled: () => done >= 2,
      onProgress: () => done++,
    });

    expect(done).toBe(2);
    expect(engine.loaded).toBe(2);
  });

  it("does not touch the engine at all if it was cancelled before it started", async () => {
    const ctx = fakeContext();
    const engine = new SampleEngine();
    const read = vi.fn(async () => new ArrayBuffer(8));

    await loadSamples(ctx, engine, refs(60, 61), read, { cancelled: () => true });
    expect(read).not.toHaveBeenCalled();
    expect(engine.loaded).toBe(0);
  });
});
