import { describe, it, expect, vi, afterEach } from "vitest";
import type { Note } from "../src/core/types.ts";
import type { AudioPlayer } from "../src/audio/Player.ts";
import {
  MAX_PREVIEW_RATE,
  MIN_PREVIEW_RATE,
  PREVIEW_SECONDS,
  previewPlan,
  SongPreview,
} from "../src/game/SongPreview.ts";

function note(time: number, duration = 0.5): Note {
  return { midi: 60, time, duration, velocity: 0.8, hand: "right" };
}

/** Notes every `gap` seconds, starting at `start`, spanning `span` seconds. */
function run(start: number, span: number, gap = 0.5): Note[] {
  const notes: Note[] = [];
  for (let t = start; t <= start + span + 1e-9; t += gap) notes.push(note(t));
  return notes;
}

describe("previewPlan", () => {
  it("has nothing to play for a song with no notes", () => {
    expect(previewPlan([])).toBeNull();
  });

  it("starts at the first note, not at zero", () => {
    const plan = previewPlan(run(12, 30));
    expect(plan?.from).toBe(12);
  });

  it("fits a middling song into the time a preview gets", () => {
    const plan = previewPlan(run(0, 16))!;
    expect(plan.rate).toBeCloseTo(2, 5);
    expect((plan.until - plan.from) / plan.rate).toBeLessThanOrEqual(PREVIEW_SECONDS);
  });

  it("does not race through a song short enough to hear as it is", () => {
    const plan = previewPlan(run(0, 4))!;
    expect(plan.rate).toBe(MIN_PREVIEW_RATE);
    expect(plan.until).toBe(4); // all of it, with time to spare
  });

  it("gives a long song its opening rather than an unrecognisable gabble", () => {
    const plan = previewPlan(run(0, 600))!;
    expect(plan.rate).toBe(MAX_PREVIEW_RATE);
    expect(plan.until - plan.from).toBe(PREVIEW_SECONDS * MAX_PREVIEW_RATE);
  });

  it("never plans past the last note", () => {
    for (const span of [0, 1, 9, 25, 120]) {
      const plan = previewPlan(run(3, span))!;
      expect(plan.until).toBeLessThanOrEqual(3 + span);
      expect(plan.until).toBeGreaterThanOrEqual(plan.from);
    }
  });

  it("keeps every preview inside its budget of real seconds", () => {
    for (const span of [0.5, 5, 12, 60, 900]) {
      const plan = previewPlan(run(0, span))!;
      expect((plan.until - plan.from) / plan.rate).toBeLessThanOrEqual(PREVIEW_SECONDS + 1e-9);
    }
  });

  it("copes with a song that is one note long", () => {
    const plan = previewPlan([note(7)])!;
    expect(plan.from).toBe(7);
    expect(plan.until).toBe(7);
    expect(plan.rate).toBe(MIN_PREVIEW_RATE);
  });
});

/**
 * The preview running, with the browser's clock and frames in hand.
 *
 * Everything that matters here is a matter of timing — which notes have sounded by now,
 * and whether any sound after you point somewhere else — so the frames are pumped by hand
 * rather than waited for.
 */
describe("SongPreview", () => {
  interface Fired {
    midi: number;
    velocity: number;
    duration: number;
    /** Which way into the player it came — the ordinary one is the one the mute stops. */
    throughMute: boolean;
  }

  /** An audio player that writes down what it was asked to play, and by which route. */
  function recorder(): { fired: Fired[]; player: AudioPlayer } {
    const fired: Fired[] = [];
    return {
      fired,
      player: {
        ensureStarted: () => Promise.resolve(),
        triggerNote: (midi, velocity, duration) =>
          fired.push({ midi, velocity, duration, throughMute: true }),
        previewNote: (midi, velocity, duration) =>
          fired.push({ midi, velocity, duration, throughMute: false }),
        noteOn: () => {},
        noteOff: () => {},
        setSustain: () => {},
        setMuted: () => {},
        setVolume: () => {},
      },
    };
  }

  /** Stand in for the browser's clock and its frames; returns the controls. */
  function fakeFrames() {
    let now = 0;
    let pending: FrameRequestCallback | null = null;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      pending = cb;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      pending = null;
    });
    return {
      /** Move the clock to `seconds` and draw the frame that falls there. */
      frameAt(seconds: number): void {
        now = seconds * 1000;
        const frame = pending;
        pending = null;
        frame?.(now);
      },
      waiting: () => pending !== null,
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("plays the song through, at speed and softer than it was written", async () => {
    const { fired, player } = recorder();
    const clock = fakeFrames();
    // Four notes over twelve seconds: the slowest a preview goes, so eight seconds of it.
    const notes = [note(0), note(4), note(8), note(12)];

    const done = new SongPreview(player).play(notes);

    clock.frameAt(1); // 1.5s into the song
    expect(fired.map((f) => f.midi)).toEqual([60]);
    expect(fired[0]!.velocity).toBeCloseTo(0.8 * 0.75, 5);
    // Held for as long as it takes at this speed, not for as long as it is written.
    expect(fired[0]!.duration).toBeCloseTo(0.5 / MIN_PREVIEW_RATE, 5);

    clock.frameAt(3); // 4.5s
    expect(fired).toHaveLength(2);

    clock.frameAt(8); // the far end: the last two notes still have to sound
    expect(fired).toHaveLength(4);
    // Not by the route the mute button cuts: a preview plays whether the app is muted
    // or not, because it is the sound you just asked for.
    expect(fired.some((f) => f.throughMute)).toBe(false);
    await expect(done).resolves.toBeUndefined();
    expect(clock.waiting()).toBe(false);
  });

  it("goes quiet as soon as you point somewhere else", async () => {
    const { fired, player } = recorder();
    const clock = fakeFrames();
    const preview = new SongPreview(player);

    const done = preview.play([note(0), note(4), note(8), note(12)]);
    clock.frameAt(1);
    expect(preview.isPlaying()).toBe(true);

    preview.stop();
    await expect(done).resolves.toBeUndefined();
    expect(preview.isPlaying()).toBe(false);

    clock.frameAt(6); // whatever the clock does now, nothing more is played
    expect(fired).toHaveLength(1);
  });

  it("has nothing to do for a song with no notes", async () => {
    const { fired, player } = recorder();
    fakeFrames();
    const preview = new SongPreview(player);
    await expect(preview.play([])).resolves.toBeUndefined();
    expect(preview.isPlaying()).toBe(false);
    expect(fired).toEqual([]);
  });
});
