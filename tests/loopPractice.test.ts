import { describe, it, expect, beforeEach } from "vitest";
import type { AudioPlayer } from "../src/audio/Player.ts";
import type { Note, Song } from "../src/core/types.ts";
import { AutoPlayer } from "../src/game/AutoPlayer.ts";
import { Conductor } from "../src/game/Conductor.ts";
import { GameSession } from "../src/game/GameSession.ts";
import { firstGroupAtOrAfter, groupChords } from "../src/game/practice.ts";

/**
 * A looping run, driven the way the render loop drives it.
 *
 * The bug this covers: the wait-mode gate was left parked past the last chord when a lap
 * ended, so the second time round the loop — and every time after it — the song played
 * itself through without waiting for a single note.
 */

class SilentPlayer implements AudioPlayer {
  async ensureStarted() {}
  triggerNote() {}
  previewNote() {}
  noteOn() {}
  noteOff() {}
  setMuted() {}
  setVolume() {}
}

function note(midi: number, time: number): Note {
  return { midi, time, duration: 0.3, velocity: 0.8, hand: "right" };
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

describe("looping a range in wait mode", () => {
  let conductor: Conductor;
  let session: GameSession;
  let wallMs: number;

  /** One render-loop frame: advance the clock, then let the session gate it. */
  function frame(count = 1): number {
    for (let i = 0; i < count; i++) {
      wallMs += 16;
      session.update(conductor.tick(wallMs));
    }
    return conductor.time;
  }

  /** Play the two notes of the range, letting the clock run on between them. */
  function playLap(): void {
    expect(session.handleHit(60)).toBe("perfect");
    frame(20);
    expect(session.handleHit(62)).toBe("perfect");
  }

  beforeEach(() => {
    wallMs = 0;
    conductor = new Conductor();
    session = new GameSession(conductor, new AutoPlayer(new SilentPlayer()));
    session.configure({
      song: song([note(60, 1.0), note(62, 1.5), note(64, 3.0)]),
      hand: "both",
      difficulty: "easy",
      range: { start: 1, end: 2 },
      waitMode: true,
      loop: true,
    });
    session.start();
  });

  it("starts the run at the top of the range", () => {
    expect(conductor.time).toBe(1);
  });

  it("holds at the first note of every lap, not just the first", () => {
    for (let lap = 1; lap <= 3; lap++) {
      // Held at the first chord of the range until it is played.
      expect(frame(40)).toBeCloseTo(1.0, 5);
      playLap();
      // Played, so the lap runs out to the end of the range and comes round again.
      frame(60);
      expect(conductor.time).toBeLessThan(2);
    }
  });

  it("never ends a looping run", () => {
    for (let lap = 0; lap < 3; lap++) {
      frame(40);
      playLap();
      frame(60);
    }
    expect(session.getState()).toBe("running");
  });

  it("wrongly played notes do not pile up across laps", () => {
    frame(40);
    expect(session.handleHit(61)).toBe("wrong"); // belongs to no gate
    playLap();
    frame(60); // round to lap two, which starts the score again

    frame(40);
    expect(session.handleHit(60)).toBe("perfect");
  });
});

describe("scrolling the track during a run", () => {
  let conductor: Conductor;
  let session: GameSession;
  let finished = false;
  let wallMs = 0;

  function frame(count = 1): number {
    for (let i = 0; i < count; i++) {
      wallMs += 16;
      session.update(conductor.tick(wallMs));
    }
    return conductor.time;
  }

  beforeEach(() => {
    wallMs = 0;
    finished = false;
    conductor = new Conductor();
    session = new GameSession(conductor, new AutoPlayer(new SilentPlayer()));
    session.onFinish = () => (finished = true);
    session.configure({
      song: song([note(60, 1.0), note(62, 2.0), note(64, 3.0)]),
      hand: "both",
      difficulty: "easy",
      range: null,
      waitMode: true,
      loop: false,
    });
    session.start();
    frame(80); // held at the first note
  });

  it("stays where it was put instead of being dragged back to the gate", () => {
    conductor.pause();
    session.seek(2.5);
    expect(frame(10)).toBeCloseTo(2.5, 5);
  });

  it("waits at the next note after the one scrolled past", () => {
    conductor.pause();
    session.seek(2.5);
    conductor.play();
    expect(frame(60)).toBeCloseTo(3.0, 5); // held at the note at 3s, not the one at 2s
  });

  it("does not answer a scroll to the end with a score card", () => {
    conductor.pause();
    session.seek(4);
    frame(10);
    expect(finished).toBe(false);
    expect(session.getState()).toBe("running");
  });

  it("still finishes when the run plays out to the end", () => {
    session.seek(3.9);
    conductor.play();
    frame(30);
    expect(finished).toBe(true);
  });
});

describe("firstGroupAtOrAfter", () => {
  const groups = groupChords([note(60, 1), note(62, 2), note(64, 3)]);

  it("finds the gate a time lands on", () => {
    expect(firstGroupAtOrAfter(groups, 2)).toBe(1);
  });

  it("finds the next gate after a time between two", () => {
    expect(firstGroupAtOrAfter(groups, 2.5)).toBe(2);
  });

  it("is the first gate before the music starts", () => {
    expect(firstGroupAtOrAfter(groups, 0)).toBe(0);
  });

  it("runs off the end past the last gate", () => {
    expect(firstGroupAtOrAfter(groups, 9)).toBe(3);
  });

  it("has nowhere to point in an empty range", () => {
    expect(firstGroupAtOrAfter([], 1)).toBe(0);
  });
});
