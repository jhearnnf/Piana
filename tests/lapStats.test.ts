import { describe, it, expect, beforeEach } from "vitest";
import type { AudioPlayer } from "../src/audio/Player.ts";
import type { Note, Song } from "../src/core/types.ts";
import { AutoPlayer } from "../src/game/AutoPlayer.ts";
import { Conductor } from "../src/game/Conductor.ts";
import { GameSession } from "../src/game/GameSession.ts";
import type { ScoreResult } from "../src/game/Scoring.ts";

/**
 * What a lap of a loop leaves behind.
 *
 * A loop never finishes, so the score card never comes up and nothing about the twenty
 * minutes you just spent on eight bars was ever written down. Each lap now reports itself,
 * which is what a progress report is eventually made of — so what counts as a lap, and how
 * long it is held to have taken, is worth pinning down here rather than reading off a chart
 * months later and wondering.
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
  return { midi, time, duration: 0.2, velocity: 0.8, hand: "right" };
}

function song(notes: Note[]): Song {
  return {
    name: "test",
    notes,
    tracks: [],
    tempoMap: [{ time: 0, bpm: 120 }],
    timeSignature: { numerator: 4, denominator: 4 },
    durationSec: 4,
  };
}

describe("recording each lap of a loop", () => {
  let conductor: Conductor;
  let session: GameSession;
  let laps: { result: ScoreResult; seconds: number }[];
  let wallMs: number;

  /** One render-loop frame, 20ms of it, driven off the same clock the transport is. */
  function frame(count = 1): number {
    for (let i = 0; i < count; i++) {
      wallMs += 20;
      session.update(conductor.tick(wallMs), wallMs);
    }
    return conductor.time;
  }

  /**
   * Frames until the song clock reaches `target`, so a hit can be timed against a note.
   *
   * Gives up if the loop comes round first: the transport wraps inside its own arithmetic,
   * so the end of a range is a time the clock is never seen holding.
   */
  function frameTo(target: number): void {
    for (let i = 0; i < 500 && conductor.time < target; i++) {
      const before = conductor.time;
      frame();
      if (conductor.time < before) return;
    }
  }

  /** Frames until the loop comes round, which is what ends a lap. */
  function wrap(): void {
    for (let i = 0; i < 500; i++) {
      const before = conductor.time;
      frame();
      if (conductor.time < before) return;
    }
    throw new Error("the loop never came round");
  }

  /** Play the range's two notes where they are written. */
  function playLap(): void {
    expect(session.handleHit(60)).toBe("perfect");
    frameTo(1.5);
    expect(session.handleHit(62)).toBe("perfect");
  }

  beforeEach(() => {
    wallMs = 0;
    laps = [];
    conductor = new Conductor();
    session = new GameSession(conductor, new AutoPlayer(new SilentPlayer()));
    session.onLap = (result, seconds) => laps.push({ result, seconds });
    session.configure({
      song: song([note(60, 1.0), note(62, 1.5), note(64, 3.0)]),
      hand: "both",
      difficulty: "easy",
      range: { start: 1, end: 2 },
      waitMode: false,
      loop: true,
    });
    session.start();
    frame(); // anchors the lap clock, as the first frame of a run does
  });

  it("reports a lap as it comes round, scored on its own", () => {
    playLap();
    wrap();

    expect(laps).toHaveLength(1);
    expect(laps[0]!.result.perfect).toBe(2);
    expect(laps[0]!.result.missed).toBe(0);
    expect(laps[0]!.result.accuracy).toBe(1);
  });

  it("counts each lap separately rather than carrying the last one round", () => {
    playLap();
    wrap();

    // A second lap with one of the two notes played and the other left alone.
    expect(session.handleHit(60)).toBe("perfect");
    wrap();

    expect(laps).toHaveLength(2);
    expect(laps[1]!.result.perfect).toBe(1);
    expect(laps[1]!.result.missed).toBe(1);
  });

  it("times how long the lap took, not how long the range is", () => {
    playLap();
    wrap();

    expect(laps[0]!.seconds).toBeGreaterThan(0.9);
    expect(laps[0]!.seconds).toBeLessThan(1.1);
  });

  it("does not count time the run was paused", () => {
    frameTo(1.4);
    conductor.pause();
    frame(200); // four seconds of standing still
    conductor.play();
    wrap();

    // Nothing was played, so nothing is reported — but the lap that follows is timed from
    // the wrap rather than from the pause.
    expect(laps).toHaveLength(0);
    playLap();
    wrap();
    expect(laps[0]!.seconds).toBeLessThan(1.1);
  });

  it("says nothing about a loop left running while nobody plays", () => {
    for (let lap = 0; lap < 3; lap++) {
      wrap();
    }
    expect(laps).toEqual([]);
  });

  it("counts a lap you played wrongly, which is still a lap you played", () => {
    expect(session.handleHit(61)).toBe("wrong");
    wrap();

    expect(laps).toHaveLength(1);
    expect(laps[0]!.result.wrong).toBe(1);
  });

  it("leaves out the half lap you scrolled into", () => {
    session.seek(1.6);
    expect(session.handleHit(60)).toBe("wrong"); // played something, all the same
    wrap();
    expect(laps).toEqual([]);

    // The whole lap that follows it is an attempt like any other.
    playLap();
    wrap();
    expect(laps).toHaveLength(1);
  });

  it("forgets the lap you abandoned by starting over", () => {
    expect(session.handleHit(60)).toBe("perfect");
    session.start(); // Restart, half way through
    playLap();
    wrap();

    expect(laps).toHaveLength(1);
    expect(laps[0]!.result.perfect).toBe(2);
  });
});

describe("a scored run that plays to the end", () => {
  it("reports how long it took alongside its score", () => {
    const conductor = new Conductor();
    const session = new GameSession(conductor, new AutoPlayer(new SilentPlayer()));
    let finish: { result: ScoreResult; seconds: number } | null = null;
    session.onFinish = (result, seconds) => (finish = { result, seconds });
    session.configure({
      song: song([note(60, 1.0), note(62, 1.5)]),
      hand: "both",
      difficulty: "easy",
      range: { start: 1, end: 2 },
      waitMode: false,
      loop: false,
    });
    session.start();

    let wallMs = 0;
    for (let i = 0; i < 100 && session.getState() === "running"; i++) {
      wallMs += 20;
      session.update(conductor.tick(wallMs), wallMs);
    }

    expect(finish).not.toBeNull();
    expect(finish!.seconds).toBeGreaterThan(0.9);
    expect(finish!.seconds).toBeLessThan(1.1);
  });
});
