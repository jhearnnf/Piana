import { describe, it, expect, beforeEach } from "vitest";
import type { AudioPlayer } from "../src/audio/Player.ts";
import type { Note, Song } from "../src/core/types.ts";
import type { ScoreResult } from "../src/game/Scoring.ts";
import { AutoPlayer } from "../src/game/AutoPlayer.ts";
import { Conductor } from "../src/game/Conductor.ts";
import { GameSession } from "../src/game/GameSession.ts";

/**
 * Wait-mode gating end to end, driven the way the render loop drives it.
 *
 * The case that matters here is two notes written milliseconds apart — too far apart to
 * be one chord, close enough that they're struck as one movement — and the keyboard
 * reporting them in the order its scan happens to produce rather than the written one.
 */

class SilentPlayer implements AudioPlayer {
  async ensureStarted() {}
  triggerNote() {}
  previewNote() {}
  noteOn() {}
  noteOff() {}
  setSustain() {}
  setMuted() {}
  setVolume() {}
}

function note(midi: number, time: number): Note {
  return { midi, time, duration: 0.4, velocity: 0.8, hand: "right" };
}

function song(notes: Note[]): Song {
  return {
    name: "test",
    notes,
    tracks: [],
    tempoMap: [{ time: 0, bpm: 120 }],
    timeSignature: { numerator: 4, denominator: 4 },
    durationSec: 3,
  };
}

describe("wait mode with near-simultaneous notes", () => {
  let conductor: Conductor;
  let session: GameSession;
  let finished: ScoreResult | null;
  let wallMs: number;

  /** One render-loop frame: advance the clock, then let the session gate it. */
  function frame(count = 1): number {
    for (let i = 0; i < count; i++) {
      wallMs += 16;
      session.update(conductor.tick(wallMs));
    }
    return conductor.time;
  }

  // 40ms apart: past groupChords' 30ms tolerance, so these are two separate gates.
  const spread = [note(60, 1.0), note(64, 1.04)];

  beforeEach(() => {
    wallMs = 0;
    finished = null;
    conductor = new Conductor();
    session = new GameSession(conductor, new AutoPlayer(new SilentPlayer()));
    session.onFinish = (result) => (finished = result);
    session.configure({
      song: song(spread),
      hand: "both",
      difficulty: "easy",
      range: null,
      waitMode: true,
      loop: false,
    });
    session.start();
    frame(80); // ~1.28s of wall clock: enough to reach the first gate and be held there
  });

  it("holds at the gate until the notes are played", () => {
    expect(frame(20)).toBeCloseTo(1.0);
    expect(session.getState()).toBe("running");
  });

  it("continues when they arrive in the written order", () => {
    expect(session.handleHit(60)).toBe("perfect");
    expect(session.handleHit(64)).toBe("perfect");
    expect(frame(20)).toBeGreaterThan(1.04);
  });

  it("continues when the keyboard reports them the other way round", () => {
    // The reported bug: 64 was judged wrong, and its own gate then waited for a note the
    // player had already struck, so the song sat there until it was struck again.
    expect(session.handleHit(64)).toBe("perfect");
    expect(session.handleHit(60)).toBe("perfect");
    expect(frame(20)).toBeGreaterThan(1.04);
  });

  it("holds neither of them against the score when played out of order", () => {
    session.handleHit(64);
    session.handleHit(60);
    frame(200); // run out the song so the result is produced
    expect(session.getState()).toBe("finished");
    expect(finished).not.toBeNull();
    expect(finished!.wrong).toBe(0);
    expect(finished!.missed).toBe(0);
    expect(finished!.accuracy).toBe(1);
  });

  it("still calls a note that belongs to no nearby gate wrong, and keeps holding", () => {
    expect(session.handleHit(61)).toBe("wrong");
    expect(frame(20)).toBeCloseTo(1.0);
  });
});
