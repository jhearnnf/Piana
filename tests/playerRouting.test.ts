import { describe, it, expect, vi, afterEach } from "vitest";
import { PianoAudioPlayer } from "../src/audio/Player.ts";

/**
 * Where a note goes on its way to the speakers.
 *
 * The synthesis itself is checked in piano.test.ts, as arithmetic. What cannot be checked
 * that way is the wiring: whether the mute button is between a given note and the output.
 * A song's notes have to be behind it and a preview in front of it, and getting that
 * backwards is silent in one direction and unstoppable in the other — neither of which
 * shows up anywhere but in the graph.
 *
 * So Web Audio is stood in for by nodes that do nothing but remember what they were
 * connected to, and the assertions are about reachability.
 */

class FakeParam {
  value = 0;
  /** Every value this was ramped towards, in order. */
  readonly targets: number[] = [];
  setTargetAtTime(value: number): void {
    this.targets.push(value);
  }
  setValueAtTime(value: number): void {
    this.value = value;
  }
  linearRampToValueAtTime(value: number): void {
    this.value = value;
  }
  cancelScheduledValues(): void {}
}

class FakeNode {
  readonly outputs: FakeNode[] = [];
  connect(node: FakeNode): FakeNode {
    this.outputs.push(node);
    return node;
  }
  disconnect(): void {}
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

class FakeOscillator extends FakeNode {
  type = "sine";
  readonly frequency = new FakeParam();
  readonly detune = new FakeParam();
  onended: (() => void) | null = null;
  start(): void {}
  stop(): void {}
}

class FakeSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  loopEnd = 0;
  readonly playbackRate = new FakeParam();
  onended: (() => void) | null = null;
  start(): void {}
  stop(): void {}
}

/** A decoded recording, short enough that nothing thinks to trim it. */
const RECORDING = {
  duration: 1,
  numberOfChannels: 1,
  sampleRate: 48000,
  length: 48000,
  getChannelData: () => new Float32Array(48000),
};

class FakeContext {
  currentTime = 0;
  sampleRate = 48000;
  state = "running";
  readonly destination = new FakeNode();
  /** Every gain made, in the order it was made — how a voice is picked out below. */
  readonly gains: FakeGain[] = [];

  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createOscillator(): FakeOscillator {
    return new FakeOscillator();
  }
  createBufferSource(): FakeSource {
    return new FakeSource();
  }
  createBiquadFilter(): FakeNode & { type: string; frequency: FakeParam; Q: FakeParam } {
    return Object.assign(new FakeNode(), {
      type: "",
      frequency: new FakeParam(),
      Q: new FakeParam(),
    });
  }
  createConvolver(): FakeNode & { buffer: unknown } {
    return Object.assign(new FakeNode(), { buffer: null });
  }
  createDelay(): FakeNode & { delayTime: FakeParam } {
    return Object.assign(new FakeNode(), { delayTime: new FakeParam() });
  }
  createDynamicsCompressor(): FakeNode & {
    threshold: FakeParam;
    knee: FakeParam;
    ratio: FakeParam;
    attack: FakeParam;
    release: FakeParam;
  } {
    return Object.assign(new FakeNode(), {
      threshold: new FakeParam(),
      knee: new FakeParam(),
      ratio: new FakeParam(),
      attack: new FakeParam(),
      release: new FakeParam(),
    });
  }
  createBuffer(
    _channels: number,
    length: number,
  ): { duration: number; getChannelData: () => Float32Array } {
    const data = new Float32Array(length);
    return { duration: length / this.sampleRate, getChannelData: () => data };
  }
  async resume(): Promise<void> {}
  async decodeAudioData(): Promise<unknown> {
    return RECORDING;
  }
}

