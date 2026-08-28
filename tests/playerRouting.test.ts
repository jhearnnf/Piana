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
  start(): void {}
  stop(): void {}
}

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
});