/** Everything sound can get to from `node`, itself included. */
function downstream(node: FakeNode): Set<FakeNode> {
  const seen = new Set<FakeNode>([node]);
  const queue = [node];
  for (const current of queue) {
    for (const next of current.outputs) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

describe("where a note is wired", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Start a player on the fake context and find the mute in its graph.
   *
   * The mute is picked out by what it does rather than by name — it is the one gain that
   * is ramped to zero by `setMuted`, asked before any note exists to be confused with.
   */
  async function started() {
    const ctx = new FakeContext();
    vi.stubGlobal("AudioContext", function AudioContextStub() {
      return ctx;
    });

    const player = new PianoAudioPlayer();
    await player.ensureStarted();
    player.setMuted(true);

    const muted = ctx.gains.filter((node) => node.gain.targets.includes(0));
    expect(muted).toHaveLength(1); // exactly one thing answers the mute button
    return { ctx, player, mute: muted[0]!, destination: ctx.destination };
  }

  /** The voice's own gain: the first one made while striking the note. */
  function voiceOf(ctx: FakeContext, strike: () => void): FakeGain {
    const before = ctx.gains.length;
    strike();
    const made = ctx.gains.slice(before);
    expect(made.length).toBeGreaterThan(0);
    return made[0]!;
  }

  it("sends the song's notes through the mute on their way out", async () => {
    const { ctx, player, mute, destination } = await started();
    const voice = voiceOf(ctx, () => player.triggerNote(60, 0.8, 0.5));
    const path = downstream(voice);

    expect(path.has(mute)).toBe(true);
    expect(path.has(destination)).toBe(true);
  });

  it("does the same for a key the player is holding down", async () => {
    const { ctx, player, mute } = await started();
    const voice = voiceOf(ctx, () => player.noteOn(60, 0.8));
    expect(downstream(voice).has(mute)).toBe(true);
  });

  it("takes a preview round the mute, so a muted app can still play you a song", async () => {
    const { ctx, player, mute, destination } = await started();
    const voice = voiceOf(ctx, () => player.previewNote(60, 0.8, 0.5));
    const path = downstream(voice);

    expect(path.has(mute)).toBe(false);
    expect(path.has(destination)).toBe(true);
  });

  it("still puts a preview through the room and the volume knob", async () => {
    const { ctx, player, destination } = await started();
    const song = voiceOf(ctx, () => player.triggerNote(60, 0.8, 0.5));
    const preview = voiceOf(ctx, () => player.previewNote(64, 0.8, 0.5));

    // Everything the song's notes pass through on the far side of the mute, a preview
    // passes through too: same room, same compressor, same volume.
    const shared = [...downstream(song)].filter((node) => downstream(preview).has(node));
    expect(shared).toContain(destination);
    expect(shared.length).toBeGreaterThan(3);
  });

  it("ramps the mute rather than switching it, in both directions", async () => {
    const { player, mute } = await started();
    player.setMuted(false);
    expect(mute.gain.targets).toEqual([0, 1]);
  });

  /**
   * The sustain pedal, which is the one control that changes what a *release* means.
   *
   * A voice is picked out here by the gain that gets ramped to zero — dropping a damper is
   * the only thing that does that to a voice — so these are assertions about whether the
   * damper fell, which is exactly what the pedal decides.
   */
  describe("the sustain pedal", () => {
    /** Did this note's damper come down? */
    const damped = (voice: FakeGain): boolean => voice.gain.targets.includes(0);

    it("lets a released key go on ringing while it is down", async () => {
      const { ctx, player } = await started();
      player.setSustain(true);

      const voice = voiceOf(ctx, () => player.noteOn(60, 0.8));
      player.noteOff(60);
      expect(damped(voice)).toBe(false);
    });

    it("drops every damper it was holding when it comes up", async () => {
      const { ctx, player } = await started();
      player.setSustain(true);

      const first = voiceOf(ctx, () => player.noteOn(60, 0.8));
      const second = voiceOf(ctx, () => player.noteOn(64, 0.8));
      player.noteOff(60);
      player.noteOff(64);
      expect(damped(first)).toBe(false);

      player.setSustain(false);
      expect(damped(first)).toBe(true);
      expect(damped(second)).toBe(true);
    });

    /** The pedal holds what has been let go of. A key still down is held by the finger. */
    it("leaves a key that is still down alone when it comes up", async () => {
      const { ctx, player } = await started();
      player.setSustain(true);
      const voice = voiceOf(ctx, () => player.noteOn(60, 0.8));

      player.setSustain(false);
      expect(damped(voice)).toBe(false);

      player.noteOff(60);
      expect(damped(voice)).toBe(true);
    });

    it("damps a released key as usual when it is up", async () => {
      const { ctx, player } = await started();
      const voice = voiceOf(ctx, () => player.noteOn(60, 0.8));
      player.noteOff(60);
      expect(damped(voice)).toBe(true);
    });

    /**
     * What a real piano does: with the pedal down a repeated note thickens rather than
     * restarting, because the first string was never damped.
     */
    it("lets the same note ring twice over", async () => {
      const { ctx, player } = await started();
      player.setSustain(true);

      const first = voiceOf(ctx, () => player.noteOn(60, 0.8));
      player.noteOff(60);
      const second = voiceOf(ctx, () => player.noteOn(60, 0.8));

      expect(second).not.toBe(first);
      expect(damped(first)).toBe(false);

      player.setSustain(false);
      expect(damped(first)).toBe(true);
    });

    it("does nothing at all for a pedal pressed twice", async () => {
      const { ctx, player } = await started();
      player.setSustain(true);
      const voice = voiceOf(ctx, () => player.noteOn(60, 0.8));
      player.noteOff(60);

      player.setSustain(true); // a pedal that repeats its message
      expect(damped(voice)).toBe(false);
    });

    /**
     * The accompaniment is not pedalled: its notes came out of the file with their own
     * durations, and smearing the part you are playing along to would make it harder to
     * hear against — which is the one thing it is there for.
     */
    it("does not hold the auto-played part", async () => {
      const { ctx, player } = await started();
      player.setSustain(true);
      const voice = voiceOf(ctx, () => player.triggerNote(60, 0.8, 0.5));
      expect(damped(voice)).toBe(true); // damped on its own duration, pedal or no pedal
    });
  });

  /**
   * A sampled note is a different way of making the sound and nothing else. It hangs off
   * the same damper, behind the same mute, through the same room — which is the whole
   * claim of `setInstruments`, and the one part of it that only shows up in the graph.
   */
  describe("with a sampled instrument loaded", () => {
    /**
     * An instrument with a recording of middle C and a hole where the top one should be —
     * a library part-way through loading, or one with a file that would not read.
     */
    async function sampled() {
      const running = await started();
      await running.player.setInstruments([
        {
          name: "Grand Piano",
          samples: [
            { midi: 60, file: "060-one.flac" },
            { midi: 84, file: "084-one.flac" },
          ],
          read: async (file: string) => (file === "084-one.flac" ? null : new ArrayBuffer(8)),
        },
      ]);
      return running;
    }

    it("plays the recording rather than the synth", async () => {
      const { ctx, player } = await sampled();
      const before = ctx.gains.length;
      player.triggerNote(60, 0.8, 0.5);
      // Three: the damper, the velocity envelope and this layer's blend. A synthesised
      // note would have made a dozen, one per partial.
      expect(ctx.gains.length - before).toBe(3);
    });

    it("still sends the song's notes through the mute", async () => {
      const { ctx, player, mute, destination } = await sampled();
      const voice = voiceOf(ctx, () => player.triggerNote(60, 0.8, 0.5));
      const path = downstream(voice);

      expect(path.has(mute)).toBe(true);
      expect(path.has(destination)).toBe(true);
    });

    it("still takes a preview round it", async () => {
      const { ctx, player, mute, destination } = await sampled();
      const path = downstream(voiceOf(ctx, () => player.previewNote(60, 0.8, 0.5)));

      expect(path.has(mute)).toBe(false);
      expect(path.has(destination)).toBe(true);
    });

    /**
     * The fallback that makes a library load in the background instead of behind a
     * progress bar: a note the instrument has no recording for is still played, by the
     * synth, rather than being dropped.
     */
    it("falls back to the synth for a note it has no recording of", async () => {
      const { ctx, player, mute } = await sampled();
      const before = ctx.gains.length;
      const voice = voiceOf(ctx, () => player.triggerNote(84, 0.8, 0.5));

      expect(ctx.gains.length - before).toBeGreaterThan(3); // a partial each
      expect(downstream(voice).has(mute)).toBe(true);
    });

    it("goes back to the synth when the instrument is taken away", async () => {
      const { ctx, player } = await sampled();
      await player.setInstruments([]);
      expect(player.instrumentNames).toEqual([]);

      const before = ctx.gains.length;
      player.triggerNote(60, 0.8, 0.5);
      expect(ctx.gains.length - before).toBeGreaterThan(3);
    });
  });

  /**
   * Layering: several instruments sounding on one note. The thing that has to hold is that
   * they are one *note* — one damper, one release, one voice — however many recordings
   * went into it. Two notes that happened to start together would come apart the moment a
   * key was let go.
   */
  describe("with two instruments layered", () => {
    async function layered() {
      const running = await started();
      await running.player.setInstruments([
        {
          name: "Grand Piano",
          samples: [{ midi: 60, file: "piano.flac" }],
          read: async () => new ArrayBuffer(8),
        },
        {
          name: "Ancient Choir",
          samples: [{ midi: 60, file: "choir.flac" }],
          level: 0.4,
          read: async () => new ArrayBuffer(8),
        },
      ]);
      return running;
    }

    it("loads both, in the order they were chosen", async () => {
      const { player } = await layered();
      expect(player.instrumentNames).toEqual(["Grand Piano", "Ancient Choir"]);
    });

    it("puts both recordings behind the same damper", async () => {
      const { ctx, player, mute, destination } = await layered();
      const voice = voiceOf(ctx, () => player.triggerNote(60, 0.8, 0.5));
      const path = downstream(voice);

      // Two envelopes and two blends hanging off the one damper, and one way out.
      expect(path.has(mute)).toBe(true);
      expect(path.has(destination)).toBe(true);
    });

    it("gives each layer its own level, set where it was asked for", async () => {
      const { ctx, player } = await layered();
      const before = ctx.gains.length;
      player.triggerNote(60, 0.8, 0.5);

      // Damper, then two (envelope, blend) pairs — one per layer.
      const made = ctx.gains.slice(before);
      expect(made).toHaveLength(5);
      expect(made.map((gain) => gain.gain.value)).toContain(0.4);
    });

    /** A blend is aimed by ear, so it has to reach the chord already under your hands. */
    it("moves a level on a note that is already sounding", async () => {
      const { ctx, player } = await layered();
      const before = ctx.gains.length;
      player.noteOn(60, 0.8);
      const made = ctx.gains.slice(before);

      player.setInstrumentLevel("Ancient Choir", 0.9);
      const ramped = made.filter((gain) => gain.gain.targets.includes(0.9));
      expect(ramped).toHaveLength(1);
    });

    it("ignores a level for an instrument that is not in the stack", async () => {
      const { player } = await layered();
      expect(() => player.setInstrumentLevel("Nothing At All", 0.5)).not.toThrow();
    });

    it("keeps an instrument that is still wanted when another is added", async () => {
      const { player } = await layered();
      let reread = false;

      await player.setInstruments([
        {
          name: "Grand Piano",
          samples: [{ midi: 60, file: "piano.flac" }],
          read: async () => {
            reread = true;
            return new ArrayBuffer(8);
          },
        },
        {
          name: "Vibes",
          samples: [{ midi: 60, file: "vibes.flac" }],
          read: async () => new ArrayBuffer(8),
        },
      ]);

      expect(player.instrumentNames).toEqual(["Grand Piano", "Vibes"]);
      expect(reread).toBe(false); // it never stopped playing, so it was never reloaded
    });
  });
});
